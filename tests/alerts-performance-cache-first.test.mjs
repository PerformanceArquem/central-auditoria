import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const extract=(start,end)=>{
 const i=html.indexOf(start),j=html.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i,'Function not found: '+start);
 return html.slice(i,j);
};
test('first paint loads cached tickets before remote network data',()=>{
 const init=extract('(async()=>{ // Cache-first','})();');
 assert.ok(init.indexOf("await IDB.get('cache')")<init.indexOf('await cloudBootstrap()'));
 assert.doesNotMatch(init,/cloudSaveTickets\(list\)/);
 assert.match(init,/sync\(true\)/);
});
test('progressive Movidesk loading throttles re-render, with complete final render',()=>{
 assert.match(html,/performance\.now\(\)-lastProgressRender>=1800/);
 assert.match(html,/all\.forEach\(t=>TK\.set\(String\(t\.id\),slim\(t\)\)\)/);
 assert.match(html,/build\(list\);start\(`API Movidesk/);
});
test('ticket lookup index is correct and reused across calls',()=>{
 const source=extract('let alarmHistoryIndexSource=null','function alarmReminderStatusForTicket');
 const context={alarmEmailHistory:[
   {status:'sent',ticket_ids:['1','2'],sent_at:'2026-11-17T09:00:00Z'},
   {status:'uncertain',ticket_ids:['2'],sent_at:'2026-11-18T09:00:00Z'},
   {status:'sent',ticket_ids:['1'],sent_at:'2026-11-18T09:00:00Z'}
 ]};
 vm.createContext(context);
 vm.runInContext(source+';this.lookup=alarmHistoryForTicket',context);
 assert.deepEqual(Array.from(context.lookup('1')).map(x=>x.status),['sent','sent']);
 assert.deepEqual(Array.from(context.lookup('2')).map(x=>x.status),['sent','uncertain']);
 assert.equal(context.lookup('999').length,0);
 assert.strictEqual(context.lookup('1'),context.lookup('1'),'index recreated unnecessarily');
 context.alarmEmailHistory=[{status:'sent',ticket_ids:['3'],sent_at:'2026-11-18T11:00:00Z'}];
 assert.equal(context.lookup('1').length,0,'stale historical entry');
 assert.equal(context.lookup('3').length,1,'new history not indexed');
});
test('email tracking and validation flow remain intact',()=>{
 assert.match(html,/function alarmEmailTicketBadge\(id\)/);
 assert.match(html,/const relevant=alarmHistoryForTicket\(id\)/);
 assert.match(html,/alarmReminderStatusForTicket\(id\)/);
 assert.match(html,/function alarmEmailHistoryLoad\(/);
 assert.match(html,/ticket_charge_validate/);
 assert.match(html,/ticket_charge_send/);
 assert.match(html,/alarmEmailValidated/);
 assert.match(html,/alarmTeamChanged\(this.value\)/);
});
