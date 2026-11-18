import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../supabase/functions/audit-email-dispatch/index.ts',import.meta.url),'utf8');
const start=source.indexOf('function keilaFlowPeriods(');
const end=source.indexOf('// Só considerar indicadores',start);
assert.ok(start>=0&&end>start,'Keila period function must exist');
const ts=source.slice(start,end);
const js=stripTypeScriptTypes(ts);
const weekday=d=>new Date(d+'T12:00:00Z').getUTCDay();
const shift=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const periods=new Function('weekday','shift','FIRST_MONTHLY_RUN',js+';return keilaFlowPeriods;')(weekday,shift,'2026-01-01');
const holidays=new Set(['2026-11-20']);
test('20 November 2026 holiday generates no daily or weekly Keila automatic report',()=>{
  assert.deepEqual(periods('2026-11-20',holidays),[]);
});
test('23 November daily production flow uses Thursday 19, not Sunday 22 or holiday 20',()=>{
  const tasks=periods('2026-11-23',holidays);
  assert.deepEqual(tasks.find(x=>x.kind==='daily'),{kind:'daily',from:'2026-11-19',to:'2026-11-19'});
  assert.ok(tasks.some(x=>x.kind==='weekly'&&x.from==='2026-11-16'&&x.to==='2026-11-22'));
});
test('ordinary day remains previous business day and weekend boundaries stay excluded',()=>{
  const tasks=periods('2026-11-19',holidays);
  assert.deepEqual(tasks.find(x=>x.kind==='daily'),{kind:'daily',from:'2026-11-18',to:'2026-11-18'});
  assert.deepEqual(periods('2026-11-21',holidays),[]);
});
