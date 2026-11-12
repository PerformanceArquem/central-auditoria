// Relatório mensal automático da Produção a partir das tabelas consolidadas.
// Leitura somente, acesso administrativo obrigatório, sem chaves no navegador.
const ZONE='America/Sao_Paulo',MAX=20000,PAGE=1000;
const name=x=>typeof x==='string'?x:String(x?.businessName||x?.name||'');
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const isProd=x=>/\bproducao\b|\bcpo\b/.test(norm(x));
const isClosed=x=>/fechad|concluid|resolvid|encerrad|cancelad|finalizad/.test(norm(x));
const sDate=x=>String(x||'').slice(0,10);
const days=(a,b)=>Math.max(0,Math.floor((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000));
const addDays=(s,n)=>new Date(Date.parse(s+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const workingDays=(a,b)=>{let n=0;for(let d=a;d<=b;d=addDays(d,1)){const w=new Date(d+'T12:00:00Z').getUTCDay();if(w>0&&w<6)n++;}return n;};
const currentDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fail=(res,status,message)=>res.status(status).json({ok:false,error:message});
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return fail(res,405,'Método não permitido');
 // Threshold configurável somente para a visualização. Não ativa envios nem modifica banco.
 const rawDays=req.query?.withoutAppointmentDays;
 const requestedDays=Array.isArray(rawDays)?'':rawDays===undefined?'30':String(rawDays);
 if(!/^[1-9][0-9]{0,2}$/.test(requestedDays)||Number(requestedDays)>365)
  return fail(res,400,'Prazo sem apontamentos inválido (1 a 365 dias)');
 const withoutAppointmentDays=Number(requestedDays);
 const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!/^https:\/\//.test(base)||!key)return fail(res,503,'Integração Supabase não configurada');
 const match=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'');
 if(!match)return fail(res,401,'Faça login para atualizar a Produção');
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),50000);
 const h={apikey:key,Authorization:'Bearer '+key};
 try{
  const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+match[1]},signal:ctrl.signal});
  if(!auth.ok)return fail(res,401,'Sessão inválida ou expirada');
  const user=await auth.json();if(!user?.id)return fail(res,401,'Usuário inválido');
  const acl=new URL(base+'/rest/v1/audit_users');
  acl.searchParams.set('select','role,is_active');acl.searchParams.set('user_id','eq.'+user.id);acl.searchParams.set('limit','1');
  const allowed=await fetch(acl,{headers:h,signal:ctrl.signal});
  if(!allowed.ok)return fail(res,503,'Não foi possível validar seu perfil');
  const roles=await allowed.json();
  if(!Array.isArray(roles)||!roles.some(r=>String(r.role).toLowerCase()==='admin'&&r.is_active!==false))
    return fail(res,403,'Somente administradores podem consultar os indicadores consolidados');
  const today=currentDate(),from=today.slice(0,7)+'-01',prevTo=addDays(from,-1),prevFrom=prevTo.slice(0,7)+'-01';
  async function all(table,columns,params={}){
   let data=[];
   for(let offset=0;offset<MAX;offset+=PAGE){
    const u=new URL(base+'/rest/v1/'+table);
    u.searchParams.set('select',columns);u.searchParams.set('order',table==='audit_direct_tickets'?'ticket_id.asc':table==='audit_direct_appointments'?'appointment_key.asc':table==='audit_recent_reconcile_state'?'job_name.asc':'id.asc');
    u.searchParams.set('limit',String(PAGE));u.searchParams.set('offset',String(offset));
    for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
    const response=await fetch(u,{headers:h,signal:ctrl.signal});
    if(!response.ok)throw new Error('Falha ao consultar dados da Produção');
    const batch=await response.json();if(!Array.isArray(batch))throw Error('Resposta inválida do banco');
    data.push(...batch);
    if(batch.length<PAGE)return data;
   }
   throw new Error('Limite de leitura atingido; reduzir janela do relatório');
  }
  const [tickets,appointments,sync,historyState]=await Promise.all([
    all('audit_direct_tickets','ticket_id,payload,created_at_source,closed_at_source,last_update_source',{'payload->>ownerTeam':'eq.Produção - CPO'}),
    all('audit_direct_appointments','appointment_key,ticket_id,collaborator_name,sector,activity,appointment_date,duration_minutes'),
    all('audit_recent_reconcile_state','completed,last_error,last_success_at,period_start,period_end',{'job_name':'eq.movidesk_recent_reconcile'}),
    all('audit_direct_sync_state','completed,last_error,last_success_at,processed_tickets',{'id':'eq.movidesk_backfill'})
  ]);
  const known=new Map(tickets.map(x=>[String(x.ticket_id),x]));
  // Ignorar datas futuras: lançamento futuro não é evidência de atividade já realizada.
  const referenceDay=currentDate();
  const relevant=appointments.filter(a=>(isProd(a.sector)||known.has(String(a.ticket_id)))&&
    /^\d{4}-\d{2}-\d{2}$/.test(String(a.appointment_date||''))&&String(a.appointment_date)<=referenceDay);
  const appByTicket=new Map();
  for(const a of relevant){
   const id=String(a.ticket_id),r=appByTicket.get(id)||{minutes:0,entries:0,people:new Set(),last:''};
   r.minutes+=Math.max(0,Number(a.duration_minutes)||0);r.entries++;
   r.people.add(name(a.collaborator_name));if(a.appointment_date>r.last)r.last=a.appointment_date;
   appByTicket.set(id,r);
  }
  const details=new Map(known);
  const prodTickets=tickets.map(t=>{
   const v=t.payload||{},id=String(t.ticket_id),closed=isClosed(v.status)||Boolean(t.closed_at_source);
   const created=sDate(t.created_at_source||v.createdDate),updated=sDate(t.last_update_source||v.lastUpdate)||created;
   const client=v.clients?.[0],sla=sDate(v.slaSolutionDate||v.dueDate||v.forecastDate||v.expectedDate);
   return {id,subject:String(v.subject||'Sem assunto'),category:String(v.category||v.serviceFirstLevel||'Geral'),client:name(client?.organization)||name(client)||'Não informado',owner:name(v.owner)||'Não atribuído',status:String(v.status||'—'),created,updated,sla,closed,history:appByTicket.get(id)};
  });
  function aggregate(a,b){
   const subset=relevant.filter(x=>x.appointment_date>=a&&x.appointment_date<=b);
   let minutes=0;const people=new Map(),tk=new Map(),dates=new Map(),dayPeople=new Map();
   for(const x of subset){
    const m=Math.max(0,Number(x.duration_minutes)||0),person=name(x.collaborator_name)||'Não informado',
     id=String(x.ticket_id),day=String(x.appointment_date);
    minutes+=m;
    const p=people.get(person)||{name:person,minutes:0,appointments:0,tickets:new Set()};p.minutes+=m;p.appointments++;p.tickets.add(id);people.set(person,p);
    const t=tk.get(id)||{id,minutes:0,appointments:0,collaborators:new Set()};t.minutes+=m;t.appointments++;t.collaborators.add(person);tk.set(id,t);
    const d=dayPeople.get(day+'|'+person)||{date:day,person,minutes:0};d.minutes+=m;dayPeople.set(day+'|'+person,d);
    dates.set(day,(dates.get(day)||0)+1);
   }
   const work=workingDays(a,b),peopleRows=[...people.values()].map(p=>({...p,tickets:p.tickets.size})).sort((x,y)=>y.minutes-x.minutes);
   const tasks=[...tk.values()].map(t=>({...t,collaborators:[...t.collaborators].join(', '),subject:details.get(t.id)?.payload?.subject||'Sem assunto',category:details.get(t.id)?.payload?.category||'Geral',status:details.get(t.id)?.payload?.status||'—'})).sort((x,y)=>y.minutes-x.minutes);
   const dailyRows=[...dayPeople.values()].sort((x,y)=>y.date.localeCompare(x.date)||y.minutes-x.minutes).slice(0,150).map(d=>{
      const w=new Date(d.date+'T12:00:00Z').getUTCDay(),workday=w>0&&w<6,ref=workday?480:0,minimum=workday?384:0;
      return {...d,workday,referenceMinutes:ref,minimumMinutes:minimum,percent:ref?Math.round(d.minutes/ref*100):null,minimumGap:workday?Math.max(0,minimum-d.minutes):null,journeyGap:workday?Math.max(0,ref-d.minutes):null,extraMinutes:workday?Math.max(0,d.minutes-ref):null,status:!workday?'Dia não útil':d.minutes<minimum?'Abaixo do mínimo':d.minutes<ref?'Dentro do mínimo':'Jornada atingida'};
   });
   return {minutes,appointments:subset.length,tickets:tk.size,people:people.size,workingDays:work,
    minutesPerWorkday:work?Math.round(minutes/work):0,peopleRows,tasks,dailyRows,dates};
  }
  const current=aggregate(from,today),previous=aggregate(prevFrom,prevTo);
  const open=prodTickets.filter(t=>!t.closed),overdue=open.filter(t=>t.sla&&t.sla<today);
  const stalled=open.filter(t=>t.updated&&days(t.updated,today)>=7);
  const old=open.filter(t=>t.created&&days(t.created,today)>=90);
  const withoutForecast=open.filter(t=>t.created&&days(t.created,today)>=30&&!t.sla);
  // Sem registros: usar a data de abertura; não classificar ticket recém-aberto como atrasado.
  // Último apontamento: usar o registro mais recente realmente importado.
  const rec=sync[0]||{};
  const historical=historyState[0]||{};
  // Importacao historica concluida indica que o job terminou, mas nao comprova
  // cobertura integral de cada chamado. Nao altera a elegibilidade dos alertas.
  const historicalJobComplete=historical.completed===true&&!historical.last_error;
  // O estado 'completed' isolado nao prova atualidade da conciliacao.
  // Falhar fechado quando a ultima execucao bem-sucedida nao for recente
  // ou o periodo coberto nao alcancar o dia anterior em Sao Paulo.
  const lastSyncMs=Date.parse(String(rec.last_success_at||''));
  const ageSyncMs=Date.now()-lastSyncMs;
  const lastCovered=sDate(rec.period_end);
  const firstCovered=sDate(rec.period_start);
  const priorDay=addDays(today,-1);
  const thresholdStart=addDays(today,-withoutAppointmentDays);
  // Conciliacao recente so comprova ausencia de apontamentos dentro da sua janela.
  // Nunca inferir ausencia por X dias se o periodo sincronizado for mais curto.
  const coverageReady=rec.completed===true&&!rec.last_error&&
    Number.isFinite(lastSyncMs)&&ageSyncMs>=0&&ageSyncMs<=36*60*60*1000&&
    /^\d{4}-\d{2}-\d{2}$/.test(lastCovered)&&lastCovered>=priorDay&&
    /^\d{4}-\d{2}-\d{2}$/.test(firstCovered)&&firstCovered<=thresholdStart;
  const coverageReason=rec.completed!==true||Boolean(rec.last_error)?'Conciliação incompleta ou com erro':
    !Number.isFinite(lastSyncMs)||ageSyncMs<0||ageSyncMs>36*60*60*1000?'Última conciliação desatualizada':
    !/^\d{4}-\d{2}-\d{2}$/.test(lastCovered)||lastCovered<priorDay?'Conciliação não cobre o dia anterior':
    !/^\d{4}-\d{2}-\d{2}$/.test(firstCovered)||firstCovered>thresholdStart?'Janela conciliada menor que o prazo solicitado':null;
  // A ausência de um registro não pode ser usada como alerta quando a conciliação está incompleta.
  const withoutAppointment=coverageReady?open.filter(t=>t.history?.last
   ? days(t.history.last,today)>=withoutAppointmentDays
   : Boolean(t.created)&&days(t.created,today)>=withoutAppointmentDays):[];
  const toAlert=t=>({id:t.id,subject:t.subject,client:t.client,owner:t.owner,status:t.status,
    sla:t.sla,ageDays:days(t.updated||t.created,today),daysWithoutAction:days(t.updated||t.created,today)});
  const toLegacy=t=>({...toAlert(t),ageDays:days(t.created,today),lastAppointment:t.history?.last||null,
    noAppointmentEver:!t.history?.last,daysWithoutAppointment:t.history?.last?days(t.history.last,today):(t.created?days(t.created,today):null),
    withoutForecast:!t.sla});
  const highProjects=current.tasks.filter(t=>/projeto|melhoria|integrac|desenvolv/i.test(norm(t.subject+' '+t.category))).slice(0,30);
  const weekdays=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const weekdayStats=new Map();
  for(const [date,n] of current.dates){const w=new Date(date+'T12:00:00Z').getUTCDay();weekdayStats.set(w,(weekdayStats.get(w)||0)+n);}
  const countByWeekday=new Map();for(let d=from;d<=today;d=addDays(d,1)){const w=new Date(d+'T12:00:00Z').getUTCDay();countByWeekday.set(w,(countByWeekday.get(w)||0)+1);}
  return res.status(200).json({ok:true,from,to:today,previousFrom:prevFrom,previousTo:prevTo,
   current:{...current,dates:undefined},previous:{...previous,dates:undefined,dailyRows:undefined,tasks:undefined},
   alertMetrics:{open:open.length,overdue:overdue.length,stalled:stalled.length,withoutSla:open.filter(t=>!t.sla).length},
   alerts:{overdue:overdue.slice(0,35).map(toAlert),stalled:stalled.slice(0,35).map(toAlert)},
   projects:highProjects,gaps:[],hourly:[],weekdays:weekdays.map((weekday,i)=>({
     weekday,count:weekdayStats.get(i)||0,days:countByWeekday.get(i)||0,
     average:(countByWeekday.get(i)||0)?Number(((weekdayStats.get(i)||0)/countByWeekday.get(i)).toFixed(1)):0
   })),dailyRows:current.dailyRows,
   legacyAlerts:{thresholdDays:withoutAppointmentDays,coverageReady,historicalImport:{jobCompleted:historicalJobComplete,processedTickets:Number(historical.processed_tickets)||0,completeCoverageVerified:false},coverage:{from:/^\d{4}-\d{2}-\d{2}$/.test(firstCovered)?firstCovered:null,to:/^\d{4}-\d{2}-\d{2}$/.test(lastCovered)?lastCovered:null,reason:coverageReason},counts:{old90:old.length,withoutForecast30:withoutForecast.length,
     withoutAppointmentCount:coverageReady?withoutAppointment.length:null,withoutAction7:stalled.length},
     old:old.slice(0,100).map(toLegacy),withoutForecast:withoutForecast.slice(0,100).map(toLegacy),
     withoutAppointment:withoutAppointment.slice(0,100).map(toLegacy),withoutAction:stalled.slice(0,100).map(toLegacy)},
   partial:rec.completed!==true||Boolean(rec.last_error),
   generatedAt:new Date().toISOString(),source:'Supabase — apontamentos e chamados consolidados',
   limitations:'Horários intradiários não disponíveis nas tabelas consolidadas; picos e intervalos não são inferidos.'});
 }catch(e){return fail(res,502,e?.name==='AbortError'?'Consulta excedeu o tempo limite':'Não foi possível atualizar: '+String(e?.message||e))}
 finally{clearTimeout(timer);}
}