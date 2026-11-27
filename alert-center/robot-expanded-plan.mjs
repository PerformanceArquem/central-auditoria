import {robotQueueFacts} from './robot-queue-facts.mjs';
import {defaults} from './engine.mjs';
import {robotRecordFacts} from './robot-record-facts.mjs';
import {waitingPlan} from './robot-waiting-executor.mjs';
import {robotDeadlineFacts} from './robot-deadline-facts.mjs';
import {robotOwnerMessage} from './robot-owner-message.mjs';
import {isWaitingCustomer} from './robot-live-preview.mjs';

const localDate=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))return null;
 const date=new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)?value:value+'Z');
 if(!Number.isFinite(+date))return null;
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
};
// ID 1 is the opening action; require the opening action and valid chronology.
// Exclude automated notes and customer-only actions from staff follow-up.
export function verifiedFollowup(ticket,today,holidays){
 const opened=localDate(ticket?.createdDate),actions=ticket?.actions;
 if(!opened||!Array.isArray(actions)||!actions.some(a=>String(a?.id)==='1'))return {};
 const records=[];
 for(const a of actions){
  const id=String(a?.id??''),date=localDate(a?.createdDate);
  if(!/^\d+$/.test(id)||!date||date<opened||date>today)return {};
  const body=String(a.description||'')+' '+String(a.htmlDescription||'');
  let kind='other';
  if(/CENTRAL-(?:ROBOT-NOTE|AUDITORIA-COBRANCA):|Mensagem automática autorizada/i.test(body))kind='robot';
  else if(id!=='1'){
   if(!a.createdBy?.id||![1,2,3].includes(Number(a.createdBy.profileType)))return {};
   if([1,3].includes(Number(a.createdBy.profileType))&&[1,2].includes(Number(a.type))&&body.replace(/<[^>]*>/g,'').trim())kind='human-followup';
  }
  records.push({id,date,kind});
 }
 const result=robotRecordFacts({today,opened,records,coverageConfirmed:true,holidays,idleThreshold:3});
 return result.verified?result.facts:{};
}

const sectors=new Set(['Suporte','Qualidade','Testes (QA)','Sucesso do Cliente','Implantação','Treinamento']);
// Deadline expansion: require explicit evidence and preserve waiting rule.
/** @param {any} ticket @param {{now?:string,today?:string,holidays?:string[],complete?:boolean,blocked?:boolean}} options */
export function expandedPlan(ticket,{now,today,holidays=[],complete=false,blocked=false}={}){
 if(!complete||blocked||!sectors.has(ticket?.ownerTeam)||(ticket.owner!==null&&(!ticket.owner?.id||!ticket.owner?.businessName))||!/^\d{1,12}$/.test(String(ticket.id))||ticket.closedIn||ticket.canceledIn||String(ticket.isDeleted)==='true'||!ticket.status||/^(fechado|resolvido|cancelado|conclu[ií]do(?: \(sem confirma[cç][aã]o\))?|encerrado|finalizado)$/i.test(ticket.status.trim()))return null;
 if(ticket.baseStatus!=null&&!['New','InAttendance','Stopped'].includes(ticket.baseStatus))return null;
 const unassigned=ticket.owner===null;
 const waiting=isWaitingCustomer(ticket);
 const existing=waitingPlan(ticket,{today,holidays,complete});
 const deadline=robotDeadlineFacts(ticket,{now,waitingConfirmed:waiting,deadlineCoverage:Object.hasOwn(ticket,'slaSolutionDate'),holidays,maxFutureBusinessDays:10});
 const facts={...(deadline.verified?deadline.facts:{}),...verifiedFollowup(ticket,today,holidays)};
 const queue=robotQueueFacts(ticket,{now,syncedAt:now,historyComplete:Array.isArray(ticket.ownerHistories),holidays,thresholds:Object.fromEntries([...sectors].map(s=>[s,defaults.triageBusinessDays]))});
 Object.assign(facts,queue.facts);
 const due=typeof ticket.slaSolutionDate==='string'?Date.parse(/(?:Z|[+-]\\d{2}:\\d{2})$/i.test(ticket.slaSolutionDate)?ticket.slaSolutionDate:ticket.slaSolutionDate+'Z'):NaN;
 const hours=(due-Date.parse(now))/3600000;
 const activeDeadline=ticket.slaSolutionDateIsPaused===false||ticket.slaSolutionDateIsPaused==='false';
 const preventive=activeDeadline&&Number.isFinite(hours)&&hours>=0&&hours<=defaults.preventiveHours;
 const escalationReview=activeDeadline&&Number.isFinite(hours)&&hours<=-defaults.escalationHours;
 const rules=[];
 if(queue.eligible)rules.push('aged-queue');
 if(unassigned)rules.push('unassigned');
 if(preventive)rules.push('preventive');
 if(facts.sem_registro===true)rules.push('no-record');
 else if(Number.isSafeInteger(facts.dias_sem_registro)&&facts.dias_sem_registro>0)rules.push('idle-record');
 if(facts.data_previsao_vencida)rules.push('overdue');
 if(facts.sem_previsao)rules.push('missing-deadline');
 if(facts.previsao_distante)rules.push('distant-deadline');
 if(!rules.length)return existing;
 const details=[];
 if(unassigned&&!queue.eligible)details.push('O chamado não possui responsável definido. Solicitamos à equipe que verifique a atribuição.');
 if(preventive)details.push('A previsão de solução vence nas próximas 24 horas. Por gentileza, verifique o andamento e atualize a previsão se necessário.');
 if(escalationReview)details.push('A previsão está vencida há pelo menos 48 horas; situação sinalizada para revisão da gestão.');
 const text=robotOwnerMessage(ticket,facts).replace(/Ticket Manager$/,'Alan — Qualidade | Ticket Manager\nMensagem automática autorizada');
 const consolidated=text.replace('Alan — Qualidade | Ticket Manager',details.length?details.join('\n\n')+'\n\nAlan — Qualidade | Ticket Manager':'Alan — Qualidade | Ticket Manager');
 const id=String(ticket.id);
 return {key:'robot-note:'+id+':'+today,ticketId:id,ownerId:unassigned?null:String(ticket.owner.id),rules:[...new Set([...(existing?.rules||[]),...rules])],channel:'movidesk-internal',simulated:true,escalationReview,text:existing?existing.text.split('\n\nAlan — Qualidade')[0]+'\n\nComplemento da fiscalização:\n'+consolidated:consolidated};
}
