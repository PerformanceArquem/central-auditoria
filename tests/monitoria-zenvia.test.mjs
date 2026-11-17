import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/monitoria-zenvia.js';

const savedFetch=globalThis.fetch;
const vars=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ZENVIA_VOICE_ACCESS_TOKEN','ZENVIA_CHAT_API_TOKEN'];
const previous=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
function response(){return {
 statusCode:200,headers:{},body:null,
 setHeader(k,v){this.headers[k]=v;return this;},
 status(n){this.statusCode=n;return this;},
 json(v){this.body=v;return this;},
 send(v){this.body=v;return this;}
};}
function req(action,params={},authorized=true){
 return {method:'GET',headers:authorized?{authorization:'Bearer valid-user'}:{},
 query:{action,...params}};
}
const json=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
function setup(provider=()=>json({sucesso:true,dados:{relatorio:[],total:0}}),role='admin'){
 process.env.SUPABASE_URL='https://test.supabase.co';
 process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-not-real';
 process.env.ZENVIA_VOICE_ACCESS_TOKEN='fake-voice';
 process.env.ZENVIA_CHAT_API_TOKEN='fake-chat';
 const seen=[];
 globalThis.fetch=async (url,options={})=>{
  const u=new URL(url);seen.push({url:u,headers:options.headers||{}});
  if(u.hostname==='test.supabase.co'&&u.pathname==='/auth/v1/user')return json({id:'user-1'});
  if(u.hostname==='test.supabase.co'&&u.pathname==='/rest/v1/audit_users')
   return json([{role,is_active:true}]);
  return provider(u,options);
 };
 return seen;
}
test.afterEach(()=>{
 globalThis.fetch=savedFetch;
 for(const k of vars)previous[k]===undefined?delete process.env[k]:process.env[k]=previous[k];
});
test('unauthenticated request cannot access Zenvia',async()=>{
 const seen=setup();
 const res=response();await handler(req('calls',{from:'2026-11-16',to:'2026-11-16'},false),res);
 assert.equal(res.statusCode,401);assert.equal(seen.length,0);
});
test('non-admin user cannot access Zenvia',async()=>{
 const seen=setup(undefined,'user');
 const res=response();await handler(req('calls',{from:'2026-11-16',to:'2026-11-16'}),res);
 assert.equal(res.statusCode,403);
 assert.equal(seen.some(x=>x.url.hostname==='voice-api.zenvia.com'),false);
});
test('call list hides numbers and recording URLs',async()=>{
 const seen=setup(u=>json({sucesso:true,dados:{relatorio:[
  {id:123,data_inicio:'2026-11-16T15:00:00Z',numero_origem:'+5541999999999',url_gravacao:'https://api.evoline.com.br/private-audio',duracao_falada_segundos:35,status:'atendida'}
 ],total:1}}));
 const res=response();
 await handler(req('calls',{from:'2026-11-16',to:'2026-11-16'}),res);
 assert.equal(res.statusCode,200);assert.equal(res.body.calls.length,2);
 const result=JSON.stringify(res.body);
 assert.equal(result.includes('+5541999999999'),false);
 assert.equal(result.includes('private-audio'),false);
 assert.equal(seen.filter(x=>x.url.hostname==='voice-api.zenvia.com').length,2);
});
test('audio relay blocks injected inbound URL hostname',async()=>{
 const seen=setup(u=>json({sucesso:true,dados:{id:123,url_gravacao:'https://evil.example/secret.mp3'}}));
 const res=response();
 await handler(req('audio',{kind:'inbound',id:'123'}),res);
 assert.equal(res.statusCode,409);
 assert.equal(seen.some(x=>x.url.hostname==='evil.example'),false);
});
test('authorized outbound audio is proxied with no secrets in result',async()=>{
 setup(()=>new Response(Uint8Array.from([73,68,51,0]),{status:200,headers:{'content-type':'audio/mpeg'}}));
 const res=response();
 await handler(req('audio',{kind:'outbound',id:'123'}),res);
 assert.equal(res.statusCode,200);assert.equal(res.headers['Content-Type'],'audio/mpeg');
 assert.ok(Buffer.isBuffer(res.body));assert.equal(res.body.length,4);
});
test('chat lookup uses backend token only, exposing bounded normalized messages',async()=>{
 const seen=setup(()=>json({messages:[{sender:{name:'Agente'},text:'Bom dia',privateKey:'never expose',createdAt:'2026-11-16T11:10:00Z'}]}));
 const res=response();
 await handler(req('chat',{protocol:'ABC_123'}),res);
 assert.equal(res.statusCode,200);assert.equal(res.body.messages[0].text,'Bom dia');
 assert.equal(JSON.stringify(res.body).includes('never expose'),false);
 assert.equal(JSON.stringify(res.body).includes('fake-chat'),false);
 const url=seen.find(x=>x.url.hostname==='zchat.zenvia.io')?.url;
 assert.equal(url?.searchParams.get('token'),'fake-chat');
});
