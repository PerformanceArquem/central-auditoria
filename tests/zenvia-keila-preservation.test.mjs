import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync('supabase/functions/audit-email-dispatch/index.ts','utf8');
const active=readFileSync('supabase/functions/audit-email-dispatch/production-flow-keila.ts','utf8');
const archived=readFileSync('supabase/functions/audit-email-dispatch/production-flow-keila-expanded.draft.ts','utf8');

test('Keila official report keeps live two-counter presentation',()=>{
 assert.match(active,/Rastreabilidade dos chamados da Produção/);
 assert.match(active,/ENTRADAS/);
 assert.match(active,/SAÍDAS/);
 assert.match(active,/metrics:\{entered,exited\}/);
 assert.match(active,/productionFlow:\{entered,exited,movements:data\.movements\.map/);
 assert.ok(!active.includes('KeilaQualityRow'));
});
test('expanded Keila proposal is archived and not imported in official dispatch',()=>{
 assert.match(archived,/CANDIDATO FUTURO, NAO IMPORTAR/);
 assert.match(archived,/KeilaQualityRow/);
 assert.ok(!index.includes('production-flow-keila-expanded.draft.ts'));
 assert.match(index,/from "\.\/production-flow-keila\.ts"/);
 assert.match(index,/keilaProductionReport\(data,task\.kind\)/);
});
test('Zenvia metrics do not enrich Keila production flow',()=>{
 assert.match(index,/const allowVoiceEmails=new Map<string,string>/);
 const from=index.indexOf('const allowVoiceEmails=');
 const until=index.indexOf('const eligible=',from);
 const allowed=index.slice(from,until);
 assert.ok(!allowed.includes("a5329710-dd63-4bfd-bbd3-dc23e0efc8f0"));
 assert.match(index,/reportData&&!reportData\.productionFlow/);
 assert.match(index,/ZENVIA_VOICE_REPORTS_ENABLED/);
});
