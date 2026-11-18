import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const src=readFileSync(new URL('../supabase/functions/audit-email-dispatch/index.ts',import.meta.url),'utf8');
const start=src.indexOf('function chargeProjectOptions(payload:R){');
const end=src.indexOf('// Sugestao de IA: rascunho editavel',start);
assert.ok(start>=0&&end>start,'Function source must be found');
const fn=src.slice(start,end).replace('payload:R','payload');
const parseOptions=runInNewContext('('+fn+')');
test('AI charge accepts a valid custom field and dates, without affecting defaults',()=>{
 const p=parseOptions({projectForecastFieldId:'CF_123-ABC',projectPeriodFrom:'2026-11-01',projectPeriodTo:'2026-11-18'});
 assert.equal(p.forecastFieldId,'CF_123-ABC');
 assert.equal(p.periodFrom,'2026-11-01');
 assert.equal(p.periodTo,'2026-11-18');
 assert.equal(p.dailyGoalHours,4);
 assert.equal(p.workdayHours,8);
});
test('AI charge works when project forecasting is not configured',()=>{
 const p=parseOptions({});
 assert.equal(p.forecastFieldId,'');
 assert.equal(p.periodFrom,undefined);
 assert.equal(p.periodTo,undefined);
});
test('AI charge rejects invalid field IDs without blocking legitimate ones',()=>{
 for(const invalid of ['campo com espaços','campo@123','A'.repeat(81)])
  assert.throws(()=>parseOptions({projectForecastFieldId:invalid}),/Configuração de previsão de projetos inválida/);
 assert.doesNotThrow(()=>parseOptions({projectForecastFieldId:'123456'}));
});
test('AI charge validates dates and reversed intervals',()=>{
 for(const invalid of [{projectPeriodFrom:'2026/11/01'},{projectPeriodFrom:'2026-11-18',projectPeriodTo:'2026-11-01'},{projectPeriodTo:'18-11-2026'}])
  assert.throws(()=>parseOptions(invalid),/Período de Projetos e Prazos inválido/);
 assert.doesNotThrow(()=>parseOptions({projectPeriodFrom:'2026-11-18',projectPeriodTo:'2026-11-18'}));
});
test('AI charge still rejects nonpositive and excessive workday goals',()=>{
 assert.throws(()=>parseOptions({projectDailyGoalHours:0}),/Meta diária de projetos inválida/);
 assert.throws(()=>parseOptions({projectWorkdayHours:25}),/Configuração de previsão de projetos inválida/);
});
