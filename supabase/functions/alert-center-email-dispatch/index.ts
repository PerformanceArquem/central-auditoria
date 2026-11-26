import {EMAIL_SECTORS,localClock,idleCoverageStart,inEmailWindow,sectorRecipient,evaluateEmailAlerts,alertBody,formatEmailDates} from '../../../alert-center/email-policy.mjs';
import {readTriageHistories} from '../../../alert-center/triage-live-reader.mjs';
import {composeTicketCharge} from '../audit-email-dispatch/ticket-charge.ts';
import {assertEmailDeliveryEnabled} from '../_shared/email-delivery-control.ts';
type Row=Record<string,any>;
const env=(key:string)=>Deno.env.get(key)?.trim()||'';
const official=new Set(['https://central-auditoria-iota.vercel.app','https://central-auditoria-arquem.vercel.app','https://centralauditoria.ddns.net','https://www.centralauditoria.ddns.net']);
export function createAlertEmailHandler(fetcher:typeof fetch=fetch,getEnv=env,clock=()=>new Date()){
 return async(req:Request)=>{
 const origin=req.headers.get('origin')||'',headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',...(official.has(origin)?{'Access-Control-Allow-Origin':origin}:{})};
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({ok:false,error:'Apenas POST.'},405);
 const base=getEnv('SUPABASE_URL').replace(/\/$/,''),key=getEnv('SUPABASE_SERVICE_ROLE_KEY');
 const db=async(path:string,options:RequestInit={})=>{
 const response=await fetcher(base+'/rest/v1/'+path,{...options,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(options.headers||{})},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Consulta ou registro da Central indisponível.');
 const text=await response.text();return text?JSON.parse(text):[];
 };
 try{
 let body;try{body=await req.json();}catch{return reply({ok:false,error:'Solicitação inválida.'},400);}
 if(!body||!['preview','dispatch'].includes(body.action))return reply({ok:false,error:'Ação inválida.'},400);
 if(body.action==='dispatch'){
 if(!getEnv('REPORT_CRON_SECRET')||req.headers.get('x-report-secret')!==getEnv('REPORT_CRON_SECRET'))return reply({ok:false,error:'Processamento não autorizado.'},403);
 if(!Number.isInteger(body.sectorIndex)||body.sectorIndex<0||body.sectorIndex>=EMAIL_SECTORS.length)return reply({ok:false,error:'Setor inválido.'},400);
 }else if(!getEnv('REPORT_CRON_SECRET')||req.headers.get('x-report-secret')!==getEnv('REPORT_CRON_SECRET')){
 const authorization=req.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(authorization))return reply({ok:false,error:'Sessão necessária.'},401);
 const response=await fetcher(base+'/auth/v1/user',{headers:{apikey:getEnv('SUPABASE_ANON_KEY'),Authorization:authorization},signal:AbortSignal.timeout(10000)});
 const user=response.ok?await response.json():null;
 if(typeof user?.id!=='string')return reply({ok:false,error:'Sessão inválida.'},401);
 const admins=await db('audit_users?user_id=eq.'+encodeURIComponent(user.id)+'&role=eq.admin&is_active=eq.true&select=user_id&limit=2');
 if(!Array.isArray(admins)||admins.length!==1)return reply({ok:false,error:'Acesso administrativo necessário.'},403);
 }
 const now=clock().toISOString(),local=localClock(now);
 const [settings,recipients,holidayRows,coverageRows]=await Promise.all([
 db('audit_alert_email_settings?select=*&limit=7'),
 db('audit_email_recipients?active=eq.true&select=id,name,email,sector,sectors,active,daily_enabled,linked_user_id&limit=501'),
 db('audit_email_holidays?affects_delivery=eq.true&select=holiday_date&limit=1001'),
 db('audit_recent_reconcile_state?job_name=eq.movidesk_recent_reconcile&select=period_start,period_end,completed,last_success_at,last_error&limit=2')
 ]);
 if(settings.length!==6||recipients.length>=501||holidayRows.length>=1001)throw Error('Configuração incompleta. Nenhum envio autorizado.');
 const holidays=holidayRows.map((r:Row)=>String(r.holiday_date));
 if(body.action==='dispatch'&&!inEmailWindow(now,holidays))return reply({ok:true,sent:false,skipped:'Fora da janela de dias úteis, das 08h30 às 08h39.'});
 const recent=coverageRows.length===1?coverageRows[0]:null,coverageAge=recent?Date.parse(now)-Date.parse(recent.last_success_at):NaN;
 // Require reconciliation over the actual three-business-day window, including holidays.
 const coverageStart=idleCoverageStart(now,holidays);
 const appointmentCoverage=!!recent&&recent.completed===true&&!recent.last_error&&coverageAge>=0&&coverageAge<=12*3600000&&String(recent.period_start)<=coverageStart&&String(recent.period_end)>local.date;
 const records=await db('rpc/audit_alert_email_snapshot',{method:'POST',body:'{}'});
 if(!Array.isArray(records)||records.length>2000)throw Error('Seleção incompleta.');
 const selectedSector=body.action==='dispatch'?EMAIL_SECTORS[body.sectorIndex].sector:null;
 const staleIds=records.filter((row:Row)=>(!selectedSector||row.payload?.ownerTeam===selectedSector)&&(!Number.isFinite(Date.parse(row.source_synced_at))||Date.parse(now)-Date.parse(row.source_synced_at)>86400000)).map((row:Row)=>String(row.ticket_id));
 let directReads=0,directUnavailable=false;
 // Read-only refresh: unchanged tickets may have old import timestamps even while still open.
 if(staleIds.length&&staleIds.length<=50&&getEnv('MOVIDESK_TOKEN')){
 try{
 const live=await readTriageHistories(staleIds,getEnv('MOVIDESK_TOKEN'),fetcher);
 const byId=new Map(live.tickets.map((ticket:Row)=>[String(ticket.id),ticket]));
 for(const row of records){
 const current=byId.get(String(row.ticket_id)) as Row|undefined;if(!current)continue;
 row.payload=current;row.source_synced_at=clock().toISOString();
 row.closed_at_source=current.closedIn||(current.isDeleted===true?clock().toISOString():null);directReads++;
 }
 }catch{directUnavailable=true;}
 }else if(staleIds.length)directUnavailable=true;
 const reference=clock().toISOString();
 const evaluation=evaluateEmailAlerts(records,{now:reference,holidays,appointmentCoverage});
 const targets=body.action==='preview'?EMAIL_SECTORS:[EMAIL_SECTORS[body.sectorIndex]];
 const bundles=[];
 for(const target of targets){
 const setting=settings.find((s:Row)=>s.sector===target.sector);
 if(!setting||setting.recipient_id!==target.recipientId)throw Error('Vínculo do destinatário divergente.');
 const recipient=sectorRecipient(target.sector,recipients);
 if(recipient.linked_user_id){
 const users=await db('audit_users?user_id=eq.'+encodeURIComponent(recipient.linked_user_id)+'&is_active=eq.true&select=user_id&limit=2');
 const identity=await fetcher(base+'/auth/v1/admin/users/'+encodeURIComponent(recipient.linked_user_id),{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});
 const user=identity.ok?await identity.json():null;
 if(users.length!==1||String(user?.email||'').trim().toLowerCase()!==recipient.email)throw Error('Conta vinculada ao destinatário não confirmada.');
 }
 const rows=evaluation.alerts.filter((r:Row)=>r.payload.ownerTeam===target.sector);
 if(rows.length>100)throw Error('Mais de 100 alertas no setor. Revisão necessária antes do envio.');
 const parts=[];
 for(let offset=0;offset<rows.length;offset+=20){
 const chunk=rows.slice(offset,offset+20);
 const subject='ARQUEM | Ticket Manager | '+target.sector+' | Alertas | '+local.date.split('-').reverse().join('/')+(rows.length>20?' | Parte '+(parts.length+1):'');
 const draft=composeTicketCharge(chunk,recipient.email,alertBody(chunk,target.sector,clock().toISOString()),{subject,customBody:true});
 parts.push({subject:draft.subject,text:formatEmailDates(draft.text),html:formatEmailDates(draft.html)});
 }
 bundles.push({sector:target.sector,recipientId:recipient.id,recipient:recipient.email,name:recipient.name,enabled:setting.enabled===true,ticketCount:rows.length,ticketIds:rows.map((r:Row)=>r.ticket_id),reviewCount:evaluation.review.filter((r:Row)=>r.sector===target.sector).length,parts});
 }
 if(body.action==='preview'){
 const history=await db('audit_alert_email_history?local_date=eq.'+local.date+'&select=sector,status,parts,accepted_parts,sent_at,error_summary&limit=7');
 return reply({ok:true,preview:true,sent:false,reference:clock().toISOString(),directReads,directUnavailable,schedule:'Dias úteis, das 08h30 às 08h35 (Brasília)',appointmentCoverage,bundles,history});
 }
 const bundle=bundles[0];
 if(!bundle.enabled)return reply({ok:true,sent:false,skipped:'Setor desabilitado.'});
 if(!inEmailWindow(clock().toISOString(),holidays))return reply({ok:true,sent:false,skipped:'Janela encerrada.'});
 await assertEmailDeliveryEnabled(db);
 // Validate provider before reserving a daily key. Never put credentials in client responses.
 const provider=new URL(getEnv('GMAIL_WEBAPP_URL'));
 if(provider.protocol!=='https:'||provider.hostname!=='script.google.com'||!provider.pathname.startsWith('/macros/s/')||!provider.pathname.endsWith('/exec')||!getEnv('GMAIL_MAIL_SECRET'))throw Error('Serviço de envio não configurado.');
 const dispatchKey='alert-email:'+local.date+':'+bundle.sector;
 const reservation=await db('audit_alert_email_history?on_conflict=dispatch_key&select=dispatch_key',{
 method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
 body:JSON.stringify({dispatch_key:dispatchKey,sector:bundle.sector,recipient_id:bundle.recipientId,recipient:bundle.recipient,local_date:local.date,status:bundle.parts.length?'sending':'empty',ticket_ids:bundle.ticketIds,parts:bundle.parts.length})
 });
 if(!Array.isArray(reservation)||reservation.length!==1)return reply({ok:true,sent:false,duplicate:true});
 if(!bundle.parts.length)return reply({ok:true,sent:false,empty:true,sector:bundle.sector});
 let accepted=0;
 const update=(record:Row)=>db('audit_alert_email_history?dispatch_key=eq.'+encodeURIComponent(dispatchKey),{method:'PATCH',body:JSON.stringify(record)});
 try{
 for(const part of bundle.parts){
 if(!inEmailWindow(clock().toISOString(),holidays))throw Error('Janela encerrada.');
 const active=await db('audit_alert_email_settings?sector=eq.'+encodeURIComponent(bundle.sector)+'&enabled=eq.true&recipient_id=eq.'+bundle.recipientId+'&select=sector&limit=1');
 const recipient=await db('audit_email_recipients?id=eq.'+bundle.recipientId+'&active=eq.true&daily_enabled=eq.true&select=email&limit=1');
 if(active.length!==1||recipient.length!==1||String(recipient[0].email).toLowerCase()!==bundle.recipient)throw Error('Destinatário ou setor alterado.');
 await assertEmailDeliveryEnabled(db);
 const response=await fetcher(provider.toString(),{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({token:getEnv('GMAIL_MAIL_SECRET'),email:bundle.recipient,assunto:part.subject,texto:part.text,html:part.html}),signal:AbortSignal.timeout(60000)});
 const result=response.ok?await response.json().catch(()=>null):null;
 if(result?.sucesso!==true)throw Error('Aceite do provedor não confirmado.');
 accepted++;await update({accepted_parts:accepted});
 }
 await update({status:'sent',sent_at:clock().toISOString()});
 return reply({ok:true,sent:true,sector:bundle.sector,acceptedParts:accepted,ticketCount:bundle.ticketCount});
 }catch{
 await update({status:'uncertain',accepted_parts:accepted,error_summary:'Envio não confirmado integralmente; conferir o provedor antes de qualquer reenvio.'}).catch(()=>{});
 return reply({ok:false,sent:false,uncertain:true,sector:bundle.sector,acceptedParts:accepted,error:'Aceite não confirmado integralmente. Nenhum reenvio automático.'},502);
 }
 }catch{return reply({ok:false,error:'Processamento interrompido. Confira os cadastros, a sincronização e o histórico antes de repetir.'},503);}
 };
}
Deno.serve(createAlertEmailHandler());
