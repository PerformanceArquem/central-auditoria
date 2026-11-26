// Read-only pilot: deliberately has no PATCH, scheduler or mail dependency.
export const PILOT_ID='102945';
export const PILOT_REFERENCE='TM-HOMOLOG-102945-OVERDUE-V1';
export const PILOT_TEXT='Olá! Tudo bem?\n\nIdentificamos que a previsão de solução deste chamado está vencida. Poderia, por gentileza, verificar o andamento e avaliar uma nova previsão de entrega?\n\nCaso exista algum impedimento ou necessidade de apoio, estamos à disposição para ajudar.\n\nAtenciosamente,\nTicket Manager | Gestão da Qualidade\nArquem Sistemas.';
export async function previewInternalNote(token, expectedOwnerId, fetcher=fetch, now=new Date()){
 if(!token||!expectedOwnerId)throw Error('Credencial ou responsável não confirmado.');
 const url=new URL('https://api.movidesk.com/public/v1/tickets');
 url.searchParams.set('token',token);url.searchParams.set('id',PILOT_ID);
 url.searchParams.set('$select','id,status,owner,ownerTeam,slaSolutionDate,slaSolutionDateIsPaused,closedIn');
 url.searchParams.set('$expand','actions');
 const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)}).catch(()=>{throw Error('Consulta Movidesk indisponível.');});
 if(!response.ok)throw Error('Consulta Movidesk HTTP '+response.status);
 const result=await response.json();
 const t=Array.isArray(result)?result.find(x=>String(x.id)===PILOT_ID):result;
 if(!t||String(t.id)!==PILOT_ID||String(t.owner?.id)!==String(expectedOwnerId))throw Error('Chamado ou responsável não confirmado.');
 const status=String(t.status||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const raw=String(t.slaSolutionDate||'');
 const due=Date.parse(/(Z|[+-]\d{2}:\d{2})$/i.test(raw)?raw:raw+'Z');
 if(!status||/fechad|resolvid|cancelad|concluid|encerrad|finalizad/.test(status)||t.closedIn||!['false',false].includes(t.slaSolutionDateIsPaused)||!Number.isFinite(due)||due>=+now)throw Error('Previsão vencida ativa não confirmada.');
 if(!Array.isArray(t.actions))throw Error('Histórico de ações indisponível.');
 const duplicate=t.actions.some(a=>String(a.description||a.htmlDescription||'').includes(PILOT_REFERENCE));
 return {mode:'read-only',ticketId:PILOT_ID,eligible:!duplicate,duplicate,deliveryEnabled:false,mailSent:false,appointmentCreated:false,reference:PILOT_REFERENCE,text:PILOT_TEXT};
}
