import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const script=fileURLToPath(new URL('../apps-script/ci-clasp-cc-promotion-guard.mjs',import.meta.url));
const workflow=readFileSync(new URL('../.github/workflows/appsscript-clasp-controlled.yml',import.meta.url),'utf8');
function run(...args){return spawnSync(process.execPath,[script,...args],{encoding:'utf8'});}
test('target deployment must match exact old version and never print its ID',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'cc-promote-'));
 try{
  const list=join(tmp,'deployments.txt');
  const id='AKfySecretDeployment123456789';
  writeFileSync(list,'Found 2 deployments.\n- '+id+' @20 - production\n- AKfyAnotherDeployment123456789 @7 - legacy\n');
  const ok=run('deployment',list,id,'20');
  assert.equal(ok.status,0,ok.stderr);
  assert.match(ok.stdout,/version=20/);
  assert.doesNotMatch(ok.stdout,/AKfySecretDeployment/);
  assert.notEqual(run('deployment',list,id,'21').status,0);
  assert.notEqual(run('deployment',list,'AKfyUnknownDeployment1234','20').status,0);
 }finally{rmSync(tmp,{recursive:true,force:true})}
});
test('candidate must have authenticated CC capability, send and validation',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'cc-candidate-'));
 try{
  const summary=join(tmp,'summary.md');
  for(let i=0;i<6;i++)writeFileSync(join(tmp,'module'+i+'.js'),'function unique'+i+'(){}\n');
  const target=join(tmp,'module0.js');
  writeFileSync(target,`function doPost(e){
   const segredo=PropertiesService.getScriptProperties().getProperty('MAIL_SECRET');
   const dados=JSON.parse(e.postData.contents);
   if(dados.token!==segredo)throw Error('Unauthorized');
   if(dados.action==='capabilities')return resposta({sucesso:true,ccSupported:true});
   const cc=dados.cc; if(cc.length>10||new Set(cc).size!==cc.length)throw Error('Invalid');
   MailApp.sendEmail({to:'recipient',cc:cc.join(', '),subject:'x',body:'x'});
  }`);
  const ok=run('candidate',tmp,summary,'21');
  assert.equal(ok.status,0,ok.stderr);
  assert.match(ok.stdout,/CANDIDATE_STATIC_OK/);
  assert.notEqual(run('candidate',tmp,summary,'0').status,0);
  writeFileSync(target,readFileSync(target,'utf8').replace('ccSupported:true','ccSupported:false'));
  assert.notEqual(run('candidate',tmp,summary,'21').status,0);
 }finally{rmSync(tmp,{recursive:true,force:true})}
});
test('production promotion is strictly manual, gated and never sends',()=>{
 const job=workflow.split('  activate-cc:')[1];
 assert.ok(job);
 assert.match(job,/inputs\.operation == 'activate_cc'/);
 assert.match(job,/environment: apps-script-production/);
 assert.match(job,/APPS_SCRIPT_RELEASE_ENABLED/);
 assert.match(job,/test "\$APPROVED_COMMIT" = "\$GITHUB_SHA"/);
 assert.match(job,/cc_expected_current_version/);
 assert.match(job,/ci-clasp-cc-promotion-guard\.mjs" candidate/);
 assert.match(job,/clasp update-deployment "\$TARGET_ID" --versionNumber "\$NEW_VERSION"/);
 assert.match(job,/cc-deployments-after/);
 assert.doesNotMatch(job,/clasp push|MailApp\.sendEmail|clasp create-deployment/);
 assert.match(workflow,/Existing \/exec deployment NOT updated/);
});

test('promotion rejects version files unless their exact approved SHA-256 matches',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'cc-hash-'));
 try{
  const files=['appsscript.json','Código.js','A.js','B.js','C.js','D.js','E.js'];
  for(const file of files)writeFileSync(join(tmp,file),file==='appsscript.json'?'{"timeZone":"America/Sao_Paulo"}':'function marker(){}');
  const h=createHash('sha256');
  for(const file of files.slice().sort()){
   h.update(file);h.update('\\0');h.update(readFileSync(join(tmp,file)));h.update('\\0');
  }
  const approved=h.digest('hex');
  assert.equal(run('sha256',tmp,approved).status,0);
  writeFileSync(join(tmp,'A.js'),'function modified(){}');
  assert.notEqual(run('sha256',tmp,approved).status,0);
  assert.notEqual(run('sha256',tmp,'invalid').status,0);
 }finally{rmSync(tmp,{recursive:true,force:true})}
});
test('manual CC promotion requires approved content hash as a release input',()=>{
 const job=workflow.split('  activate-cc:')[1];
 assert.match(workflow,/cc_approved_version_sha256:/);
 assert.match(job,/VERSION_SHA: \$\{\{ inputs\.cc_approved_version_sha256 \}\}/);
 assert.match(job,/sha256 \\\n\s+"\$PWD" "\$VERSION_SHA"/);
 assert.match(job,/\[\[ "\$VERSION_SHA" =~ \^\[a-f0-9\]\{64\}\$ \]\]/);
});
