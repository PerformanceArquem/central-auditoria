/** Called by the existing authenticated doPost, before the global pause guard. */
function arquemEmailDeliveryControl_(dados,props) {
  if(typeof dados.paused!=='boolean')throw new Error('Estado inválido');
  const authorization=String(dados.adminAuthorization||'');
  if(!/^Bearer\s+[A-Za-z0-9._-]+$/.test(authorization)||authorization.length>5000)
    throw new Error('Sessão de administrador obrigatória para alterar a chave');
  // Verify the current admin session against our existing JWT-protected action.
  // The shared mail credential alone must never be able to change this switch.
  const verification=UrlFetchApp.fetch('https://dvaaicqajlppuigeyejr.supabase.co/functions/v1/audit-email-dispatch',{
    method:'post',contentType:'application/json',headers:{Authorization:authorization},
    payload:JSON.stringify({action:'email_delivery_control'}),muteHttpExceptions:true
  });
  const identity=JSON.parse(verification.getContentText());
  if(verification.getResponseCode()!==200||identity.ok!==true||typeof identity.paused!=='boolean')
    throw new Error('Administrador não autorizado a alterar a chave de e-mails');
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000))throw new Error('Alteração em andamento');
  try{
    props.setProperty('ARQUEM_EMAILS_PAUSED',String(dados.paused));
    return {sucesso:true,paused:dados.paused};
  }finally{lock.releaseLock();}
}
