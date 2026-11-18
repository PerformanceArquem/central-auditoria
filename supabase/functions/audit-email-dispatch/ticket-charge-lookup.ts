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
 // O último apontamento é um registro real de horas do Movidesk, e não
 // 'lastUpdate' ou uma anotação interna de cobrança. Nunca inventar horas.
 const appointments=await db('audit_direct_appointments?select=ticket_id,appointment_date,duration_minutes,collaborator_name,activity&ticket_id=in.('+ids.join(',')+')&duration_minutes=gt.0&order=appointment_date.desc&limit=1000');
 if(!Array.isArray(appointments))throw Error('Não foi possível consultar os apontamentos reais.');
 const latest=new Map<string,Record<string,unknown>>();
 for(const raw of appointments){
   if(!raw||typeof raw!=='object')continue;
   const row=raw as Record<string,unknown>,id=String(row.ticket_id||'');
   if(!ids.includes(id)||latest.has(id))continue;
   latest.set(id,{date:String(row.appointment_date||''),minutes:Number(row.duration_minutes)||0,
     collaborator:String(row.collaborator_name||''),activity:String(row.activity||'')});
 }
 for(const [id,row] of found){
   found.set(id,{...row,last_real_appointment:latest.get(id)||null});
 }
 return {records:ids.filter(id=>found.has(id)).map(id=>found.get(id)!),missingIds:missing,sources};
}
