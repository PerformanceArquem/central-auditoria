import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=src('index.html'),api=src('supabase/functions/audit-email-dispatch/index.ts');
const script=src('apps-script/central-auditoria-emails-completo.gs');
const mail=src('supabase/functions/audit-email-dispatch/ticket-charge.ts');
test('Alerts composer provides checkbox CC selection and shows owner and team before sending',()=>{
 for(const id of ['alarmEmailCcChoices','alarmEmailCcDetails','alarmEmailSelectedDetails','alarmEmailPreviewRecipients'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/alarmCcRecipients\(\)/);
 assert.match(html,/cc:alarmCcRecipients\(\)/);
 assert.match(html,/body:\{action,ticketIds:ids,recipient,cc,(?:timeLog,registerInternalNote:[^,]+,)?message:/);
 assert.match(html,/data\.ccSupported!==true/);
 assert.match(html,/alarmRenderSelectedDetails\(\)/);
});
test('Backend validates active corporate CC, persists history, blocks unsupported providers',()=>{
 assert.match(api,/ccRaw\.length>10/);
 assert.match(api,/audit_email_recipients\?select=email&active=eq.true/);
 assert.match(api,/cc_recipients:cc/);
 assert.match(api,/ccProviderSupported\(\)/);
 assert.match(api,/ccSupported:!cc.length\|\|await ccProviderSupported\(\)/);
 assert.match(api,/\.\.\.\(cc\.length\?\{cc\}:\{\}\)/);
 assert.match(api,/source:'ticket_charge'\},cc\)/);
});
test('Apps Script advertises CC capability, validates corporate contacts and retains standardized sender',()=>{
 assert.match(script,/ccSupported:true/);
 assert.match(script,/new Set\(cc\)\.size!==cc\.length/);
 assert.match(script,/MailApp\.sendEmail\(\{/);
 assert.match(script,/cc:cc\.join\(', '\)/);
 assert.match(script,/name:'Central de Auditoria'/);
 assert.match(script,/arquemCreateReportAttachments_/);
 assert.match(mail,/header\('Cliente'\)\+header\('Setor'\)/);
 assert.match(mail,/header\('Responsável \/ status'\)/);
});
test('read-only inspection of TypeScript dispatcher preserves syntax',()=>{
 const cleaned=stripTypeScriptTypes(api);
 assert.doesNotThrow(()=>new Function(cleaned.replace(/\bimport\s+[^;]+;/g,'')));
});

test('sector manager button uses active registered manager metadata without guessing addresses',()=>{
 assert.match(html,/id="alarmEmailManagerCc"/);
 assert.match(html,/function alarmSuggestManagerCc\(/);
 assert.match(html,/select\('name,email,scope,sector,sectors,active'\)/);
 assert.match(html,/managementByEmail/);
 assert.match(html,/managementByEmail\.set\(email,known\)/);
 assert.match(html,/filter\(x=>x\.email!==alarmRecipientEmail\(\)\)/);
 assert.ok(html.includes("$('alarmEmailCcDetails').open=true"));
 assert.match(html,/Melhorar cobrança com IA/);
});
test('standard subject is neutral and requests respectful follow-up',()=>{
 assert.match(mail,/Acompanhamento cordial de chamados/);
 assert.match(mail,/Acompanhamento de chamados/);
 assert.match(mail,/Agradecemos desde já pela atenção e parceria/);
 assert.match(mail,/responsável/i);
});
