import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {readTriageHistories} from './triage-live-reader.mjs';
import {evaluateImportedTriage} from './triage-adapter.mjs';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/alert-center-triage-preview/index.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const payload=id=>({id,subject:'Fixture',ownerTeam:'Inteligência',status:'Em Análise',ownerHistories:[{changedDate:'2026-11-01T12:00:00',ownerTeam:'Inteligência'}],statusHistories:[{changedDate:'2026-11-01T12:00:00',status:'Em Análise'}]});
function createHandler({admin=true,individualStatus=200,liveOwner=null,importedRows=null}={}){
 let handler;const requests=[];
 const mockFetch=async(url,opts={})=>{
 requests.push({url:String(url),method:opts.method||'GET'});
 const parsed=new URL(url),name=parsed.pathname.split('/').pop();
 if(parsed.pathname.endsWith('/auth/v1/user'))return Response.json({id:'fixture'});
 if(name==='audit_users')return Response.json(admin?[{user_id:'fixture'}]:[]);
 if(name==='audit_email_holidays')return Response.json([]);
 if(name==='audit_reporting_tickets')return Response.json(importedRows??[1,2].map(id=>({ticket_id:String(id),payload:payload(id),source_synced_at:new Date(Date.now()-48*3600000).toISOString()})));
 if(parsed.hostname==='api.movidesk.com'){
 if(!parsed.searchParams.has('id'))return Response.json([]);
 return individualStatus===200?Response.json({...payload(Number(parsed.searchParams.get('id'))),owner:liveOwner}):new Response('',{status:individualStatus});
 }
 throw Error('Unexpected read');
 };
 vm.runInNewContext(source,{Deno:{env:{get:key=>({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',MOVIDESK_TOKEN:'fixture'}[key])},serve:h=>handler=h},Request,Response,URL,Headers,AbortSignal,fetch:mockFetch,evaluateImportedTriage,readTriageHistories:(ids,token)=>readTriageHistories(ids,token,mockFetch),console});
 return {handler,requests};
}
const request=(auth=true,extra={})=>new Request('https://fixture.functions.supabase.co/',{method:'POST',headers:{...(auth?{authorization:'Bearer fixture'}:{}),'content-type':'application/json'},body:JSON.stringify({mode:'read-only',refresh:true,threshold:3,...extra})});
test('authenticated individual fallback returns current rows without any writes',async()=>{
 const {handler,requests}=createHandler();const response=await handler(request());const result=await response.json();
 assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.directReads,2);
 assert.ok(result.rows.every(r=>r.source==='Movidesk · consulta direta'));assert.ok(requests.every(r=>r.method==='GET'));
});
test('404 and deferred individual calls remain distinct review reasons',async()=>{
 const {handler,requests}=createHandler({individualStatus:404});const response=await handler(request());const result=await response.json();
 assert.equal(response.status,200);assert.equal(result.rows[0].reason,'not-found-by-api');
 assert.equal(result.rows[1].reason,'not-returned-by-api');assert.ok(result.rows.every(r=>!r.eligible));
 assert.equal(requests.filter(r=>new URL(r.url).searchParams.has('id')).length,1);
});
test('unauthenticated request is rejected before any database read',async()=>{
 const {handler,requests}=createHandler();assert.equal((await handler(request(false))).status,401);assert.equal(requests.length,0);
});
test('non-admin request never reaches the Movidesk API',async()=>{
 const {handler,requests}=createHandler({admin:false});assert.equal((await handler(request())).status,403);
 assert.ok(requests.every(r=>new URL(r.url).hostname!=='api.movidesk.com'));
});

test('individual check only returns the selected triage ticket',async()=>{
 const {handler,requests}=createHandler();const response=await handler(request(true,{individualTicketId:'2'}));const result=await response.json();
 assert.equal(response.status,200);assert.equal(result.rows.length,1);assert.equal(result.rows[0].ticketId,'2');
 assert.ok(requests.filter(r=>new URL(r.url).hostname==='api.movidesk.com').every(r=>!new URL(r.url).searchParams.get('$filter')?.includes('id eq 1')));
});
test('individual check rejects tickets outside the authorized imported selection',async()=>{
 const {handler,requests}=createHandler();assert.equal((await handler(request(true,{individualTicketId:'99'}))).status,403);
 assert.ok(requests.every(r=>new URL(r.url).hostname!=='api.movidesk.com'));
});

test('direct consultation returns current owner identity without contact information',async()=>{
 const {handler,requests}=createHandler({liveOwner:{id:42,businessName:'Responsável atual',email:'private@example.test',phone:'41999999999'}});
 const response=await handler(request());const result=await response.json();
 assert.equal(response.status,200);assert.equal(result.rows.length,2);
 for(const row of result.rows){
 assert.equal(row.ownerId,'42');assert.equal(row.ownerName,'Responsável atual');assert.equal(row.sector,'Inteligência');
 assert.equal(row.source,'Movidesk · consulta direta');
 }
 const serialized=JSON.stringify(result);
 assert.ok(!serialized.includes('private@example.test'));assert.ok(!serialized.includes('41999999999'));
 assert.equal(result.deliveryEnabled,false);assert.ok(requests.every(r=>r.method==='GET'));
});
test('missing live owner remains explicit without inventing a recipient',async()=>{
 const {handler}=createHandler();const response=await handler(request());const result=await response.json();
 assert.equal(response.status,200);
 assert.ok(result.rows.every(row=>row.ownerId===null&&row.ownerName===null));
 assert.equal(result.deliveryEnabled,false);
});
test('invalid threshold is rejected before reading ticket data or Movidesk',async()=>{
 const {handler,requests}=createHandler();assert.equal((await handler(request(true,{threshold:0}))).status,400);
 assert.ok(requests.every(r=>!new URL(r.url).pathname.includes('audit_reporting')&&new URL(r.url).hostname!=='api.movidesk.com'));
});

test('triage selection and histories use one scoped reporting read',async()=>{
 const {handler,requests}=createHandler();const response=await handler(request(true,{refresh:false}));
 assert.equal(response.status,200);
 const reads=requests.filter(r=>new URL(r.url).pathname.endsWith('/audit_reporting_tickets'));
 assert.equal(reads.length,1);
 const params=new URL(reads[0].url).searchParams;
 assert.equal(params.get('payload->>ownerTeam'),'eq.Inteligência');
 assert.equal(params.get('payload->>status'),'eq.Em Análise');
 assert.equal(params.get('closed_at_source'),'is.null');
 assert.equal(params.get('limit'),'501');
 assert.ok(params.get('select').includes('source_synced_at'));
 assert.ok(requests.every(r=>!r.url.includes('audit_reporting_open_ticket_snapshot')));
});
test('closed cancelled and deleted source records never reach direct Movidesk reads',async()=>{
 const importedRows=[
 {ticket_id:'1',payload:{...payload(1),closedIn:'2026-11-01T12:00:00'}},
 {ticket_id:'2',payload:{...payload(2),canceledIn:'2026-11-01T12:00:00'}},
 {ticket_id:'3',payload:{...payload(3),isDeleted:true}},
 {ticket_id:'4',payload:payload(4),closed_at_source:'2026-11-01T12:00:00Z'}
 ];
 const {handler,requests}=createHandler({importedRows});
 const response=await handler(request(true,{refresh:false}));const result=await response.json();
 assert.equal(response.status,200);assert.equal(result.rows.length,0);
 assert.ok(requests.every(r=>new URL(r.url).hostname!=='api.movidesk.com'));
});
test('raw limit overflow remains incomplete even if lifecycle filtering could remove rows',async()=>{
 const importedRows=Array.from({length:501},(_,i)=>({ticket_id:String(i+1),payload:{...payload(i+1),isDeleted:true}}));
 const {handler,requests}=createHandler({importedRows});
 const response=await handler(request());assert.equal(response.status,409);
 assert.ok(requests.every(r=>new URL(r.url).hostname!=='api.movidesk.com'));
});

test('official origins can complete preflight without skipping authorization',async()=>{
 for(const origin of ['https://central-auditoria-iota.vercel.app','https://central-auditoria-arquem.vercel.app','https://centralauditoria.ddns.net','https://www.centralauditoria.ddns.net']){
 const {handler,requests}=createHandler();
 const preflight=await handler(new Request('https://fixture.functions.supabase.co/',{method:'OPTIONS',headers:{origin}}));
 assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 const response=await handler(new Request('https://fixture.functions.supabase.co/',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({mode:'read-only'})}));
 assert.equal(response.status,401);assert.equal(requests.length,0);
 }
});
test('unknown origins never receive CORS access',async()=>{
 for(const origin of ['https://example.test','https://central-auditoria-iota.vercel.app.example.test','null']){
 const {handler}=createHandler();const response=await handler(new Request('https://fixture.functions.supabase.co/',{method:'OPTIONS',headers:{origin}}));
 assert.equal(response.headers.get('access-control-allow-origin'),null);
 }
});
