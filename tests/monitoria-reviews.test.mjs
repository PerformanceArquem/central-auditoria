import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareReview,RUBRIC,PARTIAL} from '../lib/monitoria-review-validation.js';
const userId='123e4567-e89b-42d3-a456-426614174000';
const id='123e4567-e89b-42d3-a456-426614174001';
const mock=(channel='chat',critical=false)=>{
 const criteria=RUBRIC[channel].map((points,i)=>points===null?null:{
  id:'R'+String(i+1).padStart(2,'0'),decision:'conforme',evidence:'',reason:''
 }).filter(Boolean);
 const alerts=critical?[{code:'Z1',suspected:true,evidence:'Trecho de atendimento observado'}]:[];
 return {action:'submit',requestId:id,consent:true,channel,sourceId:'102205',sector:'Suporte',
  collaborator:'Colaborador de Teste',analysis:{
  version:'monitoria-suporte-2026-11-17',channel,scoreSuggestion:critical?0:100,
  criteria,critical:alerts
 }};
};
test('conformidade preserva nota 100 e status não-crítico',()=>{
 const x=prepareReview(mock(),userId);
 assert.equal(x.score_suggested,100);assert.equal(x.critical_suspected,false);
 assert.equal(x.criteria.length,13);
});
test('falha zeradora com evidência vira alerta provisório, não decisão definitiva',()=>{
 const x=prepareReview(mock('chat',true),userId);
 assert.equal(x.score_suggested,0);assert.equal(x.critical_suspected,true);
 assert.equal(x.critical_findings[0].code,'Z1');
});
test('não gera desconto parcial fora da planilha',()=>{
 const p=mock();p.analysis.criteria.find(c=>c.id==='R01').decision='parcial';
 assert.throws(()=>prepareReview(p,userId),/sem desconto parcial/);
});
test('descontos parciais seguem pesos diferentes de chat e telefonia',()=>{
 for(const [channel,id,weight] of [['chat','R03',2.5],['voice','R03',4]]){
  const p=mock(channel);
  const r=p.analysis.criteria.find(x=>x.id===id);
  r.decision='parcial';r.evidence='Trecho válido';
  p.analysis.scoreSuggestion=100-weight;
  const result=prepareReview(p,userId);
  assert.equal(result.score_suggested,100-weight);
 }
});
test('rejeita nota forjada pelo navegador',()=>{
 const p=mock();p.analysis.scoreSuggestion=5;
 assert.throws(()=>prepareReview(p,userId),/Pontuação divergente/);
});
test('rejeita infração sem evidência e códigos repetidos',()=>{
 const p=mock();p.analysis.criteria[0].decision='nao_conforme';
 assert.throws(()=>prepareReview(p,userId),/sem evidência/);
 const another=mock();another.analysis.criteria.push(another.analysis.criteria[0]);
 assert.throws(()=>prepareReview(another,userId),/duplicados/);
});
test('a versão de normas e a referência de origem são obrigatórias',()=>{
 const p=mock();p.analysis.version='alterado';
 assert.throws(()=>prepareReview(p,userId),/incompatível/);
 const invalid=mock();invalid.sourceId='102205 OR true';
 assert.throws(()=>prepareReview(invalid,userId),/inválido/);
});
test('rubrica da exportação totaliza 100 pontos em ambos canais',()=>{
 for(const channel of ['chat','voice']){
  const value=RUBRIC[channel].reduce((n,v)=>n+(v||0),0);
  assert.equal(value,100);
  assert.equal(PARTIAL[channel].length,13);
 }
});
