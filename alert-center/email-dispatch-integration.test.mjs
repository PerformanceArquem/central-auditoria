import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import * as policy from './email-policy.mjs';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/alert-center-email-dispatch/index.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export function createAlertEmailHandler','function createAlertEmailHandler');
const NOW='2026-11-26T11:30:00Z';
const row=(id='1',sector='Inteligência')=>({ticket_id:id,source_synced_at:NOW,payload:{subject:'Fixture',ownerTeam:sector,status:'Em Análise',slaSolutionDate:'2026-11-24T11:30:00Z',slaSolutionDateIsPaused:false,createdDate:'2026-11-01T12:00:00Z'}});
function harness({paused=false,providerAccepts=true,time=NOW,rows=[row()],admin=true,enabled=true,blockedIds=[],reviewUnavailable=false}={}){
 let handler;let mailCalls=0;const requests=[],reservations=new Map();
 const recipients=policy.EMAIL_SECTORS.map((s,i)=>({id:s.recipientId,name:s.sector,email:'sector'+i+'@arquem.com.br',sectors:[s.sector],active:true,daily_enabled:true}));
 const settings=policy.EMAIL_SECTORS.map(s=>({sector:s.sector,recipient_id:s.recipientId,enabled}));
 const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-anon',REPORT_CRON_SECRET:'fixture-cron',GMAIL_WEBAPP_URL:'https://script.google.com/macros/s/fixture/exec',GMAIL_MAIL_SECRET:'fixture-mail'};
 const fetcher=async(url,options={})=>{
 const parsed=new URL(url),name=parsed.pathname.split('/').pop(),method=options.method||'GET';
 requests.push({url:String(url),method});
 if(parsed.hostname==='script.google.com'){if(JSON.parse(options.body).action==='capabilities')return Response.json({sucesso:true});mailCalls++;return Response.json({sucesso:providerAccepts});}
 if(parsed.pathname.endsWith('/auth/v1/user'))return Response.json({id:'fixture-user'});
 if(name==='audit_users')return Response.json(admin?[{user_id:'fixture-user'}]:[]);
 if(name==='audit_alert_email_settings')return Response.json(parsed.searchParams.has('sector')?settings.filter(s=>s.sector===parsed.searchParams.get('sector').slice(3)&&s.enabled):settings);
 if(name==='audit_email_recipients')return Response.json(parsed.searchParams.has('id')?recipients.filter(r=>r.id===parsed.searchParams.get('id').slice(3)):recipients);
 if(name==='audit_email_holidays')return Response.json([]);
 if(name==='audit_recent_reconcile_state')return Response.json([{completed:true,period_start:'2026-11-01',period_end:'2026-11-27',last_success_at:NOW,last_error:null}]);
 if(name==='audit_triage_lookup_review'){if(reviewUnavailable)return new Response('',{status:503});const ids=parsed.searchParams.get('ticket_id')?.slice(4,-1).split(',')||[];return Response.json(blockedIds.filter(id=>ids.includes(id)).map(ticket_id=>({ticket_id})));}
 if(name==='audit_alert_email_snapshot')return Response.json(rows);
 if(name==='audit_email_delivery_control')return Response.json([{paused,revision:1}]);
 if(name==='audit_alert_email_history'){
 if(method==='GET')return Response.json([...reservations.values()]);
 if(method==='POST'){
 const record=JSON.parse(options.body);
 if(reservations.has(record.dispatch_key))return Response.json([]);
 reservations.set(record.dispatch_key,record);return Response.json([{dispatch_key:record.dispatch_key}]);
 }
 if(method==='PATCH'){
 const key=parsed.searchParams.get('dispatch_key').slice(3);
 Object.assign(reservations.get(key),JSON.parse(options.body));return Response.json({});
 }
 }
 throw Error('Unexpected request');
 };
 const context={...policy,Deno:{env:{get:key=>env[key]},serve:h=>handler=h},URL,Request,Response,AbortSignal,fetch:fetcher,
 composeTicketCharge:(records,recipient,text,{subject})=>({subject,text,html:'<p>Fixture '+records.length+'</p>'}),
 assertEmailDeliveryEnabled:async db=>{const state=await db('audit_email_delivery_control?id=eq.true');if(state[0].paused)throw Error('Paused');}};
 vm.runInNewContext(source,context);
 handler=context.createAlertEmailHandler(fetcher,key=>env[key]||'',()=>new Date(time));
 const request=(action='dispatch',extra={},secret=true)=>new Request('https://fixture.supabase.co/functions/v1/alert-center-email-dispatch',{method:'POST',headers:{'content-type':'application/json',...(secret?{'x-report-secret':'fixture-cron'}:{}),authorization:'Bearer fixture-user'},body:JSON.stringify({action,sectorIndex:0,...extra})});
 return {handler,request,requests,reservations,settings,recipients,mails:()=>mailCalls};
}
test('preview renders six sectors without provider calls or write reservations',async()=>{
 const h=harness();const response=await h.handler(h.request('preview'));const data=await response.json();
 assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.bundles.length,6);assert.equal(data.sent,false);
 assert.equal(h.mails(),0);assert.equal(h.reservations.size,0);
 assert.ok(h.requests.every(r=>r.method==='GET'||r.url.endsWith('/rpc/audit_alert_email_snapshot')||r.url.startsWith('https://script.google.com/')));
});
test('scheduler credentials are mandatory even with an admin session',async()=>{
 const h=harness();assert.equal((await h.handler(h.request('dispatch',{},false))).status,403);
 assert.equal(h.requests.length,0);assert.equal(h.mails(),0);
});
test('non-admin preview is rejected before reading ticket data',async()=>{
 const h=harness({admin:false});assert.equal((await h.handler(h.request('preview',{},false))).status,403);
 assert.ok(h.requests.every(r=>!r.url.includes('snapshot')));
});
test('daily reservation prevents concurrent sends and subsequent reruns',async()=>{
 const h=harness();const responses=await Promise.all([h.handler(h.request()),h.handler(h.request())]);const results=await Promise.all(responses.map(r=>r.json()));
 assert.equal(h.mails(),1);assert.equal(results.filter(r=>r.sent===true).length,1);
 await h.handler(h.request());assert.equal(h.mails(),1);
 assert.equal([...h.reservations.values()][0].status,'sent');
});
test('global pause and per-sector disabled state block delivery',async()=>{
 for(const options of [{paused:true},{enabled:false}]){
 const h=harness(options);await h.handler(h.request());assert.equal(h.mails(),0);assert.equal(h.reservations.size,0);
 }
});
test('outside morning window never reserves or sends',async()=>{
 const h=harness({time:'2026-11-26T16:00:00Z'});const data=await (await h.handler(h.request())).json();
 assert.equal(data.sent,false);assert.equal(h.mails(),0);assert.equal(h.reservations.size,0);
});
test('unconfirmed provider result stays uncertain and never retries',async()=>{
 const h=harness({providerAccepts:false});assert.equal((await h.handler(h.request())).status,502);
 assert.equal([...h.reservations.values()][0].status,'uncertain');
 await h.handler(h.request());assert.equal(h.mails(),1);
});
test('mixed-sector source data reaches only the scheduled sector recipient',async()=>{
 const h=harness({rows:[row('1'),row('2','Sucesso do Cliente'),row('3','Suporte')]});
 const data=await (await h.handler(h.request())).json();
 assert.equal(data.sector,'Inteligência');assert.equal(data.ticketCount,1);
 assert.deepEqual([...h.reservations.values()][0].ticket_ids,['1']);
});
test('stale records are not sent and remain visible for review',async()=>{
 const h=harness({rows:[{...row(),source_synced_at:'2026-11-01T12:00:00Z'}]});
 const preview=await (await h.handler(h.request('preview'))).json();assert.equal(preview.bundles[0].reviewCount,1);
 const result=await (await h.handler(h.request())).json();assert.equal(result.empty,true);assert.equal(h.mails(),0);
});
test('recipient mapping divergence blocks provider calls',async()=>{
 const h=harness();h.settings[0].recipient_id=h.settings[1].recipient_id;
 assert.equal((await h.handler(h.request())).status,503);assert.equal(h.mails(),0);
});
test('CORS preflight has no body and only permits official origins',async()=>{
 const h=harness();const response=await h.handler(new Request('https://fixture/',{method:'OPTIONS',headers:{origin:'https://central-auditoria-iota.vercel.app'}}));
 assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),'https://central-auditoria-iota.vercel.app');assert.equal(await response.text(),'');
});

test('persistently blocked fresh ticket is excluded from preview and dispatch',async()=>{const h=harness({rows:[row('81901'),row('2')],blockedIds:['81901']});const preview=await (await h.handler(h.request('preview'))).json();assert.deepEqual(preview.bundles[0].ticketIds,['2']);await h.handler(h.request());assert.deepEqual([...h.reservations.values()][0].ticket_ids,['2']);});
test('unavailable review ledger prevents any send',async()=>{const h=harness({reviewUnavailable:true});assert.equal((await h.handler(h.request())).status,503);assert.equal(h.mails(),0);});
