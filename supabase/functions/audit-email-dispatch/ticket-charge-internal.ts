// Internal notes are audit communications, NOT workTime appointments or customer-visible notes.
const clean=(v:unknown,max=180)=>String(v??'').replace(/[\x00-\x1f\x7f]+/g,' ').trim().slice(0,max);
const htmlEsc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function internalChargeNote(requestId:string,detail:{id:string;client:string;subject:string}){
 if(!/^[0-9a-f-]{36}$/i.test(requestId)||!/^\d{1,12}$/.test(detail.id))throw Error('Referência de auditoria inválida.');
 // The Movidesk worker locates this marker before writing to avoid duplicate actions.
 const reference='CENTRAL-AUDITORIA-COBRANCA:'+requestId+':'+detail.id;
 const lines=[
  'Auditoria de chamado · Central de Auditoria',
  '',
  'Na revisão do chamado #'+detail.id+' — '+clean(detail.subject,220)+', do cliente '+clean(detail.client)+', enviamos um e-mail de acompanhamento para entender como está o atendimento e como podemos ajudar a dar andamento.',
  '',
  'Quando possível, pedimos que atualize o chamado com o próximo passo. Se houver alguma dúvida, impedimento ou necessidade de apoio, pode sinalizar por aqui. Estamos à disposição para ajudar.',
  '',
  reference
 ];
 return {reference,text:lines.join('\n')};
}
export type MovideskProfile={movidesk_person_id:string,display_name:string,team_id:number,team_name:string,work_type:string};
export type ApprovedTimeLog={date:string,start:string,end:string,activity:string,minutes:number};
export function validateTimeLog(input:any):ApprovedTimeLog{
 const date=String(input?.date||''),start=String(input?.start||''),end=String(input?.end||'');
 const activity=String(input?.activity||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^[0-2]\d:[0-5]\d$/.test(start)||!/^[0-2]\d:[0-5]\d$/.test(end))
  throw Error('Informe data e horários válidos para o apontamento.');
 const startMin=Number(start.slice(0,2))*60+Number(start.slice(3));
 const endMin=Number(end.slice(0,2))*60+Number(end.slice(3));
 const minutes=endMin-startMin;
 if(Number(start.slice(0,2))>23||Number(end.slice(0,2))>23||minutes<1||minutes>720)
  throw Error('Apontamento real deve ter início anterior ao fim e duração de até 12 horas.');
 const value=Date.parse(date+'T12:00:00-03:00');
 if(!Number.isFinite(value)||new Date(value).toISOString().slice(0,10)!==date)throw Error('Data inválida.');
 // End time may not be in the future.
 if(Date.parse(date+'T'+end+':00-03:00')>Date.now()+60000)throw Error('Não é permitido apontar horas futuras.');
 if(activity!=='Avaliação de chamados')throw Error('Atividade não homologada para este apontamento.');
 return {date,start,end,activity,minutes};
}
export function movideskInternalAction(noteText:string,profile:MovideskProfile,timeLog?:ApprovedTimeLog){
 const description=htmlEsc(noteText);
 const agent={id:String(profile.movidesk_person_id)};
 const action:any={id:0,type:1,description,createdBy:agent};
 if(timeLog){
  const hours=Math.floor(timeLog.minutes/60),mins=timeLog.minutes%60;
  action.timeAppointments=[{
   activity:timeLog.activity,date:timeLog.date+'T00:00:00',
   periodStart:timeLog.start+':00',periodEnd:timeLog.end+':00',
   workTime:String(hours).padStart(2,'0')+':'+String(mins).padStart(2,'0')+':00',
   workTypeName:profile.work_type||'Normal',
   createdBy:agent,createdByTeam:{id:Number(profile.team_id),name:profile.team_name}
  }];
 }
 return {actions:[action]};
}
