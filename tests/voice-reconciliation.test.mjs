import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('api/voice-reconciliation.js','utf8')
  .replace('export function reconcile(', 'function reconcile(')
  .replace('export default async function handler(', 'async function handler(');
const scope=vm.createContext({Date,Math,Number,String,Array,Object,Set,URL,JSON,parseInt});
vm.runInContext(source+'\nthis.reconcile=reconcile;',scope);
const call=(id,time,number,status='atendida')=>({id,data_inicio:time,numero_origem:number,status});
const ticket=(id,time,number)=>({ticket_id:String(id),created_at_source:time,payload:{clients:[{phone:number}]}});
const run=(calls,tickets)=>JSON.parse(JSON.stringify(scope.reconcile(calls,tickets)));
test('matches a single incoming call to a nearby ticket with the same normalized number',()=>{
 const r=run([call(42,'2026-11-20T10:00:00-03:00','+55 (41) 99999-0000')],
  [ticket(101,'2026-11-20T10:08:00-03:00','41999990000')]);
 assert.equal(r.stats.vinculado,1);
 assert.equal(r.records[0].ticketId,'101');
 assert.equal(r.records[0].phoneMasked,'••••0000');
 assert.equal(r.records[0].matchMethod,'telefone_horario');
 assert.ok(!JSON.stringify(r).includes('41999990000'));
});
test('abandoned calls without tickets remain explicit, not assumed to be integration errors',()=>{
 const r=run([call(7,'2026-11-20T11:00:00-03:00','41988887777','cancelada')],[]);
 assert.equal(r.stats.abandonada_ou_cancelada,1);
 assert.equal(r.stats.sem_vinculo_identificado,1);
 assert.equal(r.records[0].ticketId,null);
});
test('duplicate provider event IDs are deduplicated',()=>{
 const c=call(9,'2026-11-20T11:00:00-03:00','41988887777');
 assert.equal(run([c,c],[]).stats.total,1);
});
test('ambiguous ticket candidates are never attached arbitrarily',()=>{
 const c=call(10,'2026-11-20T10:00:00-03:00','41988887777');
 const r=run([c],[ticket(11,'2026-11-20T10:01:00-03:00','41988887777'),ticket(12,'2026-11-20T10:02:00-03:00','41988887777')]);
 assert.equal(r.stats.ambiguo,1);assert.equal(r.records[0].ticketId,null);
});
test('unavailable telephone and no explicit integration ID cannot produce a guessed match',()=>{
 const r=run([call(12,'2026-11-20T10:00:00-03:00',null)],
 [ticket(13,'2026-11-20T10:00:00-03:00','41988887777')]);
 assert.equal(r.stats.dados_insuficientes,1);
});
test('a call is never linked to a distant ticket solely because a telephone matches',()=>{
 const r=run([call(15,'2026-11-20T10:00:00-03:00','41988887777')],
 [ticket(18,'2026-11-20T12:00:00-03:00','41988887777')]);
 assert.equal(r.stats.sem_vinculo_identificado,1);
});
test('explicit call IDs take precedence over phone/time matching',()=>{
 const t={ticket_id:'55',payload:{zenviaCallId:'33'},created_at_source:'2026-11-20T13:00:00-03:00'};
 const r=run([call(33,'2026-11-20T10:00:00-03:00',null)],[t]);
 assert.equal(r.stats.vinculado,1);
 assert.equal(r.records[0].matchMethod,'id');
});
test('index screen keeps reconciliation embedded in the existing voice tab',()=>{
 const html=readFileSync('index.html','utf8');
 for(const text of ['id="zvReconcilePanel"','id="zvReconcile"','/api/voice-reconciliation?',
  'window.tmAuth?.getSession?.()','zvReconcileCsv']) assert.ok(html.includes(text),text);
});
