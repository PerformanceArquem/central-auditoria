import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../ai-reports.js',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/audit-ai-reports/index.ts',import.meta.url),'utf8');
test('chat de relatórios fica acessível no painel com período, filtros e exportação',()=>{
 for(const id of ['aiReportOpen','aiReportPanel','aiReportFrom','aiReportTo','aiReportSector','aiReportCollaborator','aiReportClient','aiReportPrompt','aiReportConsent','aiReportExport','aiReportPrint'])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/<script src="\.\/ai-reports.js" defer>/);
 assert.doesNotThrow(()=>new Function(ui));
});
test('consulta exige sessão de administrador e usa dados somente leitura',()=>{
 assert.match(edge,/auth\/v1\/user/);
 assert.match(edge,/audit_users\?select=role,is_active/);
 assert.match(edge,/is_active!==false/);
 assert.match(edge,/if\(!await authorized\(/);
 assert.match(edge,/req.method!=='POST'/);
 assert.match(edge,/maxRecords=4000/);
 assert.doesNotMatch(edge,/method:'DELETE'|method:'PATCH'|method:'PUT'|method:'POST'.*rest\/v1/);
});
test('relatório só envia agregados ao Gemini após consentimento e possui resposta local',()=>{
 assert.match(edge,/externalAiConsent===true/);
 assert.match(edge,/if\(!consent\|\|!secret/);
 assert.match(edge,/basicAnswer\(data,prompt\)/);
 assert.match(edge,/systemInstruction/);
 assert.match(edge,/Não invente métricas/);
 assert.match(edge,/audit_email_holidays/);
 assert.match(edge,/hoursOutsideBusinessDays/);
 assert.match(ui,/textContent=message/);
});
test('módulo TypeScript da Edge Function tem sintaxe válida após remoção de tipos',()=>{
 const stripped=stripTypeScriptTypes(edge);
 assert.doesNotThrow(()=>new Function('Deno',stripped));
});

test('preflight permite os cabeçalhos do cliente Supabase nos domínios oficiais',async()=>{
 let handler;
 new Function('Deno',stripTypeScriptTypes(edge))({serve(fn){handler=fn}});
 const origin='https://centralauditoria.ddns.net';
 const request=(domain)=>new Request('https://example.com',{method:'OPTIONS',headers:{
  origin:domain,'Access-Control-Request-Method':'POST',
  'Access-Control-Request-Headers':'authorization,apikey,content-type,x-client-info'
 }});
 const response=await handler(request(origin));
 assert.equal(response.status,204);
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
 const allowed=response.headers.get('Access-Control-Allow-Headers').split(/,\s*/);
 for(const header of ['authorization','apikey','content-type','x-client-info'])assert.ok(allowed.includes(header));
 const forbidden=await handler(request('https://example.org'));
 assert.equal(forbidden.status,403);
 assert.equal(forbidden.headers.has('Access-Control-Allow-Origin'),false);
});
