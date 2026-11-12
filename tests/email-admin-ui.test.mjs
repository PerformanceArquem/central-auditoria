import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const extract=id=>{
 const escaped=id.replace(/[.*+?^\$\{\}()|[\]\\]/g,'\\$&');
 const regex=new RegExp('<script\\b[^>]*id="'+escaped+'"[^>]*>([\\s\\S]*?)<\\/script>','i');
 const match=html.match(regex);
 assert.ok(match,'Script '+id+' não encontrado');
 return match[1];
};
test('painel de destinatários compila e registra o evento de clique',()=>{
 const source=extract('emailAdminIntegratedScript');
 assert.doesNotThrow(()=>new Function(source));
 assert.match(source,/emailAdminOpen'\)\.addEventListener\('click'/);
 assert.match(html,/id="emailAdminOpen"/);
 assert.match(html,/id="emailAdminPanel"/);
});
test('a prévia administrativa mantém seção de auditoria fora da alternativa condicional',()=>{
 const source=extract('emailAdminIntegratedScript');
 assert.match(source,/\)\+forecastSection;/);
});
test('os scripts essenciais de interface compilam',()=>{
 for(const id of ['reportPreviewScript','executiveReportScript','productionAuditScript']){
  assert.doesNotThrow(()=>new Function(extract(id)),id);
 }
});

test('cobrança permite selecionar os e-mails corporativos cadastrados',()=>{
 const source=extract('tm-application-source');
 assert.doesNotThrow(()=>new Function(source));
 assert.match(html,/id="alarmEmailRecipient"[^>]*onchange="alarmRecipientChanged\(\)"/);
 assert.match(html,/id="alarmEmailRecipientOther"/);
 assert.match(source,/audit_email_recipients/);
 assert.match(source,/eq\('active',true\)/);
 assert.match(source,/audit_is_email_admin/);
 assert.match(source,/alarmLoadRegisteredRecipients\(\)/);
 assert.match(source,/const recipient=alarmRecipientEmail\(\)/);
 assert.match(source,/alarmEmailInvalidate\(\)/);
});

test('ranking mostra situação de e-mail e relatório com exportação',()=>{
 const source=extract('tm-application-source');
 assert.doesNotThrow(()=>new Function(source));
 for(const name of ['alarmEmailTicketBadge','alarmEmailHistoryLoad','alarmEmailHistoryExport','alarmEmailHistoryRender']){
  assert.ok(source.includes('function '+name+'(')||source.includes('async function '+name+'('),name+' ausente');
 }
 assert.match(html,/id="alarmEmailHistoryRows"/);
 assert.match(html,/id="alarmEmailHistoryFilter"/);
 assert.match(source,/ticket_charge_history/);
 assert.match(source,/alarmEmailRequestId=crypto\.randomUUID\(\)/);
 assert.match(source,/requestId:alarmEmailRequestId/);
 assert.match(source,/✉ Já cobrado/);
 assert.match(source,/✉ Verificar envio/);
});

test('cobrança informa chamados não sincronizados e bloqueia envio antes da prévia',()=>{
 const source=extract('tm-application-source');
 assert.doesNotThrow(()=>new Function(source));
 assert.match(html,/id="alarmEmailRemoveMissing"/);
 assert.match(html,/id="alarmEmailSend"[^>]*disabled/);
 assert.match(source,/alarmEmailMissingIds/);
 assert.match(source,/e\.missingIds/);
 assert.match(source,/function alarmRemoveMissingTickets\(\)/);
 assert.match(source,/alarmEmailApproved=alarmSelectionSignature\(\)/);
});

test('prévia da cobrança usa o mesmo HTML enviado, com isolamento e texto opcional',()=>{
 const app=extract('tm-application-source');
 assert.doesNotThrow(()=>new Function(app));
 assert.match(html,/id="alarmEmailPreviewFrame"[^>]*sandbox="allow-popups allow-popups-to-escape-sandbox"/);
 assert.match(html,/Ver versão em texto do e-mail/);
 assert.match(app,/alarmEmailPreviewFrame'\)\.srcdoc=data\.html/);
 assert.match(app,/if\(typeof data\.html!=='string'/);
 assert.match(app,/frame\.removeAttribute\('srcdoc'\)/);
});

test('a Direção pode habilitar o relatório diário no cadastro',()=>{
 const source=extract('emailAdminIntegratedScript');
 assert.match(source,/\$\('emailDaily'\)\.disabled=false/);
 assert.doesNotMatch(source,/if\(directionForm\(\)\)data\.daily_enabled=false/);
});

test('módulo de liberação usa autorização de administrador e preserva demais cadastros',()=>{
 const source=extract('emailAdminIntegratedScript');
 assert.doesNotThrow(()=>new Function(source));
 for(const id of ['emailReportReleaseOpen','emailReportReleasePanel','emailReleaseRows','emailReleaseStatus','emailReleaseRefresh']) assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(source,/async function verify\(\)/);
 assert.match(source,/function renderReportRelease\(\)/);
 assert.match(source,/data-release-save/);
 assert.match(source,/await verify\(\)/);
 assert.match(source,/allowed_report_types:codes/);
 assert.match(source,/original===null\?\['ticket_followup'\]:original/);
 assert.match(source,/\.eq\('active',true\)/);
 assert.match(source,/Nenhum e-mail enviado/);
});


test('revisão de cobranças separa destinatários e prioriza envio incerto',()=>{
 const source=extract('tm-application-source');
 const status=source.slice(source.indexOf('function alarmReminderStatusForTicket('),source.indexOf('async function alarmReminderPolicyLoad'));
 const badge=source.slice(source.indexOf('function alarmEmailTicketBadge('),source.indexOf('const alarmSelected='));
 const history=[{recipient:'a@arquem.com.br',status:'sent',ticket_ids:['1'],sent_at:new Date(Date.now()-2*86400000).toISOString()},{recipient:'b@arquem.com.br',status:'sent',ticket_ids:['1'],sent_at:new Date(Date.now()-6*86400000).toISOString()}];
 const run=new Function('alarmEmailHistory','alarmReminderPolicy','alarmEmailTime','esc',status+badge+';return {status:alarmReminderStatusForTicket,badge:alarmEmailTicketBadge};')(history,{interval_days:5,max_reminders:3},String,String);
 assert.equal(run.status('1','a@arquem.com.br').count,1);
 assert.equal(run.status('1','a@arquem.com.br').eligible,false);
 assert.ok(run.status('1','a@arquem.com.br').nextReviewAt);
 assert.equal(run.status('1','b@arquem.com.br').eligible,true);
 assert.match(run.badge('1'),/Revisão de reforço disponível/);
 history.push({recipient:'a@arquem.com.br',status:'uncertain',ticket_ids:['1']});
 assert.match(run.badge('1'),/Verificar envio anterior/);
 assert.doesNotMatch(run.badge('1'),/pill ok/);
 assert.equal(run.badge('2'),'');
});
