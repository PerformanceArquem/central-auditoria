import test from 'node:test';
import assert from 'node:assert/strict';
import {robotOwnerMessage} from './robot-owner-message.mjs';
test('uses current owner first name, not requester or delivery owner',()=>{
 const ticket={owner:{id:'1',businessName:'Alan Reis'},clients:[{businessName:'Cliente'}],deliveryOwner:{businessName:'Outro'}};
 assert.match(robotOwnerMessage(ticket),/^Olá, Alan! Tudo bem\?/);
 assert.match(robotOwnerMessage({...ticket,owner:{id:'2',businessName:'Maria Silva'}}),/^Olá, Maria! Tudo bem\?/);
});
test('missing owner uses team fallback',()=>{
 for(const ticket of [{},{owner:null},{owner:{businessName:'Alan'}},{owner:{id:'1',businessName:'  '}}]) assert.match(robotOwnerMessage(ticket),/^Olá, equipe! Tudo bem\?/);
});
test('approved text contains no email or automated audit claim',()=>{
 const message=robotOwnerMessage({owner:{id:'1',businessName:'  João   Silva '}});
 assert.equal(message,'Olá, João! Tudo bem?\n\nPoderia, por gentileza, nos atualizar sobre o andamento deste chamado e os próximos passos?\n\nCaso exista alguma dificuldade ou necessidade de apoio, estamos à disposição para ajudar.\n\nAgradecemos pela parceria!\n\nTicket Manager');
 assert.doesNotMatch(message,/e-mail|robô|auditoria automática/i);
});

test('uses only validated inactivity and overdue facts',()=>{
 const ticket={owner:{id:'1',businessName:'Maria Silva'}};
 const both=robotOwnerMessage(ticket,{dias_sem_atualizacao:5,data_previsao_vencida:'2026-11-20'});
 assert.match(both,/5 dias sem atualização/);
 assert.match(both,/vencida desde 20\/11\/2026/);
 assert.match(robotOwnerMessage(ticket,{dias_sem_atualizacao:1}),/1 dia sem atualização/);
 assert.doesNotMatch(robotOwnerMessage(ticket,{dias_sem_atualizacao:5}),/previsão/);
 assert.doesNotMatch(robotOwnerMessage(ticket,{data_previsao_vencida:'2026-11-20'}),/dias sem atualização/);
 for(const date of ['2026-02-30','invalid',null]) assert.doesNotMatch(robotOwnerMessage(ticket,{dias_sem_atualizacao:-1,data_previsao_vencida:date}),/vencida|dias sem atualização/);
});

test('support queue distinguishes confirmed unassigned from unknown owner',()=>{
 const facts={dias_na_fila:7,data_entrada_fila:'2026-11-20'};
 const assigned=robotOwnerMessage({ownerTeam:'Suporte',owner:{id:'2',businessName:'Maria Silva'}},facts);
 assert.match(assigned,/Olá, Maria!/);assert.match(assigned,/fila do Suporte há 7 dias/);
 const unassigned=robotOwnerMessage({ownerTeam:'Suporte',owner:null},facts);
 assert.match(unassigned,/Olá, equipe!/);assert.match(unassigned,/não possui um responsável definido/);
 assert.doesNotMatch(robotOwnerMessage({ownerTeam:'Suporte'},facts),/não possui um responsável definido/);
 assert.doesNotMatch(robotOwnerMessage({ownerTeam:'Produção'},facts),/fila do Suporte/);
});
test('combines confirmed missing record, overdue date and queue without duplicate notes',()=>{
 const msg=robotOwnerMessage({ownerTeam:'Suporte',owner:null},{sem_registro:true,data_abertura:'2026-11-01',dias_na_fila:5,data_previsao_vencida:'2026-11-20'});
 assert.match(msg,/não possui registro de acompanhamento desde a abertura em 01\/11\/2026/);
 assert.match(msg,/vencida desde 20\/11\/2026/);assert.match(msg,/fila do Suporte há 5 dias/);
 assert.equal(msg.match(/Ticket Manager/g).length,1);
 assert.match(robotOwnerMessage({},{dias_sem_registro:4,data_ultimo_registro:'2026-11-23'}),/4 dias sem atualização, com último registro em 23\/11\/2026/);
});
