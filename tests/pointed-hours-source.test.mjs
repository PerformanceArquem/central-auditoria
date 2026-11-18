import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const githubPath=new URL('../',import.meta.url);
const source=path=>readFileSync(new URL(path,githubPath),'utf8');

test('Movidesk timeAppointments workTime is the exclusive primary source of Horas Apontadas',()=>{
 for(const file of ['supabase/functions/movidesk-incremental-sync/index.ts','api/audit-report-source.js']){
  const code=source(file);
  assert.match(code,/p\.workTime/);
  assert.doesNotMatch(code,/p\.workTime\s*\?\?\s*p\.accountedTime/);
 }
});

test('chat IA derives displayed Horas Apontadas from synchronized duration_minutes',()=>{
 const code=source('supabase/functions/audit-ai-reports/index.ts');
 assert.match(code,/metric:'Horas Apontadas \(workTime do Movidesk\)'/);
 assert.match(code,/minutes\+=r\.duration_minutes/);
 assert.match(code,/sum\(rows\)\/60/);
});

test('report source must never prefer accountedTime over workTime',()=>{
 const code=source('api/audit-report-source.js');
 assert.match(code,/append\(p\.workTime,/);
 assert.doesNotMatch(code,/append\(p\.accountedTime,/);
});
