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
const ticket=(id,time,number)=>({ticket_id:String(id),created_at_source:time,payload:{clients:[{phone:number}],actions:[{origin:13,createdDate:time,description:'Chamada recebida'}]}});
const run=(calls,tickets)=>JSON.parse(JSON.stringify(scope.reconcile(calls,tickets)));
test('matches a single incoming call to a nearby ticket with the same normalized number',()=>{
 const r=run([call(42,'2026-11-20T10:00:00-03:00','+55 (41) 99999-0000')],
  [ticket(101,'2026-11-20T10:08:00-03:00','41999990000')]);
 assert.equal(r.stats.possivel_vinculo,1);
 assert.equal(r.stats.vinculado,0);
 assert.equal(r.records[0].ticketId,'101');
 assert.equal(r.records[0].phoneMasked,'••••0000');
 assert.equal(r.records[0].matchMethod,'telefone_horario_evento');
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
 assert.equal(r.stats.possivel_vinculo,0);
 assert.equal(r.records[0].matchMethod,'id');
});
test('index screen keeps reconciliation embedded in the existing voice tab',()=>{
 const html=readFileSync('index.html','utf8');
 for(const text of ['id="zvReconcilePanel"','id="zvReconcile"','/api/voice-reconciliation?',
  'window.tmAuth?.getSession?.()','zvReconcileCsv']) assert.ok(html.includes(text),text);
});

test('two calls pointing to one ticket are not incorrectly labeled missing',()=>{
 const calls=[
  call(21,'2026-11-20T10:00:00-03:00','41988887777'),
  call(22,'2026-11-20T10:05:00-03:00','41988887777')
 ];
 const r=run(calls,[ticket(99,'2026-11-20T10:02:00-03:00','41988887777')]);
 assert.equal(r.stats.possivel_vinculo,0);
 assert.equal(r.stats.ambiguo,2);
 assert.equal(r.stats.sem_vinculo_identificado,0);
});
test('coverage separates missing phone data from actual unmatched calls',()=>{
 const r=run([call(31,'2026-11-20T10:00:00-03:00','41988887777'),
  call(32,'2026-11-20T11:00:00-03:00',null)],
  [ticket(103,'2026-11-20T10:01:00-03:00','41988887777'),
   {ticket_id:'104',payload:{},created_at_source:'2026-11-20T12:00:00-03:00'}]);
 assert.equal(r.coverage.callsWithPhone,1);
 assert.equal(r.coverage.callsWithoutPhone,1);
 assert.equal(r.coverage.ticketsWithPhone,1);
 assert.equal(r.coverage.ticketsWithoutPhone,1);
});

test('URA audit requires explicit DID allowlist instead of counting all company DIDs',()=>{
 const configured=vm.createContext({process:{env:{ZENVIA_URA_DID_NUMBERS:'+55 (41) 3333-2222,554133334444'}},Set,String});
 vm.runInContext(source+'\nthis.uraDidFilter=uraDidFilter;',configured);
 const ids=[...configured.uraDidFilter()];
 assert.deepEqual(ids,['4133332222','4133334444']);
 const absent=vm.createContext({process:{env:{}},Set,String});
 vm.runInContext(source+'\nthis.uraDidFilter=uraDidFilter;',absent);
 assert.throws(()=>absent.uraDidFilter(),/DID/);
});
test('the response never claims proof that calls reached the URA menu from DID alone',()=>{
 assert.match(source,/uraEntryVerified:false/);
 assert.match(source,/não confirma que o menu da URA foi executado/);
});

