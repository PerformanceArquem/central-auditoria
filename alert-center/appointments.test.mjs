import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateAppointments} from './appointments.mjs';
const fixture={periodKey:'2026-11-24',kind:'daily',complete:true,enabledSectors:['intelligence','support'],roster:[{id:'a',sector:'intelligence',expectedMinutes:480},{id:'b',sector:'intelligence',expectedMinutes:240},{id:'c',sector:'support',expectedMinutes:480},{id:'d',sector:'production',expectedMinutes:480}],appointments:[{personId:'a',minutes:420,ticketId:1},{personId:'a',minutes:30,ticketId:1},{personId:'c',minutes:480,ticketId:2}]};
const run=(extra={})=>simulateAppointments({...fixture,...extra}).alerts;
test('individual recipients restricted to enabled sectors',()=>assert.deepEqual(run().filter(a=>a.recipientRole==='individual').map(a=>a.recipientId),['a','b','c']));
test('zero appointments included from roster',()=>assert.equal(run().find(a=>a.recipientId==='b').summary.missingMinutes,240));
test('distinct ticket count',()=>assert.equal(run().find(a=>a.recipientId==='a').summary.ticketCount,1));
test('manager summary restricted to intelligence',()=>{const s=run().find(a=>a.recipientRole==='intelligence-team-manager').summary;assert.equal(s.expectedMinutes,720);assert.equal(s.pointedMinutes,450);assert.equal(s.missingMinutes,270);assert.equal(s.coveragePercent,62.5);});
test('partial sends only team summary',()=>assert.deepEqual(run({kind:'partial'}).map(a=>a.recipientRole),['intelligence-team-manager']));
test('deduplication',()=>assert.equal(run({existingKeys:run().map(a=>a.key)}).length,0));
test('incomplete report blocked',()=>assert.throws(()=>run({complete:false})));
test('adjusted schedule required',()=>assert.throws(()=>run({roster:[{id:'a',sector:'intelligence'}]})));
test('all alerts simulated',()=>assert.ok(run().every(a=>a.simulated===true)));

test('explicit unknown target displays hours without deficit',()=>{const roster=fixture.roster.map(p=>p.id==='a'?{...p,expectedMinutes:null}:p);const s=run({roster}).find(a=>a.recipientId==='a').summary;assert.equal(s.pointedMinutes,450);assert.equal(s.missingMinutes,null);assert.equal(s.comparisonEnabled,false);});
test('mixed team targets never imply complete team coverage',()=>{const roster=fixture.roster.map(p=>p.id==='a'?{...p,expectedMinutes:null}:p);const s=run({roster}).find(a=>a.recipientRole==='intelligence-team-manager').summary;assert.equal(s.pointedMinutes,450);assert.equal(s.expectedMinutes,null);assert.equal(s.coveragePercent,null);assert.equal(s.comparableCount,1);assert.equal(s.comparableCoveragePercent,0);});
test('all unknown targets disable comparison',()=>{const roster=fixture.roster.map(p=>({...p,expectedMinutes:null}));const s=run({roster}).find(a=>a.recipientRole==='intelligence-team-manager').summary;assert.equal(s.comparableCount,0);assert.equal(s.comparableCoveragePercent,null);});
