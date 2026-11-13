import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const apps=readFileSync('apps-script/arquem-relatorios-anexos.gs','utf8');
const start=apps.indexOf('function arquemVozChatDados_(raw) {');
const end=apps.indexOf('function arquemCreateReportAttachments_(packet) {');
assert.ok(start>=0&&end>start,'Zenvia attachment helper must exist');
const scope={};
vm.runInNewContext(apps.slice(start,end)+'this.helper=arquemVozChatDados_;',scope);

const packet={
 total:4,inbound:2,outbound:2,answered:2,unanswered:1,inProgress:1,unclassified:0,
 tmaSeconds:85,tmeSeconds:null,talkSeconds:170,
 chatMetrics:{tickets:3,tmaSeconds:45,tmeSeconds:12},
 quality:{
  voz:{total:2,positive:1},chat:{total:3,positive:2}
 },
 byDay:[{date:'2026-11-10',total:4,answered:2}],
 byExtension:[{extension:'430',total:4,answered:2,talkSeconds:170}]
};
const row=(list,key)=>Array.from(list.find(x=>x[0]===key)||[]);

test('Excel durations preserve seconds numerically instead of becoming hours',()=>{
 const sheets=new Map();
 const excel={};
 vm.runInNewContext(apps,excel);
 excel.arquemCreateSheet_=(_ss,title,headers,rows)=>{
  const sheet={rows,formats:[],getRange(...range){return {
   setNumberFormat(format){sheet.formats.push({range,format});},setWrap(){}
  };}};
  sheets.set(title,sheet);return sheet;
 };
 const data=scope.helper({...packet,tmeSeconds:95,talkSeconds:90061,
  supportMetrics:{total:2,answered:1,tmaSeconds:85}});
 excel.arquemVozChatPlanilhas_({},data);
 const summary=sheets.get('Voz e Chat');
 for(const [label,column,seconds] of [
  ['Suporte · TMA',1,85],['TMA',1,85],['TMA',2,45],
  ['TME',1,95],['TME',2,12],['Tempo falado',1,90061]
 ]){
  const value=row(summary.rows,label)[column];
  assert.equal(typeof value,'number');
  assert.ok(Math.abs(value*86400-seconds)<1e-8,label);
  const index=summary.rows.findIndex(r=>r[0]===label)+2;
  assert.ok(summary.formats.some(f=>f.range[0]===index&&f.format==='[m]:ss'));
 }
 assert.equal(row(summary.rows,'CSAT')[1],'50.00%');
 const ext=sheets.get('Voz por ramal');
 assert.ok(Math.abs(ext.rows[0][3]*86400-170)<1e-8);
 assert.equal(ext.formats[0].format,'[m]:ss');
});

