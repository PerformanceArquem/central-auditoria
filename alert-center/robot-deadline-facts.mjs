import {businessDays} from './engine.mjs';
const instant=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)?Date.parse(/(Z|[+-]\d{2}:\d{2})$/i.test(v)?v:v+'Z'):NaN;
const local=t=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;};
export function robotDeadlineFacts(ticket,{now,waitingConfirmed=false,deadlineCoverage=false,holidays=[],maxFutureBusinessDays=10}={}){
 const fail=reason=>({verified:false,reason,facts:{}});
 const at=instant(now);
 if(!Number.isFinite(at)||!deadlineCoverage||!Number.isInteger(maxFutureBusinessDays)||maxFutureBusinessDays<1||maxFutureBusinessDays>365)return fail('unconfirmed-deadline');
 if(!ticket||!Object.hasOwn(ticket,'slaSolutionDate'))return fail('missing-deadline-field');
 const facts={};
 if(waitingConfirmed)facts.aguardando_cliente=true;
 const value=ticket.slaSolutionDate;
 if(value===null||value===''){
  if(waitingConfirmed)facts.sem_previsao=true;
  return {verified:true,facts};
 }
 const due=instant(value);
 if(!Number.isFinite(due))return fail('invalid-deadline');
 const paused=ticket.slaSolutionDateIsPaused;
 if(due<at){
  // A paused or unknown SLA must not be described as an active overdue deadline.
  if(paused===false||paused==='false')facts.data_previsao_vencida=local(due);
  else return fail('paused-or-unknown-sla');
 }else if(waitingConfirmed){
  const days=businessDays(local(at),local(due),holidays);
  if(days>maxFutureBusinessDays){
   facts.previsao_distante=true;facts.data_previsao=local(due);facts.dias_ate_previsao=days;facts.dias_previsao_uteis=true;
  }
 }
 return {verified:true,facts};
}
