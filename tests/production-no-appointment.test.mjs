import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const apiSource=readFileSync('api/audit-production-metrics.js','utf8')
  .replace('export default async function handler(req,res){','async function handler(req,res){');
const utcDay=(daysBefore)=>{
  const d=new Date();
  d.setUTCHours(12,0,0,0);
  d.setUTCDate(d.getUTCDate()-daysBefore);
  return d.toISOString().slice(0,10);
};
const ticket=(id,daysOld,status='Em andamento')=>({
  ticket_id:String(id),created_at_source:utcDay(daysOld),closed_at_source:null,
  last_update_source:utcDay(1),
  payload:{ownerTeam:'Produção - CPO',status,subject:'Fictício',owner:{name:'Teste'},
    createdDate:utcDay(daysOld)}
});
const tickets=[
  ticket(101,2),ticket(102,45),ticket(103,90),ticket(104,90),ticket(105,90,'Fechado'),ticket(106,45)
];
const appointments=[
  {appointment_key:'a1',ticket_id:'103',sector:'Produção - CPO',duration_minutes:30,
   appointment_date:utcDay(10),collaborator_name:'Teste'},
  {appointment_key:'a2',ticket_id:'104',sector:'Produção - CPO',duration_minutes:30,
   appointment_date:utcDay(40),collaborator_name:'Teste'},
  {appointment_key:'a3',ticket_id:'106',sector:'Produção - CPO',duration_minutes:30,
   appointment_date:utcDay(-7),collaborator_name:'Teste'}
];
let syncReady=true;
let syncAgeHours=1;
let syncPeriodEndDaysAgo=0;
let syncPeriodStartDaysAgo=370;
let historicalCompleted=true;
let adminAllowed=true;
const json=value=>({ok:true,json:async()=>value});
const fetch=async input=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/auth/v1/user'))return json({id:'user-123'});
  if(url.pathname.endsWith('/audit_users'))return json([{role:adminAllowed?'admin':'user',is_active:true}]);
  if(url.pathname.endsWith('/audit_direct_tickets'))return json(tickets);
  if(url.pathname.endsWith('/audit_direct_appointments'))return json(appointments);
  if(url.pathname.endsWith('/audit_direct_sync_state'))return json([{completed:historicalCompleted,last_error:null,processed_tickets:4722}]);
  if(url.pathname.endsWith('/audit_recent_reconcile_state'))return json([{completed:syncReady,
    last_error:syncReady?null:'Conciliação pendente',
    last_success_at:new Date(Date.now()-syncAgeHours*3600000).toISOString(),
    period_end:utcDay(syncPeriodEndDaysAgo),
    period_start:utcDay(syncPeriodStartDaysAgo)}]);
  throw Error('Unexpected URL '+url.pathname);
};
const scope={
  process:{env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test'}},
  fetch,URL,Date,Intl,Map,Set,Math,Number,String,Boolean,Object,Array,
  AbortController,setTimeout,clearTimeout,
};
vm.createContext(scope);
vm.runInContext(apiSource+'\nthis.__handler=handler;',scope);
const call=async (days,auth=true)=>{
  let response;
  const req={method:'GET',query:days===undefined?{}:{withoutAppointmentDays:days},
    headers:{authorization:auth?'Bearer fake':'none'}};
  const res={setHeader(){},status(code){response={code};return {
    json(body){response.body=body;return response;}
  }}};
  await scope.__handler(req,res);
  return response;
};
const ids=resp=>Array.from(resp.body.legacyAlerts.withoutAppointment,x=>x.id).sort();

test('30-day default excludes recent tickets and closed tickets, includes no history and stale appointments',async()=>{
  const response=await call(undefined);
  assert.equal(response.code,200);
  assert.equal(response.body.legacyAlerts.thresholdDays,30);
  assert.deepEqual(ids(response),['102','104','106']);
  assert.equal(response.body.legacyAlerts.counts.withoutAppointmentCount,3);
  const without=response.body.legacyAlerts.withoutAppointment.find(x=>x.id==='102');
  assert.equal(without.noAppointmentEver,true);
  assert.ok(without.daysWithoutAppointment>=40);
});

test('configurable threshold uses last appointment, not just ticket age',async()=>{
  const response=await call(7);
  assert.equal(response.code,200);
  assert.deepEqual(ids(response),['102','103','104','106']);
  assert.equal(response.body.legacyAlerts.thresholdDays,7);
});

test('invalid thresholds and unauthenticated access are rejected',async()=>{
  for(const bad of [0,366,'x','1.5',['7','30']]){
    const response=await call(bad);
    assert.equal(response.code,400);
  }
  assert.equal((await call(30,false)).code,401);
  adminAllowed=false;
  try{assert.equal((await call(30,true)).code,403);}
  finally{adminAllowed=true;}
});

test('the UI threshold triggers an authenticated, read-only API reload',()=>{
  const html=readFileSync('index.html','utf8');
  assert.ok(html.includes('id="pdNoAppointmentDays"'));
  assert.ok(html.includes("el('pdNoAppointmentDays').addEventListener('change',load)"));
  assert.ok(html.includes('/api/audit-production-metrics?withoutAppointmentDays='));
});

test('incomplete synchronization suppresses warnings rather than reporting zero or missing work',async()=>{
  syncReady=false;
  try{
    const response=await call(30);
    assert.equal(response.code,200);
    assert.equal(response.body.partial,true);
    assert.equal(response.body.legacyAlerts.coverageReady,false);
    assert.equal(response.body.legacyAlerts.counts.withoutAppointmentCount,null);
    assert.deepEqual(ids(response),[]);
  }finally{syncReady=true;}
});

test('UI refuses stale-appointment filter when synchronization is incomplete',()=>{
  const html=readFileSync('index.html','utf8');
  assert.ok(html.includes("legacy.coverageReady===true?lc.withoutAppointmentCount||0:'Conciliação pendente'"));
  assert.ok(html.includes("missingOption.disabled=legacy.coverageReady!==true"));
});

test('completed but stale reconciliation cannot issue missing-appointment alerts',async()=>{
  syncAgeHours=72;
  try{
    const response=await call(30);
    assert.equal(response.code,200);
    assert.equal(response.body.legacyAlerts.coverageReady,false);
    assert.equal(response.body.legacyAlerts.counts.withoutAppointmentCount,null);
    assert.deepEqual(ids(response),[]);
  }finally{syncAgeHours=1;}
});

test('completed reconciliation not covering previous day cannot issue alerts',async()=>{
  syncPeriodEndDaysAgo=5;
  try{
    const response=await call(30);
    assert.equal(response.code,200);
    assert.equal(response.body.legacyAlerts.coverageReady,false);
    assert.equal(response.body.legacyAlerts.counts.withoutAppointmentCount,null);
    assert.deepEqual(ids(response),[]);
  }finally{syncPeriodEndDaysAgo=0;}
});

test('a short recent synchronization window cannot confirm absence for 30 days',async()=>{
  syncPeriodStartDaysAgo=14;
  try{
    const response=await call(30);
    assert.equal(response.code,200);
    assert.equal(response.body.legacyAlerts.coverageReady,false);
    assert.equal(response.body.legacyAlerts.counts.withoutAppointmentCount,null);
    assert.equal(response.body.legacyAlerts.coverage.reason,'Janela conciliada menor que o prazo solicitado');
    assert.deepEqual(ids(response),[]);
  }finally{syncPeriodStartDaysAgo=370;}
});

test('the same 14-day window permits a shorter threshold, if complete and recent',async()=>{
  syncPeriodStartDaysAgo=14;
  try{
    const response=await call(7);
    assert.equal(response.code,200);
    assert.equal(response.body.legacyAlerts.coverageReady,true);
    assert.deepEqual(ids(response),['102','103','104','106']);
  }finally{syncPeriodStartDaysAgo=370;}
});

test('the panel explains when coverage is insufficient without exposing ticket details',async()=>{
  syncPeriodStartDaysAgo=14;
  try{
    const response=await call(30);
    const coverage=response.body.legacyAlerts.coverage;
    assert.equal(coverage.reason,'Janela conciliada menor que o prazo solicitado');
    assert.match(coverage.from,/^\d{4}-\d{2}-\d{2}$/);
    assert.match(coverage.to,/^\d{4}-\d{2}-\d{2}$/);
    const html=readFileSync('index.html','utf8');
    assert.ok(html.includes('id="pdCoverageNote"'));
    assert.ok(html.includes('Alerta suspenso:'));
    assert.ok(html.includes('ausência de lançamento não comprova falta de trabalho'));
  }finally{syncPeriodStartDaysAgo=370;}
});

test('historical import status is informational and cannot override insufficient recent reconciliation',async()=>{
  syncPeriodStartDaysAgo=14;
  historicalCompleted=true;
  try{
    const response=await call(30);
    assert.equal(response.code,200);
    assert.equal(response.body.legacyAlerts.historicalImport.jobCompleted,true);
    assert.equal(response.body.legacyAlerts.historicalImport.processedTickets,4722);
    assert.equal(response.body.legacyAlerts.historicalImport.completeCoverageVerified,false);
    assert.equal(response.body.legacyAlerts.coverageReady,false);
    assert.equal(response.body.legacyAlerts.counts.withoutAppointmentCount,null);
  }finally{syncPeriodStartDaysAgo=370;}
});

test('missing historical completion does not falsely claim certified historical coverage',async()=>{
  historicalCompleted=false;
  try{
    const response=await call(7);
    assert.equal(response.code,200);
    assert.equal(response.body.legacyAlerts.historicalImport.jobCompleted,false);
    assert.equal(response.body.legacyAlerts.historicalImport.completeCoverageVerified,false);
  }finally{historicalCompleted=true;}
});
