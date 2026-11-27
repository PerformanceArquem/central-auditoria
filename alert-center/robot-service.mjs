import {evaluateRobotTicket} from './robot-evaluate.mjs';
import {deliverRobotNote} from './robot-internal-delivery.mjs';
import {robotPersistence} from './robot-persistence-adapter.mjs';
import {robotMovideskTransport} from './robot-movidesk-transport.mjs';
// Trusted server composition. A verified evidence loader is mandatory.
// Preview is default; deployment and scheduler are intentionally separate.
export function createRobotService({loadEvidence,db,token,agentId,enabled=false,fetcher,clock=()=>new Date()}={}){
 if(typeof loadEvidence!=='function')throw Error('Verified evidence loader required');
 const readAndEvaluate=async id=>{
  const snapshot=await loadEvidence(id);
  if(!snapshot?.ticket||String(snapshot.ticket.id)!==id||!snapshot.context)return {plan:null,review:['unconfirmed-ticket']};
  return evaluateRobotTicket(snapshot.ticket,snapshot.context);
 };
 return {
 async preview(ticketId){
  const id=String(ticketId);
  if(!/^\d{1,12}$/.test(id))throw Error('Invalid ticket ID');
  return readAndEvaluate(id);
 },
 async execute(ticketId){
  if(enabled!==true)return {status:'disabled'};
  const persistence=robotPersistence(db,{clock});
  const writeInternal=robotMovideskTransport({token,agentId,enabled:true,...(fetcher?{fetcher}:{})});
  return deliverRobotNote(ticketId,{enabled:true,readAndEvaluate,...persistence,writeInternal});
 }
 };
}
