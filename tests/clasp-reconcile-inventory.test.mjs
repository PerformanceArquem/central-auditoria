import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const script=resolve('apps-script/ci-clasp-reconcile-dry-run.mjs');
const modulesDir=process.env.ACORN_MODULES_DIR;
if(!modulesDir)throw Error('ACORN_MODULES_DIR deve apontar para a instalacao isolada do acorn');
const names=[
 'Código.js','ZenviaVozChat.js','arquem-relatorios-anexos.gs.js',
 'homologacao-zenvia-pr68.js','intelligence-triage-mail.js',
 'validacao-sem-envio.js','arquem-comparativos.gs.js','homologacao-pr103-isolada.js'
];
function fixture(extra={}){
 const root=mkdtempSync(join(tmpdir(),'clasp-reconcile-test-'));
 const input=join(root,'remote'),output=join(root,'out');
 mkdirSync(input);
 const fns={
  'ZenviaVozChat.js': 'function doPost(){}\nfunction arquemCreateReportAttachments_(){}\n'+
   'function arquemCapacidadesAnexos_(){}\nfunction arquemPdf_(){}\nfunction arquemXlsx_(){}\n',
  'arquem-relatorios-anexos.gs.js': 'function arquemValidarPublicacaoSemEnvio(){}\n',
  'homologacao-zenvia-pr68.js': 'function arquemHomologarKeilaSemEnvio(){}\n',
  ...extra
 };
 for(const file of names)writeFileSync(join(input,file),fns[file]||'// arquivo isolado\n');
 writeFileSync(join(input,'appsscript.json'),'{"timeZone":"America/Sao_Paulo"}');
 const summary=join(root,'summary.md');
 writeFileSync(summary,'');
 return {root,input,output,summary};
}
function execute(f){
 const x=spawnSync(process.execPath,[script,f.input,f.output,f.summary,modulesDir],{encoding:'utf8'});
 return {code:x.status,message:x.stdout+'\n'+x.stderr};
}
test('bloqueia função duplicada introduzida pelo arquivo de homologação isolada',()=>{
 const f=fixture({'homologacao-pr103-isolada.js':'function arquemPdf_(){}\n'});
 try{
  const r=execute(f);
  assert.notEqual(r.code,0);
  assert.match(r.message,/AUDITORIA BLOQUEADA:/);
  assert.match(r.message,/arquemPdf_/);
  assert.match(r.message,/homologacao-pr103-isolada\.js/);
  assert.equal(readFileSync(join(f.input,'homologacao-pr103-isolada.js'),'utf8'),'function arquemPdf_(){}\n');
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test('bloqueia repetição de função no mesmo arquivo',()=>{
 const f=fixture({'homologacao-pr103-isolada.js':'function arquemPrepararRevisaoVisualAjustesSemEnvio(){}\nfunction arquemPrepararRevisaoVisualAjustesSemEnvio(){}\n'});
 try{
  const r=execute(f);
  assert.notEqual(r.code,0);
  assert.match(r.message,/AUDITORIA BLOQUEADA:/);
  assert.match(r.message,/arquemPrepararRevisaoVisualAjustesSemEnvio/);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test('não aprova inventário diferente mesmo que não haja duplicatas',()=>{
 const f=fixture();
 try{
  const r=execute(f);
  assert.notEqual(r.code,0);
  assert.match(r.message,/Unexpected inventory/);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});

test('deduplica apenas corpo byte-idêntico em memória; preserva arquivos remotos',()=>{
 const duplicate='function arquemPdf_(){}\n';
 const f=fixture({'homologacao-pr103-isolada.js':duplicate});
 // The fixture is deliberately too small for approval, but its exact duplicate
 // must not be reported as a conflicting implementation.
 try{
  const r=execute(f);
  assert.notEqual(r.code,0);
  assert.doesNotMatch(r.message,/AUDITORIA BLOQUEADA:/);
  assert.match(r.message,/Unexpected inventory/);
  const diagnostic=readFileSync(f.summary,'utf8');
  assert.match(diagnostic,/Duplicidades textualmente idênticas encontradas: 1/);
  assert.match(diagnostic,/Conflitos com implementações diferentes: 0/);
  assert.equal(readFileSync(join(f.input,'homologacao-pr103-isolada.js'),'utf8'),duplicate);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
