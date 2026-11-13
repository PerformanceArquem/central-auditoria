import {test} from 'node:test';import assert from 'node:assert/strict';
import {classify,summarize} from '../supabase/functions/intelligence-triage-report/model.mjs';
const now=Date.parse('2026-11-13T12:00:00Z');
const h=(team,date)=>({ownerTeam:team,changedDate:date});
const base={id:1,subject:'T2 Demanda',ownerTeam:'Inteligência',serviceFirstLevel:'Triagem',baseStatus:'New',status:'Em Análise',ownerHistories:[h('Produção','2026-09-01T12:00:00Z'),h('Inteligência','2026-10-01T12:00:00Z'),h('Inteligência','2026-11-12T12:00:00Z')]};
test('mesma equipe preserva início contínuo apesar de troca de responsável',()=>assert.equal(classify(base,now).queueDays,43));
test('retorno à inteligência reinicia contagem',()=>assert.equal(classify({...base,ownerHistories:[...base.ownerHistories,h('Produção','2026-11-12T13:00:00Z'),h('Inteligência','2026-11-12T14:00:00Z')]},now),null));
test('limite exclusivo de quinze dias',()=>{assert.equal(classify({...base,ownerHistories:[h('Inteligência','2026-10-29T12:00:00Z')]},now),null);assert.ok(classify({...base,ownerHistories:[h('Inteligência','2026-10-29T11:59:59Z')]},now));});
test('encerrados e equipes diferentes são excluídos',()=>{assert.equal(classify({...base,baseStatus:'Closed'},now),null);assert.equal(classify({...base,ownerTeam:'Produção'},now),null);});
test('histórico inconsistente bloqueia edição',()=>assert.throws(()=>classify({...base,ownerHistories:[]},now)));
test('KPIs conferem com lista integral',()=>assert.deepEqual(summarize([classify(base,now)]),{total:1,withoutForecast:1,maxQueueDays:43,averageQueueDays:43,types:{T1:0,T2:1,T3:0,T4:0}}));

