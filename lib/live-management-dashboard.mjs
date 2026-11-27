import {inspectTickets} from './ticket-inspection.mjs';
import {summarizeRadar} from './preventive-risk-radar.mjs';
import {identifyTraceabilitySignals} from './sector-traceability.mjs';
export function summarizeManagement({tickets=[],appointments=[],day,now=Date.now(),sector='',clientCriticality={},vipKnown=false}){
 const name=v=>typeof v==='string'?v.trim():String(v?.businessName||v?.name||'').trim();
 const team=t=>name(t.ownerTeam)||'Sem setor';
 const date=value=>{
  if(!value)return '';
  const raw=String(value);
  const ms=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+'T12:00:00Z':raw);
  if(!Number.isFinite(ms))return '';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ms);
  const part=k=>parts.find(p=>p.type===k)?.value;
  return part('year')+'-'+part('month')+'-'+part('day');
 };
 const source=tickets.filter(t=>!(t.payload||t).isDeleted);
 const selected=source.filter(t=>!sector||team(t.payload||t)===sector);
 const open=inspectTickets(selected,{now,historicalTickets:source,clientCriticality});
 const radar=summarizeRadar(open),signals=identifyTraceabilitySignals(open);
 const sectors=new Map(),owners=new Map();
 const get=k=>{if(!sectors.has(k))sectors.set(k,{sector:k,opened:0,closed:0,backlog:0,hours:0});return sectors.get(k);};
 let opened=0,closed=0,hours=0,unknownClosure=0;
 for(const sourceRow of selected){
  const t=sourceRow.payload||sourceRow,k=team(t);
  if(date(t.createdDate||sourceRow.created_at_source)===day){opened++;get(k).opened++;}
  const status=name(t.status).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const ended=/fechad|resolvid|concluid|encerrad|finalizad|solucionad/.test(status)||/^(closed|resolved)$/.test(name(t.baseStatus).toLowerCase());
  if(ended){const d=date(t.closedIn||sourceRow.closed_at_source||t.closedAt);if(!d)unknownClosure++;else if(d===day){closed++;get(k).closed++;}}
 }
 for(const r of open)get(r.sector).backlog++;
 for(const a of appointments){
  if(a.date!==day||(sector&&a.sector!==sector))continue;
  const h=Number(a.hours);if(!Number.isFinite(h)||h<0)continue;
  hours+=h;get(a.sector||'Sem setor').hours+=h;
  const k=a.owner_name||'Sem responsável';owners.set(k,(owners.get(k)||0)+h);
 }
 const vipClients=new Set(Object.keys(clientCriticality));
 const vipRisk=vipKnown?new Set(open.filter(r=>vipClients.has(r.client)&&['Alta','Crítica'].includes(r.criticality)&&r.risk?.state!=='Já vencido'&&r.risk?.coverage>=60).map(r=>r.client)).size:null;
 return {day,loaded: selected.length,backlog:open.length,opened,closed,hours,unknownClosure,radar:radar.counts,gaps:signals.length,vipRisk,sectors:[...sectors.values()].sort((a,b)=>b.backlog-a.backlog),owners:[...owners].sort((a,b)=>b[1]-a[1])};
}
