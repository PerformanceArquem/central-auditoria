// Server-side orchestration contract. Disabled by default. No email integration.
// Transport and durable persistence must be supplied by the trusted server.
export async function deliverRobotNote(ticketId,{enabled=false,readAndEvaluate,reserve,writeInternal,finish}={}){
 const id=String(ticketId);
 if(!/^\d{1,12}$/.test(id))throw Error('Chamado inválido');
 if(enabled!==true)return {status:'disabled'};
 if([readAndEvaluate,reserve,writeInternal,finish].some(fn=>typeof fn!=='function'))throw Error('Integração incompleta');
 const current=await readAndEvaluate(id);
 const plan=current?.plan;
 if(!plan||String(plan.ticketId)!==id||plan.channel!=='movidesk-internal'||!Array.isArray(plan.rules)||!plan.rules.length||typeof plan.text!=='string'||!plan.text.trim())return {status:'blocked'};
 const prefix='robot-note:'+id+':';
 const day=typeof plan.key==='string'&&plan.key.startsWith(prefix)?plan.key.slice(prefix.length):'';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)return {status:'blocked'};
 const marker='CENTRAL-ROBOT-NOTE:'+id+':'+day;
 const text=plan.text+'\n\n'+marker;
 if(text.length>3500)return {status:'blocked'};
 const reservation=await reserve({ticketId:id,day,rules:plan.rules,text});
 if(reservation?.acquired!==true)return {status:'duplicate-or-blocked'};
 // Re-evaluate after reservation, before writing; never reuse stale owner or changed facts.
 let latest;
 try{latest=(await readAndEvaluate(id))?.plan;}catch{await finish({ticketId:id,day,status:'blocked'});return {status:'blocked'};}
 if(!latest||latest.key!==plan.key||latest.channel!==plan.channel||String(latest.ticketId)!==id||latest.text!==plan.text||JSON.stringify(latest.rules)!==JSON.stringify(plan.rules)){
  await finish({ticketId:id,day,status:'blocked'});return {status:'blocked'};
 }
 let status='uncertain';
 try{
  const outcome=await writeInternal({ticketId:id,type:1,text,marker});
  if(outcome?.confirmed===true)status='confirmed';
 }catch{/* Uncertain writes must never be retried automatically. */}
 const finalized=await finish({ticketId:id,day,status});
 return {status:finalized===true?status:'uncertain'};
}
