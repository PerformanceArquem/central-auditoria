// Isolated homologation orchestrator. No direct network or production scheduler.
// The server must provide authenticated profile, durable atomic reservation and verified transport.
export async function runDeliveryHomologation({profile,authorizedRecipientId,ticketId,requestKey,confirmed=false,deliveryEnabled=false},{reserve,send,finish}={}){
 if(confirmed!==true||profile?.active!==true||typeof authorizedRecipientId!=='string'||!authorizedRecipientId.trim()||profile.movideskPersonId!==authorizedRecipientId)throw Error('Homologação não autorizada');
 if(!/^\d+$/.test(String(ticketId))||!ticketId||typeof requestKey!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey))throw Error('Identificação inválida');
 const packet={subject:'TM-HOMOLOG-002',recipientId:authorizedRecipientId,ticketId:String(ticketId),requestKey,text:'Ticket Manager | Teste de homologação. Nenhuma ação operacional necessária. Chamado: https://arquem.movidesk.com/Ticket/Edit/'+ticketId};
 if(deliveryEnabled!==true)return {status:'simulated',deliveryEnabled:false,packet};
 if([reserve,send,finish].some(fn=>typeof fn!=='function'))throw Error('Transporte e persistência não configurados');
 const reservation=await reserve(packet);
 if(reservation?.duplicate===true)return {status:'duplicate',deliveryEnabled:true};
 if(reservation?.acquired!==true||typeof reservation.id!=='string'||!reservation.id)throw Error('Reserva não confirmada');
 let outcome;
 try{
  const result=await send(packet);
  outcome=result?.accepted===true&&typeof result.deliveryId==='string'&&result.deliveryId.trim()?{status:'accepted',deliveryId:result.deliveryId}:{status:'uncertain'};
 }catch{outcome={status:'uncertain'};}
 // Never retry an uncertain outcome automatically: reconcile with provider first.
 await finish(reservation.id,outcome);
 return {...outcome,deliveryEnabled:true};
}
