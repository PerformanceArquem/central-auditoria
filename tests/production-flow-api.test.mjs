import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const model=new URL('../lib/production-flow.cjs',import.meta.url).href;
const code=readFileSync(new URL('../api/audit-production-flow.js',import.meta.url),'utf8').replace("'../lib/production-flow.cjs'",JSON.stringify(model));
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const original=globalThis.fetch,env={...process.env};
after(()=>{globalThis.fetch=original;for(const k of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','MOVIDESK_TOKEN']){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}});
function configure({role='admin',active=true,valid=true,rosterFail=false}={}){
 process.env.SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='never-expose-service-key';process.env.MOVIDESK_TOKEN='never-expose-source-token';
 const calls=[];globalThis.fetch=async(url,opts)=>{const u=new URL(url);calls.push({url:u,opts});let data=[];
  if(u.pathname==='/auth/v1/user')return {ok:valid,json:async()=>({id:'fixture'})};
  if(u.pathname.endsWith('/audit_users'))data=[{role,is_active:active}];
  else if(u.pathname==='/public/v1/persons'){if(rosterFail)throw Error('Fixture failure');data=[{id:'p',teams:['Produção - CPO']}];}
  else if(u.pathname.endsWith('/audit_direct_sync_state'))data=[{completed:true}];
  else if(u.pathname.endsWith('/audit_recent_reconcile_state'))data=[{completed:false}];
  else if(!u.pathname.endsWith('/audit_direct_tickets'))throw Error('Unexpected route');
  return {ok:true,json:async()=>data};
 };return calls;
}
async function invoke({method='GET',authorization='Bearer fixture',query={from:'2026-11-01',to:'2026-11-10'}}={}){const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.data=v;return this}};await handler({method,headers:{authorization},query},res);return res;}
test('anonymous requests never read data',async()=>{const calls=configure(),r=await invoke({authorization:''});assert.equal(r.code,401);assert.equal(calls.length,0);});
test('rejects expired and inactive or nonadmin accounts before ticket query',async()=>{for(const opts of [{valid:false},{role:'viewer'},{active:false}]){const calls=configure(opts),r=await invoke();assert.ok([401,403].includes(r.code));assert.equal(calls.some(c=>c.url.pathname.endsWith('/audit_direct_tickets')),false);}});
test('rejects writes, impossible dates, future dates and overlong range',async()=>{configure();for(const opts of [{method:'POST'},{query:{from:'2026-02-30',to:'2026-03-01'}},{query:{from:'9999-01-01',to:'9999-01-02'}},{query:{from:'2020-01-01',to:'2022-01-01'}}])assert.ok([400,405].includes((await invoke(opts)).code));});
test('history query includes leavers and excludes conversation bodies, secrets never returned',async()=>{const calls=configure(),r=await invoke();assert.equal(r.code,200);assert.equal(r.data.ok,true);const q=calls.find(c=>c.url.pathname.endsWith('/audit_direct_tickets')).url;assert.equal(q.searchParams.has('payload->>ownerTeam'),false);assert.ok(q.searchParams.get('select').includes('ownerHistories'));assert.equal(q.searchParams.get('select').includes('actions'),false);assert.equal(JSON.stringify(r.data).includes('never-expose'),false);assert.equal(r.headers['Cache-Control'],'private, no-store');});
test('unavailable person directory is explicitly partial, not a fabricated team attribution',async()=>{configure({rosterFail:true});const r=await invoke();assert.equal(r.code,200);assert.equal(r.data.partial,true);assert.equal(r.data.coverage.rosterAvailable,false);assert.ok(r.data.warnings.some(x=>x.includes('equipes dos autores')));});

