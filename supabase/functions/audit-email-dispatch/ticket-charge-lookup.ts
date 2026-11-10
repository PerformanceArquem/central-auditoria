// Busca consistente com as diferentes bases utilizadas no ranking e na importação.
type TicketRecord=Record<string,unknown>;
type LookupDB=(path:string)=>Promise<unknown>;
export type ChargeLookup={records:TicketRecord[],missingIds:string[],sources:Record<string,string>};
export async function chargeTicketLookup(ids:string[],db:LookupDB):Promise<ChargeLookup>{
 if(!Array.isArray(ids)||!ids.length||ids.length>20||
  ids.some(x=>!/^\d{1,12}$/.test(x))||new Set(ids).size!==ids.length)
  throw Error('Selecione de 1 a 20 chamados distintos.');
 const found=new Map<string,TicketRecord>(),sources:Record<string,string>={};
 const merge=(rows:unknown,origin:string,convert:(row:Record<string,unknown>)=>TicketRecord)=>{
  if(!Array.isArray(rows))throw Error('Resposta inválida ao consultar '+origin+'.');
  for(const item of rows){
   if(!item||typeof item!=='object')continue;
   const raw=item as Record<string,unknown>;
   const converted=convert(raw);
   const id=String(converted.ticket_id||'');
   if(!ids.includes(id)||found.has(id)||!converted.payload||typeof converted.payload!=='object')continue;
   found.set(id,converted);sources[id]=origin;
  }
 };
 const query=(field:string,missing:string[])=>field+'=in.('+missing.join(',')+')';
 const direct=await db('audit_direct_tickets?select=ticket_id,payload,created_at_source,last_update_source&'+query('ticket_id',ids)+'&limit=20');
 merge(direct,'audit_direct_tickets',row=>row);
 let missing=ids.filter(id=>!found.has(id));
 if(missing.length){
  const snapshot=await db('audit_email_open_ticket_snapshot?select=ticket_id,payload,created_at_source,last_update_source&'+query('ticket_id',missing)+'&limit=20');
  merge(snapshot,'audit_email_open_ticket_snapshot',row=>row);
  missing=ids.filter(id=>!found.has(id));
 }
 if(missing.length){
  const old=await db('tm_tickets?select=id,data&'+query('id',missing)+'&limit=20');
  merge(old,'tm_tickets',row=>({
   ticket_id:String(row.id||''),
   payload:row.data,
   created_at_source:(row.data as Record<string,unknown>|null)?.createdDate,
   last_update_source:(row.data as Record<string,unknown>|null)?.lastUpdate
  }));
 }
 missing=ids.filter(id=>!found.has(id));
 return {records:ids.filter(id=>found.has(id)).map(id=>found.get(id)!),missingIds:missing,sources};
}
