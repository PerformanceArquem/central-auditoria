import test from 'node:test';
import assert from 'node:assert/strict';
import {robotAppointmentEvidence} from './robot-appointment-evidence.mjs';
const opts={complete:true,today:'2026-11-27'};
const entry=(date,workTime='00:30:00')=>({date,workTime,createdBy:{id:'1'}});
const action=(...timeAppointments)=>({timeAppointments});
test('uses latest valid appointment rather than ticket update',()=>{
 const ticket={lastUpdate:'2026-11-27',actions:[action(entry('2026-11-24'),entry('2026-11-23')),action(entry('2026-11-26','00:00:00'))]};
 assert.deepEqual(robotAppointmentEvidence(ticket,opts),{appointmentCoverage:true,lastAppointmentDate:'2026-11-24'});
});
test('robot notes do not reset the appointment clock',()=>{
 const ticket={actions:[action(entry('2026-11-24')),{...action(entry('2026-11-27')),description:'CENTRAL-ROBOT-NOTE:123:2026-11-27'},{...action(entry('2026-11-26')),description:'CENTRAL-AUDITORIA-COBRANCA:1:123'}]};
 assert.equal(robotAppointmentEvidence(ticket,opts).lastAppointmentDate,'2026-11-24');
});
test('uses Sao Paulo date for timestamps',()=>{
 assert.equal(robotAppointmentEvidence({actions:[action(entry('2026-11-25T01:00:00Z'))]},opts).lastAppointmentDate,'2026-11-24');
});
test('incomplete or invalid evidence fails closed',()=>{
 for(const ticket of [{actions:[{}]},{actions:[action(entry('2026-11-28'))]},{actions:[action({date:'2026-11-24',workTime:'00:30:00'})]}])assert.equal(robotAppointmentEvidence(ticket,opts).appointmentCoverage,false);
 assert.equal(robotAppointmentEvidence({actions:[]},{...opts,complete:false}).appointmentCoverage,false);
 assert.deepEqual(robotAppointmentEvidence({actions:[]},opts),{appointmentCoverage:true,lastAppointmentDate:null});
});
