import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-private-server-key';
process.env.SUPABASE_ANON_KEY='test-anon-key';
process.env.SUPABASE_ALLOWED_EMAILS='quality@example.com';
const {default:handler}=await import('../api/ticket-manager.js');
function result(){
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(v){this.statusCode=v;return this},
 json(body){this.body=body;return this}};
 return res;
}
const req=body=>({method:'POST',query:{action:'upsertTickets'},headers:{authorization:'Bearer bearer-unit-test'},body});
function setFetch(upstream){
 globalThis.fetch=async (url,opts)=>{
  if(String(url).includes('/auth/v1/user'))return {ok:true,json:async()=>({id:'test',email:'quality@example.com'})};
  if(String(url).includes('/rest/v1/tm_tickets'))return upstream(url,opts);
  throw Error('Unexpected fetch target');
 };
}
test('valid JSON can be sent to Supabase without exposing credentials',async()=>{
 setFetch(async(_url,opts)=>{assert.equal(JSON.parse(opts.body)[0].id,'100');return {ok:true,status:201,text:async()=>'',headers:new Headers()};});
 const res=result();await handler(req({tickets:[{id:100,subject:'Example'}]}),res);
 assert.equal(res.statusCode,200);assert.equal(res.body.ok,true);
});
test('upstream invalid JSON surfaces a safe 502 with diagnostics',async()=>{
 const logs=[],original=console.error;
 console.error=(...parts)=>logs.push(parts);
 try{
  setFetch(async()=>({ok:false,status:400,text:async()=>JSON.stringify({message:'Empty or invalid json'}),headers:new Headers({'content-type':'application/json'})}));
  const res=result();await handler(req({tickets:[{id:100}]}),res);
  assert.equal(res.statusCode,502);
  assert.equal(res.body.error,'Falha ao acessar os dados compartilhados');
  const combined=JSON.stringify(logs);
  assert.match(combined,/upstreamStatus/);assert.match(combined,/requestBytes/);
  assert.doesNotMatch(combined,/bearer-unit-test|test-private-server-key/);
 }finally{console.error=original}
});
test('oversized payload fails locally before reaching Supabase',async()=>{
 let called=false;
 setFetch(async()=>{called=true;throw Error('Should not send')});
 const res=result();
 await handler(req({tickets:[{id:100,description:'x'.repeat(260000)}]}),res);
 assert.equal(res.statusCode,413);assert.equal(called,false);
});

test('existing intelligence history survives a shared-settings save above the ticket limit',async()=>{
 const state={md_ia:'á'.repeat(140000),md_domain:'https://arquem.movidesk.com',md_token:'private',md_secret:'private'};
 let saved;
 globalThis.fetch=async(url,opts)=>{
  if(String(url).includes('/auth/v1/user'))return {ok:true,json:async()=>({id:'test',email:'quality@example.com'})};
  assert.match(String(url),/\/rest\/v1\/tm_state\?/);
  saved=JSON.parse(opts.body)[0];
  return {ok:true,status:201,text:async()=>'',headers:new Headers()};
 };
 const res=result();await handler({...req({state}),query:{action:'saveState'}},res);
 assert.equal(res.statusCode,200);
 assert.equal(saved.state.md_ia,state.md_ia);
 assert.equal(saved.state.md_domain,state.md_domain);
 assert.equal(saved.state.md_token,undefined);
 assert.equal(saved.state.md_secret,undefined);
});

test('shared-settings limit remains bounded and rejects before writing',async()=>{
 let called=false;
 globalThis.fetch=async(url)=>{
  if(String(url).includes('/auth/v1/user'))return {ok:true,json:async()=>({id:'test',email:'quality@example.com'})};
  called=true;throw Error('Should not write');
 };
 const res=result();await handler({...req({state:{md_ia:'á'.repeat(500000)}}),query:{action:'saveState'}},res);
 assert.equal(res.statusCode,413);assert.equal(called,false);
 assert.match(res.body.error,/Configurações compartilhadas/);
});
