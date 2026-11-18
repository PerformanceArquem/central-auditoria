import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('index.html');
const edge=read('supabase/functions/audit-email-dispatch/index.ts');
const sql=read('ops/install-ticket-charge-validation-timing.sql');
test('Validation starts from an explicit button with server-generated date',()=>{
 assert.match(html,/id="alarmEmailValidate"/);
 assert.match(html,/async function alarmEmailValidate\(/);
 assert.match(html,/action:'ticket_charge_validate'/);
 assert.match(edge,/validated_at/);
 assert.match(sql,/validated_at timestamptz not null default now\(\)/);
});
test('Send is blocked unless selection and validator match',()=>{
 assert.match(edge,/validation\.validated_by!==sender/);
 assert.match(edge,/JSON\.stringify\(\(validation\.ticket_ids\|\|\[\]\)\.map\(String\)\)/);
 assert.match(edge,/Clique em Validado após a prévia atual/);
 assert.match(html,/!alarmEmailValidated/);
});
test('Final timestamp is set after gateway confirmation and kept separate from workTime',()=>{
 const sent=edge.indexOf("status:'sent',sent_at:new Date().toISOString()");
 const complete=edge.indexOf("completed_at:new Date().toISOString()");
 assert.ok(sent>=0&&complete>sent);
 assert.match(sql,/não representa jornada ou tempo trabalhado/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all .* from anon, authenticated, public/);
});
test('History displays validation start, email finish, and interval',()=>{
 assert.match(html,/Validação \/ horário inicial/);
 assert.match(html,/Horário final do envio/);
 assert.match(html,/const interval=validation\.validated_at/);
 assert.match(edge,/validation:validationMap\.get/);
});
