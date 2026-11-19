import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import engine from '../lib/audit-productivity-comparisons.cjs';

const {analyzeProductivity,makeWindows,plusDays}=engine;
const TO='2026-11-18';
const ap=(date,minutes=60,changes={})=>({
  appointment_date:date,duration_minutes:minutes,ticket_id:'100',
  sector:'Produção',collaborator_name:'Mariana',activity:'Análise',...changes
});
const evaluate=(current,baseline,opts={})=>analyzeProductivity(current,baseline,{
  to:TO,days:28,comparison:'previous',holidays:new Set(['2026-11-02']),...opts
});

test('28-day comparison windows are complete and adjacent without overlap',()=>{
 const w=makeWindows('2026-11-18',28,'previous');
 assert.deepEqual(w.current,{from:'2026-10-22',to:'2026-11-18'});
 assert.deepEqual(w.baseline,{from:'2026-09-24',to:'2026-10-21'});
 assert.equal(w.days,28);
 assert.equal(w.sameNumberOfDays,true);
 assert.throws(()=>makeWindows('2026-11-18',30,'previous'),/inválidos/);
 assert.throws(()=>makeWindows('bad',28,'previous'),/inválidos/);
});
test('previous-year same dates and leap years retain equal day counts',()=>{
 const win=makeWindows('2026-11-18',28,'year-prior');
 assert.deepEqual(win.baseline,{from:'2025-10-22',to:'2025-11-18'});
 assert.equal(plusDays('2024-03-01',-1),'2024-02-29');
 const leap=makeWindows('2024-03-27',28,'year-prior');
 assert.deepEqual(leap.current,{from:'2024-02-29',to:'2024-03-27'});
 assert.deepEqual(leap.baseline,{from:'2023-02-28',to:'2023-03-27'});
});
test('sums only actual valid minutes, not forecast or ticket last action',()=>{
 const current=[
  ap('2026-11-18',60),ap('2026-11-17',30),
  ap('2026-11-15',120,{sector:'Suporte',collaborator_name:'Rafael',activity:'Atendimento'}),
  ap('2026-11-18',0),ap('2026-11-18',null),ap('2026-11-18',-1),
  ap('2026-11-18',''),ap('2026-11-18',1500),ap('2026-10-21',999)
 ];
 const prior=[ap('2026-10-20',60)];
 const r=evaluate(current,prior);
 assert.equal(r.totals.current.hours,3.5);
 assert.equal(r.totals.baseline.hours,1);
 assert.equal(r.totals.varianceHours,2.5);
 assert.equal(r.totals.variancePercent,250);
 assert.equal(r.totals.current.appointments,3);
 assert.equal(r.totals.current.uniqueTickets,1);
 assert.equal(r.coverage.invalid.current,6);
 assert.equal(r.notificationsSent,0);
 assert.equal(r.changesWritten,0);
 assert.equal(r.mode,'dry-run');
});
test('team, collaborator and activity groups derive from appointment fields',()=>{
 const data=evaluate([
  ap('2026-11-18',60),
  ap('2026-11-17',30),
  ap('2026-11-16',120,{sector:'Suporte',collaborator_name:'Rafael',activity:'Atendimento',ticket_id:'101'}),
  ap('2026-11-16',30,{sector:'suporte',collaborator_name:'RAFAEL',activity:'Atendimento',ticket_id:'102'})
 ],[ap('2026-10-20',90,{sector:'Produção'})]);
 assert.equal(data.byTeam.length,2);
 assert.equal(data.byTeam.find(x=>x.name==='Produção').currentHours,1.5);
 assert.equal(data.byTeam.find(x=>x.name.toLowerCase()==='suporte').currentHours,2.5);
 assert.equal(data.byCollaborator.length,2);
 assert.equal(data.byCollaborator.find(x=>x.name.toLowerCase()==='rafael').currentUniqueTickets,2);
 assert.equal(data.byActivity.find(x=>x.name==='Atendimento').currentHours,2.5);
 assert.equal(data.byCollaborator.find(x=>x.name==='Mariana').baselineHours,1.5);
});
test('baseline zero does not become misleading infinite improvement',()=>{
 const data=evaluate([ap('2026-11-18',60)],[]);
 assert.equal(data.totals.variancePercent,null);
 assert.equal(data.byTeam[0].variancePercent,null);
 assert.equal(data.weekly.length,4);
 assert.equal(data.weekly.reduce((sum,x)=>sum+x.hours,0),1);
});
test('weekend and registered-holiday minutes are separated and not double counted',()=>{
 const data=evaluate([
  ap('2026-11-14',120), // saturday
  ap('2026-11-15',60), // sunday
  ap('2026-11-02',30), // monday, registered holiday
  ap('2026-11-16',90)  // normal monday
 ],[]);
 assert.equal(data.totals.current.hours,5);
 assert.equal(data.totals.current.weekendHours,3);
 assert.equal(data.totals.current.registeredHolidayHours,.5);
 assert.equal(data.totals.current.otherWeekdayHours,1.5);
 assert.equal(data.totals.current.daysWithAppointments,4);
});
test('missing holiday calendar is disclosed, never assumed complete',()=>{
 const data=evaluate([ap('2026-11-02',60)],[],{holidays:null});
 assert.equal(data.totals.current.registeredHolidayHours,null);
 assert.equal(data.coverage.holidaysVerified,false);
 assert(data.warnings.some(x=>x.includes('Cadastro de feriados indisponível')));
});
test('capacity is unavailable instead of fabricated, and missing identities are not inferred',()=>{
 const data=evaluate([
  ap('2026-11-18',45,{sector:null,collaborator_name:'',activity:'',ticket_id:null})
 ],[]);
 assert.equal(data.capacity.configured,false);
 assert.equal(data.capacity.plannedHours,null);
 assert.equal(data.capacity.varianceToCapacityHours,null);
 assert.equal(data.capacity.occupancyPercent,null);
 assert.equal(data.coverage.missing.sector,1);
 assert.equal(data.coverage.missing.collaborator,1);
 assert.equal(data.coverage.missing.activity,1);
 assert.equal(data.coverage.missing.ticketId,1);
 assert.equal(data.totals.current.uniqueTickets,0);
 assert.equal(data.totals.current.appointments,1);
});
test('different periods are equal length with valid weeks',()=>{
 for(const days of [7,28,56,84]){
  const x=evaluate([],[],{days});
  assert.equal(x.weekly.length,days/7);
  assert.equal(x.period.days,days);
  assert.equal(x.totals.current.calendarDays,days);
  assert.equal(x.period.sameNumberOfDays,true);
 }
});
test('rejects invalid data and never generates negative or artificial totals',()=>{
 assert.throws(()=>analyzeProductivity({},[],{to:TO}),/listas/);
 const x=evaluate([ap('2026-11-18',NaN),ap('2026-11-18','abc'),ap('2026-11-18',-5)],[]);
 assert.equal(x.totals.current.hours,0);
 assert.equal(x.coverage.invalid.current,3);
});

