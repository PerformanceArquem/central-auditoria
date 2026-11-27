import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeManagement} from '../lib/live-management-dashboard.mjs';
const now=Date.parse('2026-11-27T15:00:00Z'),day='2026-11-27';
const tickets=[
 {id:1,ownerTeam:'QA',status:'Aberto',createdDate:'2026-11-27T03:30:00Z',slaSolutionDate:'2026-11-26T12:00:00Z'},
 {id:2,ownerTeam:'QA',status:'Fechado',createdDate:'2026-11-26T12:00:00Z',closedIn:'2026-11-27T12:00:00Z'},
 {id:3,ownerTeam:'Suporte',status:'Fechado',createdDate:'2026-11-26T12:00:00Z',lastUpdate:'2026-11-27T12:00:00Z'},
 {id:4,ownerTeam:'Suporte',status:'Aberto',createdDate:'2026-11-27T02:30:00Z'},
 {id:5,ownerTeam:'QA',status:'Aberto',isDeleted:true,createdDate:'2026-11-27T12:00:00Z'}
];
const appointments=[{date:day,sector:'QA',owner_name:'A',hours:2},{date:day,sector:'Suporte',owner_name:'B',hours:1.5},{date:'2026-11-26',sector:'QA',owner_name:'A',hours:9}];
test('daily counts respect Brasilia date, confirmed closure and loaded backlog',()=>{
 const d=summarizeManagement({tickets,appointments,day,now});
 assert.equal(d.loaded,4);assert.equal(d.opened,1);assert.equal(d.closed,1);assert.equal(d.backlog,2);assert.equal(d.unknownClosure,1);
 assert.equal(d.hours,3.5);assert.equal(d.vipRisk,null);assert.equal(d.radar.overdue,1);
});
test('sector filter and appointment totals remain independent of historical ticket sector',()=>{
 const d=summarizeManagement({tickets,appointments,day,now,sector:'QA',vipKnown:true});
 assert.equal(d.loaded,2);assert.equal(d.backlog,1);assert.equal(d.closed,1);assert.equal(d.hours,2);assert.deepEqual(d.owners,[['A',2]]);assert.equal(d.vipRisk,0);
});
test('empty scope preserves unknown VIP coverage',()=>{
 const d=summarizeManagement({day,now,sector:'Inexistente'});
 assert.equal(d.loaded,0);assert.equal(d.backlog,0);assert.equal(d.vipRisk,null);
});
