import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateImportedTriage} from './triage-adapter.mjs';
const now='2026-11-26T14:00:00Z';
const current={ticket_id:'1',payload:{ownerTeam:'Inteligência',status:'Em Análise',subject:'Exemplo'}};
const stored={source_synced_at:'2026-11-26T13:00:00Z',payload:{ownerHistories:[{changedDate:'2026-11-05T12:00:00',ownerTeam:null},{changedDate:'2026-11-18T12:00:00',ownerTeam:'Inteligência'}],statusHistories:[{changedDate:'2026-11-18T13:00:00',status:'Em Análise'}]}};
test('normalizes nullable former team and UTC Movidesk timestamps',()=>{
 const r=evaluateImportedTriage(current,stored,{now,holidays:['2026-11-20']});
 assert.equal(r.eligible,true);assert.equal(r.businessDays,5);assert.equal(r.enteredDate,'2026-11-18');
});
test('UTC midnight is converted to the previous Brazilian calendar date',()=>{
 const r=evaluateImportedTriage(current,{...stored,payload:{ownerHistories:[{changedDate:'2026-11-19T01:00:00',ownerTeam:'Inteligência'}],statusHistories:[{changedDate:'2026-11-19T01:30:00',status:'Em Análise'}]}},{now,holidays:['2026-11-20']});
 assert.equal(r.enteredDate,'2026-11-18');assert.equal(r.businessDays,5);
});
test('missing stored record stays in review',()=>assert.equal(evaluateImportedTriage(current,undefined,{now}).eligible,false));
test('confirmed threshold is applied',()=>assert.equal(evaluateImportedTriage(current,stored,{now,threshold:10}).reason,'below-threshold'));
test('stale historical data never becomes eligible',()=>assert.equal(evaluateImportedTriage(current,{...stored,source_synced_at:'2026-11-01T00:00:00Z'},{now}).reason,'stale-history'));
