import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/alert-center-email-test/index.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export function testHandler','function testHandler');
function fixture({date='2026-11-26T17:00:00Z',paused=false,manualReady=true,accepted=true}={}){
 const history=[],packets=[],requests=[];let registered;
 const env={REPORT_CRON_SECRET:'fixture-cron',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',GMAIL_WEBAPP_URL:'https://script.google.com/macros/s/fixture/exec',GMAIL_MAIL_SECRET:'fixture-mail'};
 const fetcher=async(url,options={})=>{
 const name=new URL(url).pathname.split('/').pop(),method=options.method||'GET';requests.push({url:String(url),method});
 if(new URL(url).hostname==='script.google.com'){
 const packet=JSON.parse(options.body);packets.push(packet);
 return Response.json(packet.action==='triage_validate'?{sucesso:true,rows:1,sent:false,mailReady:true,manualReady,pdfBytes:5000,xlsxBytes:3000,files:[{name:'test.pdf'},{name:'test.xlsx'}]}:{sucesso:true,accepted,anexos:2,providerId:'fixture-provider'});
 }
 if(name==='audit_email_recipients')return Response.json([{id:'8f150a28-df5f-4c53-872f-ca753556d576',name:'Alan',email:'performance@arquem.com.br'}]);
 if(name==='audit_triage_snapshots')return Response.json([{id:'87204f29-a7ef-4336-88d5-2af60fd4b297',reference_date:'2026-11-25',sha256:'fixture',report:{date:'2026-11-25',items:[{id:'92070'}]}}]);
 if(name==='audit_email_sector_dispatches'){
 if(method==='GET')return Response.json(history);
 if(method==='POST'){if(history.length)return Response.json([]);history.push(JSON.parse(options.body));return Response.json([{dispatch_key:history[0].dispatch_key}]);}
 if(method==='PATCH'){Object.assign(history[0],JSON.parse(options.body));return Response.json({});}
 }
 throw Error('Unexpected request');
 };
 const context=vm.createContext({Deno:{env:{get:key=>env[key]},serve:handler=>registered=handler},Response,Request,URL,AbortSignal,TextEncoder,crypto:webcrypto,fetch:fetcher,
 triagePresentation:()=>({subject:'Original',text:'Triagem histórica',html:'<html><body><h1>Triagem histórica</h1></body></html>'}),
 assertEmailDeliveryEnabled:async()=>{if(paused)throw Error('Paused');}});
 vm.runInContext(source,context);
 const handler=context.testHandler(fetcher,key=>env[key]||'',()=>new Date(date));
 const request=(action='send',extra={},authorized=true)=>new Request('https://fixture/',{method:'POST',headers:{'content-type':'application/json',...(authorized?{'x-report-secret':'fixture-cron'}:{})},body:JSON.stringify({action,confirmed:true,...extra})});
 return {handler,request,history,packets,requests};
}
test('preview validates PDF and Excel without sending',async()=>{
 const h=fixture();const response=await h.handler(h.request('preview'));const data=await response.json();
 assert.equal(response.status,200);assert.equal(data.recipient,'performance@arquem.com.br');assert.equal(data.referenceDate,'2026-11-25');
 assert.equal(data.sent,false);assert.equal(data.attachmentCount,2);assert.equal(h.history.length,0);
 assert.deepEqual(h.packets.map(p=>p.action),['triage_validate']);
 assert.ok(data.html.includes('Base histórica de 25/11/2026'));
});
test('real test is restricted to Alan with two validated attachments and no CC',async()=>{
 const h=fixture();const response=await h.handler(h.request());const data=await response.json();
 assert.equal(response.status,200);assert.equal(data.providerAccepted,true);assert.equal(data.attachments,2);
 const send=h.packets.find(p=>p.action==='triage_send');assert.equal(send.email,'performance@arquem.com.br');assert.deepEqual(send.cc,[]);assert.equal(send.manual,true);
 assert.ok(send.dispatchKey.startsWith('intelligence-triage-manual:2026-11-25:performance@arquem.com.br:'));
 assert.equal(h.history[0].status,'sent');
});
test('repeat cannot send another message',async()=>{
 const h=fixture();await h.handler(h.request());const result=await (await h.handler(h.request())).json();
 assert.equal(result.duplicate,true);assert.equal(h.packets.filter(p=>p.action==='triage_send').length,1);
});
test('unconfirmed acceptance keeps reservation and prevents automatic retry',async()=>{
 const h=fixture({accepted:false});assert.equal((await h.handler(h.request())).status,502);
 assert.equal(h.history[0].status,'failed');await h.handler(h.request());
 assert.equal(h.packets.filter(p=>p.action==='triage_send').length,1);
});
test('unapproved recipient overrides and missing confirmation cannot send',async()=>{
 for(const extra of [{email:'other@arquem.com.br'},{cc:['other@arquem.com.br']},{recipientId:'other'},{confirmed:false}]){
 const h=fixture();assert.equal((await h.handler(h.request('send',extra))).status,400);assert.equal(h.packets.length,0);
 }
});
test('test expires after the explicit day and requires scheduler credentials',async()=>{
 const expired=fixture({date:'2026-11-27T12:00:00Z'});assert.equal((await expired.handler(expired.request())).status,410);assert.equal(expired.requests.length,0);
 const h=fixture();assert.equal((await h.handler(h.request('send',{},false))).status,403);assert.equal(h.requests.length,0);
});
test('global pause and missing manual attachment support block sending',async()=>{
 for(const options of [{paused:true},{manualReady:false}]){
 const h=fixture(options);assert.equal((await h.handler(h.request())).status,503);
 assert.equal(h.packets.filter(p=>p.action==='triage_send').length,0);assert.equal(h.history.length,0);
 }
});
