import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildProductionFlow,utc} from '../lib/production-flow.cjs';
const p=(id,name=id)=>({id,businessName:name});
const people=[{...p('P'),teams:['Produção - CPO']},{...p('Q'),teams:['Produção - CPO']},{...p('S'),teams:['Suporte']}];
const at=d=>'2026-11-'+d+'T12:00:00';
const owner=(d,team,id,by='S')=>({changedDate:at(d),ownerTeam:team,owner:p(id),changedBy:p(by)});
const status=(d,s,by)=>({changedDate:at(d),status:s,changedBy:p(by)});
const ticket=(id,owners,statuses,creator='S')=>({ticket_id:id,payload:{createdDate:at('01'),createdBy:p(creator),ownerTeam:owners.at(-1).ownerTeam,owner:owners.at(-1).owner,status:statuses.at(-1).status,ownerHistories:owners,statusHistories:statuses}});
const base=ticket('1',[owner('01','Suporte','S'),owner('02','Produção - CPO','P')],[status('01','Fila','S'),status('03','Resolvido','P'),status('04','Fechado','P')]);
const report=(rows,opts={})=>buildProductionFlow(rows,{from:'2026-11-01',to:'2026-11-30',people,...opts});
test('external ticket closed by production without return is one alert and one closure episode',()=>{const r=report([base]);assert.equal(r.summary.alerts,1);assert.equal(r.summary.closed,1);assert.equal(r.events.filter(e=>e.type==='closure').length,1);assert.equal(r.tickets[0].creator,'S');});
test('correct return to opener prevents alert; any other exit is not a return',()=>{
 const owners=[...base.payload.ownerHistories,owner('03','Suporte','S','P')];
 const r=report([ticket('2',owners,[status('01','Fila','S'),status('04','Fechado','S')])]);assert.equal(r.summary.returned,1);assert.equal(r.summary.alerts,0);assert.equal(r.summary.exited,1);
 const other=report([ticket('3',[...base.payload.ownerHistories,owner('03','Suporte','X','P')],[status('01','Fila','S'),status('04','Fechado','P')])]);assert.equal(other.summary.returned,0);assert.equal(other.summary.alerts,1);
});
test('own production ticket is included once and counted separately, even assigned outside production',()=>{const t=ticket('4',[owner('01','Suporte','S','P')],[status('01','Fila','P'),status('05','Fechado','P')],'P'),r=report([t]);assert.equal(r.summary.openedByProduction,1);assert.equal(r.summary.ownClosed,1);assert.equal(r.summary.samePersonClosed,1);assert.equal(r.summary.alerts,0);assert.equal(r.tickets.length,1);});
test('reentries are movements, not duplicate tickets; return before previous cycle does not excuse later close',()=>{
 const owners=[...base.payload.ownerHistories,owner('03','Suporte','S','P'),owner('04','Produção - CPO','P')];
 const r=report([ticket('5',owners,[status('01','Fila','S'),status('05','Fechado','P')])]);assert.equal(r.summary.entered,1);assert.equal(r.summary.entryMovements,2);assert.equal(r.summary.alerts,1);
});
test('reopen permits another closure episode, unique total stays one',()=>{const r=report([ticket('6',base.payload.ownerHistories,[status('01','Fila','S'),status('03','Resolvido','P'),status('04','Fila','S'),status('05','Fechado','P')])]);assert.equal(r.events.filter(e=>e.type==='closure').length,2);assert.equal(r.summary.closed,1);});
test('simultaneous return/closure is uncertain, not a confirmed allegation',()=>{const r=report([ticket('7',[...base.payload.ownerHistories,owner('03','Suporte','S','P')],[status('01','Fila','S'),status('03','Fechado','P')])]);assert.equal(r.summary.alerts,0);assert.equal(r.summary.review,1);});
test('historical leavers remain visible; period uses local UTC-3 calendar date',()=>{const t=ticket('8',[...base.payload.ownerHistories,owner('03','Suporte','S','P')],[status('01','Fila','S'),status('04','Fechado','S')]);const r=report([t]);assert.equal(r.summary.exited,1);assert.equal(r.tickets[0].currentTeam,'Suporte');const utcTicket=structuredClone(base);utcTicket.payload.ownerHistories[1].changedDate='2026-11-02T01:00:00.1234567';const local=report([utcTicket],{from:'2026-11-01',to:'2026-11-01'});assert.equal(local.summary.entered,1);assert.equal(utc('2026-11-02T01:00:00.1234567'),'2026-11-02T01:00:00.123Z');});
test('historical stock at period end ignores later closure',()=>{const r=report([base],{to:'2026-11-02'});assert.equal(r.summary.backlog,1);assert.equal(r.summary.closed,0);});
test('unknown actor stays uncertain and does not become a production closure allegation',()=>{const t=structuredClone(base);t.payload.statusHistories[1].changedBy={};const r=report([t]);assert.equal(r.summary.alerts,0);assert.equal(r.summary.review,1);});

