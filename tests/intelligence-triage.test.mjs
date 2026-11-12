import test from 'node:test';
import assert from 'node:assert/strict';
import {triageRows,triageReport} from '../lib/intelligence-triage.js';
import {readFileSync} from 'node:fs';
const now=new Date('2026-11-12T20:00:00Z');
const base=(id,subject,changedDate,team='Inteligência',service='Triagem')=>({
 ticket_id:String(id),closed_at_source:null,source_synced_at:'2026-11-12T19:55:00Z',
 created_at_source:'2026-08-01T10:00:00Z',
 payload:{subject,ownerTeam:team,serviceFirstLevel:service,baseStatus:'InAttendance',
  status:'Em Análise',clients:[{businessName:'Óticas Teste'}],ownerHistories:[
  {ownerTeam:'Produção - CPO',changedDate:'2026-08-02T12:00:00'},
  {ownerTeam:'Inteligência',changedDate}]}
});
test('T1-T4 titles appear using last Intelligence entry; age differs from total ticket age',()=>{
 const rows=triageRows([
 base(77533,'T2**M**3 RB - Reposição','2026-10-09T11:10:15'),
 base(100891,'T4**M**4.261015 RB - Casas decimais','2026-10-15T12:56:24'),
 base(97225,'T3**P**3 RB - Projeto','2026-11-03T17:53:57')],now);
 assert.equal(rows.length,3);assert.equal(rows[0].id,'77533');
 assert.equal(rows[0].queueDays,34);
 assert.ok(rows[0].ageDays>rows[0].queueDays);
 assert.equal(rows[2].queueDays,9);
 assert.equal(rows[1].nextStep,'A validar com a Inteligência');
});
test('closed, incorrect queue, non T1-T4 and deleted records excluded',()=>{
 const closed=base(1,'T1 teste','2026-09-10T00:00:00');closed.payload.baseStatus='Closed';
 const wrong=base(2,'T3 teste','2026-09-10T00:00:00','Produção - CPO');
 const deleted=base(3,'T2 teste','2026-09-10T00:00:00');deleted.payload.isDeleted=true;
 const other=base(4,'Projeto T4 teste','2026-09-10T00:00:00');
 assert.deepEqual(triageRows([closed,wrong,deleted,other],now),[]);
});
test('report paginates only authenticated upstream filtered query; returns complete list',async()=>{
 let called=0;
 const mock=async(url,req)=>{
  called++;assert.match(String(url),/audit_direct_tickets/);
  assert.equal(url.searchParams.get('payload->>ownerTeam'),'eq.Inteligência');
  assert.equal(url.searchParams.get('payload->>serviceFirstLevel'),'eq.Triagem');
  assert.ok(req.headers.Authorization.startsWith('Bearer '));
  return {ok:true,json:async()=>[base(100891,'T4**M** RB - Casas decimais','2026-10-15T12:56:24')]};
 };
 const report=await triageReport({base:'https://example.supabase.co',key:'test-key',fetchImpl:mock,now});
 assert.equal(called,1);assert.equal(report.ok,true);assert.equal(report.total,1);
 assert.equal(report.items[0].type,'T4');
 assert.ok(report.caveat.includes('não confirma'));
});
test('UI is wired and exports are available without new unauthenticated route',()=>{
 const html=readFileSync('index.html','utf8');
 const ui=readFileSync('intelligence-triage.js','utf8');
 const api=readFileSync('api/audit-production-metrics.js','utf8');
 for(const id of ['t-intelligence-triage','itRefresh','itDays','itType','itSearch','itPdf','itXlsx'])
  assert.ok(html.includes('id="'+id+'"'));
 assert.ok(html.includes("'intelligence-triage'"));
 assert.ok(html.includes('intelligenceTriageInit'));
 assert.ok(ui.includes('window.tmAuth?.getSession?.()'));
 assert.ok(ui.includes('XLSX.writeFile'));
 assert.ok(ui.includes('doc.autoTable'));
 assert.ok(api.includes("if(req.query?.mode==='triage')"));
});
