import {readTriageHistories} from '../../../alert-center/triage-live-reader.mjs';
import {evaluateImportedTriage} from '../../../alert-center/triage-adapter.mjs';
const env=(key:string)=>Deno.env.get(key)?.trim()||'';
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const allowed=/^https:\/\/central-auditoria-[a-z0-9-]+-arquem\.vercel\.app$/.test(origin);
 const cors={'Vary':'Origin','Cache-Control':'no-store','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',...(allowed?{'Access-Control-Allow-Origin':origin}:{})};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply({error:'Método não permitido'},405);
 let stage='auth';
 try{
 const base=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY'),key=env('SUPABASE_SERVICE_ROLE_KEY');
 const auth=req.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(auth))return reply({error:'Sessão necessária'},401);
 const userResponse=await fetch(base+'/auth/v1/user',{headers:{apikey:anon,Authorization:auth},signal:AbortSignal.timeout(10000)});
 if(!userResponse.ok)return reply({error:'Sessão inválida'},401);
 const user=await userResponse.json();
 if(typeof user.id!=='string')return reply({error:'Sessão inválida'},401);
 const read=async(table:string,params:Record<string,string>)=>{
 const url=new URL(base+'/rest/v1/'+table);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 const response=await fetch(url,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Consulta indisponível');
 const rows=await response.json();if(!Array.isArray(rows))throw Error('Resposta inválida');return rows;
 };
 const admins=await read('audit_users',{user_id:'eq.'+user.id,role:'eq.admin',is_active:'eq.true',select:'user_id',limit:'2'});
 if(admins.length!==1)return reply({error:'Acesso restrito'},403);
 let body;try{body=await req.json();}catch{return reply({error:'Requisição inválida'},400);}
 if(body.mode!=='read-only')return reply({error:'Somente consulta sem envio'},400);
 const threshold=body.threshold??3;
 if(!Number.isInteger(threshold)||threshold<1||threshold>365)return reply({error:'Informe de 1 a 365 dias úteis'},400);
 stage='snapshot';
 const [current,holidayRows]=await Promise.all([
 read('audit_reporting_open_ticket_snapshot',{'payload->>ownerTeam':'eq.Inteligência','payload->>status':'eq.Em Análise',select:'ticket_id,payload,closed_at_source',order:'ticket_id.asc',limit:'501'}),
 read('audit_email_holidays',{affects_delivery:'eq.true',select:'holiday_date',limit:'1000'})
 ]);
 if(current.length>500||holidayRows.length>=1000)return reply({error:'Consulta parcial; limite atingido. Não homologar.'},409);
 const ids=current.map(r=>String(r.ticket_id));
 if(ids.some(id=>!/^\d+$/.test(id)))throw Error('Identificador inválido');
 stage='history';
 const stored=ids.length?await read('audit_reporting_tickets',{ticket_id:'in.('+ids.join(',')+')',select:'ticket_id,source_synced_at,payload',limit:'501'}):[];
 const byId=new Map(stored.map(r=>[String(r.ticket_id),r]));
 let now=new Date().toISOString();
 const directIds=new Set<string>();let directRequests=0;
 stage='direct';
 if(body.refresh===true){
 const candidates=current.filter(r=>{
 const result=evaluateImportedTriage(r,byId.get(String(r.ticket_id)),{now,threshold,holidays:holidayRows.map(h=>h.holiday_date)});
 return !result.eligible&&!['below-threshold','outside-triage'].includes(result.reason);
 }).map(r=>String(r.ticket_id));
 if(candidates.length>50)return reply({error:'Mais de 50 históricos pendentes. Reduza o lote antes da consulta direta.'},409);
 let live;
 try{live=await readTriageHistories(candidates,env('MOVIDESK_TOKEN'));}
 catch(error){return reply({error:(error as {code?:string}).code==='rate-limit'?'Movidesk limitou as consultas. Aguarde antes de tentar novamente.':'Consulta direta do Movidesk indisponível. Nenhum histórico foi substituído.'},(error as {code?:string}).code==='rate-limit'?429:502);}
 directRequests=live.requests;now=new Date().toISOString();
 const fetched=new Map(live.tickets.map(t=>[String(t.id),t]));
 for(const row of current){
 const payload=fetched.get(String(row.ticket_id));if(!payload)continue;
 directIds.add(String(row.ticket_id));
 row.payload=payload;row.closed_at_source=payload.isDeleted===true?now:(payload.closedIn||null);
 byId.set(String(row.ticket_id),{ticket_id:String(row.ticket_id),payload,source_synced_at:now});
 }
 }
 stage='evaluation';
 const rows=current.map(r=>({...evaluateImportedTriage(r,byId.get(String(r.ticket_id)),{now,threshold,holidays:holidayRows.map(h=>h.holiday_date)}),source:directIds.has(String(r.ticket_id))?'Movidesk · consulta direta':'Base importada'}));
 return reply({ok:true,mode:'read-only',deliveryEnabled:false,sector:'Inteligência',status:'Em Análise',threshold,now,rows,complete:true,directReads:directIds.size,directRequests});
 }catch{return reply({error:'Consulta interrompida na etapa '+({auth:'de autenticação',snapshot:'de leitura da seleção importada',history:'de leitura dos históricos importados',direct:'de conferência direta',evaluation:'de validação dos históricos'}[stage]||'de consulta')+'. Nenhum resultado foi homologado.'},502);}
});
