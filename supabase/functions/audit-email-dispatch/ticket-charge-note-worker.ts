import {movideskInternalAction,type MovideskProfile,type ApprovedTimeLog} from './ticket-charge-internal.ts';
type RecordRow=Record<string,any>;
type Db=(path:string, init?:RequestInit)=>Promise<any>;
export async function processChargeInternalNote(db:Db,token:string){
 if(!token)return {ok:false,processed:0,error:'Movidesk não configurado para anotações internas'};
 const claimed=await db('rpc/audit_claim_ticket_charge_note',{method:'POST',body:'{}'}) as RecordRow[];
 if(!Array.isArray(claimed)||!claimed.length)return {ok:true,processed:0};
 const row=claimed[0],id=String(row.id||''),ticketId=String(row.ticket_id||''),requestId=String(row.request_id||'');
 const update=async(status:string,message='',processed=false)=>db('audit_ticket_charge_internal_notes?id=eq.'+encodeURIComponent(id),{
  method:'PATCH',body:JSON.stringify({status,last_error:message||null,updated_at:new Date().toISOString(),...(processed?{processed_at:new Date().toISOString()}: {})})
 });
 if(!/^[0-9a-f-]{36}$/i.test(id)||!/^\d{1,12}$/.test(ticketId))return {ok:false,processed:0,error:'Fila de notas inválida'};
 const profiles=await db('audit_movidesk_note_profiles?user_id=eq.'+encodeURIComponent(String(row.created_by_user||''))+'&active=eq.true&select=movidesk_person_id,display_name,team_id,team_name,work_type&limit=1') as RecordRow[];
 if(profiles.length!==1){await update('blocked','Identidade Movidesk não validada');return {ok:false,processed:0,error:'Perfil Movidesk não encontrado'}}
 const raw=profiles[0];
 const profile:MovideskProfile={movidesk_person_id:String(raw.movidesk_person_id),display_name:String(raw.display_name),team_id:Number(raw.team_id),team_name:String(raw.team_name),work_type:String(raw.work_type)};
 const timeLog=row.time_log?row.time_log as ApprovedTimeLog:undefined;
 const history=await db('audit_ticket_charge_history?request_id=eq.'+encodeURIComponent(requestId)+'&select=status,sent_at&limit=1') as RecordRow[];
 if(history.length!==1||history[0].status!=='sent'||!history[0].sent_at){
  await update('blocked','E-mail sem aceite confirmado');return {ok:true,processed:0,blocked:1};
 }
 const marker='CENTRAL-AUDITORIA-COBRANCA:'+requestId+':'+ticketId;
 const url=new URL('https://api.movidesk.com/public/v1/tickets');
 url.searchParams.set('token',token);url.searchParams.set('id',ticketId);
 url.searchParams.set('$select','id');url.searchParams.set('$expand','actions');
 let patchAttempted=false;
 try{
  const res=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!res.ok)throw Error('Consulta Movidesk HTTP '+res.status);
  const parsed=await res.json() as RecordRow|RecordRow[];
  const ticket=Array.isArray(parsed)?parsed.find(x=>String(x.id)===ticketId):parsed;
  if(!ticket||String(ticket.id)!==ticketId)throw Error('Movidesk não confirmou o chamado solicitado');
  const actions=Array.isArray(ticket.actions)?ticket.actions as RecordRow[]:[];
  if(actions.some(x=>String(x.description||x.htmlDescription||'').includes(marker))){
   await update('sent','',true);return {ok:true,processed:1,deduplicated:true};
  }
  patchAttempted=true;
  const patch=await fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(movideskInternalAction(String(row.note_body||''),profile,timeLog)),signal:AbortSignal.timeout(15000)});
  if(!patch.ok)throw Error('Anotação Movidesk HTTP '+patch.status);
  await update('sent','',true);
  return {ok:true,processed:1,ticketId};
 }catch(ex){
  // A PATCH can succeed at Movidesk even if its network response is lost. Never blindly retry it.
  const status=patchAttempted?'uncertain':'pending';
  const error=String((ex as Error).message||ex).replace(/[?&]token=[^&\s]+/g,'[credencial omitida]').slice(0,180);
  await update(status,error).catch(()=>{});
  return {ok:false,processed:0,status,error:'Registro interno não confirmado; consulte o histórico antes de repetir'};
 }
}
