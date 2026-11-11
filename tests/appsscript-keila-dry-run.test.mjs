import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const script=await readFile(new URL('../apps-script/central-auditoria-emails-completo.gs',import.meta.url),'utf8');

test('Keila test packet contains movements and quality, and never sends email',()=>{
 let sent=0,packet=null;
 const context={
  console:{log(){}},
  Date,JSON,
  MailApp:{sendEmail(){sent++;throw Error('Email must not be sent in dry-run')}},
  GmailApp:{sendEmail(){sent++;throw Error('Email must not be sent in dry-run')}}
 };
 vm.createContext(context);
 vm.runInContext(script,context);
 context.arquemCreateReportAttachments_=(value)=>{
  packet=value;
  return [
   {getContentType:()=> 'application/pdf',getName:()=> 'Keila.pdf',getBytes:()=>new Array(3000).fill(0)},
   {getContentType:()=> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    getName:()=> 'Keila.xlsx',getBytes:()=>new Array(2000).fill(0)}
  ];
 };
 const result=context.arquemTesteKeilaSemEnvio();
 assert.equal(sent,0);
 assert.equal(result.sent,false);
 assert.equal(result.ok,true);
 assert.equal(result.files.length,2);
 assert.equal(packet.productionFlow.entered,2);
 assert.equal(packet.productionFlow.exited,1);
 assert.equal(packet.productionQuality.length,2);
 assert.equal(packet.productionQuality[1].average,null);
 assert.equal(packet.tickets.length,2);
 assert.equal(packet.schema,'arquem-mail-v1');
});
