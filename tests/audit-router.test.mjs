import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const code=readFileSync(new URL('../api/audit.js',import.meta.url),'utf8');
const {createAuditRouter,default:handler}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.data=data;return this;}});
test('all four existing endpoint URLs map to a single function before filesystem handling',()=>{
 const expected={'audit-ticket-inspection':'inspection','audit-ticket-lookup':'lookup','audit-forecast-variances':'forecast','audit-production-flow':'production-flow'};
 const filesystem=config.routes.findIndex(r=>r.handle==='filesystem');
 for(const [endpoint,route] of Object.entries(expected)){
  const index=config.routes.findIndex(r=>r.src==='/api/'+endpoint);assert.ok(index>=0&&index<filesystem);assert.equal(config.routes[index].dest,'/api/audit?route='+route);
 }
 const deny=config.routes.findIndex(r=>r.src==='/server(?:/.*)?');assert.ok(deny>=0&&deny<filesystem);assert.equal(config.routes[deny].dest,'/api/audit?route=not-found');
 assert.equal(config.git.deploymentEnabled,false);
});
test('function entry count stays below the Hobby limit',()=>{
 const entries=readdirSync(new URL('../api/',import.meta.url)).filter(p=>/\.(js|mjs|cjs|ts)$/.test(p));assert.ok(entries.length<=12,'Function entries: '+entries.length);
});
test('unknown routes and traversal attempts never load a handler',async()=>{
 let loaded=0;const router=createAuditRouter({inspection:async()=>{loaded++;return {};}});
 for(const route of [undefined,'not-found','../server/auth','__proto__','constructor',['inspection','lookup']]){const res=response();await router({query:{route}},res);assert.equal(res.code,404);}
 assert.equal(loaded,0);const res=response();await handler({query:{route:'not-found'}},res);assert.equal(res.code,404);
});
test('delegation preserves request identity, auth, query filters, method and body',async()=>{
 for(const route of ['inspection','lookup','forecast','production-flow']){
  const body={requestId:'fixture'},req={method:'POST',headers:{authorization:'Bearer fixture'},query:{route,id:'123',from:'2026-11-01'},body};
  const router=createAuditRouter({[route]:async()=>({default:async(r,res)=>{assert.equal(r,req);assert.equal(r.body,body);assert.equal(r.method,'POST');assert.equal(r.headers.authorization,'Bearer fixture');assert.deepEqual(r.query,{id:'123',from:'2026-11-01'});res.status(403).json({error:'Access denied by original handler'});}})});
  const res=response();await router(req,res);assert.equal(res.code,403);assert.equal(res.headers['Cache-Control'],'private, no-store');
 }
});
test('unexpected failures do not disclose provider messages or secrets',async()=>{
 const router=createAuditRouter({inspection:async()=>{throw Error('private-token');}}),res=response();await router({query:{route:'inspection'}},res);assert.equal(res.code,502);assert.doesNotMatch(JSON.stringify(res.data),/private-token/);
});
test('real delegated handlers preserve authentication and do not fetch for anonymous requests',async()=>{
 const names=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TICKET_INSPECTION_ENABLED','ROBOT_OVERVIEW_ENABLED'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]])),fetchImpl=globalThis.fetch;
 try{
  Object.assign(process.env,{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',TICKET_INSPECTION_ENABLED:'true',ROBOT_OVERVIEW_ENABLED:'true'});
  globalThis.fetch=async()=>assert.fail('Anonymous request reached upstream');
  let realCode=code;
  for(const file of ['audit-ticket-inspection','audit-ticket-lookup','audit-forecast-variances','audit-production-flow','audit-robot-overview'])realCode=realCode.replace("'../server/"+file+".mjs'",JSON.stringify(new URL('../server/'+file+'.mjs',import.meta.url).href));
  const {default:realRouter}=await import('data:text/javascript;base64,'+Buffer.from(realCode).toString('base64'));
  for(const route of ['inspection','lookup','forecast','production-flow','robot-overview']){
   const res=response();await realRouter({method:'GET',headers:{},query:{route,id:'123',from:'2026-11-01',to:'2026-11-01'}},res);assert.equal(res.code,401,route);
  }
 }finally{globalThis.fetch=fetchImpl;for(const key of names)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
});
