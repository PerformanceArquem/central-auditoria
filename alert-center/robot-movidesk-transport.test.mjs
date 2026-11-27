import test from 'node:test';
import assert from 'node:assert/strict';
import {robotMovideskTransport} from './robot-movidesk-transport.mjs';
const marker='CENTRAL-ROBOT-NOTE:123:2026-11-27';
const note={ticketId:'123',type:1,text:'Olá! <teste>\n\n'+marker,marker};
function fixture({closed=false,existing=false,confirm=true}={}){
 const calls=[];let written=false;
 const fetcher=async(url,opts)=>{
  calls.push({method:opts.method,body:opts.body?JSON.parse(opts.body):null});
  if(opts.method==='PATCH'){written=true;return {ok:true};}
  return {ok:true,json:async()=>({id:123,status:closed?'Fechado':'Aguardando cliente',actions:existing||written&&confirm?[{type:1,description:marker}]:[]})};
 };
 return {calls,write:robotMovideskTransport({token:'mock-token',agentId:'456',enabled:true,fetcher})};
}
test('disabled transport never calls provider',async()=>{
 const write=robotMovideskTransport({fetcher:async()=>assert.fail('unexpected request')});
 await assert.rejects(()=>write(note));
});
test('only internal action payload and read-back confirmation',async()=>{
 const {calls,write}=fixture();
 assert.deepEqual(await write(note),{confirmed:true});
 assert.deepEqual(calls.map(x=>x.method),['GET','PATCH','GET']);
 const action=calls[1].body.actions[0];
 assert.deepEqual(Object.keys(calls[1].body),['actions']);
 assert.equal(action.type,1);assert.equal(action.createdBy.id,'456');
 assert.match(action.description,/&lt;teste&gt;/);
 assert.equal(action.timeAppointments,undefined);
});
test('existing marker avoids duplicate PATCH',async()=>{
 const {calls,write}=fixture({existing:true});
 assert.deepEqual(await write(note),{confirmed:true,deduplicated:true});
 assert.deepEqual(calls.map(x=>x.method),['GET']);
});
test('closed tickets and public actions cannot be written',async()=>{
 const {calls,write}=fixture({closed:true});
 await assert.rejects(()=>write({...note,type:2}));
 await assert.rejects(()=>write(note));
 assert.deepEqual(calls.map(x=>x.method),['GET']);
});
test('successful HTTP response without marker remains unconfirmed',async()=>{
 const {calls,write}=fixture({confirm:false});
 assert.deepEqual(await write(note),{confirmed:false});
 assert.deepEqual(calls.map(x=>x.method),['GET','PATCH','GET']);
});
