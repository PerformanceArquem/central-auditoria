import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const model=new URL('../lib/ticket-inspection.mjs',import.meta.url).href;
const code=readFileSync(new URL('../server/audit-ticket-inspection.mjs',import.meta.url),'utf8').replace("'../lib/ticket-inspection.mjs'",JSON.stringify(model));
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const original=globalThis.fetch,env={...process.env};
const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TICKET_INSPECTION_ENABLED','TICKET_INSPECTION_PERSIST','TICKET_INSPECTION_HISTORY_URL','TICKET_INSPECTION_HISTORY_SERVICE_ROLE_KEY','VERCEL_ENV'];
after(()=>{globalThis.fetch=original;for(const key of keys)if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];});
const requestId='64b2ab30-1860-42d4-86ec-1b36f016731a';
function configure({valid=true,active=true,role='admin',persist=false,stale=false,records,snapshots=[],historicalRecords=[],vipNames=['Ótica Fixture'],contextFailure=false}={}){
 Object.assign(process.env,{SUPABASE_URL:'https://source.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'secret-source',TICKET_INSPECTION_ENABLED:'true',TICKET_INSPECTION_PERSIST:String(persist),TICKET_INSPECTION_HISTORY_URL:'https://staging.supabase.co',TICKET_INSPECTION_HISTORY_SERVICE_ROLE_KEY:'secret-staging',VERCEL_ENV:'preview'});
 const calls=[];
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);calls.push({url:u,options});
  if(u.pathname==='/auth/v1/user')return {ok:valid,json:async()=>({id:'fixture-admin'})};
  let data;
  if(u.pathname==='/functions/v1/audit-email-dispatch'){if(contextFailure)throw Error('fixture');data={ok:true,names:vipNames};}
  else if(u.pathname.endsWith('/audit_users'))data=[{role,is_active:active}];
  else if(u.pathname.endsWith('/audit_direct_tickets')&&u.searchParams.has('payload->>baseStatus')){if(contextFailure)throw Error('fixture');data=historicalRecords;}
  else if(u.pathname.endsWith('/audit_direct_tickets'))data=records??[{ticket_id:'1',source_synced_at:'2026-11-23T12:00:00Z',payload:{id:1,status:'Em atendimento',subject:'Assunto',owner:'Alan',ownerTeam:'Produção',actions:[{description:'PRIVATE DESCRIPTION',createdDate:'2026-11-20T10:00:00Z',timeAppointments:[]}],ownerHistories:[{changedDate:'2026-11-20T10:00:00Z',ownerTeam:'Produção',owner:'Alan'}]}}];
  else if(u.pathname.endsWith('/rpc/audit_record_ticket_inspection'))data=stale?{stale:true}:{saved:true};
  else if(u.pathname.endsWith('/audit_ticket_inspection_snapshots'))data=snapshots;
  else throw Error('Unexpected URL');
  return {ok:true,json:async()=>data};
 };return calls;
}
async function invoke({method='GET',id='1',authorization='Bearer fixture',body={requestId}}={}){
 const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
 await handler({method,headers:{authorization},query:{id},body},res);return res;
}
test('read-only by default and no secrets or action descriptions returned',async()=>{
 const calls=configure(),r=await invoke();assert.equal(r.code,200);assert.equal(r.data.storageEnabled,false);assert.equal(r.data.item.timeline.length,1);
 assert.ok(calls.filter(c=>c.url.pathname.startsWith('/rest/')).every(c=>!c.options.method||c.options.method==='GET'));
 const configRead=calls.find(c=>c.url.pathname==='/functions/v1/audit-email-dispatch');assert.deepEqual(JSON.parse(configRead.options.body),{action:'vip_config',mode:'list'});
 assert.doesNotMatch(JSON.stringify(r.data),/secret-|PRIVATE DESCRIPTION/);assert.equal(r.headers['Cache-Control'],'private, no-store');
});
test('anonymous, invalid, inactive and nonadmin accounts cannot read tickets',async()=>{
 let calls=configure();assert.equal((await invoke({authorization:''})).code,401);assert.equal(calls.length,0);
 for(const opts of [{valid:false},{active:false},{active:null},{role:'viewer'}]){calls=configure(opts);const r=await invoke();assert.ok([401,403].includes(r.code));assert.ok(!calls.some(c=>c.url.pathname.endsWith('/audit_direct_tickets')));}
});
test('disabled gate, invalid id, invalid request id and unsupported methods do not fetch',async()=>{
 let calls=configure();process.env.TICKET_INSPECTION_ENABLED='false';assert.equal((await invoke()).code,503);assert.equal(calls.length,0);
 calls=configure({persist:true});for(const opts of [{method:'DELETE'},{id:'1&select=*'},{method:'POST',body:{requestId:'invalid'}}])assert.ok([400,405].includes((await invoke(opts)).code));assert.equal(calls.length,0);
});
test('writes require a separate staging project and are denied in production',async()=>{
 for(const mode of ['disabled','same','production','no-key']){
  const calls=configure({persist:true});
  if(mode==='disabled')process.env.TICKET_INSPECTION_PERSIST='false';
  if(mode==='same')process.env.TICKET_INSPECTION_HISTORY_URL=process.env.SUPABASE_URL+'/';
  if(mode==='production')process.env.VERCEL_ENV='production';
  if(mode==='no-key')delete process.env.TICKET_INSPECTION_HISTORY_SERVICE_ROLE_KEY;
  assert.equal((await invoke({method:'POST'})).code,409);assert.equal(calls.length,0);
 }
});
test('POST recomputes findings on server, writes only to staging and preserves idempotency id',async()=>{
 const calls=configure({persist:true}),r=await invoke({method:'POST',body:{requestId,findings:[{code:'forged'}],score:999}});assert.equal(r.code,200);assert.equal(r.data.saved,true);
 const writes=calls.filter(c=>c.options.method==='POST'&&c.url.pathname.startsWith('/rest/'));assert.equal(writes.length,1);assert.equal(writes[0].url.hostname,'staging.supabase.co');
 const saved=JSON.parse(writes[0].options.body);assert.equal(saved.p_request_id,requestId);assert.ok(saved.p_score<=100);assert.ok(!saved.p_findings.some(f=>f.code==='forged'));
 assert.equal(saved.p_actor,'fixture-admin');assert.equal(writes[0].options.headers.apikey,'secret-staging');
});
test('source not found, unknown synchronization and stale snapshot never claim save success',async()=>{
 configure({records:[]});assert.equal((await invoke()).code,404);
 configure({persist:true,records:[{ticket_id:'1',payload:{id:1}}]});assert.equal((await invoke({method:'POST'})).code,409);
 configure({persist:true,stale:true});const r=await invoke({method:'POST'});assert.equal(r.code,409);assert.equal(r.data.saved,undefined);
});
test('history replays resolution and recurrence, and caps truncated coverage',async()=>{
 const f={code:'no_owner',label:'Sem responsável'},stamp=n=>'2026-11-23T12:00:0'+n+'Z';
 configure({persist:true,snapshots:[{findings:[f],evaluated_codes:['no_owner'],observed_at:stamp(3)},{findings:[],evaluated_codes:['no_owner'],observed_at:stamp(2)},{findings:[f],evaluated_codes:['no_owner'],observed_at:stamp(1)}]});
 const r=await invoke();assert.equal(r.data.history.length,2);assert.equal(r.data.history[0].resolvedAt,Date.parse(stamp(2)));assert.equal(r.data.history[1].resolvedAt,null);
 configure({persist:true,snapshots:Array.from({length:1001},()=>({findings:[],evaluated_codes:[],observed_at:stamp(1)}))});assert.equal((await invoke()).data.historyPartial,true);
});
test('closed source explicitly resolves tracked checks without fabricating an open ticket',async()=>{
 configure({records:[{ticket_id:'1',closed_at_source:'2026-11-23T12:00:00Z',payload:{id:1}}]});const r=await invoke();assert.equal(r.data.item.closed,true);assert.ok(r.data.item.evaluatedCodes.includes('no_owner'));
});
test('upstream failures return a safe error without tokens or raw provider messages',async()=>{
 configure();globalThis.fetch=async()=>{throw Error('secret-source PRIVATE DESCRIPTION');};const r=await invoke();assert.equal(r.code,502);assert.doesNotMatch(JSON.stringify(r.data),/secret-source|PRIVATE DESCRIPTION/);
});
test('old synchronization is clearly warned without claiming current coverage',async()=>{
 configure({records:[{ticket_id:'1',source_synced_at:'2020-01-01T00:00:00Z',payload:{id:1,owner:'Alan'}}]});
 const r=await invoke();assert.equal(r.code,200);assert.ok(r.data.warnings.some(w=>w.includes('mais de 24 horas')));
});
test('server calculates peer history and priority from authenticated read-only context',async()=>{
 const source={id:1,owner:'Alan',ownerTeam:'Suporte',category:'Incidente',serviceFirstLevel:'Sistema',clients:[{businessName:'Ótica Teste'}],slaSolutionDate:'2040-01-01T12:00:00Z'};
 const peers=Array.from({length:5},(_,i)=>({...source,id:i+10,baseStatus:'Resolved',resolvedIn:'2020-01-02T12:00:00Z',slaSolutionDate:'2020-01-01T12:00:00Z'}));
 const calls=configure({records:[{ticket_id:'1',payload:source}],historicalRecords:peers,vipNames:['Ótica Teste']}),r=await invoke();
 assert.equal(r.code,200);assert.equal(r.data.item.risk.similarity.samples,5);assert.equal(r.data.item.risk.similarity.lateRate,1);assert.equal(r.data.item.risk.components.find(c=>c.key==='client').points,7);
 const query=calls.find(c=>c.url.searchParams.has('payload->>baseStatus')).url;assert.equal(query.searchParams.get('limit'),'500');assert.doesNotMatch(query.searchParams.get('select'),/actions|description|clients|subject/);
 const vipCall=calls.find(c=>c.url.pathname==='/functions/v1/audit-email-dispatch');assert.equal(vipCall.options.headers.Authorization,'Bearer fixture');assert.deepEqual(JSON.parse(vipCall.options.body),{action:'vip_config',mode:'list'});
});
test('unavailable history and VIP configuration yield explicit missing factors, without assuming low risk',async()=>{
 configure({contextFailure:true});const r=await invoke();assert.equal(r.code,200);assert.ok(r.data.warnings.some(w=>w.includes('Histórico semelhante indisponível')));assert.ok(r.data.warnings.some(w=>w.includes('criticidade não inferida')));assert.ok(r.data.item.risk.missing.includes('Criticidade do cliente'));
});
test('migration restricts access, serializes per ticket and enforces request uniqueness',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261123143000_ticket_inspection_staging.sql',import.meta.url),'utf8');
 assert.match(sql,/enable row level security/i);assert.match(sql,/revoke all.*from public,anon,authenticated/i);assert.match(sql,/request_id uuid not null unique/i);assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/source_synced_at>p_source_synced_at/);
});
