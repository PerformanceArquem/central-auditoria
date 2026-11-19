'use strict';

// Etapa 5: produtividade = horas realmente apontadas (workTime sincronizado).
// Não estimar capacidade, jornada, esforço sem registro, eficiência ou culpabilidade.
const PERIODS=new Set([7,28,56,84]);
const COMPARES=new Set(['previous','year-prior']);
const clean=(v,max=150)=>String(v??'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max);
const fold=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const dateMs=v=>{
  if(typeof v!=='string'||! /^\d{4}-\d{2}-\d{2}$/.test(v))return null;
  const ms=Date.parse(v+'T12:00:00.000Z');
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===v?ms:null;
};
const dateFromMs=ms=>new Date(ms).toISOString().slice(0,10);
const plusDays=(date,days)=>{
  const ms=dateMs(date);
  if(ms===null)throw new RangeError('Data inválida');
  return dateFromMs(ms+days*86400000);
};
function priorYear(date){
  const [y,m,d]=date.split('-').map(Number);
  // 29/02 não existe em anos não bissextos: usar 28/02 e preservar duração.
  const candidate=y-1+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  return dateMs(candidate)!==null?candidate:y-1+'-02-28';
}
function makeWindows(to,days=28,comparison='previous'){
  if(!PERIODS.has(days)||!COMPARES.has(comparison)||dateMs(to)===null)
    throw new RangeError('Período ou comparação inválidos');
  const from=plusDays(to,1-days);
  const priorFrom=comparison==='previous'?plusDays(from,-days):priorYear(from);
  const priorTo=plusDays(priorFrom,days-1);
  return {days,comparison,current:{from,to},baseline:{from:priorFrom,to:priorTo},
    basis:'dias corridos completos',sameNumberOfDays:true};
}
const hours=minutes=>Math.round(minutes/60*100)/100;
const percent=(now,prior)=>prior>0?Math.round(((now-prior)/prior)*1000)/10:null;
function analyzeProductivity(currentRows,baselineRows,options={}) {
  if(!Array.isArray(currentRows)||!Array.isArray(baselineRows))
    throw new TypeError('Apontamentos devem ser listas');
  const window=makeWindows(options.to,options.days||28,options.comparison||'previous');
  const holidays=options.holidays===null?null:options.holidays instanceof Set?options.holidays:new Set();
  const invalid={current:0,baseline:0},missing={sector:0,collaborator:0,activity:0,ticketId:0};
  const warnings=[];
  const group=(map,key,name)=>{if(!map.has(key))map.set(key,{
    name,minutes:0,entries:0,dates:new Set(),tickets:new Set(),activityMinutes:new Map()
  });return map.get(key)};
  function summarize(rows,bounds,period){
    const totals={minutes:0,entries:0,weekendMinutes:0,holidayMinutes:0,weekdayMinutes:0,
      workedDates:new Set(),tickets:new Set()};
    const teams=new Map(),people=new Map(),activities=new Map();
    const weekly=Array.from({length:window.days/7},(_,index)=>({
      index:index+1,
      from:plusDays(bounds.from,index*7),
      to:plusDays(bounds.from,index*7+6),
      minutes:0,entries:0,tickets:new Set()
    }));
    for(const row of rows){
      const value=row?.duration_minutes;
      const minutes=typeof value==='number'?value:
        typeof value==='string'&&value.trim()?Number(value):NaN;
      const date=clean(row?.appointment_date,12);
      if(dateMs(date)===null||date<bounds.from||date>bounds.to||
         !Number.isFinite(minutes)||minutes<=0||minutes>1440){
        invalid[period]++;continue;
      }
      const teamName=clean(row?.sector,120)||'Setor não informado';
      const personName=clean(row?.collaborator_name,120)||'Colaborador não informado';
      const activityName=clean(row?.activity,120)||'Atividade não informada';
      if(!clean(row?.sector))missing.sector++;
      if(!clean(row?.collaborator_name))missing.collaborator++;
      if(!clean(row?.activity))missing.activity++;
      const ticketId=clean(row?.ticket_id,30);
      const validTicket=/^\d{1,20}$/.test(ticketId);
      if(!validTicket)missing.ticketId++;
      const weekday=new Date(date+'T12:00:00Z').getUTCDay();
      const isWeekend=weekday===0||weekday===6;
      // O cadastro de feriados é das rotinas de envio; pode não cobrir todos os feriados.
      const isRegisteredHoliday=holidays!==null&&holidays.has(date);
      totals.minutes+=minutes;totals.entries++;totals.workedDates.add(date);
      if(validTicket)totals.tickets.add(ticketId);
      if(isWeekend)totals.weekendMinutes+=minutes;
      else if(isRegisteredHoliday)totals.holidayMinutes+=minutes;
      else totals.weekdayMinutes+=minutes;
      for(const [map,name] of [[teams,teamName],[people,personName],[activities,activityName]]){
        const entry=group(map,fold(name)||'nao informado',name);
        entry.minutes+=minutes;entry.entries++;entry.dates.add(date);
        if(validTicket)entry.tickets.add(ticketId);
        entry.activityMinutes.set(activityName,(entry.activityMinutes.get(activityName)||0)+minutes);
      }
      const index=Math.floor((dateMs(date)-dateMs(bounds.from))/86400000/7);
      if(weekly[index]){
        weekly[index].minutes+=minutes;weekly[index].entries++;
        if(validTicket)weekly[index].tickets.add(ticketId);
      }
    }
    return {totals,teams,people,activities,weekly};
  }
  const current=summarize(currentRows,window.current,'current');
  const baseline=summarize(baselineRows,window.baseline,'baseline');
  const toSummary=x=>({
    hours:hours(x.minutes),minutes:x.minutes,appointments:x.entries,
    uniqueTickets:x.tickets.size,daysWithAppointments:x.workedDates.size,
    weekendHours:hours(x.weekendMinutes),
    registeredHolidayHours:holidays===null?null:hours(x.holidayMinutes),
    otherWeekdayHours:holidays===null?null:hours(x.weekdayMinutes),
    calendarDays:window.days
  });
  const mergeGroups=(key,limit=50)=>{
    const a=current[key],b=baseline[key];
    return [...new Set([...a.keys(),...b.keys()])].map(k=>{
      const curr=a.get(k),old=b.get(k);
      const minutes=curr?.minutes||0,priorMinutes=old?.minutes||0;
      return {
        name:curr?.name||old?.name||'Não informado',
        currentHours:hours(minutes),baselineHours:hours(priorMinutes),
        varianceHours:hours(minutes-priorMinutes),variancePercent:percent(minutes,priorMinutes),
        currentAppointments:curr?.entries||0,baselineAppointments:old?.entries||0,
        currentUniqueTickets:curr?.tickets.size||0,
        baselineUniqueTickets:old?.tickets.size||0,
        daysWithAppointments:curr?.dates.size||0
      };
    }).sort((x,y)=>y.currentHours-x.currentHours||
      x.name.localeCompare(y.name,'pt-BR')).slice(0,limit);
  };
  const weekly=current.weekly.map((item,i)=>({
    periodIndex:i+1,from:item.from,to:item.to,
    hours:hours(item.minutes),appointments:item.entries,uniqueTickets:item.tickets.size,
    baselineFrom:baseline.weekly[i].from,baselineTo:baseline.weekly[i].to,
    baselineHours:hours(baseline.weekly[i].minutes),
    varianceHours:hours(item.minutes-baseline.weekly[i].minutes),
    variancePercent:percent(item.minutes,baseline.weekly[i].minutes)
  }));
  const totals=toSummary(current.totals),baselineTotals=toSummary(baseline.totals);
  if(holidays===null)warnings.push('Cadastro de feriados indisponível; horas em dias úteis e feriados não foram segregadas. Fins de semana seguem identificados.');
  if(invalid.current||invalid.baseline)warnings.push('Apontamentos inválidos ou fora das janelas selecionadas foram descartados, sem conversão para horas estimadas.');
  if(Object.values(missing).some(Boolean))warnings.push('Há apontamentos sem equipe, colaborador, atividade ou chamado identificado; estes não foram atribuídos artificialmente.');
  warnings.push('Nomes dos colaboradores não provam identidade única; validar cadastro antes de avaliar desempenho individual.');
  warnings.push('Sem escala/jornada validada, capacidade e diferença de jornada não podem ser calculadas; valores permanecem indisponíveis.');
  warnings.push('Apontamentos referem-se à data de trabalho e à equipe registrada no próprio lançamento, não à equipe atual do chamado.');
  return {
    mode:'dry-run',version:'5.0-readonly',
    period:window,
    totals:{
      current:totals,baseline:baselineTotals,
      varianceHours:hours(current.totals.minutes-baseline.totals.minutes),
      variancePercent:percent(current.totals.minutes,baseline.totals.minutes)
    },
    byTeam:mergeGroups('teams'),byCollaborator:mergeGroups('people'),
    byActivity:mergeGroups('activities'),
    weekly,
    capacity:{
      status:'UNAVAILABLE_UNTIL_VERIFIED_SCHEDULE',
      configured:false,plannedHours:null,actualHours:totals.hours,
      varianceToCapacityHours:null,occupancyPercent:null,
      reason:'Jornada individual, férias, afastamentos, feriados e carga horária acordada não foram fornecidos e validados.'
    },
    coverage:{
      currentRecords:currentRows.length,baselineRecords:baselineRows.length,
      validCurrentAppointments:totals.appointments,
      validBaselineAppointments:baselineTotals.appointments,
      invalid,
      missing,
      holidaysVerified:holidays!==null,
      rangeFullyVerified:false
    },
    warnings,notificationsSent:0,changesWritten:0
  };
}
module.exports={analyzeProductivity,makeWindows,plusDays,priorYear,dateMs,PERIODS,COMPARES};
