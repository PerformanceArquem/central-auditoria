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
test('PDF and spreadsheet use one shared voice/chat helper',()=>{
 assert.ok(apps.includes('if(p.zenviaVoice){'));
 assert.ok(apps.includes("arquemAddHeading_(body,'Voz × Chat · Indicadores de atendimento')"));
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
test('Zenvia reporting remains disabled by default and eligible only for three recipients',()=>{
 const dispatch=readFileSync('supabase/functions/audit-email-dispatch/index.ts','utf8');
 assert.ok(dispatch.includes("E('ZENVIA_VOICE_REPORTS_ENABLED')==='true'"));
 assert.ok(dispatch.includes("E('ZENVIA_VOICE_ATTACHMENTS_READY')!=='true'"));
 assert.ok(dispatch.includes("capabilities.zenviaVoiceReady!==true"));
 assert.ok(dispatch.includes("E('REPORT_ATTACHMENTS_ENABLED')!=='true'"));
 assert.equal((dispatch.match(/allowVoiceEmails\.get\(/g)||[]).length,1);
 assert.ok(dispatch.includes('readZenviaEmailMetrics(from,to,token'));
});
