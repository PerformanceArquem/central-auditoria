import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSectorTraceability,identifyTraceabilitySignals} from '../lib/sector-traceability.mjs';
const H=3600000;
const entry=(sector,start,end)=>({sector,at:start*H,until:end*H,hours:end-start});
test('aggregates observed hours and distinct tickets, not owner changes',()=>{
 const rows=[{id:'1',sector:'QA',queueDays:1,timeline:[entry('QA',0,2),entry('QA',2,3),entry('Produção',3,5),entry('QA',5,29)]},{id:'2',sector:'QA',timeline:[]}];
 const r=summarizeSectorTraceability(rows);
 assert.equal(r.total,2);assert.equal(r.missing,1);
 assert.equal(r.sectors[0].hours,27);assert.equal(r.sectors[0].tickets,1);
 assert.equal(r.sectors[0].currentHours,24);
 assert.equal(r.routes.reduce((a,b)=>a+b.count,0),2);
});
test('unknown sector and discontinuity do not fabricate transfers',()=>{
 const rows=[{sector:'QA',timeline:[entry('QA',0,2),entry('',2,3),entry('Suporte',3,4),entry('QA',6,8)]}];
 const r=summarizeSectorTraceability(rows);
 assert.equal(r.unknownHours,1);assert.equal(r.routes.length,0);
 assert.equal(identifyTraceabilitySignals(rows).length,0);
});
test('review signals distinguish prolonged residence, transfers and returns',()=>{
 const r=identifyTraceabilitySignals([{id:'1',sector:'QA',queueDays:7,timeline:[entry('QA',0,1),entry('Suporte',1,2),entry('QA',2,3),entry('Produção',3,4),entry('QA',4,172)]}]);
 assert.equal(r[0].hours,168);assert.equal(r[0].transfers,4);assert.equal(r[0].returns,2);assert.equal(r[0].signals.length,3);
 assert.throws(()=>identifyTraceabilitySignals([],{transferLimit:0}));
});
