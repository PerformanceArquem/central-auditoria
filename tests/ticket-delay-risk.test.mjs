import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildDelayHistory,calculateDelayRisk} from '../lib/ticket-delay-risk.mjs';
import {inspectTickets} from '../lib/ticket-inspection.mjs';
const now=Date.parse('2026-11-23T12:00:00Z');
const base={id:'100',owner:'Alan',ownerTeam:'Suporte',category:'Incidente',serviceFirstLevel:'Sistema',clients:[{businessName:'Ótica Teste'}],createdDate:'2026-11-01T12:00:00Z',slaSolutionDate:'2026-11-25T12:00:00Z',actions:[{createdDate:'2026-11-23T11:00:00Z',timeAppointments:[{date:'2026-11-23T10:00:00Z'}]}],ownerHistories:[{changedDate:'2026-11-22T12:00:00Z',ownerTeam:'Suporte',owner:'Alan'}]};
const component=(r,key)=>r.components.find(c=>c.key===key);
const risk=(ticket=base,options={})=>calculateDelayRisk(ticket,{now,...options});
const peers=()=>Array.from({length:5},(_,i)=>({...base,id:String(i+1),baseStatus:'Resolved',status:'Resolvido',resolvedIn:i<3?'2026-11-20T13:00:00Z':'2026-11-19T12:00:00Z',slaSolutionDate:'2026-11-20T12:00:00Z'}));
test('six bounded components total 100, with coverage separate from score',()=>{
 const r=risk(base,{history:buildDelayHistory(peers(),{now}),clientCriticality:{'Ótica Teste':'Alta'}});
 assert.equal(r.components.length,6);assert.equal(r.components.reduce((s,c)=>s+c.max,0),100);assert.equal(r.coverage,100);assert.equal(r.coverageLabel,'Alta');assert.ok(r.score>=0&&r.score<=100);
 assert.match(r.notice,/não é precisão estatística/);
});
test('approaching the deadline raises the deadline component; overdue is actual delay',()=>{
 const far=risk({...base,slaSolutionDate:'2026-12-10T12:00:00Z'}),near=risk({...base,slaSolutionDate:'2026-11-24T12:00:00Z'}),late=risk({...base,slaSolutionDate:'2026-11-22T12:00:00Z'});
 assert.ok(component(near,'deadline').points>component(far,'deadline').points);assert.ok(near.score>far.score);assert.equal(late.score,100);assert.equal(late.state,'Já vencido');
});
test('a recent action does not reset time since the last time appointment',()=>{
 const r=risk({...base,actions:[{createdDate:'2026-11-23T11:59:00Z',timeAppointments:[{date:'2026-11-01T12:00:00Z'}]}]});
 assert.equal(component(r,'appointment').value,22);assert.equal(component(r,'appointment').points,20);assert.equal(r.lastAppointmentAt,'2026-11-01T12:00:00.000Z');
});
test('unknown or future appointment dates are unavailable, never risk zero',()=>{
 for(const actions of [undefined,[{createdDate:'2026-11-01T12:00:00Z'}],[{timeAppointments:[{date:'invalid'}]}],[{timeAppointments:[{date:'2026-12-01T12:00:00Z'}]}]]){
  const r=risk({...base,actions});assert.equal(component(r,'appointment').available,false);assert.equal(component(r,'appointment').points,null);
 }
 const r=risk({...base,actions:[]});assert.equal(component(r,'appointment').value,22);assert.equal(r.lastAppointmentAt,null);assert.match(component(r,'appointment').basis,/desde a abertura/);
});
test('owner changes stay within a sector; return visits add to cumulative queue time',()=>{
 const r=risk({...base,ownerHistories:[{changedDate:'2026-11-01T12:00:00Z',ownerTeam:'Suporte',owner:'A'},{changedDate:'2026-11-05T12:00:00Z',ownerTeam:'Suporte',owner:'B'},{changedDate:'2026-11-10T12:00:00Z',ownerTeam:'Produção',owner:'C'},{changedDate:'2026-11-15T12:00:00Z',ownerTeam:'Suporte',owner:'D'}]});
 assert.equal(r.transfers,2);assert.equal(r.queueDays,17);assert.equal(component(r,'queue').points,10);
});
test('partial or inconsistent histories do not fabricate transfers or current queue time',()=>{
 for(const ownerHistories of [[],[{changedDate:'invalid',ownerTeam:'Suporte'}],[...base.ownerHistories,{changedDate:'2026-12-01T12:00:00Z',ownerTeam:'Suporte'}]]){
  const r=risk({...base,ownerHistories});assert.equal(r.transfers,null);assert.equal(r.queueDays,null);
 }
 assert.equal(risk({...base,ownerTeam:'Produção'}).queueDays,null);
});
test('similarity uses same sector/category/service and at least five unique concluded tickets',()=>{
 const history=buildDelayHistory([...peers(),...peers()],{now}),r=risk(base,{history});
 assert.equal(r.similarity.samples,5);assert.equal(r.similarity.late,3);assert.equal(r.similarity.lateRate,0.6);assert.equal(component(r,'similar').points,9);
 assert.equal(component(risk({...base,serviceFirstLevel:'Outro'},{history}),'similar').available,false);
 assert.equal(component(risk({...base,id:'1'},{history}),'similar').available,false);
 assert.equal(component(risk(base,{history:buildDelayHistory(peers().slice(0,4),{now})}),'similar').available,false);
});
test('cancelled, invalid, future and unclassified historical records are excluded',()=>{
 const records=[{...base,baseStatus:'Resolved',resolvedIn:'2026-11-20T12:00:00Z'},
 {...base,id:1,status:'Cancelado',baseStatus:'Resolved',resolvedIn:'2026-11-20T12:00:00Z'},
 {...base,id:2,baseStatus:'Resolved',resolvedIn:'2026-12-01T12:00:00Z'},
 {...base,id:3,baseStatus:'Resolved',resolvedIn:'2026-11-20T12:00:00Z',slaSolutionDate:null},
 {...base,id:4,baseStatus:'Resolved',resolvedIn:'2026-11-20T12:00:00Z',category:null}];
 assert.equal(risk(base,{history:buildDelayHistory(records,{now})}).similarity.samples,0);
});
test('client priority requires exact explicit match and uses highest priority among clients',()=>{
 assert.equal(component(risk(base),'client').available,false);
 assert.equal(component(risk(base,{clientCriticality:{'otica teste':'Crítica'}}),'client').points,10);
 assert.equal(component(risk(base,{clientCriticality:{'Ótica':'Crítica'}}),'client').available,false);
 const r=risk({...base,clients:[{id:'A'},{id:'B'}]},{clientCriticality:{A:'Baixa',B:'Alta'}});assert.equal(component(r,'client').points,7);
});
test('missing deadline yields indeterminate index and lower coverage instead of fabricated probability',()=>{
 const r=risk({...base,slaSolutionDate:null});assert.equal(r.score,null);assert.equal(r.band,'Indeterminada');assert.ok(r.coverage<100);assert.ok(r.missing.includes('Proximidade do vencimento'));
});
test('inspection includes the new index and alerts without including resolved peers as open tickets',()=>{
 const rows=inspectTickets([base,...peers()],{now,clientCriticality:{'Ótica Teste':'Alta'}});assert.equal(rows.length,1);assert.equal(rows[0].risk.similarity.samples,5);assert.equal(rows[0].score,rows[0].risk.score);assert.ok(rows[0].reasons.some(s=>s.includes('Histórico semelhante')));
});
test('a predictive alert requires a future valid deadline and at least 60 percent factor coverage',()=>{
 const elevated={...base,slaSolutionDate:'2026-11-24T12:00:00Z',actions:[{timeAppointments:[{date:'2026-11-01T12:00:00Z'}]}],ownerHistories:[{changedDate:'2026-11-01T12:00:00Z',ownerTeam:'Suporte'}]};
 const [full]=inspectTickets([elevated],{now,clientCriticality:{'Ótica Teste':'Crítica'}});assert.ok(full.findings.some(f=>f.code==='delay_risk'));
 const [limited]=inspectTickets([{id:8,slaSolutionDate:'2026-11-24T12:00:00Z'}],{now});assert.ok(!limited.findings.some(f=>f.code==='delay_risk'));assert.ok(!limited.evaluatedCodes.includes('delay_risk'));
 const [late]=inspectTickets([{...elevated,slaSolutionDate:'2026-11-20T12:00:00Z'}],{now});assert.ok(!late.findings.some(f=>f.code==='delay_risk'));assert.ok(late.findings.some(f=>f.code==='overdue'));
});
