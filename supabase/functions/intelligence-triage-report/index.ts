import config from '../../../config/intelligence-triage.json' with {type:'json'};
import {classify,summarize} from './model.mjs';
const env=(k:string)=>Deno.env.get(k)?.trim()||'';
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
async function db(path:string,method='GET',body?:unknown,prefer='return=representation'){
 const r=await fetch(env('SUPABASE_URL')+'/rest/v1/'+path,{method,headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),Authorization:'Bearer '+env('SUPABASE_SERVICE_ROLE_KEY'),'Content-Type':'application/json',Prefer:prefer},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Database HTTP '+r.status);return await r.json();
}
async function md(params:Record<string,string>){
 if(!env('MOVIDESK_TOKEN'))throw Error('MOVIDESK_TOKEN ausente');
 const u=new URL('https://api.movidesk.com/public/v1/tickets');u.searchParams.set('token',env('MOVIDESK_TOKEN'));Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
 const r=await fetch(u,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Movidesk HTTP '+r.status);return await r.json();
}
async function provider(action:string,payload:Record<string,unknown>={}){
 const endpoint=new URL(env('GMAIL_WEBAPP_URL'));if(endpoint.hostname!=='script.google.com'||endpoint.protocol!=='https:'||!endpoint.pathname.endsWith('/exec'))throw Error('Web App corporativo inválido');
 const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({token:env('GMAIL_MAIL_SECRET'),action,...payload}),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('Gmail Web App HTTP '+r.status);const result=await r.json();if(result.sucesso!==true)throw Error('Gmail Web App: '+String(result.erro||'recusado'));return result;
}
async function snapshot(){
 const reference=new Date(),all:Record<string,unknown>[]=[],ids=new Set();
 for(let offset=0;offset<=10000;offset+=100){
  const page=await md({'$filter':"ownerTeam eq 'Inteligência' and serviceFirstLevel eq 'Triagem'",'$select':'id','$orderby':'id asc','$top':'100','$skip':String(offset)});
  if(!Array.isArray(page))throw Error('Listagem Movidesk inválida');
  for(const row of page){if(ids.has(String(row.id)))throw Error('Paginação Movidesk inconsistente');ids.add(String(row.id));}
  if(page.length<100)break;if(offset===10000)throw Error('Lista excede limite seguro');
 }
 // Consultar o detalhe atual e os históricos reais de todos os candidatos.
 const queue=[...ids];for(let off=0;off<queue.length;off+=3){
  const details=await Promise.all(queue.slice(off,off+3).map(async id=>{const t=await md({id:String(id)});if(String(t.id)!==id)throw Error('Detalhe Movidesk inconsistente');return t;}));all.push(...details);
 }
 const items=all.map(t=>classify(t,reference.getTime())).filter(Boolean).sort((a,b)=>b.elapsedDays-a.elapsedDays||Number(a.id)-Number(b.id));
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(reference);
 const report={schema:'arquem-triage-v1',title:config.report,reference:reference.toISOString(),syncedAt:new Date().toISOString(),date:day,criteria:config.criteria,source:'Movidesk API — estado e históricos consultados nesta execução',candidates:all.length,metrics:summarize(items),items};
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(report))))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const [saved]=await db('audit_triage_snapshots','POST',{reference_date:day,report,sha256:hash});return {...report,snapshotId:saved.id,sha256:hash};
}
const esc=(x:unknown)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
async function send(report:any,prepared?:any){
 const validation=prepared||await provider('triage_validate',{report});
 if(validation.rows!==report.items.length||!validation.pdfBytes||!validation.xlsxBytes||validation.sent!==false)throw Error('Validação dos anexos não confirmada');
 const results=[];
 for(const recipient of config.recipients){
  const key='intelligence-triage:'+report.date+':'+recipient.email;
  const claimed=await db('audit_triage_dispatches?on_conflict=dispatch_key','POST',{dispatch_key:key,reference_date:report.date,email:recipient.email,snapshot_id:report.snapshotId,status:'processing',attachment_validation:validation},'resolution=ignore-duplicates,return=representation');
  if(!claimed.length){const [prior]=await db('audit_triage_dispatches?dispatch_key=eq.'+encodeURIComponent(key));results.push({email:recipient.email,status:prior?.status==='sent'?'already_sent':prior?.status||'unconfirmed'});continue;}
  try{
   const text=`${config.report}\nReferência: ${report.reference}\nSincronização: ${report.syncedAt}\nCritério: ${report.criteria}\nTotal: ${report.metrics.total}; sem previsão: ${report.metrics.withoutForecast}; maior espera: ${report.metrics.maxQueueDays} dias; média: ${report.metrics.averageQueueDays} dias.\n`+report.items.map((x:any)=>`#${x.id} | ${x.type} | ${x.client} | ${x.queueDays} dias | ${x.status} | ${x.url}`).join('\n');
   const html='<h2>'+esc(config.report)+'</h2><p>Referência: '+esc(report.reference)+'<br>Sincronização: '+esc(report.syncedAt)+'</p><p>'+esc(report.criteria)+'</p><p>Total: '+report.metrics.total+' · Sem previsão: '+report.metrics.withoutForecast+' · Maior espera: '+report.metrics.maxQueueDays+' dias · Média: '+report.metrics.averageQueueDays+' dias</p><table><tr><th>Chamado</th><th>Tipo</th><th>Cliente</th><th>Assunto</th><th>Dias</th><th>Responsável</th><th>Status</th></tr>'+report.items.map((x:any)=>'<tr><td><a href="'+x.url+'">#'+x.id+'</a></td>'+[x.type,x.client,x.subject,x.queueDays,x.owner,x.status].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</table>';
   const result=await provider('triage_send',{email:recipient.email,assunto:config.report+' | '+report.date,texto:text,html,dispatchKey:key,report,files:validation.files});
   if(result.anexos!==2||!result.gmailId)throw Error('Confirmação Gmail/anexos incompleta');
   await db('audit_triage_dispatches?dispatch_key=eq.'+encodeURIComponent(key),'PATCH',{status:'sent',sent_at:new Date().toISOString(),gmail_id:result.gmailId,provider_result:result});results.push({email:recipient.email,status:'sent',gmailId:result.gmailId});
  }catch(e){await db('audit_triage_dispatches?dispatch_key=eq.'+encodeURIComponent(key),'PATCH',{status:'uncertain',error:String(e)});results.push({email:recipient.email,status:'uncertain'});}
 }return results;
}
Deno.serve(async req=>{
 if(req.method!=='POST')return json({ok:false},405);
 if(!env('REPORT_CRON_SECRET')||req.headers.get('x-report-secret')!==env('REPORT_CRON_SECRET'))return json({ok:false,error:'Não autorizado'},401);
 try{
  const body=await req.json();if(!['preview','validate','send','scheduled'].includes(body.action))return json({ok:false,error:'Ação inválida'},400);
  if(body.action==='validate'){
   const [saved]=await db('audit_triage_snapshots?order=created_at.desc&limit=1');if(!saved)throw Error('Snapshot ausente');
   const report={...saved.report,snapshotId:saved.id,sha256:saved.sha256};
   const validation=await provider('triage_validate',{report});
   if(validation.rows!==report.items.length||!validation.files||validation.sent!==false)throw Error('Anexos inválidos');
   await db('audit_triage_snapshots?id=eq.'+saved.id,'PATCH',{attachment_preview:validation});
   return json({ok:true,snapshotId:saved.id,rows:validation.rows,pdfBytes:validation.pdfBytes,xlsxBytes:validation.xlsxBytes,sent:false});
  }
  if(body.action==='scheduled'){
   const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:config.timezone,weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
   if(['Sat','Sun'].includes(parts.weekday)||parts.hour!=='09')return json({ok:true,skipped:'Fora do horário aprovado'});
  }
  let report,prepared;
  if(body.action==='send'&&body.snapshotId){
   if(!/^[0-9a-f-]{36}$/.test(body.snapshotId))throw Error('Snapshot inválido');
   const [saved]=await db('audit_triage_snapshots?id=eq.'+body.snapshotId);if(!saved||Date.now()-Date.parse(saved.created_at)>1800000)throw Error('Snapshot ausente ou expirado');
   report={...saved.report,snapshotId:saved.id,sha256:saved.sha256};prepared=saved.attachment_preview;if(!prepared)throw Error('Anexos não validados');
  }else report=await snapshot();
  if(body.action==='preview')return json({ok:true,report});
  const results=await send(report,prepared);return json({ok:results.every(x=>x.status==='sent'||x.status==='already_sent'),date:report.date,total:report.items.length,results});
 }catch(e){console.error('triage-report:',e instanceof Error?e.message:'Falha');return json({ok:false,error:e instanceof Error?e.message:'Falha'},500);}
});

