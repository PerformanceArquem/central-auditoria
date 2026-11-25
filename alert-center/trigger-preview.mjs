// Dry-run only. No network calls, ticket creation or delivery.
export function prepareTriggerPreview({profile,authorizedRecipientId,confirmed=false}){
 if(typeof authorizedRecipientId!=='string'||!authorizedRecipientId.trim()||!profile||profile.active!==true||profile.movideskPersonId!==authorizedRecipientId)throw Error('Destinatário fora da homologação autorizada.');
 if(confirmed!==true)throw Error('Confirme a preparação do teste.');
 return {mode:'dry-run',deliveryEnabled:false,subject:'TM-HOMOLOG-001',recipientId:authorizedRecipientId,description:'Teste de integração da Central de Alertas',requiresServerAuthorization:true,requiresDuplicateCheck:true,requiresMetricsExclusion:true};
}
