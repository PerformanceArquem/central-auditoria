import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverRobotNote} from './robot-internal-delivery.mjs';
const plan={ticketId:'123',key:'robot-note:123:2026-11-27',channel:'movidesk-internal',rules:['aged-queue'],text:'Olá, Maria! Tudo bem?'};
function fixture(overrides={}){
 const calls=[];
 const options={enabled:true,readAndEvaluate:async()=>({plan}),reserve:async x=>{calls.push(['reserve',x]);return {acquired:true}},writeInternal:async x=>{calls.push(['write',x]);return {confirmed:true}},finish:async x=>{calls.push(['finish',x]);return true},...overrides};
 return {options,calls};
}
test('disabled by default without calling transport',async()=>assert.deepEqual(await deliverRobotNote('123'),{status:'disabled'}));
test('reserves before writing only an internal action with stable marker',async()=>{
 const {options,calls}=fixture();
 assert.equal((await deliverRobotNote('123',options)).status,'confirmed');
 assert.deepEqual(calls.map(x=>x[0]),['reserve','write','finish']);
 assert.equal(calls[1][1].type,1);
 assert.match(calls[1][1].text,/CENTRAL-ROBOT-NOTE:123:2026-11-27/);
 assert.equal(calls[2][1].status,'confirmed');
});
test('duplicate reservation prevents writing',async()=>{
 const {options,calls}=fixture({reserve:async()=>({acquired:false})});
 assert.equal((await deliverRobotNote('123',options)).status,'duplicate-or-blocked');
 assert.equal(calls.length,0);
});
test('changed owner or facts after reservation blocks write',async()=>{
 let reads=0;
 const {options,calls}=fixture({readAndEvaluate:async()=>({plan:++reads===1?plan:{...plan,text:'Olá, João!'}})});
 assert.equal((await deliverRobotNote('123',options)).status,'blocked');
 assert.deepEqual(calls.map(x=>x[0]),['reserve','finish']);
});
test('uncertain provider outcome is recorded without retry',async()=>{
 let attempts=0;
 const {options,calls}=fixture({writeInternal:async()=>{attempts++;throw Error('timeout')}});
 assert.equal((await deliverRobotNote('123',options)).status,'uncertain');
 assert.equal(attempts,1);assert.equal(calls.at(-1)[1].status,'uncertain');
});
test('rejects non-internal channel before reserving',async()=>{
 const {options,calls}=fixture({readAndEvaluate:async()=>({plan:{...plan,channel:'email'}})});
 assert.equal((await deliverRobotNote('123',options)).status,'blocked');assert.equal(calls.length,0);
});
