import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../monitoria-packages.js',import.meta.url),'utf8');
const code=source.replace(' let previewRows=[],previewPeriod=null;',' globalThis.__testPeriods={periods,emailHtml,audioLink,finalReportPDF};\n let previewRows=[],previewPeriod=null;');
const sandbox={
 location:{origin:'https://central-auditoria-iota.vercel.app'},
 document:{readyState:'loading',addEventListener(){}},
 window:{},URL,Date,Number,String,Math,Array,Map,Set,encodeURIComponent,
};
vm.runInNewContext(code,sandbox,{timeout:3000});
const {periods,emailHtml,audioLink,finalReportPDF}=sandbox.__testPeriods;
test('semanal é segunda a domingo, incluindo virada do ano',()=>{
 const x=periods('weekly','2026-01-01');
 assert.equal(x.from,'2025-12-29');assert.equal(x.to,'2026-01-04');
});
test('mensal respeita fevereiro em ano bissexto',()=>{
 const x=periods('monthly','2024-02-10');
 assert.equal(x.from,'2024-02-01');assert.equal(x.to,'2024-02-29');
});
test('anual percorre o ano civil completo',()=>{
 const x=periods('annual','2026-11-17');
 assert.equal(x.from,'2026-01-01');assert.equal(x.to,'2026-12-31');
});
test('prévia corporativa omite avaliações provisórias e escapa HTML',()=>{
 const rows=[
  {review_status:'approved',score_approved:92,monitored_at:'2026-11-17',
   collaborator_name:'<Pessoa>',reviewer_name:'Analista "Teste"',channel:'chat',source_id:'102205',critical_confirmed:false},
  {review_status:'provisional',score_approved:null,monitored_at:'2026-11-17',
   collaborator_name:'<Pessoa>',reviewer_name:'Outro',channel:'voice',source_id:'0000001'}
 ];
 const html=emailHtml(rows,periods('monthly','2026-11-17'));
 assert.match(html,/&lt;Pessoa&gt;/);
 assert.ok(!html.includes('<Pessoa>'));
 assert.ok(!html.includes('0000001'));
 assert.match(html,/92\.00/);
 assert.match(html,/prévia sem envio automático/i);
});
test('link de áudio aponta ao módulo com login e não inclui token',()=>{
 const link=audioLink({channel:'voice',recording_kind:'outbound',source_id:'1234567'});
 const u=new URL(link);assert.equal(u.pathname,'/');
 assert.equal(u.searchParams.get('monitoria_voice'),'1234567');
 assert.equal(u.searchParams.get('kind'),'outbound');
 assert.equal(u.searchParams.has('token'),false);
 assert.equal(audioLink({channel:'voice',recording_kind:'outbound',source_id:'1%2Fother'}),null);
});
test('pacotes não fazem envio automático nem usam GmailApp',()=>{
 assert.ok(!/GmailApp|MailApp\.send|sendEmail\s*\(/.test(source));
 assert.match(source,/Extrato_/);
 assert.match(source,/NÃO garantem o chat integral/);
 assert.match(source,/\.pdf/);
 assert.match(source,/Notas_Monitoria\.xlsx/);
});

test('PDF final inclui monitor responsável, nota aprovada e link privado sem token',()=>{
 const operations=[];
 class MockPdf{
  setFillColor(...a){operations.push(['fill',...a])}
  rect(){}setTextColor(){}setFontSize(){}setFont(){}setDrawColor(){}line(){}
  text(t){operations.push(['text',t])}
  textWithLink(label,x,y,options){operations.push(['link',label,options.url])}
  splitTextToSize(text){return [String(text)]}
  addPage(){operations.push(['newPage'])}
  setProperties(){}output(){return Uint8Array.from([37,80,68,70]).buffer}
 }
 sandbox.window.jspdf={jsPDF:MockPdf};
 const rows=[{
  review_status:'approved',score_approved:94,score_suggested:96,channel:'voice',
  monitored_at:'2026-11-17',source_id:'12345',recording_kind:'outbound',
  reviewer_name:'Analista Qualidade',collaborator_name:'Pessoa Exemplo',sector:'Suporte',
  critical_findings:[],critical_confirmed:false,reviewer_notes:'Revisada'
 }];
 const result=finalReportPDF(rows,periods('monthly','2026-11-17'));
 assert.ok(result instanceof ArrayBuffer);
 assert.ok(operations.some(o=>o[0]==='text'&&String(o[1]).includes('Analista Qualidade')));
 assert.ok(operations.some(o=>o[0]==='text'&&String(o[1]).includes('94')));
 assert.ok(operations.some(o=>o[0]==='link'&&o[2].includes('monitoria_voice=12345')));
 assert.ok(operations.every(o=>JSON.stringify(o).indexOf('Access-Token')<0));
});
test('pacote sempre possui relatório final em PDF e manifesto de integridade',()=>{
 assert.match(source,/Relatorio_Final_Monitoria\.pdf/);
 assert.match(source,/MANIFESTO_MONITORIA\.json/);
 assert.match(source,/chatFullHistoryValidated:false/);
 assert.match(source,/emailsSent:false/);
});
