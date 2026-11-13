import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../apps-script/intelligence-triage-mail.gs',import.meta.url),'utf8');
function fixture(initial,fail=false){
 const properties=new Map(initial?[['TRIAGE_digest',initial]]:[]),sent=[];
 const context=vm.createContext({console:{error(){}},Error,LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v)})},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:()=>[],base64EncodeWebSafe:()=> 'digest',base64Decode:x=>x,newBlob:(bytes,mime,name)=>({getBytes:()=>Array.from({length:1200},(_,i)=>i===0?80:i===1?75:0),getDataAsString:()=>mime==='application/pdf'?'%PDF-1.7':'PK',getName:()=>name})},
  MailApp:{getRemainingDailyQuota:()=>100,sendEmail:message=>{if(fail)throw Error('Resposta incerta');sent.push(message);}}});
 vm.runInContext(code,context);
 const request={action:'triage_send',email:'zanona@arquem.com.br',dispatchKey:'intelligence-triage:2026-11-13:zanona@arquem.com.br',assunto:'Triagem',texto:'Relatório',html:'<p>Relatório</p>',report:{schema:'arquem-triage-v1',date:'2026-11-13',items:[],metrics:{total:0}},files:[{name:'report.pdf',mime:'application/pdf',base64:'pdf'},{name:'report.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:'xlsx'}]};
 return {properties,sent,request,run:r=>context.arquemTriageAction_(r||request)};
}
test('registro confirmado retorna mesmo aceite sem repetir envio',()=>{const f=fixture('sent:mailapp:existing');const r=f.run();assert.equal(r.accepted,true);assert.equal(r.providerId,'mailapp:existing');assert.equal(f.sent.length,0);});
test('tentativa em andamento impede repetição incerta',()=>{const f=fixture('2026-11-13T12:00:00Z');assert.equal(f.run().sucesso,false);assert.equal(f.sent.length,0);});
test('falha após início mantém bloqueio de duplicidade',()=>{const f=fixture(null,true);assert.equal(f.run().sucesso,false);assert.ok(f.properties.get('TRIAGE_digest'));assert.equal(f.run().sucesso,false);assert.equal(f.sent.length,0);});
test('aceite envia ambos anexos e chamada seguinte não reenvia',()=>{const f=fixture();const first=f.run();assert.equal(first.accepted,true);assert.equal(first.anexos,2);assert.equal(f.sent.length,1);assert.equal(f.sent[0].attachments.length,2);assert.equal(f.sent[0].to,'zanona@arquem.com.br');assert.equal(f.run().deduplicated,true);assert.equal(f.sent.length,1);});
test('destinatário fora da lista não recebe mensagem',()=>{const f=fixture();assert.equal(f.run({...f.request,email:'outro@arquem.com.br'}).sucesso,false);assert.equal(f.sent.length,0);});

