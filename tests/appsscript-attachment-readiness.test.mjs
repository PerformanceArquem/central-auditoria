import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const script=await readFile(new URL('../apps-script/arquem-relatorios-anexos.gs',import.meta.url),'utf8');
const template='1T7dKL5aJA6dPoAUmfmtV4_ywDNwgaAE9nGy62o59gLA';
const modified=new Date('2026-11-10T13:00:00Z');
function environment(){
 const map=new Map();
 const properties={getProperty:key=>map.get(key)||null,
   setProperties:(values)=>{for(const [k,v] of Object.entries(values))map.set(k,v)}};
 const file={getMimeType:()=> 'application/vnd.google-apps.document', getLastUpdated:()=>modified};
 const context={PropertiesService:{getScriptProperties:()=>properties},
   DriveApp:{getFileById:(id)=>{if(id!==template)throw Error('Not found');return file}},
   DocumentApp:{openById:(id)=>{if(id!==template)throw Error('Not found');return {getBody:()=>({})}}},
   MimeType:{GOOGLE_DOCS:'application/vnd.google-apps.document'},console,Date};
 vm.createContext(context);vm.runInContext(script,context);
 return {context,map,file};
}
test('capabilities blocked without configured or validated template',()=>{
 const {context,map}=environment();
 assert.equal(context.arquemCapacidadesAnexos_().paperTemplateConfigured,false);
 map.set('ARQUEM_PAPEL_TIMBRADO_DOC_ID',template);
 assert.equal(context.arquemCapacidadesAnexos_().paperTemplateConfigured,false);
});
test('validating PDF and Excel without email unlocks matching model',()=>{
 const {context,map}=environment();
 map.set('ARQUEM_PAPEL_TIMBRADO_DOC_ID',template);
 context.arquemTesteAnexosSemEnvio=()=>({ok:true,sent:false,files:[
   {name:'report.pdf'},{name:'report.xlsx'}]});
 const outcome=context.arquemValidarPublicacaoSemEnvio();
 assert.equal(outcome.sent,false);
 assert.equal(context.arquemCapacidadesAnexos_().paperTemplateConfigured,true);
 map.set('ARQUEM_PAPEL_TIMBRADO_DOC_ID','different');
 assert.equal(context.arquemCapacidadesAnexos_().paperTemplateConfigured,false);
});
test('refuses to activate attachments after a failed dry run',()=>{
 const {context,map}=environment();
 map.set('ARQUEM_PAPEL_TIMBRADO_DOC_ID',template);
 context.arquemTesteAnexosSemEnvio=()=>{throw Error('PDF export failed')};
 assert.throws(()=>context.arquemValidarPublicacaoSemEnvio(),/PDF export failed/);
 assert.equal(context.arquemCapacidadesAnexos_().paperTemplateConfigured,false);
});
test('requires two generated attachments and no outgoing email',()=>{
 const {context,map}=environment();
 map.set('ARQUEM_PAPEL_TIMBRADO_DOC_ID',template);
 context.arquemTesteAnexosSemEnvio=()=>({ok:true,sent:true,files:[{},{}]});
 assert.throws(()=>context.arquemValidarPublicacaoSemEnvio(),/nao passaram/);
 assert.equal(context.arquemCapacidadesAnexos_().paperTemplateConfigured,false);
});
