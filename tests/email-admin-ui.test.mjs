import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const extract=id=>{
 const escaped=id.replace(/[.*+?^\$\{\}()|[\]\\]/g,'\\$&');
 const regex=new RegExp('<script\\b[^>]*id="'+escaped+'"[^>]*>([\\s\\S]*?)<\\/script>','i');
 const match=html.match(regex);
 assert.ok(match,'Script '+id+' não encontrado');
 return match[1];
};
test('painel de destinatários compila e registra o evento de clique',()=>{
 const source=extract('emailAdminIntegratedScript');
 assert.doesNotThrow(()=>new Function(source));
 assert.match(source,/emailAdminOpen'\)\.addEventListener\('click'/);
 assert.match(html,/id="emailAdminOpen"/);
 assert.match(html,/id="emailAdminPanel"/);
});
test('a prévia administrativa mantém seção de auditoria fora da alternativa condicional',()=>{
 const source=extract('emailAdminIntegratedScript');
 assert.match(source,/\)\+forecastSection;/);
});
test('os scripts essenciais de interface compilam',()=>{
 for(const id of ['reportPreviewScript','executiveReportScript','productionAuditScript']){
  assert.doesNotThrow(()=>new Function(extract(id)),id);
 }
});
