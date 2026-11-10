// Central de Auditoria — Movidesk incremental, piloto de produção controlado.
// NÃO altera o checkpoint histórico e NÃO envia e-mails.
// Exige admin Supabase em 'status'/'probe' ou segredo do Cron em 'sync_next'.
const env=(name:string)=>Deno.env.get(name)?.trim()??"";
const SUPA=env("SUPABASE_URL").replace(/\/$/,"");
const ROLE=env("SUPABASE_SERVICE_ROLE_KEY");
const API="https://api.movidesk.com/public/v1/tickets";
const ORIGIN="https://central-auditoria-iota.vercel.app";
function headers(req:Request){
 const origin=req.headers.get("Origin")??"";
 return {
  "Access-Control-Allow-Origin":origin===ORIGIN?origin:ORIGIN,
  "Access-Control-Allow-Methods":"OPTIONS, POST",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-sync-cron-secret, x-supabase-api-version",
  "Access-Control-Max-Age":"3600",
  "Vary":"Origin",
 };
}
function reply(req:Request,data:unknown,status=200){
 return new Response(JSON.stringify(data),{status,headers:{...headers(req),"Content-Type":"application/json","Cache-Control":"no-store"}});
}
function iso(v:unknown):string|null{
 if(!v)return null;
 const d=new Date(String(v));return Number.isFinite(d.getTime())?d.toISOString():null;
}
function name(v:unknown):string {
 if(v&&typeof v==="object"){
  const r=v as Record<string,unknown>;return String(r.name??r.businessName??r.email??"");
 }
 return String(v??"");
}
function minutes(v:unknown):number{
 if(v==null||v==="")return 0;
 if(typeof v==="number")return Number.isFinite(v)?Math.max(0,Math.round(v*60)):0;
 const str=String(v).trim(),m=/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(str);
 if(m)return Math.max(0,Math.round(Number(m[1])*60+Number(m[2])+Number(m[3]??0)/60));
 const n=Number(str.replace(",","."));return Number.isFinite(n)?Math.max(0,Math.round(n*60)):0;
}
function appointments(ticket:Record<string,unknown>){
 const rows:Record<string,unknown>[]=[],ticketId=String(ticket.id??"");
 const acts=Array.isArray(ticket.actions)?ticket.actions as Record<string,unknown>[]:[];
 for(let ai=0;ai<acts.length;ai++){
  const action=acts[ai];
  const entries=Array.isArray(action.timeAppointments)?action.timeAppointments as Record<string,unknown>[]:[];
  function add(duration:unknown,person:unknown,date:unknown,activity:unknown,sector:unknown,key:string){
   const d=minutes(duration),day=iso(date??action.createdDate)?.slice(0,10);
   if(!d||d>525600||!day)return;
   rows.push({appointment_key:ticketId+":"+key,ticket_id:ticketId,
    collaborator_name:name(person)||name(ticket.owner)||"Não informado",
    sector:name(sector)||name(ticket.ownerTeam)||"Sem setor",
    activity:name(activity)||"Geral",appointment_date:day,duration_minutes:d,
    source_synced_at:new Date().toISOString()});
  }
  if(entries.length)entries.forEach((p,pi)=>add(p.workTime??p.accountedTime,
   p.createdBy??p.agent??action.createdBy,p.date,p.activity,p.createdByTeam,
   String(action.id??ai)+":"+String(p.id??pi)));
  else add(action.timeWorked,action.createdBy,action.createdDate,action.activity,
   ticket.ownerTeam,String(action.id??ai)+":action");
 }
 return rows;
}
async function db(path:string,method="GET",payload?:unknown){
 if(!SUPA||!ROLE)throw Error("Configuração de Supabase indisponível");
 const response=await fetch(SUPA+"/rest/v1/"+path,{
  method,headers:{apikey:ROLE,Authorization:"Bearer "+ROLE,
   "Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=representation"},
  ...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(20000)});
 const body=await response.text();
 if(!response.ok)throw Error("Supabase HTTP "+response.status+": "+body.slice(0,200));
 return body?JSON.parse(body):null;
}
async function rpc(functionName:string,args:Record<string,unknown>={}){return db("rpc/"+functionName,"POST",args)}
async function md(params:Record<string,string>){
 const token=env("MOVIDESK_TOKEN");if(!token)throw Error("MOVIDESK_TOKEN ausente");
 const url=new URL(API);url.searchParams.set("token",token);
 for(const [key,val] of Object.entries(params))url.searchParams.set(key,val);
 // Falhas temporárias são repetidas sem avançar o checkpoint do lote.
 // Limitar a espera evita prender a Edge Function indefinidamente.
 for(let attempt=0;attempt<3;attempt++){
  try{
   const r=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(12000)});
   if(r.ok)return await r.json();
   if(![429,500,502,503,504].includes(r.status)||attempt===2)
    throw Error("Movidesk HTTP "+r.status);
   const retryAfter=Number(r.headers.get("Retry-After"));
   const delay=Number.isFinite(retryAfter)&&retryAfter>0
    ? Math.min(4000,retryAfter*1000):500*2**attempt;
   await new Promise(resolve=>setTimeout(resolve,delay));
  }catch(error){
   if(attempt===2||!(
    error instanceof TypeError||
    error instanceof DOMException&&error.name==="TimeoutError"
   ))throw error;
   await new Promise(resolve=>setTimeout(resolve,500*2**attempt));
  }
 }
 throw Error("Tentativas Movidesk esgotadas");
}
async function admin(req:Request){
 const authorization=req.headers.get("Authorization")??"";
 if(!/^Bearer\s+/.test(authorization))return false;
 const key=env("SUPABASE_ANON_KEY")||ROLE;
 const response=await fetch(SUPA+"/auth/v1/user",{
  headers:{apikey:key,Authorization:authorization},signal:AbortSignal.timeout(10000)});
 if(!response.ok)return false;
 const user=await response.json();if(!user?.id)return false;
 const rows=await db("audit_users?user_id=eq."+encodeURIComponent(user.id)+"&role=eq.admin&is_active=eq.true&select=user_id&limit=1");
 return Array.isArray(rows)&&rows.length===1;
}
type State={window_start:string;window_end:string;next_offset:number};
async function current(){
 const rows=await db("audit_incremental_state?job_name=eq.movidesk_incremental&select=job_name,window_start,window_end,next_offset,lease_until,last_success_at,last_error");
 if(!Array.isArray(rows)||!rows.length)throw Error("Estado incremental ausente");
 return rows[0];
}
async function list(s:State){
 const start=new Date(s.window_start).toISOString().replace(/\.\d{3}Z$/,"Z");
 const end=new Date(s.window_end).toISOString().replace(/\.\d{3}Z$/,"Z");
 const items=await md({
  "$select":"id,lastUpdate",
  "$filter":"lastUpdate ge "+start+" and lastUpdate lt "+end,
  "$orderby":"lastUpdate asc,id asc","$top":"5","$skip":String(s.next_offset),
 });
 if(!Array.isArray(items))throw Error("Lista Movidesk inválida");
 return items as Record<string,unknown>[];
}
async function saveTicket(t:Record<string,unknown>){
 const id=String(t.id??"");
 if(!/^\d+$/.test(id))throw Error("ID inválido");
 const now=new Date().toISOString();
 await db("audit_direct_tickets?on_conflict=ticket_id","POST",[{
  ticket_id:id,payload:t,created_at_source:iso(t.createdDate),
  last_update_source:iso(t.lastUpdate),
  closed_at_source:iso(t.closedIn??t.closedAt??t.closedDate),source_synced_at:now,
 }]);
 const rows=appointments(t);
 if(rows.length)await db("audit_direct_appointments?on_conflict=appointment_key","POST",rows);
 return rows.length;
}
Deno.serve(async (req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=="POST")return reply(req,{error:"Método não permitido"},405);
 try{
  const body=await req.json().catch(()=>({}));
  const action=String(body.action??"status");
  const expected=env("CRON_SYNC_SECRET")||env("SYNC_CRON_SECRET");
  const provided=req.headers.get("x-sync-cron-secret")??"";
  const cron=Boolean(expected)&&provided===expected;
  if(cron){
   if(action!=="sync_next")return reply(req,{error:"Ação não autorizada para Cron"},403);
   if(env("SYNC_AUTOMATION_ENABLED")!=="true")return reply(req,{ok:true,skipped:"Automação desativada"});
  } else if(!await admin(req))return reply(req,{error:"Administrador autenticado necessário"},403);
  if(action==="status")return reply(req,{ok:true,mode:"incremental",state:await current()});
  if(action==="probe"){
   const state=await current(),items=await list(state);
   return reply(req,{ok:true,mode:"probe",read:items.length,sampleIds:items.map(x=>x.id),
    state,note:"Somente leitura; sem alterações"});
  }
  if(action!=="sync_next")return reply(req,{error:"Ação desconhecida"},400);
  const claims=await rpc("audit_incremental_claim");
  if(!Array.isArray(claims)||!claims.length)return reply(req,{ok:true,skipped:"Outro lote em andamento"});
  const c=claims[0] as {claimed_token:string;claimed_from:string;claimed_to:string;claimed_offset:number};
  try{
   const items=await list({window_start:c.claimed_from,window_end:c.claimed_to,next_offset:c.claimed_offset});
   let saved=0,pointCount=0;
   for(const item of items){
    const id=String(item.id??"");if(!/^\d+$/.test(id))throw Error("ID inválido na listagem");
    const detail=await md({id});
    if(!detail||String(detail.id??"")!==id)throw Error("Detalhe inválido: "+id);
    pointCount+=await saveTicket(detail);saved++;
   }
   const completed=await rpc("audit_incremental_finish",
    {p_token:c.claimed_token,p_count:items.length,p_success:true,p_error:null});
   if(completed!==true)throw Error("Checkpoint incremental não confirmado");
   return reply(req,{ok:true,mode:"sync_next",read:items.length,saved,
    appointments:pointCount,nextOffset:items.length<5?0:c.claimed_offset+items.length,
    windowCompleted:items.length<5,note:"Sem e-mails; histórico preservado"});
  }catch(e){
   await rpc("audit_incremental_finish",
    {p_token:c.claimed_token,p_count:0,p_success:false,p_error:String(e)}).catch(()=>{});
   throw e;
  }
 }catch(e){return reply(req,{ok:false,error:String(e instanceof Error?e.message:e).slice(0,260)},500)}
});
