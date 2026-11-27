import {createWaitingExecutor} from '../../../alert-center/robot-waiting-executor.mjs';
import {robotPersistence} from '../../../alert-center/robot-persistence-adapter.mjs';
const env=(k:string)=>Deno.env.get(k)?.trim()||'';
Deno.serve(async(req:Request)=>{
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply({error:'Método não permitido'},405);
 try{
 const base=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY'),role=env('SUPABASE_SERVICE_ROLE_KEY'),token=env('MOVIDESK_TOKEN');
 if(!base||!anon||!role||!token)return reply({error:'Configuração indisponível'},503);
 const auth=req.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(auth))return reply({error:'Sessão necessária'},401);
 const cronSecret=req.headers.get('x-robot-cron-secret');
 let scheduled=auth==='Bearer '+role;
 if(cronSecret){
 if(auth!=='Bearer '+anon||cronSecret.length!==64)return reply({error:'Acesso restrito'},403);
 const check=await fetch(base+'/rest/v1/rpc/audit_robot_verify_cron_secret',{method:'POST',headers:{apikey:role,Authorization:'Bearer '+role,'Content-Type':'application/json'},body:JSON.stringify({p_secret:cronSecret}),signal:AbortSignal.timeout(10000)});
 scheduled=check.ok&&(await check.json())===true;
 if(!scheduled)return reply({error:'Acesso restrito'},403);
 }
 let user: {id:string}|null=null;
 if(!scheduled){
 const userResponse=await fetch(base+'/auth/v1/user',{headers:{apikey:anon,Authorization:auth},signal:AbortSignal.timeout(10000)});
 if(!userResponse.ok)return reply({error:'Sessão inválida'},401);
 user=await userResponse.json();
 if(typeof user?.id!=='string')return reply({error:'Sessão inválida'},401);
 }
 const db=async(path:string,opts:RequestInit={})=>{
 const response=await fetch(base+'/rest/v1/'+path,{...opts,headers:{apikey:role,Authorization:'Bearer '+role,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Consulta indisponível');
 return response.json();
 };
 const read=async(table:string,params:Record<string,string>)=>{
 const rows=await db(table+'?'+new URLSearchParams(params));
 if(!Array.isArray(rows))throw Error('Resposta inválida');return rows;
 };
 if(!scheduled){
 const admins=await read('audit_users',{user_id:'eq.'+user!.id,role:'eq.admin',is_active:'eq.true',select:'user_id',limit:'2'});
 if(admins.length!==1)return reply({error:'Acesso restrito'},403);
 }
 const body=await req.json().catch(()=>null);
 const id=String(body?.ticketId??'');
 const batch=body?.action==='batch';
 if(scheduled&&!batch)return reply({error:'Somente consulta coletiva agendada'},400);
 const cursor=body?.cursor??null;
 if(body?.mode!=='read-only'||(batch?(cursor!==null&&(typeof cursor!=='string'||!/^\d{1,12}$/.test(cursor))):!/^\d{1,12}$/.test(id)))return reply({error:'Consulta de homologação inválida'},400);
 const readPolicy=async(ticketId:string)=>{
 const [holidays,blocks]=await Promise.all([
 read('audit_email_holidays',{affects_delivery:'eq.true',select:'holiday_date',limit:'1000'}),
 read('audit_triage_lookup_review',{ticket_id:'eq.'+ticketId,resolved_at:'is.null',select:'ticket_id',limit:'2'})
 ]);
 return {complete:holidays.length<1000&&holidays.every(h=>/^\d{4}-\d{2}-\d{2}$/.test(h.holiday_date)),blocked:blocks.length>0,holidays:holidays.map(h=>h.holiday_date)};
 };
 const readTicket=async(ticketId:string)=>{
 const url=new URL('https://api.movidesk.com/public/v1/tickets');
 url.searchParams.set('token',token);url.searchParams.set('id',ticketId);
 const response=await fetch(url,{method:'GET',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Chamado não confirmado');
 return response.json();
 };
 // Explicit hard lock. No production PATCH capability is exposed by this endpoint.
 const executor=createWaitingExecutor({readPolicy,readTicket,...robotPersistence(db),enabled:false});
 if(batch){
 const sectors=['Suporte','Qualidade','Testes (QA)','Sucesso do Cliente','Implantação','Treinamento'];
 const params:Record<string,string>={select:'ticket_id',closed_at_source:'is.null','payload->>ownerTeam':'in.('+sectors.map(s=>'"'+s+'"').join(',')+')',or:'(payload->>status.eq.Aguardando cliente,payload->>justification.eq.Aguardando ação do cliente)',order:'ticket_id.asc',limit:'6'};
 if(cursor!==null)params.ticket_id='gt.'+cursor;
 const candidates=await read('audit_reporting_tickets',params);
 const ids=candidates.slice(0,5).map(x=>String(x.ticket_id));
 if(ids.some(x=>!/^\d{1,12}$/.test(x))||new Set(ids).size!==ids.length)throw Error('Seleção inválida');
 const rows=[];
 for(const ticketId of ids){
 try{const result=await executor.preview(ticketId);rows.push({ticketId,plan:result.plan,review:false});}
 catch{rows.push({ticketId,plan:null,review:true});}
 }
 return reply({ok:true,mode:'read-only',deliveryEnabled:false,coverage:'not-exhaustive',rows,nextCursor:candidates.length>5?ids[ids.length-1]:null});
 }
 const result=await executor.preview(id);
 return reply({ok:true,deliveryEnabled:false,mode:'read-only',plan:result.plan});
 }catch{return reply({error:'Homologação interrompida; nenhuma cobrança realizada'},502);}
});
