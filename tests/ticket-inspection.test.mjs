import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectTickets,filterInspections,recordOccurrences} from '../lib/ticket-inspection.mjs';
const now=Date.parse('2026-11-23T12:00:00Z');
const ticket={id:1,status:'Em atendimento',ownerTeam:'Produção',subject:'Teste',clients:[{businessName:'Ótica'}],actions:[],slaSolutionDate:'2026-11-22T12:00:00Z'};
test('detects overdue, missing owner and appointments with explicit score',()=>{
 const [r]=inspectTickets([ticket],{now}); assert.equal(r.score,100);assert.equal(r.criticality,'Crítica');assert.deepEqual(r.findings.map(f=>f.code),['overdue','no_owner','no_appointments']);
});
test('omitted actions are unknown, not proof of missing appointments',()=>{
 const [r]=inspectTickets([{id:2,owner:{businessName:'Alan'}}],{now});assert.ok(!r.findings.some(f=>f.code==='no_appointments'));assert.ok(r.gaps.includes('Ações não carregadas'));assert.equal(r.queueDays,null);
});
test('closed, deleted and resolved tickets are excluded',()=>{
 assert.equal(inspectTickets([{...ticket,status:'Resolvido'},{...ticket,baseStatus:'Closed'},{...ticket,isDeleted:true},{ticket_id:3,closed_at_source:'2026-11-22',payload:ticket}],{now}).length,0);
});
test('chronological transfers include return visits and responsible changes',()=>{
 const [r]=inspectTickets([{...ticket,ownerHistories:[{changedDate:'2026-11-20T12:00:00',ownerTeam:'Produção',owner:{businessName:'B'}},{changedDate:'2026-11-10T12:00:00Z',ownerTeam:'Produção',owner:'A'},{changedDate:'2026-11-15T12:00:00Z',ownerTeam:'Inteligência',owner:'C'}]}],{now});
 assert.deepEqual(r.timeline.map(h=>h.hours),[120,120,72]);assert.equal(r.queueDays,3);assert.equal(r.timeline[2].owner,'B');
});
test('invalid and future histories do not fabricate queue residence',()=>{
 const [r]=inspectTickets([{...ticket,slaSolutionDate:'invalid',ownerHistories:[{changedDate:'invalid'},{changedDate:'2026-12-01',ownerTeam:'Produção'}]}],{now});assert.equal(r.queueDays,null);assert.equal(r.forecastKnown,false);assert.ok(r.findings.some(f=>f.code==='invalid_forecast'));
});
test('near deadline, stale action and missing appointments increase risk',()=>{
 const [r]=inspectTickets([{...ticket,owner:'Alan',slaSolutionDate:'2026-11-24T12:00:00Z',actions:[{createdDate:'2026-11-01T12:00:00Z'}]}],{now});assert.equal(r.score,80);assert.equal(r.criticality,'Crítica');assert.ok(r.findings.some(f=>f.code==='idle'));
});
test('filters combine sector client and criticality',()=>{
 const rows=inspectTickets([ticket],{now});assert.equal(filterInspections(rows,{sector:'Produção',client:'otica',criticality:'Crítica'}).length,1);assert.equal(filterInspections(rows,{sector:'Suporte'}).length,0);
});
test('history deduplicates active findings and records recurrence',()=>{
 const rows=inspectTickets([ticket],{now});const first=recordOccurrences([],rows,now);assert.equal(recordOccurrences(first,rows,now+1).length,first.length);
 assert.deepEqual(recordOccurrences(first,[],now+1),first);
 const ended=recordOccurrences(first,[{id:'1',findings:[]}],now+2);assert.ok(ended.every(e=>e.resolvedAt===now+2));assert.equal(recordOccurrences(ended,rows,now+3).length,first.length*2);
});
test('time appointment is distinct from a plain action',()=>{
 const [r]=inspectTickets([{...ticket,actions:[{timeAppointments:[{workTime:'01:00:00'}],createdDate:'2026-11-23T11:00:00Z'}]}],{now});assert.ok(!r.findings.some(f=>['idle','no_appointments'].includes(f.code)));
});
test('changing owner within a sector does not reset queue permanence',()=>{
 const [r]=inspectTickets([{...ticket,ownerHistories:[{changedDate:'2026-11-01T12:00:00Z',ownerTeam:'Produção',owner:'A'},{changedDate:'2026-11-22T12:00:00Z',ownerTeam:'Produção',owner:'B'}]}],{now});
 assert.equal(r.queueDays,22);assert.ok(r.findings.some(f=>f.code==='queue'));assert.equal(r.timeline.length,2);
});
test('unknown appointment coverage cannot close a previously observed occurrence',()=>{
 const first=recordOccurrences([],inspectTickets([ticket],{now}),now);
 const next=recordOccurrences(first,inspectTickets([{...ticket,actions:undefined}],{now}),now+1);
 assert.equal(next.find(e=>e.key==='1:no_appointments').resolvedAt,null);
});
test('missing deadline without other risk factors is indeterminate rather than low risk',()=>{
 const [r]=inspectTickets([{id:3,owner:'Alan',actions:[{createdDate:'2026-11-23T11:00:00Z',timeAppointments:[{workTime:'00:01:00'}]}]}],{now});
 assert.equal(r.score,0);assert.equal(r.criticality,'Indeterminada');assert.equal(r.forecastKnown,false);assert.equal(filterInspections([r],{criticality:'Indeterminada'}).length,1);
});