test('URA scope never queries account-wide inbound call reports',()=>{
 assert.match(source,/voice-api\.zenvia\.com\/did'/);
 assert.match(source,/encodeURIComponent\(String\(did\.id\)\)\+'\/relatorio'/);
 assert.doesNotMatch(source,/voice-api\.zenvia\.com\/did\/relatorio/);
 assert.match(source,/approvedDids\.has\(didNumber\(row\.numero\)\)/);
 assert.match(source,/calls\.some\(call=>didNumber\(call\.numero_destino\)!==didNumber\(did\.numero\)\)/);
});

test('an ordinary ticket with matching phone cannot be mistaken for a voice integration ticket',()=>{
 const regular={ticket_id:'501',created_at_source:'2026-11-20T10:01:00-03:00',
  payload:{clients:[{phone:'41988887777'}],actions:[{origin:2}]}};
 const r=run([call(50,'2026-11-20T10:00:00-03:00','41988887777')],[regular]);
 assert.equal(r.stats.possivel_vinculo,0);
 assert.equal(r.stats.sem_vinculo_identificado,1);
 assert.equal(r.coverage.ticketsWithTelephonyAction,0);
});
test('abandoned call may be associated with a Movidesk origin 16 action without claiming ID proof',()=>{
 const t={ticket_id:'502',created_at_source:'2026-11-20T10:01:00-03:00',
  payload:{clients:[{phone:'41988887777'}],actions:[{origin:16,createdDate:'2026-11-20T10:02:00-03:00'}]}};
 const r=run([call(51,'2026-11-20T10:00:00-03:00','41988887777','cancelada')],[t]);
 assert.equal(r.stats.possivel_vinculo,1);
 assert.equal(r.stats.abandonada_ou_cancelada,1);
 assert.equal(r.coverage.ticketsWithTelephonyAction,1);
});

test('telephony evidence is returned as action origin codes, not private text',()=>{
 const t=ticket(702,'2026-11-20T10:01:00-03:00','41988887777');
 t.payload.actions[0].description='private call details';
 const r=run([call(70,'2026-11-20T10:00:00-03:00','41988887777')],[t]);
 assert.deepEqual(r.records[0].movideskTelephonyOrigins,['13']);
 assert.equal(r.coverage.telephonyActionsWithoutCallId,1);
 assert.ok(!JSON.stringify(r).includes('private call details'));
});

test('ticket created hours before the telephone action can still match a call by action timestamp',()=>{
 const t={ticket_id:'800',created_at_source:'2026-11-20T02:00:00-03:00',
  payload:{clients:[{phone:'41999990000'}],actions:[{origin:16,createdDate:'2026-11-20T10:01:00-03:00'}]}};
 const r=run([call(801,'2026-11-20T10:00:00-03:00','41999990000','cancelada')],[t]);
 assert.equal(r.stats.possivel_vinculo,1);
 assert.equal(r.records[0].deltaSeconds,60);
});
test('the same phone with events on different times matches each call to its own ticket',()=>{
 const calls=[call(810,'2026-11-20T08:00:00-03:00','41999990000'),
  call(811,'2026-11-20T15:00:00-03:00','41999990000')];
 const r=run(calls,[ticket(812,'2026-11-20T08:02:00-03:00','41999990000'),
  ticket(813,'2026-11-20T15:01:00-03:00','41999990000')]);
 assert.equal(r.stats.possivel_vinculo,2);
 assert.deepEqual(r.records.map(x=>x.ticketId),['812','813']);
});
test('tickets without telephone action timestamp are not matched by creation time alone',()=>{
 const t={ticket_id:'900',created_at_source:'2026-11-20T10:01:00-03:00',
  payload:{clients:[{phone:'41999990000'}],actions:[{origin:16}]}};
 const r=run([call(901,'2026-11-20T10:00:00-03:00','41999990000')],[t]);
 assert.equal(r.stats.sem_vinculo_identificado,1);
});

test('matches a Zenvia recording reference from Movidesk without exposing signed rec link',()=>{
 const t=ticket(981,'2026-11-20T08:00:00-03:00','41988887777');
 t.payload.actions[0].htmlDescription='<a href="https://voice-app.zenvia.com/rec?x=private-token&amp;id=123456789&amp;cid=765432">Ouvir recado</a>';
 const c={...call(501,'2026-11-20T10:00:00-03:00',null),url_gravacao:'https://voice-api.zenvia.com/rec/123456789'};
 const r=run([c],[t]);
 assert.equal(r.stats.vinculado_gravacao,1);
 assert.equal(r.records[0].ticketId,'981');
 assert.equal(r.records[0].matchMethod,'gravacao');
 assert.equal(r.coverage.ticketsWithRecordingReference,1);
 assert.ok(!JSON.stringify(r).includes('private-token'));
 assert.ok(!JSON.stringify(r).includes('123456789'));
});
test('recording reference only counts when both provider URLs share the exact recording ID',()=>{
 const t=ticket(982,'2026-11-20T08:00:00-03:00','41988887777');
 t.payload.actions[0].htmlDescription='<a href="https://voice-app.zenvia.com/rec?x=secret&id=123456789&cid=765432">recado</a>';
 const c={...call(502,'2026-11-20T10:00:00-03:00',null),url_gravacao:'https://voice-api.zenvia.com/rec/123456780'};
 const r=run([c],[t]);
 assert.equal(r.stats.vinculado_gravacao,0);
 assert.equal(r.stats.dados_insuficientes,1);
});
test('other hosts cannot inject recording references',()=>{
 const t=ticket(983,'2026-11-20T08:00:00-03:00','41988887777');
 t.payload.actions[0].htmlDescription='<a href="https://evil.example/rec?x=secret&id=123456789">recado</a>';
 const c={...call(503,'2026-11-20T10:00:00-03:00',null),url_gravacao:'https://voice-api.zenvia.com/rec/123456789'};
 assert.equal(run([c],[t]).stats.vinculado_gravacao,0);
});

test('documented Zenvia /rec/?id= URL can be matched to Movidesk recording reference',()=>{
 const t=ticket(990,'2026-11-20T08:00:00-03:00','41988887777');
 t.payload.actions[0].htmlDescription='<a href="https://voice-app.zenvia.com/rec?x=secret&id=123456789&cid=765432">Recado</a>';
 const c={...call(991,'2026-11-20T10:00:00-03:00',null),
  url_gravacao:'https://api.evoline.com.br/rec/?id=123456789'};
 const r=run([c],[t]);
 assert.equal(r.stats.vinculado_gravacao,1);
 assert.equal(r.records[0].matchMethod,'gravacao');
 assert.ok(!JSON.stringify(r).includes('secret'));
});
test('recording URL must be on an approved provider host',()=>{
 const t=ticket(992,'2026-11-20T08:00:00-03:00','41988887777');
 t.payload.actions[0].htmlDescription='https://voice-app.zenvia.com/rec?id=123456789&x=secret';
 const c={...call(993,'2026-11-20T10:00:00-03:00',null),
  url_gravacao:'https://untrusted.example/rec/?id=123456789'};
 assert.equal(run([c],[t]).stats.vinculado_gravacao,0);
});

test('DID scope approval is mandatory even when its number exists in Zenvia catalogue',()=>{
 assert.match(source,/ZENVIA_URA_SCOPE_CONFIRMED/);
 assert.match(source,/ZENVIA_URA_SCOPE_CONFIRMED!=='true'/);
 assert.doesNotMatch(source,/matched\.some\(row=>!row\.ura_id/);
});

test('a conflicting explicit call ID blocks weaker phone-time association',()=>{
 const t=ticket(1100,'2026-11-20T10:01:00-03:00','41999990000');
 t.payload.zenviaCallId='other-call';
 const result=run([call(1101,'2026-11-20T10:00:00-03:00','41999990000')],[t]);
 assert.equal(result.stats.possivel_vinculo,0);
 assert.equal(result.stats.sem_vinculo_identificado,1);
});
