import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/audit-robot-overview.mjs';
const originalFetch=globalThis.fetch,originalEnv={...process.env};
const keys=['ROBOT_OVERVIEW_ENABLED','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
after(()=>{globalThis.fetch=originalFetch;for(const key of keys)if(originalEnv[key]===undefined)delete process.env[key];else process.env[key]=originalEnv[key];});
function setup({admin=true,active=true,valid=true,rows}={}) {
 Object.assign(process.env,{ROBOT_OVERVIEW_ENABLED:'true',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-secret'});
 const calls=[];
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);calls.push({url:u,options});
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  if(u.pathname==='/auth/v1/user')return {ok:valid,json:async()=>({id:'admin-id'})};
  if(u.pathname.endsWith('/audit_users'))return {ok:true,json:async()=>[{role:admin?'admin':'viewer',is_active:active}]};
  if(u.pathname.endsWith('/audit_reporting_tickets'))return {ok:true,json:async()=>rows??[{ticket_id:'1',source_synced_at:new Date().toISOString(),ownerTeam:'Suporte',status:'Em atendimento',subject:'Exemplo',owner:null,slaSolutionDate:null}]};
  throw Error('Unexpected upstream');
 };return calls;
}
async function invoke({method='GET',scope='all',authorization='Bearer fixture'}={}) {
 const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
 await handler({method,query:{scope},headers:{authorization}},res);return res;
}
test('disabled gate and all mutation methods fail before fetching',async()=>{
 const calls=setup();process.env.ROBOT_OVERVIEW_ENABLED='false';assert.equal((await invoke()).code,503);
 process.env.ROBOT_OVERVIEW_ENABLED='true';for(const method of ['POST','PATCH','DELETE'])assert.equal((await invoke({method})).code,405);
 assert.equal(calls.length,0);
});
test('only authenticated active administrators reach ticket reads',async()=>{
 let calls=setup();assert.equal((await invoke({authorization:''})).code,401);assert.equal(calls.length,0);
 for(const options of [{valid:false},{admin:false},{active:false}]){calls=setup(options);assert.ok([401,403].includes((await invoke()).code));assert.ok(!calls.some(c=>c.url.pathname.endsWith('audit_reporting_tickets')));}
});
test('scope is fixed and source fields exclude action text and contacts',async()=>{
 const calls=setup(),result=await invoke();assert.equal(result.code,200);assert.equal(result.data.mode,'read-only');assert.equal(result.data.writeEnabled,false);
 const source=calls.find(c=>c.url.pathname.endsWith('audit_reporting_tickets')).url;
 assert.equal(source.searchParams.get('limit'),'1001');assert.equal(source.searchParams.get('closed_at_source'),'is.null');
 assert.doesNotMatch(source.searchParams.get('select'),/actions|description|email|phone/);
 assert.doesNotMatch(JSON.stringify(result.data),/server-secret/);assert.equal(result.headers['Cache-Control'],'private, no-store');
});
test('invalid scopes and selection overflow never return partial tickets',async()=>{
 let calls=setup();assert.equal((await invoke({scope:'constructor'})).code,400);assert.equal(calls.length,0);
 setup({rows:Array.from({length:1001},(_,i)=>({ticket_id:String(i)}))});const result=await invoke();assert.equal(result.code,409);assert.equal(result.data.tickets,undefined);
});
test('provider failures and records outside requested scope expose no raw data',async()=>{
 setup();globalThis.fetch=async()=>{throw Error('server-secret provider-body');};assert.doesNotMatch(JSON.stringify((await invoke()).data),/server-secret|provider-body/);
 setup();const result=await invoke({scope:'production'});assert.equal(result.code,502);assert.equal(result.data.tickets,undefined);
});
