import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('expanding CC options auto-checks Gmail gateway without an email send',()=>{
 assert.match(ui,/<details id="alarmEmailCcDetails" ontoggle="if\(this\.open\)alarmEmailCheckCc\(\)"/);
 assert.match(ui,/async function alarmEmailCheckCc\(\)/);
 assert.match(ui,/body:\{action:'ticket_charge_cc_health'\}/);
});
test('composer opening checks CC only when options are expanded',()=>{
 const start=ui.indexOf('function alarmOpenComposer(){');
 const end=ui.indexOf('\nfunction alarmEmailDraft()',start);
 assert.ok(start>=0&&end>start);
 const open=ui.slice(start,end);
 assert.match(open,/if\(\$\('alarmEmailCcDetails'\)\?\.open\)alarmEmailCheckCc\(\)/);
});
test('absence of CC capability never unblocks unsafe send',()=>{
 assert.match(ui,/data\.cc\?\.length&&data\.ccSupported!==true/);
 assert.match(ui,/alarmEmailValidate/);
});
