import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const controlSource=readFileSync(new URL('../supabase/functions/_shared/email-delivery-control.ts',import.meta.url),'utf8');
const {assertEmailDeliveryEnabled,emailDeliveryAdmin}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(controlSource)).toString('base64'));

test('pause, missing state and database failure all block delivery',async()=>{
  for(const db of [async()=>[{paused:true}],async()=>[],async()=>{throw Error('offline')}]){
    await assert.rejects(()=>assertEmailDeliveryEnabled(db));
  }
  await assert.doesNotReject(()=>assertEmailDeliveryEnabled(async()=>[{paused:false}]));
});
test('read state does not call the provider or mutate anything',async()=>{
  let writes=0;const db=async(_path,options)=>{if(options)writes++;return [{paused:true,revision:0}]};
  const result=await emailDeliveryAdmin({},new Request('https://test.local'),db,()=>'', 'https://test.local');
  assert.equal(result.paused,true);assert.equal(writes,0);
});
test('resume requires explicit confirmation and current revision',async()=>{
  const db=async()=>[{paused:true,revision:3}];
  await assert.rejects(()=>emailDeliveryAdmin({paused:false,revision:3},new Request('https://test.local'),db,()=>'', ''),/Confirme/);
  await assert.rejects(()=>emailDeliveryAdmin({paused:false,revision:2,confirmResume:true},new Request('https://test.local'),db,()=>'', ''),/outro administrador/);
});
test('pause commits before contacting provider and survives provider failure',async()=>{
  const previous=globalThis.fetch;const calls=[];
  globalThis.fetch=async url=>{calls.push(String(url));if(String(url).includes('/auth/v1/user'))return Response.json({id:'admin'});throw Error('offline');};
  try{
    const db=async(path,options)=>{if(!options)return [{paused:false,revision:3}];calls.push('commit-pause');return {paused:true,revision:4};};
    const result=await emailDeliveryAdmin({paused:true,revision:3},new Request('https://test.local',{headers:{authorization:'Bearer admin-session'}}),db,n=>n==='SUPABASE_URL'?'https://db.test':'test', 'https://provider.test');
    assert.equal(result.paused,true);assert.ok(result.warning);assert.ok(calls.indexOf('commit-pause')<calls.indexOf('https://provider.test'));
  }finally{globalThis.fetch=previous;}
});
test('provider refusal never enables the database or schedules',async()=>{
  const previous=globalThis.fetch;let writes=0;
  globalThis.fetch=async url=>String(url).includes('/auth/v1/user')?Response.json({id:'admin'}):Response.json({sucesso:false});
  try{
    const db=async(_path,options)=>{if(options)writes++;return [{paused:true,revision:0}];};
    await assert.rejects(()=>emailDeliveryAdmin({paused:false,revision:0,confirmResume:true},new Request('https://test.local',{headers:{authorization:'Bearer admin-session'}}),db,()=> 'test','https://provider.test'));
    assert.equal(writes,0);
  }finally{globalThis.fetch=previous;}
});
test('both sender services and existing admin authorization enforce the switch',()=>{
  const main=readFileSync(new URL('../supabase/functions/audit-email-dispatch/index.ts',import.meta.url),'utf8');
  const triage=readFileSync(new URL('../supabase/functions/intelligence-triage-report/index.ts',import.meta.url),'utf8');
  const send=main.slice(main.indexOf('async function sendMail('),main.indexOf('async function isAdmin('));
  assert.equal((send.match(/await assertEmailDeliveryEnabled\(db\)/g)||[]).length,2);
  const route=main.slice(main.indexOf("if(action==='email_delivery_control')"));
  assert.ok(route.indexOf('isAdmin(req)')<route.indexOf('emailDeliveryAdmin('));
  assert.match(triage,/if\(action==='triage_send'\)await assertEmailDeliveryEnabled/);
});
test('switch stays disabled when status is unknown; cancelling resume makes no write',async()=>{
  const nodes=new Map();const node=()=>({checked:false,disabled:false,textContent:'',dataset:{},handlers:{},setAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;}});
  for(const id of ['emailDeliveryToggle','emailDeliveryStatus','emailDeliveryHint','emailDeliveryRefresh'])nodes.set(id,node());
  let interval,reads=0,writes=0;
  const ctx=vm.createContext({document:{getElementById:id=>nodes.get(id),querySelector:()=>node()},window:{addEventListener(){},confirm:()=>false},setInterval:fn=>{interval=fn;return 1},clearInterval(){}});
  vm.runInContext(readFileSync(new URL('../email-delivery-control.js',import.meta.url),'utf8'),ctx);
  assert.equal(nodes.get('emailDeliveryToggle').disabled,true);
  ctx.window.tmEmailAdminClient={functions:{invoke:async(_name,{body})=>{if(Object.hasOwn(body,'paused'))writes++;else reads++;return {data:{ok:true,paused:true,revision:0}};}}};
  interval();await new Promise(resolve=>setImmediate(resolve));
  const toggle=nodes.get('emailDeliveryToggle');assert.equal(toggle.checked,false);assert.equal(toggle.disabled,false);
  toggle.checked=true;await toggle.handlers.change();assert.equal(writes,0);assert.equal(toggle.checked,false);assert.equal(reads,1);
});
