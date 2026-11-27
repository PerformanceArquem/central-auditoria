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
 if(!/^[a-f0-9]{64}$/.test(cronSecret))return reply({error:'Acesso restrito'},403);
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
 const allPages=body?.allPages===true;
 if(allPages&&(!scheduled||!batch))return reply({error:'Execução completa restrita ao servidor'},403);
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
 let currentCursor=cursor;
 const started=Date.now();
 const rows: {ticketId:string,plan:unknown,review:boolean}[]=[];
 let pages=0;
 do {
 const sectors=['Suporte','Qualidade','Testes (QA)','Sucesso do Cliente','Implantação','Treinamento'];
 // Query the provider directly, using a numeric keyset rather than a mutable offset.
 const url=new URL('https://api.movidesk.com/public/v1/tickets');
 url.searchParams.set('token',token);
 url.searchParams.set('$select','id,ownerTeam,status,justification,baseStatus');
 const sectorFilter=sectors.map(s=>"ownerTeam eq '"+s.replaceAll("'","''")+"'").join(' or ');
 const clauses=["("+sectorFilter+")","(status eq 'Aguardando cliente' or (status eq 'Agendado' and justification eq 'Aguardando ação do cliente'))"];
 if(currentCursor!==null)clauses.push('id gt '+currentCursor);
 url.searchParams.set('$filter',clauses.join(' and '));
 url.searchParams.set('$orderby','id asc');
 url.searchParams.set('$top','6');
 const response=await fetch(url,{method:'GET',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)return reply({error:'Consulta direta Movidesk indisponível',providerStatus:response.status},502);
 const candidates=await response.json();
 if(!Array.isArray(candidates)||candidates.length>6)throw Error('Lista Movidesk inválida');
 const allIds=candidates.map(x=>String(x.id));
 if(allIds.some((x,i)=>!/^\d{1,12}$/.test(x)||(i>0&&Number(x)<=Number(allIds[i-1]))||(currentCursor!==null&&Number(x)<=Number(currentCursor))))throw Error('Paginação direta inválida');
 const ids=allIds.slice(0,5);
 for(const ticketId of ids){
 try{const result=await executor.preview(ticketId);rows.push({ticketId,plan:result.plan,review:false});}
 catch{rows.push({ticketId,plan:null,review:true});}
 }
 pages++;
 currentCursor=candidates.length>5?ids[ids.length-1]:null;
 }while(allPages&&currentCursor!==null&&pages<10&&Date.now()-started<60000);
 return reply({ok:true,mode:'read-only',deliveryEnabled:false,coverage:'live-provider-page',rows,nextCursor:currentCursor,pages,complete:currentCursor===null});
 }
 const result=await executor.preview(id);
 return reply({ok:true,deliveryEnabled:false,mode:'read-only',plan:result.plan});
 }catch{return reply({error:'Homologação interrompida; nenhuma cobrança realizada'},502);}
});
