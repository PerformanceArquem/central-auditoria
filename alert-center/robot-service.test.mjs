import test from 'node:test';
import assert from 'node:assert/strict';
import {createRobotService} from './robot-service.mjs';
const ticket={id:123,ownerTeam:'Suporte',status:'Aguardando cliente',owner:{id:'1',businessName:'Maria Silva'},actions:[{timeAppointments:[{date:'2026-11-24',workTime:'00:30:00',createdBy:{id:'1'}}]}],slaSolutionDate:'2026-11-30T15:00:00Z',slaSolutionDateIsPaused:false};
const context={now:'2026-11-27T15:00:00Z',syncedAt:'2026-11-27T15:00:00Z',today:'2026-11-27',opened:'2026-11-19',records:[{id:'1',date:'2026-11-26',kind:'human-followup'}],recordCoverage:true,deadlineCoverage:true,waitingConfirmed:true,waitingSince:'2026-11-19',appointmentHistoryComplete:true};
const loadEvidence=async()=>({ticket,context});
test('preview produces internal follow-up while execution is disabled',async()=>{
 const service=createRobotService({loadEvidence});
 const result=await service.preview('123');
 assert.deepEqual(result.plan.rules,['customer-followup']);
 assert.match(result.plan.text,/24\/11\/2026, há 3 dias úteis/);
 assert.deepEqual(await service.execute('123'),{status:'disabled'});
});
test('composed service reserves, writes and confirms using injected fake providers',async()=>{
 const calls=[];let action;
 const service=createRobotService({enabled:true,loadEvidence,token:'mock',agentId:'456',clock:()=>new Date(context.now),db:async(path)=>{calls.push(path);return true;},fetcher:async(url,opts)=>{
 calls.push(opts.method);
 if(opts.method==='PATCH'){action=JSON.parse(opts.body).actions[0];return {ok:true};}
 return {ok:true,json:async()=>({...ticket,actions:action?[...ticket.actions,action]:ticket.actions})};
 }});
 assert.deepEqual(await service.execute('123'),{status:'confirmed'});
 assert.deepEqual(calls,['rpc/audit_reserve_robot_internal_note','GET','PATCH','GET','rpc/audit_finish_robot_internal_note']);
 assert.equal(action.type,1);
});
test('wrong ticket identity blocks preview',async()=>{
 const service=createRobotService({loadEvidence});
 assert.deepEqual(await service.preview('999'),{plan:null,review:['unconfirmed-ticket']});
});
