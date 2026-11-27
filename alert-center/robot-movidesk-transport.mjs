// Server-only transport; requires a separately verified agent identity.
// No email, customer-facing action, time appointment or automatic retry.
const escapeHtml=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function robotMovideskTransport({token,agentId,enabled=false,fetcher=fetch,validateBeforeWrite}={}){
 return async function writeInternal({ticketId,type,text,marker,ownerId}){
  if(enabled!==true)throw Error('Transporte desativado');
  if(!token||!/^\d{1,20}$/.test(String(agentId??''))||!/^\d{1,12}$/.test(String(ticketId))||type!==1||typeof text!=='string'||text.length>3500||typeof marker!=='string'||!marker.startsWith('CENTRAL-ROBOT-NOTE:'+ticketId+':')||!text.endsWith(marker))throw Error('Registro interno inválido');
  const url=new URL('https://api.movidesk.com/public/v1/tickets');
  url.searchParams.set('token',token);url.searchParams.set('id',String(ticketId));
  const read=async()=>{
   const response=await fetcher(url.toString(),{method:'GET',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('Consulta Movidesk indisponível');
   const data=await response.json();
   if(!data||Array.isArray(data)||String(data.id)!==String(ticketId)||!Array.isArray(data.actions))throw Error('Histórico não confirmado');
   return data;
  };
  const hasMarker=t=>t.actions.some(a=>Number(a.type)===1&&String(a.description||a.htmlDescription||'').includes(marker));
  const before=await read();
  if(hasMarker(before))return {confirmed:true,deduplicated:true};
  const status=String(before.status||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  if(!status||before.closedIn||before.canceledIn||String(before.isDeleted)==='true'||['fechado','resolvido','cancelado','concluido','concluido (sem confirmacao)','encerrado','finalizado'].includes(status))throw Error('Chamado indisponível');
  if(ownerId!=null&&String(before.owner?.id)!==String(ownerId))throw Error('Responsável alterado antes do registro');
  if(typeof validateBeforeWrite==='function'&&(await validateBeforeWrite(before,{ticketId:String(ticketId),text,marker,ownerId}))!==true)throw Error('Evidência alterada antes do registro');
  const response=await fetcher(url.toString(),{method:'PATCH',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({actions:[{id:0,type:1,description:escapeHtml(text),createdBy:{id:String(agentId)}}]}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Registro interno não confirmado');
  // HTTP success alone is insufficient. Require a read-back of the internal marker.
  return {confirmed:hasMarker(await read())};
 };
}
