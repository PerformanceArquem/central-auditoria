import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, businessDays } from './engine.mjs';
const context={now:'2026-11-25T11:30:00Z',localDate:'2026-11-25',holidays:['2026-11-20']};
const base={id:1,sector:'intelligence',closed:false,createdDate:'2026-11-25'};
const run=(tickets,extra={})=>simulate(tickets,{...context,...extra});
const rules=r=>r.alerts.map(a=>a.rule);
test('overdue and escalation at 48 hours',()=>assert.deepEqual(rules(run([{...base,dueAt:'2026-11-23T11:30:00Z'}])),['overdue','escalation']));
test('preventive at 24 hours',()=>assert.deepEqual(rules(run([{...base,dueAt:'2026-11-26T11:30:00Z'}])),['preventive']));
test('outside preventive window',()=>assert.deepEqual(rules(run([{...base,dueAt:'2026-11-26T11:31:00Z'}])),[]));
test('closed and other sectors ignored',()=>assert.equal(run([{...base,closed:true},{...base,sector:'production'}]).alerts.length,0));
test('weekends and holidays excluded',()=>assert.equal(businessDays('2026-11-19','2026-11-25',context.holidays),3));
test('idle for three business days',()=>assert.deepEqual(rules(run([{...base,lastAppointmentDate:'2026-11-19'}])),['idle']));
test('daily deduplication preserves active occurrence',()=>{const t={...base,dueAt:'2026-11-25T10:00:00Z'};const first=run([t]);const second=run([t],{existingKeys:first.alerts.map(a=>a.key)});assert.equal(second.alerts.length,0);assert.deepEqual(second.activeOccurrences,['1:overdue']);});
test('consolidates old triage tickets',()=>{const r=run([{...base,inTriage:true,triageEnteredDate:'2026-11-19'},{...base,id:2,inTriage:true,triageEnteredDate:'2026-11-02'}]);assert.equal(r.alerts.length,1);assert.equal(r.alerts[0].recipient,'production-manager');assert.deepEqual(r.alerts[0].tickets.map(t=>t.severity),['attention','critical']);});
test('regularized ticket no longer active',()=>assert.deepEqual(run([{...base,closed:true}]).activeOccurrences,[]));
test('simulation flag on all alerts',()=>assert.ok(run([{...base,dueAt:'2026-11-24T10:00:00Z'}]).alerts.every(a=>a.simulated)));
test('invalid clock rejected',()=>assert.throws(()=>simulate([],{now:'invalid',localDate:'2026-11-25'})));

test('duplicate snapshot rows appear once in triage summary',()=>{
  const ticket={...base,inTriage:true,triageEnteredDate:'2026-11-19'};
  const result=run([ticket,{...ticket,id:String(ticket.id)}]);
  assert.equal(result.alerts.length,1);
  assert.equal(result.alerts[0].tickets.length,1);
});
test('daily triage suppression preserves active occurrences',()=>{
  const ticket={...base,inTriage:true,triageEnteredDate:'2026-11-19'};
  const first=run([ticket]);
  const second=run([ticket],{existingKeys:first.alerts.map(a=>a.key)});
  assert.equal(second.alerts.length,0);
  assert.deepEqual(second.activeOccurrences,['1:aged-triage']);
});
test('configured thresholds are applied',()=>{
  const result=run([{...base,dueAt:'2026-11-24T11:30:00Z',lastAppointmentDate:'2026-11-19',inTriage:true,triageEnteredDate:'2026-11-19'}],{settings:{escalationHours:24,idleBusinessDays:4,triageBusinessDays:4}});
  assert.deepEqual(rules(result),['overdue','escalation']);
});
test('invalid thresholds fail before producing alerts',()=>{
  for(const name of ['preventiveHours','escalationHours','idleBusinessDays','triageBusinessDays']){
    for(const value of [0,-1,NaN,Infinity,null,'3',1.5]){
      assert.throws(()=>run([base],{settings:{[name]:value}}),/Invalid alert setting/);
    }
  }
});
