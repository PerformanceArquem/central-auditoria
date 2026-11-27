import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRobotOverview} from './robot-overview.mjs';
import {consolidateRobot,summarizeRobot} from './robot-dashboard.mjs';
const now='2026-11-27T12:00:00Z';
const record=(id,sector='Suporte',patch={})=>({ticket_id:String(id),source_synced_at:now,payload:{subject:'Exemplo',status:'Em atendimento',ownerTeam:sector,owner:{id:'1',businessName:'Pessoa A'},slaSolutionDate:'2026-11-25T12:00:00Z',slaSolutionDateIsPaused:false,...patch}});
test('overview spans three management groups and keeps subsetors independent',()=>{
 const snapshot=buildRobotOverview([record(1,'Suporte'),record(2,'Produção'),record(3,'Qualidade')],{now});
 const rows=consolidateRobot(snapshot);
 assert.deepEqual(new Set(rows.map(r=>r.group)),new Set(['Suporte','Produção','Inteligência']));
 assert.equal(rows.find(r=>r.ticketId==='3').sector,'Qualidade');
 assert.deepEqual(summarizeRobot(rows),{tickets:3,occurrences:6,review:0});
 assert.equal(snapshot.writeEnabled,false);assert.equal(snapshot.deliveryEnabled,false);
 assert.deepEqual(snapshot.suspendedRules,['idle','queue']);
});
test('stale, future and missing synchronization are review only',()=>{
 for(const sync of ['2026-11-20T12:00:00Z','2026-11-28T12:00:00Z',null]) {
  const snapshot=buildRobotOverview([{...record(1),source_synced_at:sync}],{now});
  assert.equal(snapshot.alerts.length,0);assert.equal(snapshot.review.length,1);
 }
});
test('paused or unknown SLA does not issue overdue while missing data remains explicit',()=>{
 for(const pause of [true,null,undefined])assert.equal(buildRobotOverview([record(1,'Suporte',{slaSolutionDateIsPaused:pause})],{now}).alerts.length,0);
 const result=buildRobotOverview([record(1,'Suporte',{slaSolutionDate:null,owner:null})],{now});
 assert.deepEqual(result.alerts.map(a=>a.rule),['no-forecast','owner-not-informed']);
 const idOnly=buildRobotOverview([record(2,'Suporte',{owner:{id:'7'},slaSolutionDate:null})],{now});
 assert.ok(!idOnly.alerts.some(a=>a.rule==='owner-not-informed'));
});
test('closed and deleted tickets are excluded and invalid deadline is review only',()=>{
 const source=[record(1,'Suporte',{closedIn:now}),record(2,'Suporte',{isDeleted:true}),record(3,'Suporte',{status:'Cancelado'}),record(4,'Suporte',{slaSolutionDate:'invalid'})];
 const result=buildRobotOverview(source,{now});
 assert.equal(result.excluded,3);assert.equal(result.alerts.length,0);assert.equal(result.review[0].reason,'invalid-forecast');
});
test('duplicate IDs, unsafe scope, out-of-scope records and overflow fail without partial results',()=>{
 for(const [records,options] of [[[record(1),record(1)],{now}],[[record(1)],{now,scope:'__proto__'}],[[record(1,'Suporte')],{now,scope:'production'}],[Array.from({length:1001},(_,i)=>record(i)),{now}]])assert.throws(()=>buildRobotOverview(records,options));
});
test('snapshot excludes private payload fields and does not mutate input',()=>{
 const source=record(1);source.payload.actions=[{description:'PRIVATE'}];source.payload.owner.email='private@example.com';
 const before=JSON.stringify(source),snapshot=buildRobotOverview([source],{now});
 assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE|private@example/);assert.equal(JSON.stringify(source),before);
});
