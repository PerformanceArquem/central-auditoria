import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const script=new URL('../scripts/audit-appsscript-project.mjs',import.meta.url).pathname;
const workflow=await readFile(new URL('../.github/workflows/audit-appsscript-installation.yml',import.meta.url),'utf8');
test('pipeline somente leitura e não publica nem executa scripts',()=>{
 assert.match(workflow,/clasp" pull/);
 assert.doesNotMatch(workflow,/(?:clasp|CLASP).*\b(?:push|deploy|run)\b/);
 assert.match(workflow,/secrets.CLASPRC_JSON/);
});
test('rejeita projeto sem doPost válido',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'audit-script-'));
 try{
  const remote=path.join(dir,'remote');await mkdir(remote);
  const source=path.join(dir,'new.gs'),old=path.join(remote,'Old.gs');
  await writeFile(source,'function doPost(e) {}\nfunction arquemCreateReportAttachments_() {}');
  await writeFile(old,'function otherHandler(e) {}');
  let failed=false;
  try{execFileSync('node',[script,remote,source],{stdio:'pipe'})}catch(e){failed=e.status===2;}
  assert.equal(failed,true);
 }finally{await rm(dir,{recursive:true,force:true})}
});
