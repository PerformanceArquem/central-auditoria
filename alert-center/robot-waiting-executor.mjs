import {isWaitingCustomer} from './robot-live-preview.mjs';
import {robotAppointmentEvidence} from './robot-appointment-evidence.mjs';
import {businessDays} from './engine.mjs';
import {robotOwnerMessage} from './robot-owner-message.mjs';
import {deliverRobotNote} from './robot-internal-delivery.mjs';
const sectors=new Set(['Suporte','Qualidade','Testes (QA)','Sucesso do Cliente','Implantação','Treinamento']);
const dayAt=now=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;};
export function waitingPlan(ticket,{today,holidays,blocked=false,complete=false}={}){
 if(blocked||!complete||!Array.isArray(holidays)||!/^\d{4}-\d{2}-\d{2}$/.test(today||'')||!/^\d{1,12}$/.test(String(ticket?.id??''))||!sectors.has(ticket.ownerTeam)||!isWaitingCustomer(ticket)||ticket.closedIn||ticket.canceledIn||String(ticket.isDeleted)==='true'||!ticket.owner?.id||!ticket.owner?.businessName)return null;
 const evidence=robotAppointmentEvidence(ticket,{complete,today});
 if(!evidence.appointmentCoverage||!evidence.lastAppointmentDate)return null;
 const days=businessDays(evidence.lastAppointmentDate,today,holidays);
 if(days<3)return null;
 const id=String(ticket.id);
 return {key:'robot-note:'+id+':'+today,ticketId:id,ownerId:String(ticket.owner.id),rules:['customer-followup'],channel:'movidesk-internal',simulated:true,text:robotOwnerMessage(ticket,{aguardando_cliente:true,dias_sem_apontamento:days,data_ultimo_apontamento:evidence.lastAppointmentDate}).replace(/Ticket Manager$/,'Alan — Qualidade | Ticket Manager\nMensagem automática autorizada')};
}
// Only the waiting-customer rule is wired here. Other robot rules remain independent.
/** @param {{readTicket: Function, readPolicy: Function, reserve?: Function, finish?: Function, writeInternal?: Function, enabled?: boolean, clock?: ()=>Date}} options */
export function createWaitingExecutor({readTicket,readPolicy,reserve,finish,writeInternal,enabled=false,clock=()=>new Date()}){
 if(typeof readTicket!=='function'||typeof readPolicy!=='function')throw Error('Verified readers required');
 const readAndEvaluate=async id=>{
  const policy=await readPolicy(id);
  if(policy?.complete!==true||policy.blocked!==false)return {plan:null};
  const ticket=await readTicket(id);
  if(String(ticket?.id)!==id)return {plan:null};
  return {plan:waitingPlan(ticket,{today:dayAt(clock()),holidays:policy.holidays,complete:true})};
 };
 return {preview:async id=>readAndEvaluate(String(id)),execute:async id=>deliverRobotNote(id,{enabled,readAndEvaluate,reserve,finish,writeInternal})};
}
