import {previewWaitingAppointment} from '../../../alert-center/robot-live-preview.mjs';
const env=(k:string)=>Deno.env.get(k)?.trim()||'';
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const allowed=new Set(['https://central-auditoria-iota.vercel.app','https://central-auditoria-arquem.vercel.app','https://centralauditoria.ddns.net','https://www.centralauditoria.ddns.net']).has(origin)||/^https:\/\/central-auditoria-[a-z0-9-]+-arquem\.vercel\.app$/.test(origin);
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',...(allowed?{'Access-Control-Allow-Origin':origin}:{})};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Método não permitido'},405);
 try{
 const base=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY'),role=env('SUPABASE_SERVICE_ROLE_KEY'),token=env('MOVIDESK_TOKEN');
 if(!base||!anon||!role||!token)return reply({error:'Configuração indisponível'},503);
 const auth=req.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(auth))return reply({error:'Sessão necessária'},401);
 const userResponse=await fetch(base+'/auth/v1/user',{headers:{apikey:anon,Authorization:auth},signal:AbortSignal.timeout(10000)});
 if(!userResponse.ok)return reply({error:'Sessão inválida'},401);
 const user=await userResponse.json();if(typeof user?.id!=='string')return reply({error:'Sessão inválida'},401);
 const read=async(table:string,params:Record<string,string>)=>{
 const url=new URL(base+'/rest/v1/'+table);
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 const response=await fetch(url,{method:'GET',headers:{apikey:role,Authorization:'Bearer '+role},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Consulta indisponível');
 const rows=await response.json();if(!Array.isArray(rows))throw Error('Resposta inválida');return rows;
 };
 const admins=await read('audit_users',{user_id:'eq.'+user.id,role:'eq.admin',is_active:'eq.true',select:'user_id',limit:'2'});
 if(admins.length!==1)return reply({error:'Acesso restrito'},403);
 const body=await req.json().catch(()=>null);
 if(body?.mode!=='read-only'||!/^\d{1,12}$/.test(String(body?.ticketId??'')))return reply({error:'Informe o chamado e o modo somente leitura'},400);
 const id=String(body.ticketId);
 const [holidays,blocks]=await Promise.all([
 read('audit_email_holidays',{affects_delivery:'eq.true',select:'holiday_date',limit:'1000'}),
 read('audit_triage_lookup_review',{ticket_id:'eq.'+id,resolved_at:'is.null',select:'ticket_id',limit:'2'})
 ]);
 if(holidays.length>=1000||holidays.some(h=>!/^\d{4}-\d{2}-\d{2}$/.test(h.holiday_date)))return reply({error:'Calendário não confirmado'},409);
 const row=await previewWaitingAppointment(id,{token,holidays:holidays.map(h=>h.holiday_date),blocked:blocks.length>0});
 return reply({ok:true,mode:'read-only',deliveryEnabled:false,threshold:3,row});
 }catch{return reply({error:'Consulta interrompida. Nenhum registro foi efetuado.'},502);}
});
