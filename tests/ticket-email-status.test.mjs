import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const extract=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
function setup(items=[],loaded=true){
 const nodes={alarmEmailSelectedDetails:{},alarmEmailPreviewHistory:{}};
 const context={alarmEmailHistory:items,alarmEmailHistoryLoaded:loaded,
  alarmReminderPolicy:{},alarmEmailTime:stamp=>stamp,
  esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  $:id=>nodes[id],TK:new Map(),hrs:()=>0,H:String};
 vm.createContext(context);
 vm.runInContext(extract('let alarmHistoryIndexSource=null','async function alarmReminderPolicyLoad')+
  extract('function alarmEmailTicketBadge','const alarmSelected=')+
  'const alarmSelected=new Set(["1"]);'+
  extract('function alarmRenderSelectedDetails','function alarmTimeLogToggle'),context);
 return {context,nodes,badge:id=>context.alarmEmailTicketBadge(id)};
}
test('only confirmed sends display success, using the latest date and escaped recipient',()=>{
 const {badge}=setup([
  {status:'sent',ticket_ids:['1'],sent_at:'2026-11-16T12:00:00Z',recipient:'old@example.com'},
  {status:'sent',ticket_ids:['1'],sent_at:'2026-11-18T12:00:00Z',recipient:'<new@example.com>'},
  {status:'uncertain',ticket_ids:['2']},
 ]);
 assert.match(badge('1'),/E-mail enviado · 2026-11-18T12:00:00Z · 2 cobrança/);
 assert.match(badge('1'),/&lt;new@example.com&gt;/);
 assert.doesNotMatch(badge('2'),/E-mail enviado/);
 assert.match(badge('2'),/Verificar envio/);
 assert.match(badge('3'),/Sem envio no histórico consultado/);
});
test('unloaded history never claims that no email was sent',()=>{
 assert.match(setup([],false).badge('1'),/Histórico não consultado/);
});
test('a later uncertain attempt remains visible beside a confirmed send',()=>{
 const {badge}=setup([{status:'sent',ticket_ids:['1'],sent_at:'2026-11-17',recipient:'a@example.com'},
  {status:'uncertain',ticket_ids:['1'],created_at:'2026-11-18'}]);
 assert.match(badge('1'),/E-mail enviado/);
 assert.match(badge('1'),/Outro envio a verificar/);
});
test('selected tickets and preview show the same persisted send status',()=>{
 const {context,nodes}=setup([{status:'sent',ticket_ids:['1'],sent_at:'2026-11-18',recipient:'a@example.com'}]);
 context.alarmRenderSelectedDetails();
 assert.match(nodes.alarmEmailSelectedDetails.innerHTML,/#1.*E-mail enviado/);
 assert.match(nodes.alarmEmailPreviewHistory.innerHTML,/#1.*E-mail enviado/);
 assert.match(html,/Esta prévia não envia e-mail/);
});
