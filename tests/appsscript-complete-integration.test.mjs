import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const file=await readFile(new URL('../apps-script/central-auditoria-emails-completo.gs',import.meta.url),'utf8');
const TEMPLATE='1T7dKL5aJA6dPoAUmfmtV4_ywDNwgaAE9nGy62o59gLA';
function harness(){
 const props=new Map([['MAIL_SECRET','unit-only-secret'],['ARQUEM_PAPEL_TIMBRADO_DOC_ID',TEMPLATE]]);
 let deliveries=0, exportRuns=0;
 const document={getBody:()=>({})},fileObj={getMimeType:()=> 'application/vnd.google-apps.document',getLastUpdated:()=>new Date('2026-11-09T00:00:00Z')};
 const context={
   PropertiesService:{getScriptProperties:()=>({
      getProperty:k=>props.get(k)||null,setProperties:o=>{for(const [k,v] of Object.entries(o))props.set(k,v)}
   })},
   DriveApp:{getFileById:id=>{if(id!==TEMPLATE)throw Error('not found');return fileObj}},
   DocumentApp:{openById:id=>{if(id!==TEMPLATE)throw Error('not found');return document}},
   MimeType:{GOOGLE_DOCS:'application/vnd.google-apps.document'},
   ContentService:{MimeType:{JSON:'application/json'},createTextOutput:value=>({setMimeType(){return this},getContent(){return value}})},
   MailApp:{getRemainingDailyQuota:()=>500,sendEmail(){deliveries++}},
   console,Date,JSON
 };
 vm.createContext(context);vm.runInContext(file,context);
 // Override artifact generation; this verifies the integrated dispatch and lifecycle.
 context.arquemTesteAnexosSemEnvio=()=>{exportRuns++;return {ok:true,sent:false,files:[{name:'sample.pdf'},{name:'sample.xlsx'}]}};
 context.arquemCreateReportAttachments_=()=>[{name:'sample.pdf'},{name:'sample.xlsx'}];
 const post=data=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({token:'unit-only-secret',...data})}}).getContent());
 return {context,post,props,get deliveries(){return deliveries},get exportRuns(){return exportRuns}};
}
test('one doPost and one PDF/XLSX generator',()=>{
 assert.equal((file.match(/function doPost\s*\(/g)||[]).length,1);
 assert.equal((file.match(/function arquemCreateReportAttachments_\s*\(/g)||[]).length,1);
});
test('capabilities cannot announce ready before actual dry run',()=>{
 const h=harness();
 assert.equal(h.post({action:'capabilities'}).paperTemplateConfigured,false);
 assert.equal(h.deliveries,0);
});
test('unauthenticated health does not disclose readiness',()=>{
 const h=harness();
 const response=JSON.parse(h.context.doPost({postData:{contents:JSON.stringify({token:'wrong',action:'capabilities'})}}).getContent());
 assert.equal(response.sucesso,false);
 assert.equal(h.deliveries,0);
});
test('dry run validates template and capabilities without sending email',()=>{
 const h=harness();
 h.context.arquemValidarPublicacaoSemEnvio();
 const report=h.post({action:'capabilities'});
 assert.equal(report.paperTemplateConfigured,true);
 assert.deepEqual([...report.formats],['pdf','xlsx']);
 assert.equal(h.exportRuns,1);
 assert.equal(h.deliveries,0);
});
test('attachment sending remains gated until validated',()=>{
 const h=harness();
 const p={email:'destinatario@arquem.com.br',assunto:'Teste',texto:'Corpo',
  reportData:{schema:'arquem-mail-v1'}};
 assert.equal(h.post(p).sucesso,false);
 assert.equal(h.deliveries,0);
});
test('changing template invalidates previous approval',()=>{
 const h=harness();h.context.arquemValidarPublicacaoSemEnvio();
 h.props.set('ARQUEM_PAPEL_TIMBRADO_DOC_ID','other-id');
 assert.equal(h.post({action:'capabilities'}).paperTemplateConfigured,false);
 assert.equal(h.deliveries,0);
});
