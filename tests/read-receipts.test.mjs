import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const moduleUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const receiptsUrl=moduleUrl(stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/_shared/read-receipts.ts',import.meta.url),'utf8')));
const {receiptToken,hashReceiptToken,prepareReadReceipt,openSignalToken,openSignalContent}=await import(receiptsUrl);
const handler=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/audit-read-receipt/handler.ts',import.meta.url),'utf8')).replace("'../_shared/read-receipts.ts'",JSON.stringify(receiptsUrl));
const {handleReadReceipt}=await import(moduleUrl(handler));
const now=new Date('2026-11-18T15:00:00Z');
const token='a'.repeat(64);
function fixture(overrides={}){
  let writes=0;
  const row={dispatch_key:'test:report',recipient_name:'Destinatária demonstrativa',subject:'Relatório demonstrativo',period_from:'2026-11-17',period_to:'2026-11-17',expires_at:'2027-01-01T00:00:00Z',delivered_at:'2026-11-18T12:00:00Z',confirmed_at:null,...overrides};
  const db=async(path,init={})=>{
    if(init.method==='PATCH'){writes++;if(row.confirmed_at)return [];Object.assign(row,JSON.parse(init.body));return [{...row}];}
    return [{...row}];
  };
  const req=(action,other={})=>new Request('https://example.invalid/receipt',{method:'POST',headers:{Origin:'https://central-auditoria-iota.vercel.app'},body:JSON.stringify({action,token,...other})});
  return {row,db,req,writes:()=>writes};
}
test('inspection and link scanners never acknowledge; POST requires explicit acceptance',async()=>{
  const f=fixture();
  const get=await handleReadReceipt(new Request('https://example.invalid?token='+token),f.db,now);
  assert.equal(get.status,405);
  const inspect=await handleReadReceipt(f.req('inspect'),f.db,now);
  assert.equal((await inspect.json()).status,'pending');assert.equal(f.writes(),0);
  assert.equal((await handleReadReceipt(f.req('confirm'),f.db,now)).status,400);assert.equal(f.writes(),0);
});
test('explicit confirmation is idempotent and preserves the first timestamp',async()=>{
  const f=fixture();
  const first=await (await handleReadReceipt(f.req('confirm',{accepted:true}),f.db,now)).json();
  const again=await (await handleReadReceipt(f.req('confirm',{accepted:true}),f.db,new Date(now.getTime()+60000))).json();
  assert.equal(first.status,'confirmed');assert.equal(first.confirmedAt,now.toISOString());assert.equal(again.confirmedAt,first.confirmedAt);assert.equal(f.writes(),1);
});
test('expired, missing and unsent receipts cannot be confirmed',async()=>{
  const expired=fixture({expires_at:'2026-11-17T00:00:00Z'}),unsent=fixture({delivered_at:null});
  assert.equal((await handleReadReceipt(expired.req('confirm',{accepted:true}),expired.db,now)).status,410);
  assert.equal((await handleReadReceipt(unsent.req('confirm',{accepted:true}),unsent.db,now)).status,409);
  assert.equal((await handleReadReceipt(unsent.req('inspect'),async()=>[],now)).status,404);
  assert.equal(expired.writes()+unsent.writes(),0);
});
test('forbidden origins, malformed tokens and database failure are rejected without sensitive output',async()=>{
  const f=fixture();
  const bad=new Request('https://example.invalid',{method:'POST',headers:{Origin:'https://evil.invalid'},body:JSON.stringify({action:'confirm',token,accepted:true})});
  assert.equal((await handleReadReceipt(bad,f.db,now)).status,403);
  assert.equal((await handleReadReceipt(f.req('inspect',{token:'invalid'}),f.db,now)).status,400);
  const unavailable=await handleReadReceipt(f.req('inspect'),async()=>{throw Error('service-role-secret');},now);
  assert.equal(unavailable.status,503);assert.ok(!(await unavailable.text()).includes('service-role-secret'));
});
test('new emails disclose opening detection without including a reading confirmation',async()=>{
  const first=await receiptToken('test-secret','dispatch:1'),second=await receiptToken('test-secret','dispatch:2');
  assert.match(first,/^[a-f0-9]{64}$/);assert.notEqual(first,second);assert.notEqual(first,await hashReceiptToken(first));
  let row;let calls=0;
  const db=async(path,init={})=>{if(init.method==='POST'){calls++;if(row)return [];row=JSON.parse(init.body);return [row];}return [row];};
  const ctx={dispatchKey:'dispatch:1',recipientName:'Destinatário'};
  const a=await prepareReadReceipt(db,'test-secret',ctx,'sample@example.invalid','Relatório');
  const b=await prepareReadReceipt(db,'test-secret',ctx,'sample@example.invalid','Relatório');
  assert.equal(a.html,b.html);assert.equal(calls,2);assert.ok(!JSON.stringify(row).includes(first));assert.equal(row.token_hash,await hashReceiptToken(first));
  const open=await openSignalToken('test-secret',ctx.dispatchKey);
  assert.equal(row.open_token_hash,await hashReceiptToken(open));
  assert.match(a.html,/audit-open-signal\?t=/);
  assert.match(a.text,/abertura detectada/);
  for(const content of [a.html,a.text]){
    assert.doesNotMatch(content,/confirmação de leitura|confirmar .*leitura|confirmar-leitura\.html|data-arquem-read-receipt/i);
    assert.ok(!content.includes(first));
  }
});

test('scheduled email batches cannot dispatch before 09h in Sao Paulo',()=>{
  const source=readFileSync(new URL('../supabase/functions/audit-email-dispatch/index.ts',import.meta.url),'utf8');
  assert.match(source,/if\(batchGroup && localHour < 9\)/);
  assert.doesNotMatch(source,/localHour < \(batchGroup==='management'\?8:9\)/);
});

test('image-load token is independent of explicit confirmation and the message discloses tracking',async()=>{
  const secret='demo-key', key='test:dispatch-1';
  const confirm=await receiptToken(secret,key), open=await openSignalToken(secret,key);
  assert.match(open,/^[a-f0-9]{64}$/);
  assert.notEqual(open,confirm);
  assert.notEqual(open,await openSignalToken(secret,'test:dispatch-2'));
  const html=openSignalContent(open);
  assert.match(html,/audit-open-signal\?t=/);
  assert.match(html,/não comprova leitura/);
  assert.match(html,/imagem/);
});
test('open signal has no IP, location, user-agent or device fingerprint storage and does not confirm reading',()=>{
  const edge=readFileSync(new URL('../supabase/functions/audit-open-signal/index.ts',import.meta.url),'utf8');
  const migration=readFileSync(new URL('../ops/install-email-open-signal.sql',import.meta.url),'utf8');
  const source=readFileSync(new URL('../supabase/functions/_shared/read-receipts.ts',import.meta.url),'utf8');
  assert.match(edge,/first_opened_at=is.null/);
  assert.match(edge,/delivered_at=not.is.null/);
  assert.match(edge,/method:'PATCH'/);
  assert.doesNotMatch(edge,/confirmed_at/);
  assert.doesNotMatch(edge,/headers\.get\(['"]user-agent|x-forwarded-for/i);
  assert.match(migration,/first_opened_at timestamptz/);
  assert.match(source,/open_token_hash:openTokenHash/);
});

test('integration test emails also create unique automatic opening-tracking receipts without sending in preview',()=>{
 const source=readFileSync(new URL('../supabase/functions/audit-email-dispatch/index.ts',import.meta.url),'utf8');
 const shared=readFileSync(new URL('../supabase/functions/_shared/read-receipts.ts',import.meta.url),'utf8');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(source,/manual-integration-test:'\+crypto\.randomUUID\(\)/);
 assert.match(source,/recipientName:rows\[0\]\.name,source:'test'/);
 assert.match(source,/sendMail\(recipient,draft\.subject,draft\.text,draft\.html,undefined,false,/);
 assert.match(source,/source:'ticket_charge'/);
 assert.match(source,/manual-test:\$\{id\}/);
 assert.match(source,/false,receiptContext\(key,rec,from,to\)/);
 assert.match(shared,/\| 'ticket_charge' \| 'test'/);
 assert.match(html,/<th>Origem<\/th>/);
 assert.match(html,/source==='test'\?'Teste manual'/);
 assert.match(html,/source==='ticket_charge'\?'Cobrança manual'/);
 assert.doesNotMatch(html,/neq\('source','test'\)/);
});
