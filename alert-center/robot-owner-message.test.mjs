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
