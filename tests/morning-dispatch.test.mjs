import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const path='../supabase/functions/audit-email-dispatch/';
const code=stripTypeScriptTypes(readFileSync(new URL(path+'morning-policy.ts',import.meta.url),'utf8'));
const {morningWindow,planMorning,forecastOwners}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('08:57 inclusive, 10:00 exclusive in Brasilia, all late hours blocked',()=>{
 for(const [time,allowed] of [['08:56:59',false],['08:57:00',true],['09:59:59',true],['10:00:00',false],['18:00:00',false],['23:59:59',false]])assert.equal(morningWindow(new Date('2026-11-23T'+time+'-03:00')),allowed,time);
});
test('simulation preserves different subscriptions and blocks repeated keys and every recorded outcome',()=>{
 const task=id=>({r:{id},kind:'daily',from:'2026-11-19',to:'2026-11-22'});
 const input=[task('one'),task('one'),task('second-keila'),task('failed'),task('processing'),task('sent')];
 const registered=new Set(['failed','processing','sent'].map(id=>`${id}:daily:2026-11-19:2026-11-22`));
 const plan=planMorning(input,registered);
 assert.equal(plan.sent,false);assert.equal(plan.notificationsSent,0);assert.equal(plan.batches.flat().length,2);
 assert.deepEqual(plan.batches.flat().map(x=>x.recipientId),['one','second-keila']);
 assert.throws(()=>planMorning(input,registered,11));
});
test('bounded owner queries preserve every ID with no timeout retry',async()=>{
 const ids=Array.from({length:47},(_,i)=>String(i+1));let calls=0;
 const rows=await forecastOwners([...ids,'1'],async url=>{calls++;const group=url.match(/in\.\(([^)]+)\)/)[1].split(',');assert.ok(group.length<=20);return group.map(ticket_id=>({ticket_id}));});
 assert.equal(calls,3);assert.deepEqual(rows.map(r=>r.ticket_id),ids);
 let failures=0;await assert.rejects(forecastOwners(ids,async()=>{failures++;throw Error('timeout');}));assert.equal(failures,1);
 await assert.rejects(forecastOwners(['1)'],async()=>[]));
});
test('batch simulations cover all 29 reports in groups of at most eight',()=>{
 const tasks=Array.from({length:29},(_,id)=>({r:{id},kind:'weekly',from:'2026-11-16',to:'2026-11-22'}));
 assert.deepEqual(planMorning(tasks,new Set()).batches.map(b=>b.length),[8,8,8,5]);
});

test('scheduler guard blocks dispatch before dependencies and preserves preparation',async()=>{
 const source=readFileSync(new URL(path+'index.ts',import.meta.url),'utf8');
 const start=source.indexOf('async function handleRequest('),end=source.indexOf('\nDeno.serve(',start);
 const fn=stripTypeScriptTypes(source.slice(start,end));let calls=0;
 const deps={morningWindow:()=>false,E:()=> 'secret',json:(body,status=200)=>({body,status}),automaticDelivery:{run:(_value,fn)=>fn()},prepareReports:async()=>{calls++;return {prepared:true};},err:e=>e.message,RELEASE_ID:'test'};
 const handle=new Function(...Object.keys(deps),fn+';return handleRequest;')(...Object.values(deps));
 for(const action of ['dispatch','dispatch_noon_partial','dispatch_weekly_preliminary','failed_report_send']){
   const result=await handle(new Request('https://test.invalid',{method:'POST',headers:{'x-report-secret':'secret'},body:JSON.stringify({action})}));
   assert.equal(result.body.sent,false);assert.equal(calls,0);
 }
 assert.deepEqual(await handle(new Request('https://test.invalid',{method:'POST',headers:{'x-report-secret':'secret'},body:JSON.stringify({action:'prepare'})})),{prepared:true});
 assert.equal(calls,1);
});

test('Apps Script rechecks the window after generation and before provider acceptance',async()=>{
 const {runInNewContext}=await import('node:vm');
 const source=readFileSync(new URL('../apps-script/central-auditoria-emails-completo.gs',import.meta.url),'utf8');
 const doPost=source.slice(source.indexOf('function doPost('),source.indexOf('\nfunction resposta('));
 let sends=0;let minute=600;
 const context={console:{error:()=>{}},PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'secret'})},Utilities:{formatDate:(_d,_tz,part)=>String(part==='H'?Math.floor(minute/60):minute%60)},MailApp:{getRemainingDailyQuota:()=>100,sendEmail:()=>{sends++;}},resposta:x=>x};
 runInNewContext(doPost,context);
 const request=automaticDelivery=>({postData:{contents:JSON.stringify({token:'secret',email:'teste@arquem.com.br',assunto:'Teste',texto:'Somente simulado',automaticDelivery})}});
 assert.equal(context.doPost(request(true)).sucesso,false);assert.equal(sends,0);
 minute=537;assert.equal(context.doPost(request(true)).sucesso,true);assert.equal(sends,1);
 minute=700;assert.equal(context.doPost(request(false)).sucesso,true);assert.equal(sends,2);
});
