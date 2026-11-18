import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const script=fileURLToPath(new URL('../apps-script/ci-clasp-pr103-overlay-dry-run.mjs',import.meta.url));
const acorn=process.env.ACORN_DIR;
test('PR103 rehearsal preserves canonical functions and removes only redundant temp declarations',()=>{
 assert.ok(acorn,'ACORN_DIR required in CI');
 const temp=mkdtempSync(join(tmpdir(),'pr103-dryrun-'));
 try{
  const input=join(temp,'remote'),output=join(temp,'output'),summary=join(temp,'report.md');
  mkdirSync(input,{recursive:true});
  const fn=n=>`function ${n}(){return "${n}"}\n`;
  const first=['arquemCreateReportAttachments_','arquemPdf_','arquemXlsx_'];
  const second=['arquemAjustesValidos_','arquemAmostraAjustes_','arquemAssinarAjustes_','arquemHomologarAjustesSemEnvio'];
  const special='arquemPrepararRevisaoVisualAjustesSemEnvio';
  const core=['doPost','arquemCapacidadesAnexos_','arquemHomologarKeilaSemEnvio','arquemValidarPublicacaoSemEnvio'];
  writeFileSync(join(input,'ZenviaVozChat.js'),first.map(fn).join(''));
  writeFileSync(join(input,'arquem-relatorios-anexos.gs.js'),second.map(fn).join(''));
  writeFileSync(join(input,'Código.js'),core.map(fn).join(''));
  writeFileSync(join(input,'homologacao-pr103-isolada.js'),[...first,...second,special,special].map(fn).join(''));
  for(let i=0;i<5;i++){
   const begin=i*8,end=Math.min(37,(i+1)*8);
   writeFileSync(join(input,'extra-'+i+'.js'),
      Array.from({length:Math.max(0,end-begin)},(_,j)=>fn('other_'+(begin+j))).join(''));
  }
  writeFileSync(join(input,'appsscript.json'),'{"timeZone":"America/Sao_Paulo"}');
  const result=spawnSync(process.execPath,[script,input,output,summary,acorn],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/PR103_OVERLAY_DRY_RUN_OK duplicates=8 removed=8 globals=49 files=9 deployAuthorized=false/);
  const cleaned=readFileSync(join(output,'homologacao-pr103-isolada.js'),'utf8');
  assert.equal((cleaned.match(/function /g)||[]).length,1);
  assert.match(cleaned,/arquemPrepararRevisaoVisualAjustesSemEnvio/);
  assert.equal(readFileSync(join(output,'Código.js'),'utf8'),readFileSync(join(input,'Código.js'),'utf8'));
  assert.equal(readFileSync(join(output,'ZenviaVozChat.js'),'utf8'),readFileSync(join(input,'ZenviaVozChat.js'),'utf8'));
  assert.equal(readFileSync(join(output,'appsscript.json'),'utf8'),readFileSync(join(input,'appsscript.json'),'utf8'));
  assert.match(readFileSync(summary,'utf8'),/Não é uma autorização de publicação/);
 }finally{rmSync(temp,{recursive:true,force:true})}
});
test('a changed PR103 duplicate aborts rehearsal rather than quietly choosing a version',()=>{
 assert.ok(acorn,'ACORN_DIR required in CI');
 const src=readFileSync(script,'utf8');
 assert.match(src,/own\.some\(c=>c\.body!==own\[0\]\.body\)/);
 assert.match(src,/const allowed=new Set\(/);
 assert.match(src,/filenames\.length!==9/);
 assert.doesNotMatch(src,/clasp push|MailApp\.sendEmail|deployments\.create/);
});
