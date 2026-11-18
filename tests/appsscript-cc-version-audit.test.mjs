import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const workflow=readFileSync(new URL('../.github/workflows/appsscript-clasp-controlled.yml',import.meta.url),'utf8');
const script=fileURLToPath(new URL('../apps-script/ci-clasp-cc-live-audit.mjs',import.meta.url));
test('audit reports versioned CC contract without invoking doPost, sending mail or exposing deployment IDs',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'cc-audit-'));
 try{
  const list=join(tmp,'deployments.txt'),root=join(tmp,'root'),summary=join(tmp,'summary.md');
  writeFileSync(list,'Found 3 deployments.\n- AKfySensitiveSecretHEAD @HEAD\n- AKfySensitiveSecretNew @24 - production\n- AKfySensitiveSecretOld @22 - legacy\n');
  mkdirSync(join(root,'head'),{recursive:true});
  mkdirSync(join(root,'versions','v24'),{recursive:true});
  mkdirSync(join(root,'versions','v22'),{recursive:true});
  writeFileSync(join(root,'head','Código.js'),"function doPost(e){ if(dados.action==='capabilities')return resposta({sucesso:true,ccSupported:true});MailApp.sendEmail({cc:cc.join(', ')}); }");
  writeFileSync(join(root,'versions','v24','Código.js'),"function doPost(e){if(dados.action==='capabilities')return resposta({sucesso:true,ccSupported:true});MailApp.sendEmail({to:'x',cc:cc.join(', ')}); }");
  writeFileSync(join(root,'versions','v22','Código.js'),"function doPost(e){if(dados.action==='capabilities')return resposta({sucesso:true});MailApp.sendEmail({to:'x'}); }");
  const v=spawnSync(process.execPath,[script,'versions',list],{encoding:'utf8'});
  assert.equal(v.status,0,v.stderr);
  assert.equal(v.stdout,'24 22');
  const r=spawnSync(process.execPath,[script,'report',list,root,summary],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const text=readFileSync(summary,'utf8');
  assert.match(text,/\| 24 \| sim \| sim \| sim \| compatível no código \|/);
  assert.match(text,/\| 22 \| sim \| não \| não \| incompleto \/ revisar \|/);
  assert.doesNotMatch(text,/AKfySensitiveSecret/);
  assert.doesNotMatch(r.stdout,/AKfySensitiveSecret/);
 }finally{rmSync(tmp,{recursive:true,force:true})}
});

test('independent CC audit runs even if inventory reconciliation fails closed',()=>{
 const section=workflow.split('  cc-readonly-audit:')[1]?.split('  zenvia-isolated-tests:')[0];
 assert.ok(section,'independent cc audit job missing');
 assert.match(section,/clasp list-deployments/);
 assert.match(section,/clasp pull --versionNumber/);
 assert.match(section,/ci-clasp-cc-live-audit\.mjs" report/);
 assert.match(section,/secrets\.CLASPRC_JSON/);
 assert.doesNotMatch(section,/clasp push|clasp create-version|clasp create-deployment|MailApp/);
 assert.doesNotMatch(section,/needs:\s*audit/);
 const main=workflow.split('  audit:')[1]?.split('  cc-readonly-audit:')[0];
 assert.ok(main?.includes('ci-clasp-reconcile-dry-run.mjs'),'reconciliation guard accidentally removed');
});

test('remote inventory audit identifies duplicates without changing allowlist or disclosing source',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'inventory-triage-'));
 try{
  const remote=join(tmp,'remote'),summary=join(tmp,'summary.md');
  mkdirSync(remote,{recursive:true});
  writeFileSync(join(remote,'Código.js'),
    'function doPost(e){}\nfunction arquemCreateReportAttachments_(){}\nfunction arquemCapacidadesAnexos_(){}\n');
  writeFileSync(join(remote,'homologacao-pr103-isolada.js'),
    'function arquemCreateReportAttachments_(){}\nfunction arquemHomologarKeilaSemEnvio(){}\nfunction arquemValidarPublicacaoSemEnvio(){}\n');
  const script=fileURLToPath(new URL('../apps-script/ci-clasp-inventory-triage.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,remote,summary],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const output=readFileSync(summary,'utf8');
  assert.match(output,/Arquivos JavaScript: 2/);
  assert.match(output,/Funções globais únicas: 5/);
  assert.match(output,/Funções com múltiplas definições: 1/);
  assert.match(output,/arquemCreateReportAttachments_/);
  assert.match(output,/homologacao-pr103-isolada.js/);
  assert.doesNotMatch(output,/function doPost\(e\)/);
  assert.match(result.stdout,/INVENTORY_DUPLICATE/);
 }finally{rmSync(tmp,{recursive:true,force:true})}
});
test('inventory review remains read-only and release allowlist unchanged',()=>{
 const runner=workflow.split('  cc-readonly-audit:')[1]?.split('  zenvia-isolated-tests:')[0];
 assert.match(runner,/ci-clasp-inventory-triage\.mjs/);
 assert.doesNotMatch(runner,/clasp push|create-deployment|create-version/);
 const recon=readFileSync(new URL('../apps-script/ci-clasp-reconcile-dry-run.mjs',import.meta.url),'utf8');
 assert.match(recon,/approvedInventories = new Set\(\['6:39', '8:48'\]\)/);
 assert.doesNotMatch(recon,/'9:49'/);
});
