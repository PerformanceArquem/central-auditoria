import test from 'node:test';
import assert from 'node:assert/strict';
import {robotDeadlineFacts} from './robot-deadline-facts.mjs';
const opts={now:'2026-11-27T15:00:00Z',deadlineCoverage:true,waitingConfirmed:true,maxFutureBusinessDays:10};
test('active overdue deadline is expressed in Brasilia local date',()=>{
 const r=robotDeadlineFacts({slaSolutionDate:'2026-11-25T01:00:00Z',slaSolutionDateIsPaused:false},opts);
 assert.equal(r.verified,true);assert.equal(r.facts.data_previsao_vencida,'2026-11-24');
});
test('missing deadline requires explicit field and waiting status',()=>{
 assert.equal(robotDeadlineFacts({slaSolutionDate:null},opts).facts.sem_previsao,true);
 assert.equal(robotDeadlineFacts({},opts).verified,false);
 assert.equal(robotDeadlineFacts({slaSolutionDate:null},{...opts,waitingConfirmed:false}).facts.sem_previsao,undefined);
});
test('distant forecast uses business days and configurable limit',()=>{
 const ticket={slaSolutionDate:'2026-12-18T15:00:00Z'};
 const r=robotDeadlineFacts(ticket,{...opts,holidays:['2026-12-04']});
 assert.equal(r.facts.dias_ate_previsao,14);assert.equal(r.facts.previsao_distante,true);
 assert.equal(robotDeadlineFacts(ticket,{...opts,maxFutureBusinessDays:15}).facts.previsao_distante,undefined);
});
test('paused or unconfirmed overdue SLA never generates a false claim',()=>{
 for(const paused of [true,undefined])assert.equal(robotDeadlineFacts({slaSolutionDate:'2026-11-25T15:00:00Z',slaSolutionDateIsPaused:paused},opts).verified,false);
 assert.equal(robotDeadlineFacts({slaSolutionDate:'invalid'},opts).verified,false);
 assert.equal(robotDeadlineFacts({slaSolutionDate:null},{...opts,deadlineCoverage:false}).verified,false);
});
