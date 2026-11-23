import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-private-server-key';
process.env.SUPABASE_ANON_KEY='test-anon-key';
process.env.SUPABASE_ALLOWED_EMAILS='quality@example.com';
const src=await fs.readFile(new URL('../api/ticket-manager.js',import.meta.url),'utf8');
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
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
test('isolated UTF-16 surrogates are repaired only in the transmitted copy',async()=>{
 const broken=String.fromCharCode(0xD83D),ticket={id:100,subject:'Texto '+broken,actions:[{description:broken+' fim'}]},warnings=[],warn=console.warn;
 let saved;
 console.warn=(...args)=>warnings.push(args);
 try{
  setFetch(async(_url,opts)=>{saved=JSON.parse(opts.body)[0];
   // The JSON accepted by JS must also contain only Unicode scalar strings.
   assert.equal(saved.data.subject.isWellFormed(),true);
   assert.equal(saved.data.actions[0].description.isWellFormed(),true);
   return {ok:true,status:201,text:async()=>'',headers:new Headers()};
  });
  const res=result();await handler(req({tickets:[ticket]}),res);
  assert.equal(res.statusCode,200);assert.equal(res.body.normalizedUnicodeStrings,2);
  assert.equal(saved.data.subject,'Texto \uFFFD');assert.equal(ticket.subject,'Texto '+broken);
  assert.equal(ticket.actions[0].description,broken+' fim');
  assert.doesNotMatch(JSON.stringify(warnings),/Texto|bearer-unit-test|test-private-server-key/);
 }finally{console.warn=warn;}
});
test('valid emoji, accents and literal escape text remain unchanged',async()=>{
 const ticket={id:101,subject:'Ação — João 😀',literal:'\\ud83d',nested:{text:'café'}};
 setFetch(async(_url,opts)=>{assert.deepEqual(JSON.parse(opts.body)[0].data,ticket);return {ok:true,status:201,text:async()=>'',headers:new Headers()};});
 const res=result();await handler(req({tickets:[ticket]}),res);assert.equal(res.statusCode,200);assert.equal(res.body.normalizedUnicodeStrings,0);
});
test('malformed keys and identifiers fail before writing rather than changing identity',async()=>{
 let called=false;setFetch(async()=>{called=true;throw Error('Must not write');});
 for(const ticket of [{id:String.fromCharCode(0xD83D)},{id:100,[String.fromCharCode(0xD83D)]:1}]){
  const res=result();await handler(req({tickets:[ticket]}),res);assert.equal(res.statusCode,400);
 }
 assert.equal(called,false);
});
test('shared settings normalize incomplete Unicode without exposing or mutating settings',async()=>{
 const state={md_ia:'Nota '+String.fromCharCode(0xDC00),md_token:'do-not-send'},warn=console.warn;let saved;
 console.warn=()=>{};
 try{
  globalThis.fetch=async(url,opts)=>{
   if(String(url).includes('/auth/v1/user'))return {ok:true,json:async()=>({id:'test',email:'quality@example.com'})};
   saved=JSON.parse(opts.body)[0];return {ok:true,status:201,text:async()=>'',headers:new Headers()};
  };
  const res=result();await handler({...req({state}),query:{action:'saveState'}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.normalizedUnicodeStrings,1);assert.equal(saved.state.md_ia,'Nota \uFFFD');assert.equal(saved.state.md_token,undefined);assert.equal(state.md_ia.isWellFormed(),false);
 }finally{console.warn=warn;}
});
