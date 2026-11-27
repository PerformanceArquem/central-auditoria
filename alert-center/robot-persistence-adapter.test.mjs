import test from 'node:test';
import assert from 'node:assert/strict';
import {robotPersistence} from './robot-persistence-adapter.mjs';
const clock=()=>new Date('2026-11-28T01:00:00Z');
test('reservation uses Brasilia date and dedicated RPC only',async()=>{
 const calls=[];const p=robotPersistence(async(path,opts)=>{calls.push([path,JSON.parse(opts.body)]);return true},{clock});
 assert.deepEqual(await p.reserve({ticketId:'123',day:'2026-11-28',rules:['idle-record'],text:'Test'}),{acquired:false});
 assert.equal(calls.length,0);
 assert.deepEqual(await p.reserve({ticketId:'123',day:'2026-11-27',rules:['idle-record'],text:'Test'}),{acquired:true});
 assert.deepEqual(calls,[['rpc/audit_reserve_robot_internal_note',{p_ticket_id:'123',p_day:'2026-11-27',p_rules:['idle-record'],p_note_body:'Test'}]]);
});
test('only explicit true confirms a reservation or finalization',async()=>{
 const p=robotPersistence(async()=>({ok:true}),{clock});
 assert.equal((await p.reserve({ticketId:'123',day:'2026-11-27',rules:['idle-record'],text:'Test'})).acquired,false);
 assert.equal(await p.finish({ticketId:'123',day:'2026-11-27',status:'confirmed'}),false);
});
test('finalization preserves original date and rejects invalid status',async()=>{
 const calls=[];const p=robotPersistence(async(path,opts)=>{calls.push([path,JSON.parse(opts.body)]);return true},{clock});
 assert.equal(await p.finish({ticketId:'123',day:'2026-11-26',status:'uncertain'}),true);
 assert.deepEqual(calls,[['rpc/audit_finish_robot_internal_note',{p_ticket_id:'123',p_day:'2026-11-26',p_status:'uncertain'}]]);
 await assert.rejects(()=>p.finish({ticketId:'123',day:'2026-11-26',status:'sent'}));
 assert.equal(calls.length,1);
});
