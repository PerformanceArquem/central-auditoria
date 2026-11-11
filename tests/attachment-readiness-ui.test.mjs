import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const script=html.slice(html.indexOf('async function emailAttachmentCheck(){'),html.indexOf('async function alarmEmailAiAvailability(){'));
test('painel exibe verificação sem envio no módulo de e-mails',()=>{
 assert.match(html,/id="emailAttachmentReadinessCard"/);
 assert.match(html,/id="emailAttachmentCheckStatus"/);
 assert.match(html,/onclick="emailAttachmentCheck\(\)"/);
 assert.match(html,/Nenhum e-mail será enviado/);
});
test('consulta action attachment_health autenticada e nunca efetua disparo',()=>{
 assert.match(script,/window\.tmEmailAdminClient/);
 assert.match(script,/action:'attachment_health'/);
 assert.doesNotMatch(script,/ticket_charge_send|GmailApp\.sendEmail|action:'dispatch'/);
 assert.match(script,/data\.ready===true/);
 assert.match(script,/data\.enabled===true/);
 assert.match(script,/button\.disabled=false/);
});
