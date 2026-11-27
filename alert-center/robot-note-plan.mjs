import {robotOwnerMessage} from './robot-owner-message.mjs';
import {robotQueueFacts} from './robot-queue-facts.mjs';

// Planning only. No transport, email, ticket updates or database writes.
// Other rule facts must come from an independently validated evaluator.
export function planRobotNote(ticket,{now,syncedAt,blocked=false,historyComplete=false,holidays=[],thresholds={},validatedFacts=null,existingKeys=[]}={}){
 const id=String(ticket?.id??'');
 const at=Date.parse(now),sync=Date.parse(syncedAt);
 const excluded=String(ticket?.status??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 if(blocked||!/^\d{1,12}$/.test(id)||ticket.closedIn||ticket.canceledIn||String(ticket.isDeleted)==='true'||!excluded||['fechado','resolvido','cancelado','concluido','concluido (sem confirmacao)','encerrado','finalizado'].includes(excluded)||!Number.isFinite(at)||!Number.isFinite(sync)||sync>at||at-sync>86400000)return null;
 const queue=robotQueueFacts(ticket,{now,syncedAt,blocked,historyComplete,holidays,thresholds});
 const facts={...(validatedFacts?.verified===true?validatedFacts.facts:{}),dias_na_fila:undefined,data_entrada_fila:undefined,...queue.facts};
 const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 const positive=n=>Number.isSafeInteger(n)&&n>0;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
 const day=parts.year+'-'+parts.month+'-'+parts.day;
 if(!validDate(facts.data_previsao_vencida)||facts.data_previsao_vencida>day)delete facts.data_previsao_vencida;
 const rules=[];
 if(queue.eligible)rules.push('aged-queue');
 if(positive(facts.dias_sem_registro??facts.dias_sem_atualizacao))rules.push('idle-record');
 if(facts.sem_registro===true&&validDate(facts.data_abertura))rules.push('no-record');
 if(facts.data_previsao_vencida)rules.push('overdue');
 if(facts.aguardando_cliente===true&&(positive(facts.dias_sem_contato)||facts.sem_previsao===true||facts.previsao_distante===true&&positive(facts.dias_ate_previsao)&&validDate(facts.data_previsao)))rules.push('customer-followup');
 const key='robot-note:'+id+':'+day;
 if(!rules.length||existingKeys.includes(key))return null;
 return {key,ticketId:id,rules,channel:'movidesk-internal',simulated:true,text:robotOwnerMessage(ticket,facts)};
}
