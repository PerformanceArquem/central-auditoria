import {triagePresentation} from '../intelligence-triage-report/presentation.ts';
import {assertEmailDeliveryEnabled} from '../_shared/email-delivery-control.ts';
type Row=Record<string,any>;
const env=(name:string)=>Deno.env.get(name)?.trim()||'';
const TEST={day:'2026-11-26',reference:'2026-11-25',snapshot:'87204f29-a7ef-4336-88d5-2af60fd4b297',recipientId:'8f150a28-df5f-4c53-872f-ca753556d576',email:'performance@arquem.com.br',key:'alert-real-test:20261126:20261125:alan'};
export function testHandler(fetcher:typeof fetch=fetch,getEnv=env,clock=()=>new Date()){
 return async(req:Request)=>{
 const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply({ok:false,error:'Apenas POST.'},405);
 if(!getEnv('REPORT_CRON_SECRET')||req.headers.get('x-report-secret')!==getEnv('REPORT_CRON_SECRET'))return reply({ok:false,error:'Não autorizado.'},403);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock());
 if(today!==TEST.day)return reply({ok:false,error:'A autorização deste teste expirou.'},410);
 const base=getEnv('SUPABASE_URL').replace(/\/$/,''),key=getEnv('SUPABASE_SERVICE_ROLE_KEY');
 const db=async(path:string,options:RequestInit={})=>{
 const r=await fetcher(base+'/rest/v1/'+path,{...options,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(options.headers||{})},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Registro da Central indisponível.');
 const text=await r.text();return text?JSON.parse(text):[];
 };
 let stage='request';
 try{
 const body=await req.json();
 if(!body||!['preview','send'].includes(body.action)||body.email!==undefined||body.cc!==undefined||body.recipientId!==undefined)return reply({ok:false,error:'Solicitação inválida.'},400);
 if(body.action==='send'&&body.confirmed!==true)return reply({ok:false,error:'Confirmação do teste necessária.'},400);
 stage='recipient';
 const recipients=await db('audit_email_recipients?id=eq.'+TEST.recipientId+'&active=eq.true&select=id,name,email&limit=2');
 if(recipients.length!==1||String(recipients[0].email).toLowerCase()!==TEST.email)return reply({ok:false,error:'Destinatário autorizado não confirmado.'},403);
 const previous=await db('audit_email_sector_dispatches?dispatch_key=eq.'+encodeURIComponent(TEST.key)+'&select=status,provider_id,sent_at&limit=1');
 if(body.action==='send'&&previous.length)return reply({ok:true,sent:false,duplicate:true,status:previous[0].status});
 stage='historical-snapshot';
 const snapshots=await db('audit_triage_snapshots?id=eq.'+TEST.snapshot+'&reference_date=eq.'+TEST.reference+'&select=id,reference_date,created_at,sha256,report&limit=2');
 if(snapshots.length!==1||snapshots[0].report?.date!==TEST.reference||!Array.isArray(snapshots[0].report?.items)||!snapshots[0].report.items.length)throw Error('Registro histórico de ontem não confirmado.');
 const saved=snapshots[0],report={...saved.report,manual:undefined,snapshotId:saved.id,sha256:saved.sha256};
 stage='presentation';
 const draft=triagePresentation(report,recipients[0]);
 const subject='[TESTE REAL] Ticket Manager | Triagem da Inteligência | 25/11/2026';
 const notice='TESTE REAL DE ENVIO · Somente Alan Reis\nBase histórica: triagem registrada em 25/11/2026. Esta mensagem reproduz aquele registro e não apresenta a situação atual dos chamados.\n';
 const text=notice+'\n'+draft.text;
 const html=draft.html.replace(/<body[^>]*>/,match=>match+'<div style="padding:14px 22px;background:#eaf2fa;color:#173454;font:14px Arial,sans-serif"><strong>TESTE REAL · Somente Alan Reis</strong><br>Base histórica de 25/11/2026. Reprodução do registro daquela data; não representa a situação atual dos chamados.</div>');
 stage='provider-configuration';
 const provider=new URL(getEnv('GMAIL_WEBAPP_URL'));
 if(provider.protocol!=='https:'||provider.hostname!=='script.google.com'||!provider.pathname.startsWith('/macros/s/')||!provider.pathname.endsWith('/exec')||!getEnv('GMAIL_MAIL_SECRET'))throw Error('Serviço corporativo não configurado.');
 const call=async(action:string,payload:Row)=>{
 const response=await fetcher(provider.toString(),{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({token:getEnv('GMAIL_MAIL_SECRET'),action,...payload}),signal:AbortSignal.timeout(60000)});
 const result=response.ok?await response.json().catch(()=>null):null;
 if(result?.sucesso!==true){const detail=String(result?.erro||'');throw Error(/destinat|recipient|chave|key|cópias|copias/i.test(detail)?'provider-recipient-policy':/cota|quota/i.test(detail)?'provider-quota':'provider-validation-rejected');}
 return result;
 };
 await assertEmailDeliveryEnabled(db);
 const selection=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({snapshot:TEST.snapshot,purpose:TEST.key}))))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const providerKey='intelligence-triage-manual:'+TEST.reference+':'+TEST.email+':'+selection;
 stage='attachment-validation';
 const validation=await call('triage_validate',{report,manual:true,email:TEST.email,cc:[]});
 if(validation.rows!==report.items.length||!validation.pdfBytes||!validation.xlsxBytes||validation.sent!==false||validation.mailReady!==true||validation.manualReady!==true||!Array.isArray(validation.files)||validation.files.length!==2)throw Error('PDF e Excel não validados.');
 if(body.action==='preview')return reply({ok:true,preview:true,sent:false,recipient:TEST.email,referenceDate:TEST.reference,subject,text,html,tickets:report.items.length,attachmentCount:validation.files.length,pdfBytes:validation.pdfBytes,xlsxBytes:validation.xlsxBytes});
 const reserved=await db('audit_email_sector_dispatches?on_conflict=dispatch_key&select=dispatch_key',{
 method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
 body:JSON.stringify({dispatch_key:TEST.key,recipient_id:TEST.recipientId,report_kind:'daily',period_from:TEST.reference,period_to:TEST.reference,status:'processing'})
 });
 if(!Array.isArray(reserved)||reserved.length!==1)return reply({ok:true,sent:false,duplicate:true});
 const update=(data:Row)=>db('audit_email_sector_dispatches?dispatch_key=eq.'+encodeURIComponent(TEST.key),{method:'PATCH',body:JSON.stringify(data)});
 try{
 await assertEmailDeliveryEnabled(db);
 const current=await db('audit_email_recipients?id=eq.'+TEST.recipientId+'&active=eq.true&email=eq.'+encodeURIComponent(TEST.email)+'&select=id&limit=1');
 if(current.length!==1)throw Error('Destinatário alterado.');
 const result=await call('triage_send',{email:TEST.email,assunto:subject,texto:text,html,dispatchKey:providerKey,report,files:validation.files,manual:true,cc:[]});
 if(result.accepted!==true||result.anexos!==2||!result.providerId)throw Error('Aceite com anexos não confirmado.');
 const sentAt=clock().toISOString();
 await update({status:'sent',sent_at:sentAt,provider_id:String(result.providerId).slice(0,180),error_message:null});
 return reply({ok:true,sent:true,providerAccepted:true,recipient:TEST.email,referenceDate:TEST.reference,tickets:report.items.length,attachments:2,providerId:result.providerId,sentAt});
 }catch{
 await update({status:'failed',error_message:'TESTE INDETERMINADO: verificar provedor antes de repetir; chave reservada impede reenvio automático.'}).catch(()=>{});
 return reply({ok:false,sent:false,uncertain:true,error:'Aceite não confirmado integralmente. Nenhum reenvio automático.'},502);
 }
 }catch(error){const code=error instanceof Error&&['provider-recipient-policy','provider-quota','provider-validation-rejected'].includes(error.message)?error.message:undefined;return reply({ok:false,error:'Teste interrompido antes da confirmação. Conferir registros e anexos.',stage,code},503);}
 };
}
Deno.serve(testHandler());
