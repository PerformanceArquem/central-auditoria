import test from 'node:test';
import assert from 'node:assert/strict';
import {expandedPlan} from './robot-expanded-plan.mjs';
const options={now:'2026-11-27T12:00:00Z',today:'2026-11-27',holidays:[],complete:true};
const action=(id,createdDate,description,profileType=1)=>({id,createdDate,description,type:1,createdBy:{id:'42',profileType},timeAppointments:[]});
const opening=action(1,'2026-11-23T12:00:00Z','Abertura');
const base={id:123,ownerTeam:'Suporte',owner:{id:'42',businessName:'Pessoa teste'},status:'Em atendimento',baseStatus:'InAttendance',createdDate:'2026-11-23T12:00:00Z',slaSolutionDate:null,actions:[opening]};
test('opening does not count as follow-up; 3 working days trigger no-record',()=>assert.deepEqual(expandedPlan(base,options)?.rules,['no-record']));
test('recent robot notes and customer replies do not reset staff follow-up',()=>assert.deepEqual(expandedPlan({...base,actions:[opening,action(2,'2026-11-24T12:00:00Z','Acompanhamento'),action(3,'2026-11-27T12:00:00Z','CENTRAL-ROBOT-NOTE:123:2026-11-27'),action(4,'2026-11-27T12:00:00Z','Retorno',2)]},options)?.rules,['idle-record']));
test('recent human update clears idle and no-record',()=>assert.equal(expandedPlan({...base,actions:[opening,action(2,'2026-11-27T12:00:00Z','Acompanhamento')]},options),null));
test('missing actor or initial action suppresses record rule',()=>{assert.equal(expandedPlan({...base,actions:[{...opening,id:2}]},options),null);assert.equal(expandedPlan({...base,actions:[opening,{...action(2,'2026-11-25T12:00:00Z','Acompanhamento'),createdBy:null}]},options),null)});
test('overdue and no-record are consolidated',()=>{const p=expandedPlan({...base,slaSolutionDate:'2026-11-26T12:00:00Z',slaSolutionDateIsPaused:false},options);assert.deepEqual(p?.rules,['no-record','overdue']);assert.equal(p?.text.match(/Mensagem automática autorizada/g)?.length,1)});
test('holiday and weekend excluded',()=>assert.equal(expandedPlan(base,{...options,holidays:['2026-11-24','2026-11-25']}),null));

test('aged queue uses last confirmed entry, not ticket opening',()=>{
 const t={...base,ownerHistories:[{changedDate:'2026-11-23T12:00:00Z',ownerTeam:'Implantação'},{changedDate:'2026-11-24T12:00:00Z',ownerTeam:'Suporte'}]};
 assert.ok(expandedPlan(t,options)?.rules.includes('aged-queue'));
 assert.ok(!expandedPlan({...t,ownerHistories:[...t.ownerHistories,{changedDate:'2026-11-27T12:00:00Z',ownerTeam:'Qualidade'}]},options)?.rules.includes('aged-queue'));
});
test('explicit null owner produces team note, absent owner does not',()=>{
 const p=expandedPlan({...base,owner:null},options);
 assert.ok(p?.rules.includes('unassigned'));assert.equal(p?.ownerId,null);assert.match(p.text,/não possui responsável definido/);
 assert.equal(expandedPlan({...base,owner:undefined},options),null);
});
test('preventive only for active SLA within 24 hours',()=>{
 const t={...base,slaSolutionDate:'2026-11-28T09:00:00-03:00',slaSolutionDateIsPaused:false};
 assert.ok(expandedPlan(t,options)?.rules.includes('preventive'));
 assert.ok(!expandedPlan({...t,slaSolutionDateIsPaused:true},options)?.rules.includes('preventive'));
 assert.ok(!expandedPlan({...t,slaSolutionDate:'2026-11-29T12:00:00Z'},options)?.rules.includes('preventive'));
});
test('overdue by 48 hours flags managerial review, not delivered manager notification',()=>{
 const p=expandedPlan({...base,slaSolutionDate:'2026-11-25T12:00:00Z',slaSolutionDateIsPaused:false},options);
 assert.equal(p?.escalationReview,true);assert.ok(!p.rules.includes('escalation'));
});
test('closed base status suppresses all rules even with misleading display status',()=>assert.equal(expandedPlan({...base,baseStatus:'Resolved',owner:null},options),null));
