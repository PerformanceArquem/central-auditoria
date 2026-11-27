/** Pure policy: no provider calls, database writes or timers. */
export function morningWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  const minute=Number(values.hour)*60+Number(values.minute);
  return minute>=8*60+57 && minute<10*60;
}

/** Existing records, including ambiguous failures, always require reconciliation. */
export function planMorning(tasks:any[], registered:Set<string>, batchSize=8) {
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>10)throw Error('Invalid batch size');
  const seen=new Set<string>();
  const planned=tasks.map(t=>{
    const key=`${t.r.id}:${t.kind}:${t.from}:${t.to}`;
    const blocked=registered.has(key)||seen.has(key);
    seen.add(key);
    return {key,recipientId:String(t.r.id),kind:t.kind,status:blocked?'blocked':'planned'};
  });
  const ready=planned.filter(t=>t.status==='planned');
  return {sent:false,notificationsSent:0,planned, batches:Array.from({length:Math.ceil(ready.length/batchSize)},(_,i)=>ready.slice(i*batchSize,(i+1)*batchSize))};
}

/** Sequential chunks keep JSON projections and IN URLs bounded. No retry on timeout. */
export async function forecastOwners(ids:string[],db:(path:string)=>Promise<any>) {
  const unique=[...new Set(ids)];
  if(unique.some(id=>!/^\d{1,12}$/.test(id)))throw Error('Invalid ticket ID');
  const rows:any[]=[];
  for(let i=0;i<unique.length;i+=20){
    const page=await db('audit_direct_tickets?select=ticket_id,owner:payload->owner&ticket_id=in.('+unique.slice(i,i+20).join(',')+')&order=ticket_id.asc&limit=20');
    if(!Array.isArray(page))throw Error('Invalid owner response');
    rows.push(...page);
  }
  return rows;
}
