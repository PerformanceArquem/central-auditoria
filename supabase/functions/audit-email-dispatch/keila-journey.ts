// Quadro de jornada para o relatório exclusivo de Keila, baseado em apontamentos reais.
// Não presume ausência/falta sem parametrizar a jornada e os feriados do período.
type R=Record<string,unknown>;
export type KeilaJourneyRow={name:string;sector:string;appointments:number;tickets:number;daysWithEntries:number;minutes:number;
 nonWorkMinutes:number;averageMinutes:number|null;capacityMinutes:number;minimumMinutes:number;
 capacityPercent:number|null;minimumGapMinutes:number;journeyGapMinutes:number;status:string};
export type KeilaJourney={from:string;to:string;workingDays:number;dailyTargetMinutes:number;minimumPercent:number;
 capacityMinutes:number;minimumMinutes:number;rows:KeilaJourneyRow[];note:string};
const norm=(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
export const hhmm=(v:unknown)=>{if(v==null)return '—';const n=Math.max(0,Math.round(Number(v)||0));return Math.floor(n/60)+'h'+String(n%60).padStart(2,'0');};
export function buildKeilaJourney(
 appointments:R[],from:string,to:string,workingDates:string[],dailyTargetMinutes=480,minimumPercent=80,
 selectedNames:string[]=[]
):KeilaJourney{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error('Período inválido');
 if(!Number.isFinite(dailyTargetMinutes)||dailyTargetMinutes<=0||dailyTargetMinutes>1440||
   !Number.isFinite(minimumPercent)||minimumPercent<0||minimumPercent>100)
  throw Error('Referências de jornada inválidas');
 const validDays=new Set(workingDates.filter(d=>d>=from&&d<=to));
 const capacity=validDays.size*dailyTargetMinutes,minimum=Math.round(capacity*minimumPercent/100);
 const selected=new Map(selectedNames.filter(Boolean).map(n=>[norm(n),String(n)]));
 const team=new Map<string,{name:string;sector:string;appointments:number;tickets:Set<string>;dates:Set<string>;minutes:number;nonWorkMinutes:number}>();
 const ensure=(name:string,sector='Produção - CPO')=>{
   const id=norm(name);if(!team.has(id))team.set(id,{name,sector,appointments:0,tickets:new Set(),dates:new Set(),minutes:0,nonWorkMinutes:0});
   return team.get(id)!;
 };
 for(const name of selected.values())ensure(name);
 for(const a of appointments){
  const name=String(a.collaborator_name||'').trim(),sector=String(a.sector||'');
  if(!name||(!selected.size&&!/\bproducao\b|\bcpo\b/.test(norm(sector)))||
    (selected.size&&!selected.has(norm(name))))continue;
  const date=String(a.appointment_date||'').slice(0,10);
  if(date<from||date>to)continue;
  const minutes=Number(a.duration_minutes);
  if(!Number.isFinite(minutes)||minutes<0)throw Error('Apontamento com duração inválida');
  const item=ensure(name,sector||'Produção - CPO');item.appointments++;
  item.minutes+=minutes;
  item.dates.add(date);
  if(!validDays.has(date))item.nonWorkMinutes+=minutes;
  const ticket=String(a.ticket_id||'').trim();if(ticket)item.tickets.add(ticket);
 }
 const rows=[...team.values()].map(v=>{
  const minutes=Math.round(v.minutes),ordinary=Math.max(0,v.minutes-v.nonWorkMinutes);
  return {name:v.name,sector:v.sector,appointments:v.appointments,tickets:v.tickets.size,
   daysWithEntries:v.dates.size,minutes,nonWorkMinutes:Math.round(v.nonWorkMinutes),
   averageMinutes:v.dates.size?Math.round(v.minutes/v.dates.size):null,
   capacityMinutes:capacity,minimumMinutes:minimum,capacityPercent:capacity?Math.round(ordinary/capacity*100):null,
   minimumGapMinutes:Math.max(0,minimum-Math.round(ordinary)),
   journeyGapMinutes:Math.max(0,capacity-Math.round(ordinary)),
   status:capacity===0?'Sem referência':ordinary<minimum?'Crítico':'Bom'
  };
 }).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 return {from,to,workingDays:validDays.size,dailyTargetMinutes,minimumPercent,
  capacityMinutes:capacity,minimumMinutes:minimum,rows,
  note:'Jornada de referência, não controle de ponto. Faltas = diferença entre horas apontadas em dias úteis e meta; não comprovam ausência. Horas em dias não úteis são exibidas separadamente.'};
}
export function keilaJourneySection(data:KeilaJourney){
 const header=['Colaborador','Equipe','Tickets','Dias com apontamento','Horas apontadas','Média por dia','Horas não úteis','Capacidade','Mínimo','% capacidade','Falta mínimo','Falta jornada','Situação'];
 const cell=(v:unknown)=>'<td style="padding:8px;border:1px solid #dae4f0;vertical-align:top">'+esc(v)+'</td>';
 const rows=data.rows.map(r=>[r.name,r.sector,r.tickets,r.daysWithEntries,hhmm(r.minutes),
  hhmm(r.averageMinutes),hhmm(r.nonWorkMinutes),hhmm(r.capacityMinutes),hhmm(r.minimumMinutes),
  r.capacityPercent==null?'—':r.capacityPercent+'%',hhmm(r.minimumGapMinutes),hhmm(r.journeyGapMinutes),r.status]);
 const heading='Colaboradores · horas apontadas e jornada';
 const summary=data.workingDays+' dias úteis × '+hhmm(data.dailyTargetMinutes)+
  ' = '+hhmm(data.capacityMinutes)+' por colaborador; mínimo de '+data.minimumPercent+'% ('+hhmm(data.minimumMinutes)+')';
 const html='<section style="font-family:Arial,sans-serif;margin:24px 0;color:#173453">'+
  '<h2 style="font-size:17px">'+heading+'</h2><p style="font-size:12px">'+esc(summary)+'</p>'+
  '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:11px;width:100%"><thead><tr style="background:#edf3fb">'+
  header.map(k=>'<th style="padding:8px;border:1px solid #dae4f0">'+esc(k)+'</th>').join('')+'</tr></thead><tbody>'+
  (rows.length?rows.map(r=>'<tr>'+r.map(cell).join('')+'</tr>').join(''):'<tr><td colspan="13">Sem apontamentos da equipe no período.</td></tr>')+
  '</tbody></table></div><p style="font-size:11px;color:#60748c">'+esc(data.note)+'</p></section>';
 const text='\n\n'+heading.toUpperCase()+'\n'+summary+'\n'+
  (rows.length?rows.map(r=>r.join(' | ')).join('\n'):'Sem apontamentos no período')+'\n'+data.note;
 return {header,rows,html,text,summary};
}
