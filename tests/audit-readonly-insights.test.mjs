import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import engine from '../lib/audit-readonly-insights.cjs';

const {evaluateAuditInsights,queueEntry,utc}=engine;
const NOW=Date.parse('2026-11-19T15:00:00Z');
function ticket(patch={}, rowPatch={}) {
 return {
  ticket_id:'10001',
  closed_at_source:null,
  source_synced_at:'2026-11-19T14:00:00Z',
  payload:{
   id:10001,subject:'Implantação de loja principal',
   ownerTeam:'Implantação',baseStatus:'InAttendance',status:'Em andamento',
   owner:{id:'owner-1',businessName:'Mariana'},slaSolutionDate:'2026-11-18T15:00:00Z',
   slaSolutionDateIsPaused:false,lastActionDate:'2026-11-10T15:00:00Z',
   clients:[{organization:{businessName:'Cliente fictício'}}],
   ownerHistories:[
    {ownerTeam:'Suporte',changedDate:'2026-11-01T12:00:00Z'},
    {ownerTeam:'Implantação',changedDate:'2026-11-15T12:00:00Z'}],
   ...patch
  },...rowPatch
 };
}
const appointment=(patch={})=>({
 ticket_id:'10001',collaborator_name:'Mariana',
 appointment_date:'2026-11-18',duration_minutes:45,activity:'Análise',...patch
});
const run=(t,a=[])=>evaluateAuditInsights(t,a,{now:NOW});

test('alert and queue use the verified current team entry, not the ticket creation',()=>{
 const data=run([ticket()]);
 assert.equal(data.notificationsSent,0);
 assert.equal(data.changesWritten,0);
 assert.equal(data.mode,'dry-run');
 assert.equal(data.alerts.total,2);
 assert.deepEqual(data.alerts.preview.map(x=>x.kind).sort(),['SEM_MOVIMENTACAO_7D','SLA_VENCIDO']);
 assert.equal(data.queues.teams[0].verifiedEntry,1);
 assert.equal(data.queues.teams[0].queueDaysAverage,4);
 assert.equal(data.queues.teams[0].overdue,1);
 assert.match(data.alerts.preview[0].messagePreview,/por gentileza/i);
});

test('queue time is unknown without appropriate owner history',()=>{
 const data=run([ticket({ownerHistories:[]})]);
 assert.equal(data.queues.withoutVerifiedEntry,1);
 assert.equal(data.queues.teams[0].queueDaysAverage,null);
 assert.equal(data.quality.preview[0].classification,'REVISÃO_HUMANA_OBRIGATÓRIA');
 assert(data.quality.preview[0].signals.some(s=>s.code==='HISTORICO_INDISPONIVEL'));
});

test('ticket re-entry into the same team resets verified queue age',()=>{
 const result=queueEntry([
  {ownerTeam:'Implantação',changedDate:'2026-11-01T00:00:00Z'},
  {ownerTeam:'Produção',changedDate:'2026-11-10T00:00:00Z'},
  {ownerTeam:'Implantação',changedDate:'2026-11-18T00:00:00Z'}
 ],'implantacao',NOW);
 assert.equal(new Date(result).toISOString(),'2026-11-18T00:00:00.000Z');
 assert.equal(utc('2026-11-18T00:00:00'),Date.parse('2026-11-18T00:00:00Z'));
});

test('closed or paused SLA never generates overdue alerts',()=>{
 const x=run([
  ticket({}, {ticket_id:'10001',closed_at_source:'2026-11-18T00:00:00Z'}),
  ticket({slaSolutionDateIsPaused:true},{ticket_id:'10002'}),
  ticket({baseStatus:'Resolved'},{ticket_id:'10003'})
 ]);
 assert.equal(x.coverage.openTickets,1);
 assert.equal(x.queues.teams[0].overdue,0);
 assert.equal(x.alerts.preview.some(a=>a.kind==='SLA_VENCIDO'),false);
});

test('preventive SLA is proposed only within 24h',()=>{
 const d=run([ticket({lastActionDate:'2026-11-19T13:00:00Z',
  slaSolutionDate:'2026-11-20T10:00:00Z'})]);
 assert.equal(d.alerts.total,1);
 assert.equal(d.alerts.preview[0].kind,'SLA_PREVENTIVO_24H');
});

