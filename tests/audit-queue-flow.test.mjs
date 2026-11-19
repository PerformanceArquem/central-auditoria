import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import flow from '../lib/audit-queue-flow.cjs';

const {analyzeQueueFlow,safeHistory,utc}=flow;
const NOW=Date.parse('2026-11-19T15:00:00Z');
const history=[
 {ownerTeam:'Suporte',changedDate:'2026-11-01T10:00:00Z'},
 {ownerTeam:'Inteligência',changedDate:'2026-11-08T10:00:00Z'},
 {ownerTeam:'Produção',changedDate:'2026-11-12T10:00:00Z'}
];
const ticket=(patch={},rowPatch={})=>({
 ticket_id:'101',closed_at_source:null,source_synced_at:'2026-11-19T14:00:00Z',
 payload:{
  id:101,subject:'Projeto fictício',
  ownerTeam:'Produção',owner:{id:'owner1',businessName:'Mariana'},
  baseStatus:'InAttendance',status:'Em andamento',
  lastActionDate:'2026-11-10T10:00:00Z',
  ownerHistories:history,
  ...patch
 },...rowPatch
});
const run=(rows,opts={})=>analyzeQueueFlow(rows,{now:NOW,...opts});

test('computes current team age from the last proven entry, not ticket creation',()=>{
 const a=run([ticket()]);
 assert.equal(a.mode,'dry-run');
 assert.equal(a.queue.teams[0].team,'Produção');
 assert.equal(a.queue.teams[0].verifiedQueueEntries,1);
 assert.equal(a.queue.teams[0].averageVerifiedQueueDays,7);
 assert.equal(a.queue.detailsPreview[0].currentQueueDays,7);
 assert.equal(a.queue.detailsPreview[0].daysWithoutRealAction,9);
 assert.equal(a.notificationsSent,0);
 assert.equal(a.changesWritten,0);
});
test('recognizes transfers only between two known, distinct teams; initial assignment not a transfer',()=>{
 const x=run([ticket()]);
 assert.equal(x.movements.total,2);
 assert.deepEqual(x.movements.routes.map(v=>[v.fromTeam,v.toTeam]),[
  ['Suporte','Inteligência'],['Inteligência','Produção']
 ]);
 assert.equal(x.movements.routes.every(v=>v.uniqueTickets===1),true);
 assert.equal(x.movements.recentPreview[0].priorQueueDays,4);
});
test('returning to a team resets the current queue age and preserves transition evidence',()=>{
 const h=[...history,{ownerTeam:'Suporte',changedDate:'2026-11-16T10:00:00Z'},
   {ownerTeam:'Produção',changedDate:'2026-11-18T10:00:00Z'}];
 const x=run([ticket({ownerHistories:h})]);
 assert.equal(x.queue.detailsPreview[0].currentQueueDays,1);
 assert.equal(x.movements.total,4);
 assert.equal(x.queue.teams[0].over15Days,0);
});
test('repeated owner assignments within the same team do not create fake transfers',()=>{
 const h=[
  {ownerTeam:'Suporte',changedDate:'2026-11-01T10:00:00Z'},
  {ownerTeam:'Suporte',changedDate:'2026-11-04T10:00:00Z'},
  {ownerTeam:'Produção',changedDate:'2026-11-12T10:00:00Z'}
 ];
 const x=run([ticket({ownerHistories:h})]);
 assert.equal(x.movements.total,1);
 assert.equal(x.movements.recentPreview[0].priorQueueDays,11,
   'Time in previous team starts at first entry, not the latest same-team reassignment');
});
test('closed tickets contribute verified historical transfers but not current backlog',()=>{
 const x=run([ticket({baseStatus:'Closed'},{
  closed_at_source:'2026-11-18T17:00:00Z'
 })]);
 assert.equal(x.coverage.openTicketsInSnapshot,0);
 assert.equal(x.coverage.closedTicketsInSnapshot,1);
 assert.equal(x.movements.total,2);
 assert.equal(x.queue.teams.length,0);
});
test('15-day queue warning only when entry is verified',()=>{
 const x=run([ticket({ownerHistories:[
  {ownerTeam:'Produção',changedDate:'2026-10-30T12:00:00Z'}
 ]})]);
 assert.equal(x.queue.teams[0].over15Days,1);
 assert.equal(x.queue.detailsPreview[0].managerReviewCandidate,true);
 assert.equal(x.queue.detailsPreview[0].sent,false);
});
test('incomplete/mismatched histories never infer queue age, time in other teams, or transfers',()=>{
 const x=run([
  ticket({ownerHistories:[]}),
  ticket({ownerHistories:history,ownerTeam:'Implantação'},{ticket_id:'102'}),
  ticket({ownerHistories:[{ownerTeam:'Suporte',changedDate:'invalid'}]},{ticket_id:'103'})
 ]);
 assert.equal(x.queue.detailsPreview.every(v=>v.currentQueueDays===null),true);
 assert.equal(x.queue.teams.every(v=>v.averageVerifiedQueueDays===null),true);
 assert.equal(x.coverage.incompleteHistories,2);
 assert.equal(x.discarded.EQUIPE_ATUAL_DIVERGE_DO_HISTORICO,1);
 // Verifiable historical transitions can still be counted for the mismatched current team.
 assert.equal(x.movements.total,2);
});
test('ambiguous simultaneous team transitions are rejected, never ordered by guess',()=>{
 const h=[
  {ownerTeam:'Suporte',changedDate:'2026-11-10T10:00:00Z'},
  {ownerTeam:'Produção',changedDate:'2026-11-10T10:00:00Z'}
 ];
 const x=run([ticket({ownerHistories:h})]);
 assert.equal(x.discarded.TRANSICAO_AMBIGUA,1);
 assert.equal(x.movements.total,0);
 assert.equal(x.queue.teams[0].unverifiableQueueAge,1);
 assert.equal(safeHistory(h,NOW).valid,false);
});
test('stale and duplicated records are disclosed, not silently included',()=>{
 const x=run([
  ticket(),ticket(),ticket({},{
    ticket_id:'102',source_synced_at:'2026-11-17T15:00:00Z'
  })
 ]);
 assert.equal(x.coverage.duplicateRecordsSkipped,1);
 assert.equal(x.coverage.staleRecordsSkipped,1);
 assert.equal(x.coverage.openTicketsInSnapshot,1);
 assert.equal(x.movements.total,2);
});
test('only events within 30 days are counted and no last-update fallback invents activity',()=>{
 const h=[
  {ownerTeam:'Suporte',changedDate:'2026-01-01T12:00:00Z'},
  {ownerTeam:'Produção',changedDate:'2026-01-05T12:00:00Z'},
  {ownerTeam:'Implantação',changedDate:'2026-11-18T12:00:00Z'}
 ];
 const x=run([ticket({ownerTeam:'Implantação',ownerHistories:h,
  lastActionDate:null,lastUpdate:'2026-11-19T12:00:00Z'
 })]);
 assert.equal(x.movements.total,1);
 assert.equal(x.queue.detailsPreview[0].daysWithoutRealAction,null);
 assert.equal(utc('2026-11-18T10:00:00'),Date.parse('2026-11-18T10:00:00Z'));
});
test('malformed inputs do not produce invented figures',()=>{
 assert.throws(()=>run(null),/Lista de chamados/);
 assert.throws(()=>run([],{now:NaN}),/Horário inválido/);
 const x=run([{payload:null,source_synced_at:null}]);
 assert.equal(x.queue.teams.length,0);
 assert.equal(x.movements.total,0);
});

