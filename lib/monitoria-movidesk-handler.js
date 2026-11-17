// Mini Central: consulta somente leitura das interações de um chamado Movidesk.
// Não equivale necessariamente ao histórico integral do chat: depende das ações que o Movidesk expõe.
const REPO='https://api.movidesk.com/public/v1/tickets';
const answer=(res,status,v)=>res.status(status).json(v);
async function authorize(req){
 const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const jwt=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'')?.[1];
 if(!base.startsWith('https://')||!key||!jwt)return {ok:false,status:401,error:'Faça login para consultar o Movidesk'};
 const user=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+jwt},signal:AbortSignal.timeout(10000)});
 if(!user.ok)return {ok:false,status:401,error:'Sessão inválida'};
 const profile=await user.json();
 if(!profile?.id)return {ok:false,status:401,error:'Sessão inválida'};
 const u=new URL(base+'/rest/v1/audit_users');
 u.searchParams.set('user_id','eq.'+profile.id);u.searchParams.set('select','role,is_active');u.searchParams.set('limit','1');
 const r=await fetch(u,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});
 if(!r.ok)return {ok:false,status:503,error:'Não foi possível confirmar o perfil'};
 const rows=await r.json();
 if(!Array.isArray(rows)||!rows.some(x=>String(x.role).toLowerCase()==='admin'&&x.is_active===true))
  return {ok:false,status:403,error:'Somente a Qualidade autorizada pode visualizar conversas'};
 return {ok:true};
}
function plain(value){
 return String(value||'').replace(/<\s*br\s*\/?\s*>/gi,'\n')
  .replace(/<\/(p|div|li)>/gi,'\n').replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<')
  .replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').trim().slice(0,10000);
}
function actor(v){
 if(typeof v==='string')return v.slice(0,100);
 return String(v?.businessName||v?.name||'Não identificado').slice(0,100);
}
export function normalize(ticket){
 const actions=Array.isArray(ticket?.actions)?ticket.actions:[];
 const messages=actions.filter(a=>a&&!a.isDeleted&&
   (typeof a.description==='string'||typeof a.htmlDescription==='string'))
  .slice(0,1500).map((a,i)=>({
   index:i,id:String(a.id||'').slice(0,60),
   at:String(a.createdDate||'').slice(0,40),
   sender:actor(a.createdBy),
   text:plain(a.description||a.htmlDescription),
   actionType:a.type==null?null:String(a.type).slice(0,20),
   origin:a.origin==null?null:String(a.origin).slice(0,20)
  })).filter(a=>a.text);
 const active=actions.filter(a=>a&&!a.isDeleted);
 const origins=[...new Set(active.map(a=>a.origin==null?'não informado':String(a.origin)))].slice(0,30);
 const types=[...new Set(active.map(a=>a.type==null?'não informado':String(a.type)))].slice(0,30);
 const discarded=active.length-messages.length;
 const partial=actions.length>1500||messages.length>=1500;
 const coverage={
  source:'movidesk_ticket_actions',chatFullHistoryVerified:false,
  exportedActions:actions.length,activeActions:active.length,renderedInteractions:messages.length,
  nonTextOrExcludedActions:Math.max(0,discarded),actionOrigins:origins,actionTypes:types,
  partial,requiresHumanCheck:true,
  reason:'Ações de chamado são registros de diferentes origens/tipos, não necessariamente mensagens de chat. Não foi confirmado início, fim ou integridade da conversa.'
 };
 return {ticketId:String(ticket.id||''),subject:String(ticket.subject||'').slice(0,240),
  messages,partial,coverage,source:'movidesk_ticket_actions',
  warning:'EXTRATO NÃO HOMOLOGADO COMO CHAT COMPLETO: valide início, fim e participantes da conversa antes de pontuar. Ações de chamado podem incluir notas e registros internos.'};
}
async function syncedTicket(id){
 const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!base.startsWith('https://')||!key)return null;
 const url=new URL(base+'/rest/v1/audit_direct_tickets');
 url.searchParams.set('select','ticket_id,payload');
 url.searchParams.set('ticket_id','eq.'+id);
 url.searchParams.set('limit','1');
 const r=await fetch(url,{headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!r.ok)return null;
 const rows=await r.json();
 const record=Array.isArray(rows)?rows[0]:null;
 if(!record||String(record.ticket_id)!==id||!record.payload||typeof record.payload!=='object')return null;
 const normalized=normalize({...record.payload,id});
 if(!normalized.messages.length)return null;
 normalized.source='synced_movidesk_ticket_actions';
 normalized.coverage.source='synced_movidesk_ticket_actions';
 normalized.coverage.chatFullHistoryVerified=false;
 normalized.warning='EXTRATO SINCRONIZADO: consulta ao vivo não disponível; estes registros podem conter notas internas e NÃO comprovam o chat completo. Verifique autoria e cobertura antes de avaliar.';
 return normalized;
}
async function useSyncedOrFail(res,id,message,status=502){
 try{
  const data=await syncedTicket(id);
  if(data)return answer(res,200,{ok:true,...data,syncedFallback:true});
 }catch{/* O fallback nunca deve expor erros internos ou dados do serviço. */}
 return answer(res,status,{ok:false,error:message});
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return answer(res,405,{ok:false,error:'Método não permitido'});
 let authorized=false;
 try{
  const allowed=await authorize(req);
  if(!allowed.ok)return answer(res,allowed.status,{ok:false,error:allowed.error});
  authorized=true;
  const id=String(req.query.ticketId||'');
  if(!/^\d{1,12}$/.test(id))return answer(res,400,{ok:false,error:'Informe o número do chamado Movidesk'});
  const token=process.env.MOVIDESK_TOKEN;
  if(!token)return await useSyncedOrFail(res,id,'Movidesk não configurado e não há extrato sincronizado para este chamado',503);
  const url=new URL(REPO);
  url.searchParams.set('token',token);
  url.searchParams.set('$filter','id eq '+id);
  url.searchParams.set('$expand','actions');
  url.searchParams.set('$top','1');
  const upstream=await fetch(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(18000)});
  if(!upstream.ok)return await useSyncedOrFail(res,id,'API Movidesk indisponível e extrato sincronizado não encontrado');
  const rows=await upstream.json();
  if(!Array.isArray(rows))return await useSyncedOrFail(res,id,'Resposta Movidesk inválida e extrato sincronizado não encontrado');
  const ticket=rows.find(t=>String(t?.id)===id);
  if(!ticket)return await useSyncedOrFail(res,id,'Chamado não localizado na API ou no banco sincronizado',404);
  return answer(res,200,{ok:true,...normalize(ticket)});
 }catch{
  const id=String(req.query.ticketId||'');
  if(authorized&&/^\d{1,12}$/.test(id))return await useSyncedOrFail(res,id,'Consulta Movidesk indisponível e nenhum extrato sincronizado encontrado');
  return answer(res,authorized?400:503,{ok:false,error:authorized?'Número de chamado inválido':'Falha ao validar a sessão e as permissões'});
 }
}
