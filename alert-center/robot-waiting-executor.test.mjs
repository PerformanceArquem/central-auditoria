import test from 'node:test';
import assert from 'node:assert/strict';
import {waitingPlan,createWaitingExecutor} from './robot-waiting-executor.mjs';
const ticket={id:123,ownerTeam:'Suporte',status:'Agendado',baseStatus:'Stopped',justification:'Aguardando ação do cliente',owner:{id:'1',businessName:'Maria Silva'},actions:[{timeAppointments:[{date:'2026-11-24',workTime:'00:30:00',createdBy:{id:'1'}}]}]};
const opts={today:'2026-11-27',holidays:[],complete:true};
test('three business days from verified appointment generate internal plan',()=>{
 const p=waitingPlan(ticket,opts);assert.equal(p.ownerId,'1');assert.deepEqual(p.rules,['customer-followup']);assert.match(p.text,/24\/11\/2026, há 3 dias úteis/);
 assert.equal(waitingPlan(ticket,{...opts,holidays:['2026-11-25']}),null);
});
test('internal waiting, unauthorized sector and incomplete evidence never qualify',()=>{
 for(const patch of [{justification:'Aguardando ação interna'},{ownerTeam:'Produção - CPO'},{owner:null},{actions:[{}]}])assert.equal(waitingPlan({...ticket,...patch},opts),null);
 assert.equal(waitingPlan(ticket,{...opts,blocked:true}),null);
});
test('executor remains disabled by default',async()=>{
 const e=createWaitingExecutor({readTicket:async()=>ticket,readPolicy:async()=>({complete:true,blocked:false,holidays:[]})});
 assert.deepEqual(await e.execute('123'),{status:'disabled'});
});
test('owner change with identical first name prevents write after reservation',async()=>{
 let reads=0;const outcomes=[];
 const e=createWaitingExecutor({enabled:true,clock:()=>new Date('2026-11-27T15:00:00Z'),readTicket:async()=>({...ticket,owner:{id:String(++reads),businessName:'Maria Silva'}}),readPolicy:async()=>({complete:true,blocked:false,holidays:[]}),reserve:async()=>({acquired:true}),finish:async x=>{outcomes.push(x.status);return true;},writeInternal:async()=>assert.fail('Unexpected write')});
 assert.deepEqual(await e.execute('123'),{status:'blocked'});assert.deepEqual(outcomes,['blocked']);
});