const api=readFileSync(new URL('../api/audit-queue-flow-preview.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../audit-queue-flow-ui.js',import.meta.url),'utf8');
test('dashboard includes queue and transfer views without sending controls',()=>{
 for(const id of ['queueFlowPreviewPanel','queueFlowPreviewRun','queueFlowPreviewMetrics',
  'queueFlowPreviewStatus','queueFlowTeamRows','queueFlowRouteRows','queueFlowOldestRows'])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/audit-queue-flow-ui\.js/);
 assert.match(ui,/method:'GET'/);
 assert.doesNotMatch(ui,/sendEmail|ticket_charge_send|registerInternalNote|movideskInternalAction/);
});
test('API is admin-restricted, GET-only and never uses write methods',()=>{
 assert.match(api,/req\.method!=='GET'/);
 assert.match(api,/audit_users/);
 assert.match(api,/is_active!==false/);
 assert.match(api,/notificationsSent:0,changesWritten:0/);
 assert.doesNotMatch(api,/method:\s*'(POST|PATCH|PUT|DELETE)'/);
});
test('fake API request reads authenticated snapshots; POST denied without network',async()=>{
 const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
 const env=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const originalFetch=globalThis.fetch;
 process.env.SUPABASE_URL='https://example.supabase.co';
 process.env.SUPABASE_SERVICE_ROLE_KEY='fake-server-key';
 const res=()=>({statusCode:200,setHeader(){return this},status(x){this.statusCode=x;return this},
   json(x){this.body=x;return this},end(){return this}});
 try{
  const {default:handler}=await import('../api/audit-queue-flow-preview.js');
  const calls=[];
  globalThis.fetch=async(url,opts)=>{
   calls.push({url:String(url),method:opts.method});
   assert.equal(opts.method,'GET');
   if(String(url).endsWith('/auth/v1/user'))
     return {ok:true,json:async()=>({id:'test-admin'})};
   if(String(url).includes('/rest/v1/audit_users'))
     return {ok:true,json:async()=>[{role:'admin',is_active:true}]};
   if(String(url).includes('/rest/v1/audit_direct_tickets'))
     return {ok:true,json:async()=>[ticket()]};
   throw Error('Unexpected request');
  };
  const allowed=res();
  await handler({method:'GET',headers:{authorization:'Bearer fake-user-token'}},allowed);
  assert.equal(allowed.statusCode,200);
  assert.equal(allowed.body.movements.total,2);
  assert.equal(allowed.body.notificationsSent,0);
  assert.equal(allowed.body.changesWritten,0);
  assert.equal(calls.length,3);
  assert.doesNotMatch(JSON.stringify(allowed.body),/fake-server-key|fake-user-token/);
  calls.length=0;
  const denied=res();
  await handler({method:'POST',headers:{authorization:'Bearer fake-user-token'}},denied);
  assert.equal(denied.statusCode,405);
  assert.equal(calls.length,0);
 }finally{
  globalThis.fetch=originalFetch;
  for(const key of keys){
   if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];
  }
 }
});
