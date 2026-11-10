import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../api/audit-forecast-variances.js',import.meta.url),'utf8');
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const originalFetch=globalThis.fetch;
const originalUrl=process.env.SUPABASE_URL;
const originalKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
after(()=>{
 globalThis.fetch=originalFetch;
 if(originalUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=originalUrl;
 if(originalKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=originalKey;
});
function response(ok=true,data={}){return {ok,json:async()=>data};}
function invoke(headers={},method='GET'){
 const req={method,headers};
 const res={
  code:200,headers:{},payload:null,
  setHeader(k,v){this.headers[k]=v;return this},
  status(v){this.code=v;return this},
  json(v){this.payload=v;return this}
 };
 return handler(req,res).then(()=>res);
}
function configure({user=true,role='admin',active=true,rows=[]}={}){
 process.env.SUPABASE_URL='https://mock.supabase.co';
 process.env.SUPABASE_SERVICE_ROLE_KEY='server-only-key';
 const requests=[];
 globalThis.fetch=async(url,opts)=>{
  const u=new URL(url);requests.push({path:u.pathname,headers:opts.headers});
  if(u.pathname==='/auth/v1/user')return response(user,{id:'fake-user'});
  if(u.pathname==='/rest/v1/audit_users')return response(true,[{role,is_active:active}]);
  if(u.pathname==='/rest/v1/audit_forecast_variance_snapshots')return response(true,rows);
  throw new Error('Unexpected route '+u.pathname);
 };
 return requests;
}
test('rejects anonymous requests before database or auth fetch',async()=>{
 const requests=configure();
 const out=await invoke();
 assert.equal(out.code,401);
 assert.equal(requests.length,0);
 assert.equal(out.headers['Cache-Control'],'no-store, private');
});
test('rejects invalid sessions',async()=>{
 const requests=configure({user:false});
 const out=await invoke({authorization:'Bearer invalid'});
 assert.equal(out.code,401);
 assert.equal(requests.length,1);
});
test('rejects inactive administrators',async()=>{
 const requests=configure({role:'admin',active:false});
 const out=await invoke({authorization:'Bearer token'});
 assert.equal(out.code,403);
 assert.equal(requests.length,2);
});
test('rejects users without admin privileges',async()=>{
 const requests=configure({role:'viewer',active:true});
 const out=await invoke({authorization:'Bearer token'});
 assert.equal(out.code,403);
 assert.equal(requests.length,2);
});
test('returns normalized forecast variance for active admin',async()=>{
 const rows=[{ticket_id:'100893',subject:'Exemplo',client_name:'Loja',
  sector:'Produção - CPO',status:'Fechado',estimated_hours:'12.00',actual_minutes:26,
  variance_percent:'96.39',evidence:'estimativa inicial de 12 horas',confidence:'baixa',
  updated_at:'2026-11-10T15:40:00Z'}];
 const requests=configure({rows});
 const out=await invoke({authorization:'Bearer token'});
 assert.equal(out.code,200);
 assert.equal(out.payload.source,'supabase-automatic');
 assert.equal(out.payload.items.length,1);
 assert.equal(out.payload.items[0].id,'100893');
 assert.equal(out.payload.items[0].pl,12);
 assert.equal(out.payload.items[0].h,26/60);
 assert.equal(out.payload.items[0].confidence,'baixa');
 assert.equal(requests.length,3);
 assert.ok(requests.every(r=>r.headers.apikey==='server-only-key'));
 assert.equal(JSON.stringify(out.payload).includes('server-only-key'),false);
});
test('rejects non-GET calls',async()=>{
 configure();
 const out=await invoke({},'POST');
 assert.equal(out.code,405);
});
