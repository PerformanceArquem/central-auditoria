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

test('recording reference cannot override a different explicit call ID',()=>{
 const t=ticket(1300,'2026-11-20T08:00:00-03:00','41999990000');
 t.payload.zenviaCallId='another-call';
 t.payload.actions[0].htmlDescription='https://voice-app.zenvia.com/rec?id=123456789';
 const c={...call(1301,'2026-11-20T10:00:00-03:00',null),
  url_gravacao:'https://api.evoline.com.br/rec/?id=123456789'};
 const r=run([c],[t]);
 assert.equal(r.stats.vinculado_gravacao,0);
 assert.equal(r.stats.dados_insuficientes,1);
});
test('phone and event time cannot override a contradictory recording reference',()=>{
 const t=ticket(1400,'2026-11-20T10:01:00-03:00','41999990000');
 t.payload.actions[0].htmlDescription='https://voice-app.zenvia.com/rec?id=123456789';
 const c={...call(1401,'2026-11-20T10:00:00-03:00','41999990000'),
  url_gravacao:'https://api.evoline.com.br/rec/?id=987654321'};
 const r=run([c],[t]);
 assert.equal(r.stats.possivel_vinculo,0);
 assert.equal(r.stats.sem_vinculo_identificado,1);
});

test('linked tickets expose Movidesk sector and employee, without contact or private details',()=>{
 const t=ticket(1510,'2026-11-20T10:02:00-03:00','41999990000');
 t.payload.ownerTeam='Suporte';
 t.payload.owner={businessName:'Operador Teste',phone:'41999990000',email:'private@example.com'};
 const result=run([call(1511,'2026-11-20T10:00:00-03:00','41999990000')],[t]);
 assert.equal(result.records[0].sector,'Suporte');
 assert.equal(result.records[0].employee,'Operador Teste');
 assert.ok(!JSON.stringify(result).includes('private@example.com'));
});
test('calls without matched tickets do not invent sector or employee',()=>{
 const result=run([call(1520,'2026-11-20T10:00:00-03:00','41999990000')],[]);
 assert.equal(result.records[0].sector,'');
 assert.equal(result.records[0].employee,'');
});
test('sector and employee dropdowns filter reconciliation and its export',()=>{
 const html=readFileSync('index.html','utf8');
 for(const item of ['id="zvReconcileSector"','id="zvReconcileEmployee"',
  'fillReconciliationPeople()', "r.sector===sector", "r.employee===employee",
  "'sector','employee'"])assert.ok(html.includes(item),item);
});

test('URA reconciliation uses independent date selectors defaulting to seven days, preserving monthly voice metrics',()=>{
 const html=readFileSync('index.html','utf8');
 assert.match(html,/id="zvReconcileStart"/);
 assert.match(html,/id="zvReconcileEnd"/);
 assert.match(html,/const start=el\('zvReconcileStart'\)\.value,end=el\('zvReconcileEnd'\)\.value/);
 assert.match(html,/el\('zvStart'\)\.value=today\.slice\(0,7\)\+'-01'/);
 assert.match(html,/Date\.parse\(today\+'T12:00:00Z'\)-6\*86400000/);
});


test('date validation accepts 8 and 31 inclusive days and rejects longer or invalid ranges',async()=>{
 const context=vm.createContext({Date,Math,Number,String,Array,Object,Set,URL,JSON,parseInt,process:{env:{}}});
 vm.runInContext(source+'\nthis.handler=handler;',context);
 const request=async(start,end)=>{
  const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await context.handler({method:'GET',query:{start,end}},res);
  return res;
 };
 for(const [start,end] of [['2026-11-01','2026-11-08'],['2026-10-01','2026-10-31'],['2026-11-23','2026-11-23']]){
  const res=await request(start,end);
  assert.equal(res.code,503); // Passed date validation; integrations deliberately unconfigured.
 }
 for(const [start,end] of [['2026-10-01','2026-11-01'],['2026-11-23','2026-11-01'],['2026-02-30','2026-03-01'],['','2026-11-23']]){
  assert.equal((await request(start,end)).code,400);
 }
 const html=readFileSync('index.html','utf8');
 assert.ok(html.includes('/86400000>30)throw Error'));
 assert.ok(html.includes('31 dias corridos'));
});


