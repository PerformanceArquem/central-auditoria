import test from 'node:test';
import assert from 'node:assert/strict';
import {robotRecordFacts} from './robot-record-facts.mjs';
const base={today:'2026-11-27',opened:'2026-11-19',coverageConfirmed:true,holidays:['2026-11-20'],idleThreshold:3,contactThreshold:3};
test('robot notes never reset human follow-up clock',()=>{
 const r=robotRecordFacts({...base,records:[{id:'1',date:'2026-11-26',kind:'robot'}]});
 assert.equal(r.verified,true);assert.equal(r.facts.sem_registro,true);assert.equal(r.facts.dias_sem_registro,5);assert.equal(r.facts.data_abertura,'2026-11-19');
});
test('internal human follow-up is not proof of client contact',()=>{
 const r=robotRecordFacts({...base,waitingSince:'2026-11-19',records:[{id:'1',date:'2026-11-26',kind:'human-followup'}]});
 assert.equal(r.facts.dias_sem_registro,undefined);assert.equal(r.facts.dias_sem_contato,5);
 assert.equal(r.facts.data_ultimo_contato,undefined);
});
test('recent verified customer contact resets both clocks',()=>{
 const r=robotRecordFacts({...base,waitingSince:'2026-11-19',records:[{id:'1',date:'2026-11-26',kind:'human-contact'}]});
 assert.equal(r.facts.dias_sem_contato,undefined);assert.equal(r.facts.dias_sem_registro,undefined);
});
test('incomplete coverage or invalid evidence never triggers a claim',()=>{
 for(const overrides of [{coverageConfirmed:false},{records:[{id:'1',date:'2026-11-28',kind:'human-contact'}]},{records:[{id:'1',date:'2026-11-26',kind:'unknown'}]},{waitingSince:'2026-11-18'}]){
  const r=robotRecordFacts({...base,records:[],...overrides});assert.equal(r.verified,false);assert.deepEqual(r.facts,{});
 }
});

test('default waiting customer threshold is five business days',()=>{
 const {contactThreshold,...defaults}=base;
 const args={...defaults,waitingSince:'2026-11-19',records:[]};
 assert.equal(robotRecordFacts({...args,today:'2026-11-26'}).facts.dias_sem_contato,undefined);
 assert.equal(robotRecordFacts(args).facts.dias_sem_contato,5);
 assert.equal(robotRecordFacts({...args,records:[{id:'robot1',date:'2026-11-26',kind:'robot'}]}).facts.dias_sem_contato,5);
 assert.equal(robotRecordFacts({...args,records:[{id:'human1',date:'2026-11-25',kind:'human-contact'}]}).facts.dias_sem_contato,undefined);
});
