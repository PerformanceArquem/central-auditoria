import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../monitoria-packages.js',import.meta.url),'utf8');
const code=source.replace(' let previewRows=[],previewPeriod=null;',' globalThis.__testPeriods={periods,emailHtml,audioLink};\n let previewRows=[],previewPeriod=null;');
const sandbox={
 location:{origin:'https://central-auditoria-iota.vercel.app'},
 document:{readyState:'loading',addEventListener(){}},
 window:{},URL,Date,Number,String,Math,Array,Map,Set,encodeURIComponent,
};
vm.runInNewContext(code,sandbox,{timeout:3000});
const {periods,emailHtml,audioLink}=sandbox.__testPeriods;
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
 assert.match(source,/Chat_/);
 assert.match(source,/\.pdf/);
 assert.match(source,/Notas_Monitoria\.xlsx/);
});
