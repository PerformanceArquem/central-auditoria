import test from 'node:test';
import assert from 'node:assert/strict';
import {robotQueueFacts} from './robot-queue-facts.mjs';
const event=(ownerTeam,changedDate)=>({ownerTeam,changedDate});
const ticket={ownerTeam:'Suporte',status:'Em atendimento',ownerHistories:[event('Suporte','2026-11-10T12:00:00Z'),event('Produção','2026-11-16T12:00:00Z'),event('Suporte','2026-11-19T12:00:00Z'),event('Suporte','2026-11-23T12:00:00Z')]};
const opts={now:'2026-11-27T15:00:00Z',syncedAt:'2026-11-27T12:00:00Z',historyComplete:true,holidays:['2026-11-20'],thresholds:{Suporte:3}};
test('uses latest actual entry rather than owner change and excludes holidays',()=>{
 const r=robotQueueFacts(ticket,opts);
 assert.equal(r.eligible,true);
 assert.deepEqual(r.facts,{dias_na_fila:5,data_entrada_fila:'2026-11-19',dias_fila_uteis:true});
 assert.equal(robotQueueFacts(ticket,{...opts,thresholds:{Suporte:6}}).reason,'below-threshold');
});
test('fails closed for missing coverage, stale data, unresolved review and absent threshold',()=>{
 for(const [overrides,reason] of [[{historyComplete:false},'missing-history'],[{syncedAt:'2026-11-25T12:00:00Z'},'stale-history'],[{blocked:true},'excluded'],[{thresholds:{}},'missing-sector-threshold']]){
  const r=robotQueueFacts(ticket,{...opts,...overrides});assert.equal(r.eligible,false);assert.equal(r.reason,reason);assert.deepEqual(r.facts,{});
 }
});
test('rejects mismatched or unordered history and closed tickets',()=>{
 assert.equal(robotQueueFacts({...ticket,ownerTeam:'Qualidade'},{...opts,thresholds:{Qualidade:3}}).reason,'history-mismatch');
 assert.equal(robotQueueFacts({...ticket,ownerHistories:[...ticket.ownerHistories].reverse()},opts).reason,'invalid-history');
 assert.equal(robotQueueFacts({...ticket,status:'Fechado'},opts).reason,'excluded');
});
test('applies independent thresholds to each approved sector',()=>{
 for(const ownerTeam of ['Suporte','Qualidade','Testes (QA)','Sucesso do Cliente','Implantação','Treinamento']){
  const t={...ticket,ownerTeam,ownerHistories:[event(ownerTeam,'2026-11-19T12:00:00Z')]};
  assert.equal(robotQueueFacts(t,{...opts,thresholds:{[ownerTeam]:5}}).eligible,true);
  assert.equal(robotQueueFacts(t,{...opts,thresholds:{[ownerTeam]:6}}).eligible,false);
 }
});