test('PDF durations carry rounded seconds into minutes',()=>{
 const data=scope.helper({...packet,tmaSeconds:59.8});
 assert.equal(row(data.overview,'TMA')[1],'01:00');
});
test('PDF and spreadsheet use one shared voice/chat helper',()=>{
 assert.ok(apps.includes('if(p.zenviaVoice){'));
 assert.ok(apps.includes("arquemAddHeading_(body,'Voz (conta Zenvia) × Chat (Suporte)')"));
 for(const tab of ['Voz e Chat','Voz por dia','Voz por ramal','Metodologia canais'])
   assert.ok(apps.includes("'"+tab+"'"),'Missing Excel tab '+tab);
 assert.ok(apps.includes('if(packet.zenviaVoice)arquemVozChatDados_(packet.zenviaVoice)'));
});
test('CSAT identical in PDF/Excel: 8-10 positive, no phantom zero TME',()=>{
 const d=scope.helper(packet);
 assert.equal(row(d.overview,'CSAT')[1],'50.00%');
 assert.equal(row(d.overview,'CSAT')[2],'66.67%');
 assert.deepEqual(row(d.overview,'Notas 8–10'),['Notas 8–10',1,2]);
 assert.deepEqual(row(d.overview,'Notas 1–7'),['Notas 1–7',1,1]);
 assert.deepEqual(row(d.overview,'TMA'),['TMA','01:25','00:45']);
 assert.deepEqual(row(d.overview,'TME'),['TME','Indisponível','00:12']);
 assert.deepEqual(Array.from(d.days[0]),['2026-11-10',4,2]);
 assert.deepEqual(Array.from(d.ramais[0]),['430',4,2,'02:50']);
});
test('zero evaluations means no CSAT, not a 0% grade',()=>{
 const d=scope.helper({...packet,quality:{
  voz:{total:0,positive:0},chat:{total:0,positive:0}
 }});
 assert.deepEqual(row(d.overview,'CSAT'),['CSAT','Sem avaliações','Sem avaliações']);
});
test('invalid counts, grades, ramal ID or durations fail before exporting files',()=>{
 for(const changed of [
  {...packet,total:99},
  {...packet,quality:{voz:{total:2,positive:3},chat:{total:3,positive:2}}},
  {...packet,byExtension:[{extension:'=CMD',total:1,answered:1,talkSeconds:25}]},
  {...packet,tmeSeconds:-2},
  {...packet,byDay:[{date:'2026-11-10',total:1,answered:2}]}
 ]) assert.throws(()=>scope.helper(changed));
});
test('Zenvia reporting remains disabled by default and restricted to authorized corporate identities',()=>{
 const dispatch=readFileSync('supabase/functions/audit-email-dispatch/index.ts','utf8');
 assert.ok(dispatch.includes("E('ZENVIA_VOICE_REPORTS_ENABLED')==='true'"));
 assert.ok(dispatch.includes("E('ZENVIA_VOICE_ATTACHMENTS_READY')!=='true'"));
 assert.ok(dispatch.includes("capabilities.zenviaVoiceReady!==true"));
 assert.ok(dispatch.includes("E('REPORT_ATTACHMENTS_ENABLED')!=='true'"));
 assert.equal((dispatch.match(/allowVoiceEmails\.get\(/g)||[]).length,1);
 assert.ok(dispatch.includes('readZenviaEmailMetrics(from,to,token'));
});

test('PDF and Excel explicitly disclose different voice/account and chat/support scopes',()=>{
 assert.ok(apps.includes("['Indicador','Voz · conta Zenvia','Chat · Suporte']"));
 const summary=scope.helper(packet);
 assert.ok(summary.note.includes('toda a conta Zenvia'));
 assert.ok(summary.note.includes('chat representa o Suporte'));
 const emailSource=readFileSync('supabase/functions/audit-email-dispatch/zenvia-email-section.ts','utf8');
 assert.ok(emailSource.includes("voiceScope:'Conta Zenvia (todas as chamadas)'"));
 assert.ok(emailSource.includes("chatScope:'Suporte (base Movidesk)'"));
 assert.ok(emailSource.includes('Escopos distintos'));
});


test('voice metrics are restricted to exactly four approved corporate recipient records, never Keila',()=>{
 const dispatch=readFileSync('supabase/functions/audit-email-dispatch/index.ts','utf8');
 const begin=dispatch.indexOf('const allowVoiceEmails=new Map<string,string>([');
 const end=dispatch.indexOf(']);',begin);
 assert.ok(begin>=0&&end>begin,'Recipient allowlist not found');
 const entries=[...dispatch.slice(begin,end).matchAll(/\['([0-9a-f-]{36})','([^']+)'\]/g)]
   .map(match=>[match[1],match[2]]).sort((a,b)=>a[0].localeCompare(b[0]));
 const expected=[
  ['a4748115-e1d6-42dc-a8d1-706b8129219f','suportegestao@arquem.com.br'],
  ['40752b0b-c2a4-4031-9496-733b6f846d76','financeiro@arquem.com.br'],
  ['1b8168c6-bec0-4f6d-a3f9-feaec63ed147','canestraro@arquem.com.br'],
  ['8f44d5bc-0cd8-45da-97b2-c2407663083a','canestraro@arquem.com.br']
 ].sort((a,b)=>a[0].localeCompare(b[0]));
 assert.deepEqual(entries,expected);
 assert.ok(!dispatch.slice(begin,end).includes('a5329710-dd63-4bfd-bbd3-dc23e0efc8f0'));
 assert.match(dispatch,/allowVoiceEmails\.get\(String\(reportData\.recipientId\)\)===String\(email\)\.trim\(\)\.toLowerCase\(\)/);
 assert.match(dispatch,/if\(eligible&&reportData&&E\('ZENVIA_VOICE_REPORTS_ENABLED'\)==='true'\)/);
 assert.match(dispatch,/if\(E\('ZENVIA_VOICE_ATTACHMENTS_READY'\)!=='true' \|\| E\('REPORT_ATTACHMENTS_ENABLED'\)!=='true'\)/);
 assert.match(dispatch,/capabilities\.zenviaVoiceReady!==true \|\| capabilities\.zenviaVoiceVersion!=='arquem-voice-chat-v1'/);
});
