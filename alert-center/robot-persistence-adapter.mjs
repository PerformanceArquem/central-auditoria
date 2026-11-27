// Trusted server only. No email, scheduler or direct Movidesk writes.
export function robotPersistence(db,{clock=()=>new Date()}={}){
 if(typeof db!=='function')throw Error('Database adapter required');
 const localDay=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(clock()).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;};
 return {
 async reserve({ticketId,day,rules,text}){
  if(day!==localDay())return {acquired:false};
  const result=await db('rpc/audit_reserve_robot_internal_note',{method:'POST',body:JSON.stringify({p_ticket_id:ticketId,p_day:day,p_rules:rules,p_note_body:text})});
  return {acquired:result===true};
 },
 async finish({ticketId,day,status}){
  if(!['confirmed','uncertain','blocked'].includes(status))throw Error('Invalid outcome');
  const result=await db('rpc/audit_finish_robot_internal_note',{method:'POST',body:JSON.stringify({p_ticket_id:ticketId,p_day:day,p_status:status})});
  return result===true;
 }
 };
}
