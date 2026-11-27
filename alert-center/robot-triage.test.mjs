import test from 'node:test';
import assert from 'node:assert/strict';
import {triageRobotSnapshot} from './robot-triage.mjs';
import {consolidateRobot,summarizeRobot} from './robot-dashboard.mjs';
const now='2026-11-27T12:00:00Z';
const base={ticketId:'1',sector:'Inteligência',ownerName:'Ana',subject:'Chamado',eligible:true,reason:'threshold-reached',businessDays:4,enteredDate:'2026-11-23',syncedAt:now};
const context={threshold:3,referenceTime:now,now};

test('adapter keeps only validated old triage and separates review, waiting and outside',()=>{
 const rows=[base,{...base,ticketId:'2',eligible:false,reason:'missing-history'},{...base,ticketId:'3',eligible:false,reason:'below-threshold',businessDays:1},{...base,ticketId:'4',eligible:false,reason:'outside-triage'}];
 const before=JSON.stringify(rows),snapshot=triageRobotSnapshot({...context,rows});
 assert.equal(snapshot.source,'triage-read-only');
 assert.deepEqual(snapshot.alerts,[{ticketId:'1',rule:'aged-triage'}]);
 assert.deepEqual(snapshot.review.map(r=>r.ticketId),['2']);
 assert.equal(snapshot.waiting,1);assert.equal(snapshot.outside,1);
 const result=consolidateRobot(snapshot);
 assert.deepEqual(summarizeRobot(result),{tickets:1,occurrences:1,review:1});
 assert.equal(result.find(r=>r.ticketId==='1').owner,'Ana');
 assert.equal(JSON.stringify(rows),before);
});

test('stale or future synchronization and malformed eligible histories become review',()=>{
 const invalid=[{syncedAt:'2026-11-25T12:00:00Z'},{syncedAt:'2026-11-28T12:00:00Z'},{enteredDate:'2026-02-30'},{businessDays:1},{eligible:false},{reason:'unrecognized'}];
 for(const change of invalid){
  const snapshot=triageRobotSnapshot({...context,rows:[{...base,...change}]});
  assert.equal(snapshot.alerts.length,0);assert.equal(snapshot.review.length,1);
 }
});

test('expired query, duplicate IDs, invalid threshold and invalid clock are rejected',()=>{
 for(const change of [{referenceTime:'2026-11-27T10:00:00Z'},{rows:[base,base]},{threshold:0},{now:'invalid'}])
  assert.throws(()=>triageRobotSnapshot({...context,rows:[base],...change}));
});

test('direct API outcomes remain the review reason even when imported history is stale',()=>{
 for(const reason of ['not-found-by-api','not-returned-by-api']) {
  const snapshot=triageRobotSnapshot({...context,rows:[{...base,eligible:false,reason,syncedAt:'2026-11-06T12:00:00Z'}]});
  assert.equal(snapshot.alerts.length,0);assert.equal(snapshot.review[0].reason,reason);
  const row=consolidateRobot(snapshot)[0];
  assert.equal(row.review,true);
  assert.equal(row.reason,reason==='not-found-by-api'?'Chamado não localizado pela API':'Consulta individual pendente');
 }
});
