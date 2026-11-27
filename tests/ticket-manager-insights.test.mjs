import test from 'node:test';
import assert from 'node:assert/strict';
import {localInsight,draftTicketFollowUp,INSIGHT_OPTIONS} from '../lib/ticket-manager-insights.mjs';
const now=Date.parse('2026-11-27T15:00:00Z');
const tickets=[{id:123,ownerTeam:'QA',owner:{businessName:'A'},status:'Aberto',createdDate:'2026-11-01T12:00:00Z',slaSolutionDate:'2026-11-26T12:00:00Z',actions:[]},{id:456,ownerTeam:'Suporte',status:'Fechado',closedIn:'2026-11-27T12:00:00Z'}];
test('all six local insights return a scoped narrative',()=>{
 for(const [intent] of INSIGHT_OPTIONS){const r=localInsight(intent,{tickets,now,day:'2026-11-27',sector:'QA'});assert.match(r.answer,/QA/);assert.match(r.answer,/Fonte:/);}
});
test('overdue is separate from future risk and unknown VIP is not zero',()=>{
 assert.match(localInsight('risk',{tickets,now}).answer,/1 já vencidos/);
 assert.match(localInsight('vip',{tickets,now}).answer,/indisponível/);
});
test('follow-up is a draft and honors selection and closed status',()=>{
 const r=draftTicketFollowUp('123',{tickets,now,sector:'QA'});
 assert.match(r.answer,/#123/);assert.match(r.answer,/previsão/);assert.match(r.notice,/Nenhum envio/);
 assert.throws(()=>draftTicketFollowUp('123',{tickets,now,sector:'Suporte'}));
 assert.throws(()=>draftTicketFollowUp('456',{tickets,now}));
 assert.throws(()=>draftTicketFollowUp('abc',{tickets,now}));
});
test('no fabricated results for unavailable sources or unsupported daily filters',()=>{
 assert.throws(()=>localInsight('risk',{tickets:[],now}));
 assert.throws(()=>localInsight('daily',{tickets,now,day:'2026-11-27',client:'X'}));
});
