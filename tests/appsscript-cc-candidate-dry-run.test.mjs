import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../apps-script/ci-clasp-cc-candidate-dry-run.mjs',import.meta.url));
const workflow=readFileSync(new URL('../.github/workflows/appsscript-clasp-controlled.yml',import.meta.url),'utf8');
const modules=process.env.ACORN_DIR;
test('read-only candidate changes only doPost; preserves file list and manifest',()=>{
 assert.ok(modules,'ACORN_DIR required');
 const root=mkdtempSync(join(tmpdir(),'cc-candidate-test-'));
 try{
  const input=join(root,'original'),out=join(root,'preview'),summary=join(root,'summary.md');
  mkdirSync(input);
  const source=[
   "function doPost(e){",
   "const segredo=PropertiesService.getScriptProperties().getProperty('MAIL_SECRET');",
   "const dados=JSON.parse(e.postData.contents);",
   "if(dados.token!==segredo)throw Error('Unauthorized');",
   "if(dados.action==='capabilities')return resposta(arquemCapacidadesAnexos_());",
   "MailApp.sendEmail({to:dados.email,subject:'x',body:'x'});",
   "return resposta({sucesso:true});",
   "}",
   "function outraFuncao(){return 1;}"
  ].join('\n');
  writeFileSync(join(input,'Código.js'),source);
  writeFileSync(join(input,'homologacao-pr103-isolada.js'),'function helperPr103(){}\n');
  for(let i=0;i<7;i++){
   const count=i<4?7:6; // 28 + 18 = 46, plus 3 = 49 globals
   writeFileSync(join(input,'set-'+i+'.js'),Array.from({length:count},(_,j)=>
    'function helper_'+i+'_'+j+'(){}\n').join(''));
  }
  writeFileSync(join(input,'appsscript.json'),'{"timeZone":"America/Sao_Paulo"}');
  const r=spawnSync(process.execPath,[script,input,out,summary,modules],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/STAGING_OK/);
  assert.equal(readFileSync(join(out,'appsscript.json'),'utf8'),readFileSync(join(input,'appsscript.json'),'utf8'));
  assert.match(readFileSync(join(out,'Código.js'),'utf8'),/ccSupported:true/);
  assert.match(readFileSync(join(out,'Código.js'),'utf8'),/MailApp.sendEmail\(\{to:dados.email,subject:'x',body:'x', \.\.\.\(cc.length/);
  assert.match(readFileSync(join(out,'Código.js'),'utf8'),/function outraFuncao\(\)\{return 1;\}/);
  assert.equal(readFileSync(join(out,'set-0.js'),'utf8'),readFileSync(join(input,'set-0.js'),'utf8'));
  assert.notEqual(readFileSync(join(out,'Código.js'),'utf8'),source);
 }finally{rmSync(root,{recursive:true,force:true})}
});
test('staging code does not send or publish',()=>{
 const run=workflow.split('  cc-candidate-dryrun:')[1]?.split('  zenvia-isolated-tests:')[0];
 assert.ok(run);
 assert.match(run,/ci-clasp-cc-candidate-dry-run\.mjs/);
 assert.doesNotMatch(run,/clasp push|clasp update-deployment|MailApp\.sendEmail|upload-artifact/);
 const src=readFileSync(script,'utf8');
 assert.doesNotMatch(src,/clasp push|execSync\(|fetch\(|create-deployment/);
 assert.match(src,/names\.size!==49/);
});
