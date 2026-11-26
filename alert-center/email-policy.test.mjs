import test from 'node:test';
import assert from 'node:assert/strict';
import {EMAIL_SECTORS,localClock,idleCoverageStart,inEmailWindow,sectorRecipient,evaluateEmailAlerts,alertBody,formatEmailDates} from './email-policy.mjs';
const now='2026-11-26T11:30:00Z';
const ticket=(id='1',extra={})=>({ticket_id:id,source_synced_at:now,payload:{subject:'Fixture',ownerTeam:'Inteligência',status:'Em Análise',createdDate:'2026-11-01T12:00:00Z',slaSolutionDate:'2026-11-24T11:30:00Z',slaSolutionDateIsPaused:false,...extra}});
test('only the six explicitly approved sectors are eligible',()=>{
 const rows=[...EMAIL_SECTORS.map((s,i)=>ticket(String(i+1),{ownerTeam:s.sector})),ticket('7',{ownerTeam:'Suporte'}),ticket('8',{ownerTeam:'Produção'})];
 assert.equal(evaluateEmailAlerts(rows,{now}).alerts.length,6);
});
test('SLA 24h prevention and 48h escalation use elapsed time',()=>{
 const result=evaluateEmailAlerts([ticket('1'),ticket('2',{slaSolutionDate:'2026-11-27T11:30:00Z'}),ticket('3',{slaSolutionDate:'2026-11-27T11:30:01Z'})],{now});
 assert.deepEqual(result.alerts.map(x=>x.rules),[['overdue','escalation'],['preventive']]);
});
test('closed deleted homologation and paused tickets do not issue SLA alerts',()=>{
 const rows=[ticket('1',{status:'Concluído'}),ticket('2',{closedIn:now}),ticket('3',{canceledIn:now}),ticket('4',{isDeleted:true}),ticket('5',{subject:' tm-homolog-001 '}),ticket('6',{slaSolutionDateIsPaused:true}),ticket('7',{slaSolutionDateIsPaused:null})];
 assert.equal(evaluateEmailAlerts(rows,{now}).alerts.length,0);
});
test('stale and future snapshots stay for review',()=>{
 const rows=[{...ticket('1'),source_synced_at:'2026-11-25T11:29:59Z'},{...ticket('2'),source_synced_at:'2026-11-26T11:31:00Z'}];
 const result=evaluateEmailAlerts(rows,{now});assert.equal(result.alerts.length,0);assert.equal(result.review.length,2);
});
test('idle requires reconciliation and counts real appointment dates',()=>{
 const row={...ticket('1',{slaSolutionDate:null}),last_real_appointment:{date:'2026-11-23',minutes:30}};
 assert.equal(evaluateEmailAlerts([row],{now}).alerts.length,0);
 assert.deepEqual(evaluateEmailAlerts([row],{now,appointmentCoverage:true}).alerts[0].rules,['idle']);
 row.last_real_appointment.date='2026-11-24';assert.equal(evaluateEmailAlerts([row],{now,appointmentCoverage:true}).alerts.length,0);
});
test('weekends and holidays extend the idle coverage window',()=>{
 assert.equal(idleCoverageStart('2026-11-23T11:30:00Z',['2026-11-20']),'2026-11-17');
 assert.equal(idleCoverageStart(now),'2026-11-23');
});
test('scheduled sending is restricted to the local morning window on business days',()=>{
 assert.equal(localClock(now).time,'08:30');assert.equal(inEmailWindow(now),true);
 for(const time of ['2026-11-26T11:29:00Z','2026-11-26T11:40:00Z','2026-11-28T11:30:00Z'])assert.equal(inEmailWindow(time),false);
 assert.equal(inEmailWindow(now,['2026-11-26']),false);
});
test('multi-sector recipient is restricted to the QA alert sector',()=>{
 const rec={id:EMAIL_SECTORS[3].recipientId,email:'qa@arquem.com.br',active:true,daily_enabled:true,sectors:['Sucesso do Cliente','Implantação','Testes (QA)']};
 assert.deepEqual(sectorRecipient('Testes (QA)',[rec]).sectors,['Testes (QA)']);
 assert.throws(()=>sectorRecipient('Produção',[rec]));
 assert.throws(()=>sectorRecipient('Testes (QA)',[{...rec,active:false}]));
 assert.throws(()=>sectorRecipient('Testes (QA)',[{...rec,email:'external@example.test'}]));
});
test('duplicate snapshots and overflow block the entire evaluation',()=>{
 assert.throws(()=>evaluateEmailAlerts([ticket(),ticket()],{now}));
 assert.throws(()=>evaluateEmailAlerts(Array.from({length:2001},(_,i)=>ticket(String(i+1))),{now}));
});
test('humanized email copy describes rules without inventing work',()=>{
 const rows=evaluateEmailAlerts([ticket()],{now}).alerts;
 const text=alertBody(rows,'Inteligência',now);
 assert.ok(text.includes('26/11/2026 às 08:30'));assert.ok(text.includes('Prazo vencido'));
 assert.ok(text.includes('não comprova ausência de trabalho'));assert.ok(!text.includes('2026-11-26T'));
});

test('owner objects without a name never reach the email renderer as objects',()=>{
 const records=[ticket('1',{owner:{id:null,businessName:null}}),ticket('2',{owner:{id:'123',businessName:null}})];
 const result=evaluateEmailAlerts(records,{now});
 assert.equal(result.alerts[0].payload.owner,null);
 assert.deepEqual(result.alerts[1].payload.owner,{businessName:'ID 123'});
});
test('email presentation uses Brazilian dates and preserves ticket links',()=>{
 const text=formatEmailDates('Último apontamento: 2026-11-18 · https://arquem.movidesk.com/Ticket/Edit/101360');
 assert.equal(text,'Último apontamento: 18/11/2026 · https://arquem.movidesk.com/Ticket/Edit/101360');
});
