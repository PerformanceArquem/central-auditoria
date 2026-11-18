import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('index.html'),edge=read('supabase/functions/audit-email-dispatch/index.ts');
test('CC diagnostic requires admin session and does not send emails',()=>{
 assert.match(edge,/action === 'ticket_charge_cc_health'/);
 assert.match(edge,/if \(!await isAdmin\(req\)\)/);
 assert.match(edge,/mailSent:false/);
 assert.match(edge,/action:'capabilities'/);
 assert.match(edge,/ccSupported===true/);
 assert.match(edge,/async function ccProviderSupported\(\)/);
 assert.match(edge,/return \(await ccProviderDiagnostic\(\)\)\.supported/);
});
test('CC diagnostics are limited to reason codes, never secrets or response body',()=>{
 assert.match(edge,/type CcCapabilityDiagnostic=/);
 assert.match(edge,/invalid_response/);
 assert.match(edge,/capability_missing/);
 const region=edge.split('async function ccProviderDiagnostic()')[1].split('async function ccProviderSupported()')[0];
 assert.doesNotMatch(region,/json\(\{.*target/);
 assert.doesNotMatch(region,/status\(false,\s*String\(/);
});
test('operator can verify CC without disabling the fail-closed preview or send protection',()=>{
 assert.match(ui,/id="alarmEmailCheckCc"/);
 assert.match(ui,/id="alarmEmailCcStatus"/);
 assert.match(ui,/async function alarmEmailCheckCc\(/);
 assert.match(ui,/action:'ticket_charge_cc_health'/);
 assert.match(ui,/ccReasonMessage/);
 assert.match(ui,/data\.cc\?\.length&&data\.ccSupported!==true/);
 assert.match(edge,/if\(!await ccProviderSupported\(\)\)throw/);
});
test('dispatcher remains syntactically valid',()=>{
 const cleaned=stripTypeScriptTypes(edge);
 assert.doesNotThrow(()=>new Function(cleaned.replace(/\bimport\s+[^;]+;/g,'')));
});
