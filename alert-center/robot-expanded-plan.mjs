import {waitingPlan} from './robot-waiting-executor.mjs';
import {robotDeadlineFacts} from './robot-deadline-facts.mjs';
import {robotOwnerMessage} from './robot-owner-message.mjs';
import {isWaitingCustomer} from './robot-live-preview.mjs';
const sectors=new Set(['Suporte','Qualidade','Testes (QA)','Sucesso do Cliente','Implantação','Treinamento']);
// Deadline expansion: require explicit evidence and preserve waiting rule.
export function expandedPlan(ticket,{now,today,holidays=[],complete=false,blocked=false}={}){
 if(!complete||blocked||!sectors.has(ticket?.ownerTeam)||!ticket.owner?.id||!ticket.owner?.businessName||!/^\d{1,12}$/.test(String(ticket.id))||ticket.closedIn||ticket.canceledIn||String(ticket.isDeleted)==='true'||!ticket.status||/^(fechado|resolvido|cancelado|conclu[ií]do(?: \(sem confirma[cç][aã]o\))?|encerrado|finalizado)$/i.test(ticket.status.trim()))return null;
 const waiting=isWaitingCustomer(ticket);
 const existing=waitingPlan(ticket,{today,holidays,complete});
 const deadline=robotDeadlineFacts(ticket,{now,waitingConfirmed:waiting,deadlineCoverage:Object.hasOwn(ticket,'slaSolutionDate'),holidays,maxFutureBusinessDays:10});
 const facts=deadline.verified?deadline.facts:{};
 const rules=[];
 if(facts.data_previsao_vencida)rules.push('overdue');
 if(facts.sem_previsao)rules.push('missing-deadline');
 if(facts.previsao_distante)rules.push('distant-deadline');
 if(!rules.length)return existing;
 const text=robotOwnerMessage(ticket,facts).replace(/Ticket Manager$/,'Alan — Qualidade | Ticket Manager\nMensagem automática autorizada');
 const id=String(ticket.id);
 return {key:'robot-note:'+id+':'+today,ticketId:id,ownerId:String(ticket.owner.id),rules:[...new Set([...(existing?.rules||[]),...rules])],channel:'movidesk-internal',simulated:true,text:existing?existing.text.split('\n\nAlan — Qualidade')[0]+'\n\nComplemento da fiscalização:\n'+text:text};
}
