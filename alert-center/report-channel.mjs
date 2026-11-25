// Pure channel adapter. No network, attachments, or delivery.
export function prepareMovideskReport({prepared,authorizedRecipientId,enabled=false}){
 if(enabled!==true)throw Error('Canal Movidesk desabilitado');
 if(!prepared||prepared.report_data?.schema!=='arquem-mail-v1')throw Error('Relatório original inválido');
 const packet=prepared.report_data;
 if(!authorizedRecipientId||String(packet.recipientId)!==String(authorizedRecipientId))throw Error('Destinatário sem autorização para este relatório');
 if(packet.historicalIncomplete===true)throw Error('Relatório incompleto');
 if(typeof prepared.body_text!=='string'||!prepared.body_text.trim()||typeof prepared.subject!=='string'||!prepared.subject.trim())throw Error('Conteúdo original ausente');
 return {channel:'movidesk',mode:'dry-run',deliveryEnabled:false,recipientId:String(authorizedRecipientId),subject:prepared.subject,text:'TICKET MANAGER | ACOMPANHAMENTO OPERACIONAL\nConfira os indicadores, riscos e encaminhamentos do relatório.\n\n'+prepared.body_text,originalHtml:typeof prepared.body_html==='string'?prepared.body_html:null,reportKind:packet.reportKind,from:packet.from,to:packet.to,attachments:[]};
}

 // Prepared-report freshness guard. Call only after server-side recipient mapping
 // and existing reconciliation/configuration validation. No delivery.
 export function prepareFreshMovideskReport({prepared,authorizedRecipientId,enabled=false,now=Date.now(),verifiedSource=false}){
  if(verifiedSource!==true)throw Error('Fonte original não validada');
  if(prepared?.status!=='ready'||!Number.isFinite(now)||!Number.isFinite(Date.parse(prepared.expires_at))||Date.parse(prepared.expires_at)<=now)throw Error('Relatório indisponível ou expirado');
  if(prepared.report_data?.historicalIncomplete!==false)throw Error('Completude não confirmada');
  return prepareMovideskReport({prepared,authorizedRecipientId,enabled});
 }
