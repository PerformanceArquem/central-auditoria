// Conciliação independente de horas recentes Movidesk (somente leitura no Movidesk).
// Busca pela DATA DO APONTAMENTO, não pela abertura/lastUpdate do chamado.
// Sem e-mails, com paginação, checkpoint, lease e upsert idempotente.
const E=(k:string)=>Deno.env.get(k)?.trim()||'';
const SUPA=E('SUPABASE_URL').replace(/\/$/,'');
const ROLE=E('SUPABASE_SERVICE_ROLE_KEY');
const API='https://api.movidesk.com/public/v1/tickets';
const ORIGIN='https://central-auditoria-iota.vercel.app';
const headers=(req:Request)=>({
  'Access-Control-Allow-Origin':req.headers.get('Origin')===ORIGIN?ORIGIN:ORIGIN,
  'Access-Control-Allow-Methods':'OPTIONS,POST',
  'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-sync-cron-secret',
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'
});
const reply=(req:Request,obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:headers(req)});
const name=(x:unknown)=>x&&typeof x==='object'?String((x as Record<string,unknown>).businessName??(x as Record<string,unknown>).name??''):String(x??'');
const iso=(x:unknown)=>{const d=new Date(String(x??''));return Number.isFinite(d.getTime())?d.toISOString():null};
const time=(x:unknown)=>{
 if(x==null||x==='')return 0;
 if(typeof x==='number')return Number.isFinite(x)?Math.max(0,Math.round(x*60)):0;
 const s=String(x).trim(), m=/^(\d+):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?$/.exec(s);
 if(m)return Math.max(0,Math.round(+m[1]*60+(+m[2])+(+(m[3]||0))/60));
 const n=Number(s.replace(',','.'));return Number.isFinite(n)?Math.max(0,Math.round(n*60)):0;
};
async function db(path:string,method='GET',body?:unknown){
 if(!SUPA||!ROLE)throw Error('Secrets do Supabase incompletos');
 const r=await fetch(SUPA+'/rest/v1/'+path,{method,
  headers:{apikey:ROLE,Authorization:'Bearer '+ROLE,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 const s=await r.text();if(!r.ok)throw Error('Supabase HTTP '+r.status+': '+s.slice(0,200));
 return s?JSON.parse(s):null;
}
const rpc=(n:string,args:Record<string,unknown>={})=>db('rpc/'+n,'POST',args);
async function movidesk(params:Record<string,string>){
 const token=E('MOVIDESK_TOKEN');if(!token)throw Error('MOVIDESK_TOKEN indisponivel');
 const u=new URL(API);u.searchParams.set('token',token);
 for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
 const r=await fetch(u,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(22000)});
 if(!r.ok)throw Error('Movidesk HTTP '+r.status+' na conciliacao de apontamentos');
 return r.json();
}
async function isAdmin(req:Request){
 const auth=req.headers.get('Authorization')||'';
 if(!/^Bearer\s+\S+/.test(auth))return false;
 const r=await fetch(SUPA+'/auth/v1/user',{headers:{apikey:E('SUPABASE_ANON_KEY')||ROLE,Authorization:auth},signal:AbortSignal.timeout(10000)});
 if(!r.ok)return false;const u=await r.json();if(!u?.id)return false;
 const users=await db('audit_users?user_id=eq.'+encodeURIComponent(u.id)+'&role=eq.admin&is_active=eq.true&select=user_id&limit=1');
 return Array.isArray(users)&&users.length===1;
}
function extract(t:Record<string,unknown>){
 const out:Record<string,unknown>[]=[],id=String(t.id??''),actions=Array.isArray(t.actions)?t.actions as Record<string,unknown>[]:[];
 for(let ai=0;ai<actions.length;ai++){
  const a=actions[ai],entries=Array.isArray(a.timeAppointments)?a.timeAppointments as Record<string,unknown>[]:[];
  function push(v:unknown,person:unknown,date:unknown,activity:unknown,sector:unknown,key:string){
   const minutes=time(v),when=iso(date||a.createdDate)?.slice(0,10);
   if(!minutes||minutes>525600||!when)return;
   out.push({appointment_key:id+':'+key,ticket_id:id,collaborator_name:name(person)||name(t.owner)||'Não informado',
    sector:name(sector)||name(t.ownerTeam)||'Sem setor',activity:name(activity)||'Geral',
    appointment_date:when,duration_minutes:minutes,source_synced_at:new Date().toISOString()});
  }
  if(entries.length)entries.forEach((p,pi)=>push(p.workTime??p.accountedTime,p.createdBy??p.agent??a.createdBy,p.date,p.activity,
    p.createdByTeam,String(a.id??ai)+':'+String(p.id??pi)));
  else push(a.timeWorked,a.createdBy,a.createdDate,a.activity,t.ownerTeam,String(a.id??ai)+':action');
 }
 return out;
}
async function list(start:string,end:string,offset:number){
 // Documentação Movidesk: OData actions/any + timeAppointments/any.
 const f='actions/any(a: a/timeAppointments/any(p: p/date ge '+start+'T00:00:00.00z and p/date lt '+end+'T00:00:00.00z))';
 const items=await movidesk({'$select':'id,lastUpdate','$filter':f,'$orderby':'id asc','$top':'10','$skip':String(offset)});
 if(!Array.isArray(items))throw Error('Resposta inesperada da pesquisa Movidesk');
 return items as Record<string,unknown>[];
}
async function save(t:Record<string,unknown>){
 const id=String(t.id??'');if(!/^\d+$/.test(id))throw Error('ID invalido');
 const now=new Date().toISOString(),rows=extract(t);
 await db('audit_direct_tickets?on_conflict=ticket_id','POST',[{ticket_id:id,payload:t,created_at_source:iso(t.createdDate),
  last_update_source:iso(t.lastUpdate),closed_at_source:iso(t.closedIn??t.closedAt??t.closedDate),source_synced_at:now}]);
 if(rows.length)await db('audit_direct_appointments?on_conflict=appointment_key','POST',rows);
 return rows.length;
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=='POST')return reply(req,{error:'Metodo nao permitido'},405);
 try{
  const body=await req.json().catch(()=>({})),action=String(body.action||'status');
  const secret=E('CRON_SYNC_SECRET')||E('SYNC_CRON_SECRET');
  const cron=Boolean(secret)&&req.headers.get('x-sync-cron-secret')===secret;
  if(cron){
   if(action!=='sync_next')return reply(req,{error:'Cron apenas sync_next'},403);
   if(E('SYNC_AUTOMATION_ENABLED')!=='true')return reply(req,{ok:true,skipped:'Automacao desativada'});
  }else if(!await isAdmin(req))return reply(req,{error:'Admin autenticado necessario'},403);
  if(action==='status')return reply(req,{ok:true,state:await db('audit_recent_reconcile_state?select=*&limit=1')});
  if(action==='probe'){
   const state=(await db('audit_recent_reconcile_state?select=*&limit=1'))[0];
   const rows=await list(state.period_start,state.period_end,state.next_offset);
   return reply(req,{ok:true,rows:rows.length,ids:rows.map((x:Record<string,unknown>)=>x.id),from:state.period_start,to:state.period_end,note:'Somente leitura'});
  }
  if(action!=='sync_next')return reply(req,{error:'Acao nao reconhecida'},400);
  const claims=await rpc('audit_recent_claim');
  if(!Array.isArray(claims)||!claims.length)return reply(req,{ok:true,skipped:'Outro lote em andamento'});
  const c=claims[0];
  if(c.already_completed)return reply(req,{ok:true,completed:true,from:c.claimed_start,to:c.claimed_end,note:'Janela conciliada'});
  try{
   const rows=await list(c.claimed_start,c.claimed_end,c.claimed_offset);
   let appts=0;
   for(const row of rows){
    const id=String(row.id??'');if(!/^\d+$/.test(id))throw Error('ID de chamado invalido');
    const full=await movidesk({id});if(!full||String(full.id??'')!==id)throw Error('Detalhe invalido '+id);
    appts+=await save(full);
   }
   const complete=rows.length<10;
   const finished=await rpc('audit_recent_finish',{p_token:c.claimed_token,p_count:rows.length,p_complete:complete,p_error:null});
   if(finished!==true)throw Error('Checkpoint nao confirmado');
   return reply(req,{ok:true,mode:'recent_time_appointments',saved:rows.length,appointments:appts,
    from:c.claimed_start,to:c.claimed_end,nextOffset:c.claimed_offset+rows.length,completed:complete});
  }catch(e){
   await rpc('audit_recent_finish',{p_token:c.claimed_token,p_count:0,p_complete:false,p_error:String(e)}).catch(()=>{});
   throw e;
  }
 }catch(e){return reply(req,{ok:false,error:String(e instanceof Error?e.message:e).slice(0,350)},500)}
});