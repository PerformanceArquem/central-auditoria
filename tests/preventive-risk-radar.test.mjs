import test from 'node:test';
import assert from 'node:assert/strict';
import {radarCategory,summarizeRadar,filterRadar,preventiveGuidance} from '../lib/preventive-risk-radar.mjs';
const row=(score,coverage=100,sector='QA',owner='A',state='Risco de atraso',components=[])=>({sector,owner,risk:{score,coverage,state,components}});
test('classification boundaries and insufficient coverage',()=>{
 for(const [score,category] of [[0,'low'],[1,'medium'],[39,'medium'],[40,'high'],[69,'high'],[70,'critical'],[100,'critical']])assert.equal(radarCategory(row(score)),category);
 assert.equal(radarCategory(row(100,59)),'unknown');
 assert.equal(radarCategory(row(null)),'unknown');
 assert.equal(radarCategory(row(100,30,'QA','A','Já vencido')),'overdue');
});
test('rankings exclude overdue and uncertain records',()=>{
 const rows=[row(80),row(50),row(75,100,'Suporte','B'),row(100,100,'QA','A','Já vencido'),row(95,30)];
 const s=summarizeRadar(rows);
 assert.deepEqual(s.sectors,[['QA',2],['Suporte',1]]);
 assert.deepEqual(s.owners,[['A',2],['B',1]]);
 assert.equal(Object.values(s.counts).reduce((a,b)=>a+b,0),rows.length);
 assert.deepEqual(filterRadar(rows,{category:'critical',owner:'B'}),[rows[2]]);
});
test('guidance is bounded and prioritizes available positive factors',()=>{
 const factors=[{key:'deadline',points:30,available:true},{key:'appointment',points:20,available:true},{key:'queue',points:10,available:true},{key:'client',points:7,available:true},{key:'similar',points:99,available:false}];
 const suggestions=preventiveGuidance(row(85,100,'QA','A','Risco de atraso',factors));
 assert.equal(suggestions.length,3);assert.match(suggestions[0],/prazo/);assert.match(suggestions[1],/apontamentos/);assert.match(suggestions[2],/permanência/);
 assert.match(preventiveGuidance(row(null))[0],/cobertura/);
 assert.match(preventiveGuidance(row(100,100,'QA','A','Já vencido'))[0],/vencido/);
});
