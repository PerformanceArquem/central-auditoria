import test from 'node:test';
import assert from 'node:assert/strict';
import {previewWaitingAppointment} from './robot-live-preview.mjs';
const ticket={id:123,ownerTeam:'Suporte',status:'Aguardando cliente',actions:[{timeAppointments:[{date:'2026-11-24',workTime:'00:30:00',createdBy:{id:'1'}}]}]};
const options={token:'mock',holidays:[],clock:()=>new Date('2026-11-27T15:00:00Z')};
const run=(t=ticket,extra={})=>previewWaitingAppointment('123',{...options,fetcher:async(url,o)=>{assert.equal(o.method,'GET');return {ok:true,json:async()=>t}},...extra});
test('third business day is eligible, with no writes',async()=>{
 const r=await run();assert.equal(r.eligible,true);assert.equal(r.businessDays,3);assert.equal(r.lastAppointmentDate,'2026-11-24');assert.equal(r.simulated,true);
});
test('holiday postpones eligibility',async()=>assert.equal((await run(ticket,{holidays:['2026-11-25']})).eligible,false));
test('blocked tickets do not contact provider',async()=>{
 const r=await run(ticket,{blocked:true,fetcher:async()=>assert.fail('unexpected request')});assert.equal(r.reason,'blocked-ticket');
});
test('closed, unrelated sector, or different status are excluded',async()=>{
 for(const patch of [{closedIn:'2026-11-27'},{ownerTeam:'Produção'},{status:'Em atendimento'}])assert.equal((await run({...ticket,...patch})).reason,'outside-scope');
});
test('unverified or missing appointments cannot generate eligible preview',async()=>{
 assert.equal((await run({...ticket,actions:[{}]})).eligible,false);
 assert.equal((await run({...ticket,actions:[]})).reason,'no-verified-appointment');
 assert.equal((await run({...ticket,id:456})).reason,'unconfirmed-ticket');
});

test('actual stopped scheduled status with customer justification triggers preview',async()=>{
 const r=await run({...ticket,status:'Agendado',baseStatus:'Stopped',justification:'Aguardando ação do cliente'});
 assert.equal(r.eligible,true);assert.equal(r.businessDays,3);
});
test('internal justification, other base status and unapproved sector remain excluded',async()=>{
 const waiting={...ticket,status:'Agendado',baseStatus:'Stopped',justification:'Aguardando ação do cliente'};
 for(const patch of [{justification:'Aguardando ação interna'},{baseStatus:'InAttendance'},{ownerTeam:'Produção - CPO'},{justification:null}])assert.equal((await run({...waiting,...patch})).reason,'outside-scope');
});