test('directory loads independently of dates, URA and Zenvia, paginates and omits private fields',async()=>{
 const requests=[];
 const ctx=vm.createContext({Date,Math,Number,String,Array,Object,Set,Map,URL,JSON,parseInt,AbortController,setTimeout,clearTimeout,
 process:{env:{SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',MOVIDESK_TOKEN:'secret'}},
 fetch:async(url)=>{
  const u=new URL(url);requests.push(u);
  if(u.pathname==='/auth/v1/user')return {ok:true,json:async()=>({id:'admin'})};
  if(u.pathname==='/rest/v1/audit_users')return {ok:true,json:async()=>[{role:'admin',is_active:true}]};
  assert.equal(u.pathname,'/public/v1/persons');
  const rows=u.searchParams.get('$skip')==='0'
   ?Array.from({length:100},(_,i)=>({id:String(i+1),businessName:'Agent '+i,teams:['Suporte'],profileType:1,isActive:true,email:'private@example.com'}))
   :[{id:'101',businessName:'Other',teams:['Inteligencia','Suporte'],profileType:3,isActive:true},
    {id:'102',businessName:'Inactive',teams:['Hidden'],profileType:1,isActive:false},
    {id:'103',businessName:'Client',teams:['Hidden'],profileType:2,isActive:true}];
  return {ok:true,json:async()=>rows};
 }});
 vm.runInContext(source+'\nthis.handler=handler;',ctx);
 const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await ctx.handler({method:'GET',headers:{authorization:'Bearer user'},query:{action:'directory'}},res);
 assert.equal(res.code,200);assert.equal(res.body.employees.length,101);
 assert.deepEqual(Array.from(res.body.sectors),['Inteligencia','Suporte']);
 assert.ok(!JSON.stringify(res.body).includes('private@example.com'));
 assert.ok(!JSON.stringify(res.body).includes('secret'));
 assert.equal(requests.filter(u=>u.pathname==='/public/v1/persons').length,2);
});

test('directory rejects non-admin access before consulting Movidesk',async()=>{
 let calls=0;
 const ctx=vm.createContext({Date,Math,Number,String,Array,Object,Set,Map,URL,JSON,parseInt,AbortController,setTimeout,clearTimeout,
 process:{env:{SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',MOVIDESK_TOKEN:'secret'}},
 fetch:async()=>{calls++;return {ok:true,json:async()=>calls===1?{id:'user'}:[{role:'viewer',is_active:true}]};}});
 vm.runInContext(source+'\nthis.handler=handler;',ctx);
 const res={setHeader(){},status(code){this.code=code;return this;},json(body){return this;}};
 await ctx.handler({method:'GET',headers:{authorization:'Bearer user'},query:{action:'directory'}},res);
 assert.equal(res.code,403);assert.equal(calls,2);
});

test('employee selector uses Movidesk membership even with no reconciled calls',()=>{
 const html=readFileSync('index.html','utf8');
 const fn=html.slice(html.indexOf('function fillReconciliationPeople(){'),html.indexOf('async function loadReconciliationPeople(){'));
 const select=()=>({value:'',options:[],replaceChildren(option){this.options=[option];},add(option){this.options.push(option);}});
 const sector=select(),employee=select();
 const ctx=vm.createContext({Set,Option:function(text,value){this.text=text;this.value=value;},
 el:id=>id==='zvReconcileSector'?sector:employee,
 reconcileDirectory:{sectors:['Suporte','Producao'],employees:[{name:'Ana',teams:['Suporte']},{name:'Bia',teams:['Producao','Suporte']},{name:'Caio',teams:['Producao']}]}});
 vm.runInContext(fn+';fillReconciliationPeople();',ctx);
 assert.equal(sector.options.length,3);assert.equal(employee.options.length,4);
 sector.value='Suporte';vm.runInContext('fillReconciliationPeople();',ctx);
 assert.deepEqual(employee.options.map(x=>x.value),['','Ana','Bia']);
 employee.value='Ana';sector.value='Producao';vm.runInContext('fillReconciliationPeople();',ctx);
 assert.deepEqual(employee.options.map(x=>x.value),['','Bia','Caio']);assert.equal(employee.value,'');
});


test('Movidesk queries keep both date boundaries on every page',async()=>{
 const urls=[];
 const ctx=vm.createContext({Date,Math,Number,String,Array,Object,Set,URL,JSON,parseInt,
 fetch:async url=>{urls.push(new URL(url));return {ok:true,json:async()=>urls.length===1?Array.from({length:500},(_,i)=>({ticket_id:i})):[]};}});
 vm.runInContext(source+'\nthis.readTickets=movideskTickets;',ctx);
 const result=await ctx.readTickets('2026-11-01','2026-11-23','https://test.invalid','not-real');
 assert.equal(result.length,500);assert.equal(urls.length,2);
 for(const u of urls){assert.deepEqual(u.searchParams.getAll('created_at_source'),[
  'gte.2026-11-01T02:40:00.000Z','lt.2026-11-24T03:20:00.000Z']);}
 assert.equal(urls[1].searchParams.get('offset'),'500');
});

test('provider rejection reports the failing stage without returning upstream secrets',async()=>{
 const logs=[];
 const ctx=vm.createContext({Date,Math,Number,String,Array,Object,Set,Map,URL,JSON,parseInt,AbortController,setTimeout,clearTimeout,
 console:{error:(...args)=>logs.push(args)},
 process:{env:{SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'service-secret',ZENVIA_VOICE_ACCESS_TOKEN:'voice-secret',ZENVIA_URA_DID_NUMBERS:'4130135878',ZENVIA_URA_SCOPE_CONFIRMED:'true'}},
 fetch:async url=>{const u=new URL(url);
  if(u.pathname==='/auth/v1/user')return {ok:true,json:async()=>({id:'admin'})};
  if(u.pathname==='/rest/v1/audit_users')return {ok:true,json:async()=>[{role:'admin',is_active:true}]};
  if(u.hostname==='voice-api.zenvia.com')return {ok:false,status:403,json:async()=>({message:'voice-secret'})};
  return {ok:true,json:async()=>[]};
 }});
 vm.runInContext(source+'\nthis.handler=handler;',ctx);
 const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await ctx.handler({method:'GET',headers:{authorization:'Bearer admin-session'},query:{start:'2026-11-01',end:'2026-11-23'}},res);
 assert.equal(res.code,502);assert.ok(res.body.error.includes('cadastro de n'));
 assert.ok(res.body.error.includes('token'));assert.equal(logs.length,1);
 assert.ok(!JSON.stringify({body:res.body,logs}).includes('voice-secret'));
 assert.ok(!JSON.stringify({body:res.body,logs}).includes('service-secret'));
});


test('unlinked detail lists all 72 of 101 calls independently of department filters',()=>{
 const html=readFileSync('index.html','utf8');
 const fn=html.slice(html.indexOf('function buildUnlinkedReport(data){'),html.indexOf('function showUnlinkedReport(){'));
 const ctx=vm.createContext({Date,Intl,Number,Math});vm.runInContext(fn+';this.build=buildUnlinkedReport;',ctx);
 const records=Array.from({length:101},(_,i)=>({callId:String(i+1),startedAt:'2026-11-19T16:25:01-03:00',phoneMasked:'****3280',status:'atendida',reconciliation:i<72?'sem_vinculo_identificado':i<96?'ambiguo':'possivel_vinculo',sector:i<72?'':'Suporte'}));
 const data={from:'2026-11-01',to:'2026-11-23',records};
 const r=ctx.build(data);
 assert.equal(r.total,101);assert.equal(r.count,72);assert.equal(r.rows.length,72);
 assert.ok(r.summary.startsWith('Das 101'));assert.ok(r.summary.includes('72 ficaram'));
 assert.ok(r.period.includes('01/11/2026'));assert.ok(r.period.includes('23/11/2026'));
 assert.equal(r.rows[0][2],'1');assert.equal(r.rows[71][2],'72');
 assert.ok(r.rows[0][1].includes('19/11/2026'));assert.ok(r.rows[0][1].includes('16:25:01'));
 assert.equal(r.rows[0].length,r.headers.length);
 assert.equal(ctx.build({...data,records:[]}).count,0);
 const exportFn=html.slice(html.indexOf('function downloadUnlinkedReport(){'),html.indexOf('function showReconciliation(){'));
 assert.ok(exportFn.includes('buildUnlinkedReport(reconcileDataset)'));
 assert.ok(!exportFn.includes('zvReconcileSector'));assert.ok(!exportFn.includes('zvReconcileEmployee'));
});


test('call evidence separates recording from cancellation without exposing URLs or claiming URA completion',()=>{
 const base=call(2000,'2026-11-19T10:00:00-03:00','41999990000','cancelada');
 const r=run([{...base,url_gravacao:'https://voice-api.zenvia.com/rec/123456789?token=private',duracao_segundos:125,duracao_falada_segundos:0,ramal_id:45},
 {...base,id:2001,status:'atendida',url_gravacao:'',duracao_segundos:900,duracao_falada_segundos:850,ramal_id:46},
 {...base,id:2002,status:'sem resposta'},
 {...base,id:2003,status:'atendida',url_gravacao:'https://untrusted.example/rec/private',duracao_segundos:null,duracao_falada_segundos:''}],[]);
 assert.equal(r.records[0].recordingState,'informada');
 assert.equal(r.records[0].status,'abandonada_ou_cancelada');
 assert.equal(r.records[0].durationSeconds,125);assert.equal(r.records[0].talkSeconds,0);
 assert.equal(r.records[1].recordingState,'nao_informada');
 assert.equal(r.records[2].recordingState,'desconhecida');
 assert.equal(r.records[3].recordingState,'nao_informada');
 assert.equal(r.records[3].durationSeconds,null);assert.equal(r.records[3].talkSeconds,null);
 for(const row of r.records)assert.equal(row.uraCompletion,'nao_comprovada');
 assert.ok(!JSON.stringify(r).includes('private'));assert.ok(!JSON.stringify(r).includes('https://'));
});

test('unlinked report exports evidence counts and preserves unknown durations',()=>{
 const html=readFileSync('index.html','utf8');
 const fn=html.slice(html.indexOf('function buildUnlinkedReport(data){'),html.indexOf('function showUnlinkedReport(){'));
 const ctx=vm.createContext({Date,Intl,Number,Math});vm.runInContext(fn+';this.build=buildUnlinkedReport;',ctx);
 const r=ctx.build({from:'2026-11-01',to:'2026-11-23',records:[
 {reconciliation:'sem_vinculo_identificado',status:'abandonada_ou_cancelada',recordingState:'informada',durationSeconds:125,talkSeconds:0,extensionReported:false},
 {reconciliation:'sem_vinculo_identificado',status:'atendida',recordingState:'nao_informada',durationSeconds:null,talkSeconds:null,extensionReported:true},
 {reconciliation:'sem_vinculo_identificado',status:'nao_atendida'},
 {reconciliation:'possivel_vinculo',recordingState:'informada'}]});
 assert.equal(r.count,3);assert.equal(r.evidence[0][1],1);assert.equal(r.evidence[1][1],1);assert.equal(r.evidence[2][1],1);
 assert.equal(r.evidence[3][1],1);assert.equal(r.evidence[6][1],3);
 assert.equal(r.rows[0][6],'00:02:05');assert.equal(r.rows[0][7],'00:00:00');
 assert.notEqual(r.rows[1][6],'00:00:00');
 assert.equal(r.headers.length,11);assert.equal(r.rows[0].length,11);
});
