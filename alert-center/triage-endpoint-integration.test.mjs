import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {readTriageHistories} from './triage-live-reader.mjs';
import {evaluateImportedTriage} from './triage-adapter.mjs';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/alert-center-triage-preview/index.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const payload=id=>({id,subject:'Fixture',ownerTeam:'Inteligência',status:'Em Análise',ownerHistories:[{changedDate:'2026-11-01T12:00:00',ownerTeam:'Inteligência'}],statusHistories:[{changedDate:'2026-11-01T12:00:00',status:'Em Análise'}]});
function createHandler({admin=true,individualStatus=200}={}){
 let handler;const requests=[];
 const mockFetch=async(url,opts={})=>{
 requests.push({url:String(url),method:opts.method||'GET'});
 const parsed=new URL(url),name=parsed.pathname.split('/').pop();
 if(parsed.pathname.endsWith('/auth/v1/user'))return Response.json({id:'fixture'});
 if(name==='audit_users')return Response.json(admin?[{user_id:'fixture'}]:[]);
 if(name==='audit_reporting_open_ticket_snapshot')return Response.json([1,2].map(id=>({ticket_id:String(id),payload:payload(id),closed_at_source:null})));
 if(name==='audit_email_holidays')return Response.json([]);
 if(name==='audit_reporting_tickets')return Response.json([1,2].map(id=>({ticket_id:String(id),payload:payload(id),source_synced_at:new Date(Date.now()-48*3600000).toISOString()})));
 if(parsed.hostname==='api.movidesk.com'){
 if(!parsed.searchParams.has('id'))return Response.json([]);
 return individualStatus===200?Response.json(payload(Number(parsed.searchParams.get('id')))):new Response('',{status:individualStatus});
 }
 throw Error('Unexpected read');
 };
 vm.runInNewContext(source,{Deno:{env:{get:key=>({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',MOVIDESK_TOKEN:'fixture'}[key])},serve:h=>handler=h},Request,Response,URL,Headers,AbortSignal,fetch:mockFetch,evaluateImportedTriage,readTriageHistories:(ids,token)=>readTriageHistories(ids,token,mockFetch),console});
 return {handler,requests};
}
const request=(auth=true)=>new Request('https://fixture.functions.supabase.co/',{method:'POST',headers:{...(auth?{authorization:'Bearer fixture'}:{}),'content-type':'application/json'},body:JSON.stringify({mode:'read-only',refresh:true,threshold:3})});
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
