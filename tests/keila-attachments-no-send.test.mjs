import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('apps-script/arquem-relatorios-anexos.gs','utf8');
const ctx=vm.createContext({});
vm.runInContext(source,ctx,{filename:'arquem-relatorios-anexos.gs'});

const sample={
  productionFlow:{
    entered:1,exited:1,entryMovements:2,exitMovements:1,
    movements:[
      {id:'101191',direction:'entry',at:'2026-11-16T12:00:00Z',client:'Loja',
       fromTeam:'Suporte',toTeam:'Produção - CPO',responsible:'Pessoa A'},
      {id:'101191',direction:'exit',at:'2026-11-16T13:00:00Z',client:'Loja',
       fromTeam:'Produção - CPO',toTeam:'Suporte',responsible:'Pessoa B'}
    ]
  }
};

test('keila movements are preserved individually with safe Movidesk links',()=>{
  const result=ctx.arquemMovimentosProducao_(sample);
  assert.equal(result.length,2);
  assert.equal(result[0].direction,'Entrada');
  assert.equal(result[1].direction,'Saída');
  assert.equal(result[0].url,'https://arquem.movidesk.com/Ticket/Edit/101191');
  assert.equal(result[1].fromTeam,'Produção - CPO');
});

test('invalid ticket identifiers and movement directions are rejected',()=>{
  assert.throws(()=>ctx.arquemMovimentosProducao_({productionFlow:{
    movements:[{id:'javascript:alert(1)',direction:'entry'}]
  }}),/Chamado inválido/);
  assert.throws(()=>ctx.arquemMovimentosProducao_({productionFlow:{
    movements:[{id:'101191',direction:'unknown'}]
  }}),/Direção inválida/);
});

test('production attachment generator contains dedicated PDF and Excel tables',()=>{
  assert.match(source,/Rastreabilidade detalhada — entradas e saídas/);
  assert.match(source,/Movimentações Produção/);
  assert.match(source,/const movements=arquemMovimentosProducao_\(p\)/);
  assert.match(source,/function arquemTesteKeilaSemEnvio/);
  assert.doesNotMatch(source.slice(source.indexOf('function arquemTesteKeilaSemEnvio'),source.indexOf('function arquemTesteAnexosSemEnvio')),/GmailApp\.sendEmail|MailApp\.sendEmail/);
});
