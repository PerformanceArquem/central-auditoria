import test from 'node:test';
import assert from 'node:assert/strict';
import {planRobotNote} from './robot-note-plan.mjs';
const ticket={id:123,ownerTeam:'Suporte',status:'Em atendimento',owner:{id:'1',businessName:'Maria Silva'},ownerHistories:[{ownerTeam:'Suporte',changedDate:'2026-11-19T12:00:00Z'}]};
const opts={now:'2026-11-27T15:00:00Z',syncedAt:'2026-11-27T12:00:00Z',historyComplete:true,holidays:['2026-11-20'],thresholds:{Suporte:3},validatedFacts:{verified:true,facts:{dias_sem_registro:5,data_previsao_vencida:'2026-11-25'}}};
test('consolidates verified facts into one simulated internal note',()=>{
 const p=planRobotNote(ticket,opts);
 assert.equal(p.channel,'movidesk-internal');assert.equal(p.simulated,true);
 assert.equal(p.key,'robot-note:123:2026-11-27');
 assert.deepEqual(p.rules,['aged-queue','idle-record','overdue']);
 assert.match(p.text,/Olá, Maria!/);assert.match(p.text,/fila do Suporte/);assert.match(p.text,/25\/11\/2026/);
 assert.equal(p.text.match(/Ticket Manager/g).length,1);
});
test('daily deduplication and safety blocks suppress all notes',()=>{
 for(const overrides of [{existingKeys:['robot-note:123:2026-11-27']},{blocked:true},{syncedAt:'2026-11-25T12:00:00Z'}])assert.equal(planRobotNote(ticket,{...opts,...overrides}),null);
 assert.equal(planRobotNote({...ticket,status:'Fechado'},opts),null);
});
test('unverified facts and future deadline are not included',()=>{
 const p=planRobotNote(ticket,{...opts,validatedFacts:{verified:false,facts:{dias_sem_registro:99}}});
 assert.deepEqual(p.rules,['aged-queue']);
 assert.doesNotMatch(p.text,/99 dias/);
 const q=planRobotNote(ticket,{...opts,validatedFacts:{verified:true,facts:{data_previsao_vencida:'2026-12-01'}}});
 assert.doesNotMatch(q.text,/vencida/);
 assert.equal(planRobotNote(ticket,{...opts,historyComplete:false,validatedFacts:null}),null);
});