const api=readFileSync(new URL('../api/audit-productivity-preview.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../audit-productivity-preview-ui.js',import.meta.url),'utf8');
test('UI includes all comparisons, capacity warning and manually triggered CSV only',()=>{
 for(const id of ['productivityPreviewPanel','productivityDays','productivityCompare',
  'productivityPreviewRun','productivityCsv','productivityTeamRows','productivityPersonRows',
  'productivityActivityRows','productivityWeekRows','productivityCapacity']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(html,/audit-productivity-preview-ui\.js/);
 assert.match(ui,/method:'GET'/);
 assert.match(ui,/exportProductivityCsv/);
 assert.match(ui,/Protege contra fórmulas/);
 assert.doesNotMatch(ui,/sendMail|ticket_charge_send|movideskInternalAction/);
});
test('GET endpoint is admin restricted and has no write methods',()=>{
 assert.match(api,/req\.method!=='GET'/);
 assert.match(api,/audit_users/);
 assert.match(api,/is_active!==false/);
 assert.match(api,/audit_direct_appointments/);
 assert.match(api,/audit_email_holidays/);
 assert.match(api,/notificationsSent:0,changesWritten:0/);
 assert.doesNotMatch(api,/method:\s*'(POST|PUT|PATCH|DELETE)'/);
});
test('mocked API reads and declines invalid actions without writes or secrets in response',async()=>{
 const savedFetch=globalThis.fetch;
 const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 process.env.SUPABASE_URL='https://example.supabase.co';
 process.env.SUPABASE_SERVICE_ROLE_KEY='private-mock-key';
 const r=()=>({statusCode:200,setHeader(){return this},
  status(n){this.statusCode=n;return this},json(x){this.body=x;return this},end(){return this}});
 try{
  const {default:handler}=await import('../api/audit-productivity-preview.js');
  const calls=[];
  globalThis.fetch=async(url,opts)=>{
   calls.push({url:String(url),method:opts.method});
   assert.equal(opts.method,'GET');
   if(String(url).endsWith('/auth/v1/user'))
    return {ok:true,json:async()=>({id:'fake-admin'})};
   if(String(url).includes('/rest/v1/audit_users'))
    return {ok:true,json:async()=>[{role:'admin',is_active:true}]};
   if(String(url).includes('/rest/v1/audit_direct_appointments')){
    const q=new URL(url).searchParams;
    assert(q.has('and'));
    assert.equal(q.get('limit'),'500');
    return {ok:true,json:async()=>[]};
   }
   if(String(url).includes('/rest/v1/audit_email_holidays'))
    return {ok:true,json:async()=>[{holiday_date:'2026-11-02'}]};
   throw Error('Unexpected request');
  };
  const ok=r();
  await handler({method:'GET',headers:{authorization:'Bearer user-test'},
    query:{days:'28',comparison:'previous'}},ok);
  assert.equal(ok.statusCode,200);
  assert.equal(ok.body.totals.current.hours,0);
  assert.equal(ok.body.capacity.varianceToCapacityHours,null);
  assert.equal(ok.body.notificationsSent,0);
  assert.equal(ok.body.changesWritten,0);
  assert.equal(calls.length,5);
  assert(calls.every(x=>x.method==='GET'));
  assert.doesNotMatch(JSON.stringify(ok.body),/private-mock-key|user-test/);

  calls.length=0;
  const post=r();
  await handler({method:'POST',headers:{authorization:'Bearer user-test'},query:{}},post);
  assert.equal(post.statusCode,405);
  assert.equal(calls.length,0);
  const invalid=r();
  await handler({method:'GET',headers:{authorization:'Bearer user-test'},query:{days:'999',comparison:'previous'}},invalid);
  assert.equal(invalid.statusCode,400);
  assert.equal(calls.length,0);
 }finally{
  globalThis.fetch=savedFetch;
  for(const key of keys){
    if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];
  }
 }
});
