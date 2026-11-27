import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRobotTicket} from './robot-evaluate.mjs';
const ticket={id:123,ownerTeam:'Suporte',status:'Aguardando cliente',owner:{id:'1',businessName:'Maria Silva'},ownerHistories:[{ownerTeam:'Suporte',changedDate:'2026-11-19T12:00:00Z'}],slaSolutionDate:null,actions:[{timeAppointments:[{date:'2026-11-24',workTime:'00:30:00',createdBy:{id:'1'}}]}]};
const context={now:'2026-11-27T15:00:00Z',syncedAt:'2026-11-27T12:00:00Z',today:'2026-11-27',opened:'2026-11-19',records:[{id:'1',date:'2026-11-26',kind:'robot'}],appointmentHistoryComplete:true,recordCoverage:true,deadlineCoverage:true,waitingConfirmed:true,waitingSince:'2026-11-19',historyComplete:true,holidays:['2026-11-20'],thresholds:{Suporte:3}};
test('combines queue, missing human records and customer follow-up into a single internal plan',()=>{
 const {plan,review}=evaluateRobotTicket(ticket,context);
 assert.deepEqual(review,[]);
 assert.equal(plan.channel,'movidesk-internal');assert.equal(plan.simulated,true);
 assert.match(plan.text,/Olá, Maria!/);assert.match(plan.text,/fila do Suporte/);
 assert.match(plan.text,/não possui registro de acompanhamento/);
 assert.match(plan.text,/último apontamento foi realizado em 24\/11\/2026, há 3 dias úteis/);assert.match(plan.text,/previsão definida/);
 assert.equal(plan.text.match(/Ticket Manager/g).length,1);
});
test('blocked tickets and prior daily key prevent any plan',()=>{
 assert.equal(evaluateRobotTicket(ticket,{...context,blocked:true}).plan,null);
 assert.equal(evaluateRobotTicket(ticket,{...context,existingKeys:['robot-note:123:2026-11-27']}).plan,null);
});
test('unconfirmed evidence is reviewed rather than asserted',()=>{
 const {plan,review}=evaluateRobotTicket(ticket,{...context,recordCoverage:false,deadlineCoverage:false,historyComplete:false});
 assert.equal(plan,null);assert.deepEqual(review,['unconfirmed-history','unconfirmed-deadline']);
});

test('recent appointment prevents appointment-based customer follow-up',()=>{
 const current={...ticket,slaSolutionDate:'2026-11-30T15:00:00Z',slaSolutionDateIsPaused:false,actions:[{timeAppointments:[{date:'2026-11-26',workTime:'00:30:00',createdBy:{id:'1'}}]}]};
 const result=evaluateRobotTicket(current,{...context,thresholds:{},records:[{id:'1',date:'2026-11-26',kind:'human-followup'}]});
 assert.equal(result.plan,null);
});
