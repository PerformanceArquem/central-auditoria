import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const server=readFileSync(new URL('../supabase/functions/audit-email-dispatch/index.ts',import.meta.url),'utf8');
const preview=html.slice(html.indexOf('async function alarmEmailPreview(){'),html.indexOf('async function alarmEmailValidate(){'));
const validate=server.slice(server.indexOf(" if(action==='ticket_charge_validate'){"),server.indexOf(" if(action==='ticket_charge_send'){"));

test('validation button must not claim it was already validated',()=>{
 assert.match(html,/id="alarmEmailValidate"[^>]*disabled>Validar e registrar início<\/button>/);
 assert.match(html,/function alarmEmailInvalidate\(\)[\s\S]*?textContent='Validar e registrar início'/);
 assert.doesNotMatch(preview,/textContent='✓ Validado — registrar início'/);
});
test('preview renders while CC unavailable, without enabling validation or sending',()=>{
 assert.match(preview,/const ccBlocked=!!data\.cc\?\.length&&data\.ccSupported!==true/);
 assert.doesNotMatch(preview,/if\(data\.cc\?\.length&&data\.ccSupported!==true\)throw/);
 assert.match(preview,/alarmEmailApproved=ccBlocked\?'':alarmSelectionSignature\(\)/);
 assert.match(preview,/alarmEmailRequestId=ccBlocked\?'':crypto\.randomUUID\(\)/);
 assert.match(preview,/\$\('alarmEmailValidate'\)\.disabled=ccBlocked/);
 assert.match(preview,/\$\('alarmEmailPreviewArea'\)\.classList\.remove\('hide'\)/);
 assert.match(preview,/const ccReason=data\.ccDiagnostic\?\.reason/);
 assert.match(preview,/ccReasonMessage\[ccReason\]/);
 assert.match(preview,/desmarcar todas as cópias e gerar outra prévia/);
 assert.match(server,/ccDiagnostic:ccDiagnostic\?/);
});
test('server refuses CC validation while provider has not confirmed support',()=>{
 assert.match(validate,/if\(cc\.length&&!await ccProviderSupported\(\)\)/);
 assert.ok(validate.indexOf('ccProviderSupported()')<validate.indexOf("ticketChargeAdminUser(req)"));
 assert.match(validate,/Validação bloqueada sem enviar e-mail/);
 assert.match(server,/if\(cc\.length\)\{[\s\S]*?if\(!await ccProviderSupported\(\)\)throw/);
});
