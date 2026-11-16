import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const files=['apps-script/arquem-relatorios-anexos.gs','apps-script/central-auditoria-emails-completo.gs'];
for(const path of files){
 const code=readFileSync(path,'utf8');
 test(path+' marks synthetic reports unambiguously in PDF',()=>{
   assert.match(code,/const syntheticSample=\/homologa\|dados fict\[ií\]cios\/i/);
   assert.match(code,/AMOSTRA DE HOMOLOGAÇÃO — DADOS FICTÍCIOS — SEM ENVIO DE E-MAIL/);
   assert.match(code,/NÃO representam registros reais sincronizados/);
 });
 test(path+' keeps dates as text, formats hours in B5 not date in B4',()=>{
   assert.match(code,/first\.getRange\('B3:B4'\)\.setNumberFormat\('@'\)/);
   assert.match(code,/if\(!p\.productionFlow\)first\.getRange\('B5'\)\.setNumberFormat\('\[h\]:mm:ss'\)/);
   assert.doesNotMatch(code,/getRange\('B4'\)\.setNumberFormat\('\[h\]:mm:ss'\)/);
 });
}
