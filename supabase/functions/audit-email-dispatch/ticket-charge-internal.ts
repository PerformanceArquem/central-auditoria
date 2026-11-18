// Internal notes are audit communications, NOT workTime appointments or customer-visible notes.
const clean=(v:unknown,max=180)=>String(v??'').replace(/[\x00-\x1f\x7f]+/g,' ').trim().slice(0,max);
const htmlEsc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export type NoteDetail={id:string;client:string;sector:string;owner:string;subject:string};
export function internalChargeNote(requestId:string,detail:NoteDetail,recipient:string,cc:string[]){
 if(!/^[0-9a-f-]{36}$/i.test(requestId)||!/^\d{1,12}$/.test(detail.id))throw Error('Referência de auditoria inválida.');
 const reference='CENTRAL-AUDITORIA-COBRANCA:'+requestId+':'+detail.id;
 const lines=[
  '[REGISTRO INTERNO DE COBRANÇA — CENTRAL DE AUDITORIA]',
  'Referência: '+reference,
  'Motivo: verificação de chamado sem movimentação/tratamento.',
  'Chamado: #'+detail.id,
  'Cliente: '+clean(detail.client),
  'Setor no momento da cobrança: '+clean(detail.sector),
  'Responsável no momento da cobrança: '+clean(detail.owner),
  'Assunto: '+clean(detail.subject,220),
  'E-mail de cobrança enviado para: '+clean(recipient,128),
  'Em cópia (CC): '+(cc.length?cc.map(x=>clean(x,128)).join(', '):'Nenhum'),
  'Solicitado: atualização do andamento no Movidesk, próxima ação, responsável e previsão de retorno.',
  'Registro exclusivo de auditoria: não constitui tratamento técnico, resolução do chamado nem apontamento de horas.'
 ];
 return {reference,text:lines.join('\n')};
}
export function movideskInternalAction(noteText:string){
 const description=htmlEsc(noteText).replace(/\n/g,'<br>');
 return {actions:[{id:0,type:1,description}]}; // NEVER include timeAppointments, status, owner, tags or clients.
}
