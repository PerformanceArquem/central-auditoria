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
 assert.match(source,/✉ E-mail enviado/);
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