test('quality detects evidence but never registers non-conformity or AI verdict',()=>{
 const d=run([ticket({
  subject:'ok',owner:null,ownerHistories:[],slaSolutionDate:null,lastActionDate:null,lastUpdate:null
 })]);
 assert.equal(d.quality.totalFlagged,1);
 const codes=d.quality.preview[0].signals.map(x=>x.code);
 assert(codes.includes('SEM_RESPONSAVEL'));
 assert(codes.includes('ASSUNTO_POUCO_DESCRITIVO'));
 assert(codes.includes('PRAZO_NAO_IDENTIFICADO'));
 assert.equal(d.quality.method,'regras_deterministicas_sem_ia');
});

test('productivity uses positive real appointment minutes, not SLA or ticket last action',()=>{
 const d=run([ticket()],[
  appointment(),
  appointment({ticket_id:'10002',duration_minutes:30,activity:'Atendimento'}),
  appointment({duration_minutes:0}),
  appointment({duration_minutes:-30}),
  appointment({duration_minutes:null}),
  appointment({duration_minutes:NaN}),
 ]);
 assert.equal(d.productivity.totalMinutes,75);
 assert.equal(d.productivity.validAppointments,2);
 assert.equal(d.productivity.invalidAppointments,4);
 assert.equal(d.productivity.collaborators[0].ticketCount,2);
 assert.equal(d.productivity.collaborators[0].hours,1.25);
 assert.deepEqual(d.productivity.collaborators[0].teams,['Implantação']);
});

test('duplicate ticket source rows are not double counted',()=>{
 const d=run([ticket(),ticket()]);
 assert.equal(d.coverage.uniqueTickets,1);
 assert.equal(d.alerts.total,2);
});

test('missing activity is identified instead of fabricated',()=>{
 const d=run([], [appointment({activity:''})]);
 assert.deepEqual(d.productivity.collaborators[0].activities,[{activity:'Não informada',minutes:45}]);
});

const route=readFileSync(new URL('../api/audit-readonly-insights.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../audit-readonly-insights-ui.js',import.meta.url),'utf8');
test('UI exposes four previews and no action to notify',()=>{
 for(const id of ['auditInsightsRun','auditInsightsAlerts','auditInsightsQueues',
   'auditInsightsQuality','auditInsightsProductivity','auditInsightsStatus'])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/audit-readonly-insights-ui\.js/);
 assert.match(ui,/method:'GET'/);
 assert.doesNotMatch(ui,/sendEmail|ticket_charge_send|movideskInternalAction/);
});
test('API allows GET only and uses authenticated Supabase admin ACL',()=>{
 assert.match(route,/req\.method!=='GET'/);
 assert.match(route,/audit_users/);
 assert.match(route,/is_active!==false/);
 assert.match(route,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.doesNotMatch(route,/method:\s*'(POST|PUT|PATCH|DELETE)'/);
 assert.match(route,/notificationsSent:0,changesWritten:0/);
});

test('API reads source data only, excludes session token and secret from its response',async()=>{
 const savedFetch=globalThis.fetch;
 const vars=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
 const old=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
 process.env.SUPABASE_URL='https://example.supabase.co';
 process.env.SUPABASE_SERVICE_ROLE_KEY='fake-private-key';
 try {
  const {default:handler}=await import('../api/audit-readonly-insights.js');
  const paths=[];
  globalThis.fetch=async (url,opts)=>{
   paths.push(String(url));
   assert.equal(opts.method,'GET');
   if(String(url).endsWith('/auth/v1/user'))
     return {ok:true,json:async()=>({id:'user-1'})};
   if(String(url).includes('/rest/v1/audit_users'))
     return {ok:true,json:async()=>[{role:'admin',is_active:true}]};
   if(String(url).includes('/rest/v1/audit_direct_tickets'))
     return {ok:true,json:async()=>[ticket()]};
   if(String(url).includes('/rest/v1/audit_direct_appointments'))
     return {ok:true,json:async()=>[appointment()]};
   throw Error('Unexpected request');
  };
  const res=()=>({statusCode:200,setHeader(){return this},status(code){this.statusCode=code;return this},
    json(body){this.body=body;return this},end(){return this}});
  const valid=res();
  await handler({method:'GET',headers:{authorization:'Bearer sample-session'}},valid);
  assert.equal(valid.statusCode,200);
  assert.equal(valid.body.notificationsSent,0);
  assert.equal(valid.body.changesWritten,0);
  assert.equal(valid.body.productivity.totalMinutes,45);
  assert.equal(paths.length,4);
  assert.doesNotMatch(JSON.stringify(valid.body),/sample-session|fake-private-key/);

  paths.length=0;
  const write=res();
  await handler({method:'POST',headers:{authorization:'Bearer sample-session'}},write);
  assert.equal(write.statusCode,405);
  assert.equal(paths.length,0);
 }finally{
  globalThis.fetch=savedFetch;
  for(const key of vars){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}
 }
});
