// Verify the temporary candidate has a voice guard before generating attachments and sending mail.
// This test does not run remote Apps Script code or reveal source; it is strictly structural.
import {readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const [candidateDir,summaryPath,modulesDir]=process.argv.slice(2);
if(!candidateDir||!summaryPath||!modulesDir)throw Error('Expected candidate, summary, parser');
const require=createRequire(join(modulesDir,'package.json'));
const {parse}=require('acorn');
const src=readFileSync(join(candidateDir,'Código.js'),'utf8');
const ast=parse(src,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
const post=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id?.name==='doPost');
if(!post)throw Error('Missing protected doPost');
const actions={guard:[],attachments:[],email:[]};
function walk(n,parents=[]){
 if(!n||typeof n!=='object')return;
 if(n.type==='IfStatement'&&src.slice(n.start,n.end).includes('Anexos Zenvia Voz x Chat nao homologados nesta implantacao'))
  actions.guard.push({n,parents});
 if(n.type==='CallExpression'){
  if(n.callee.type==='Identifier'&&n.callee.name==='arquemCreateReportAttachments_')actions.attachments.push({n,parents});
  if(n.callee.type==='MemberExpression'&&n.callee.object?.name==='MailApp'&&n.callee.property?.name==='sendEmail')actions.email.push({n,parents});
 }
 for(const [key,v] of Object.entries(n)){
  if(key==='start'||key==='end')continue;
  if(Array.isArray(v))for(const item of v)if(item&&typeof item==='object'&&typeof item.type==='string')walk(item,[...parents,n]);
  else if(v&&typeof v==='object'&&typeof v.type==='string')walk(v,[...parents,n]);
 }
}
walk(post);
if(actions.guard.length!==1||actions.attachments.length!==1||actions.email.length!==1)
 throw Error('Expected exactly one voice guard, attachment call and sendEmail call');
const g=actions.guard[0].n,a=actions.attachments[0].n,e=actions.email[0].n;
if(!(post.start<g.start&&g.end<=a.start&&a.end<e.start))throw Error('Guard not strictly before attachment generation and mail submission');
const test=src.slice(g.test.start,g.test.end);
if(!test.includes('.zenviaVoice')||!test.includes('zenviaVoiceReady')||!test.includes('zenviaVoiceVersion')||!test.includes('arquem-voice-chat-v1'))
 throw Error('Guard missing payload/ready/version requirements');
const then=src.slice(g.consequent.start,g.consequent.end);
if(!/throw\s+new\s+Error/.test(then))throw Error('Guard does not stop execution');
if(g.alternate)throw Error('Voice guard unexpectedly has else');
const result=post.body.body;
const beforeMail=result.filter(n=>n.start<e.start);
if(!beforeMail.length)throw Error('No processing prior to mail');
appendFileSync(summaryPath,'\n### Ordem do bloqueio de Voz e Chat validada estruturalmente\n\n'+
 '- Checagem de payload, versao e pronto antes de gerar PDF/XLSX\n'+
 '- Lancamento de erro antes de enviar e-mail em caso nao homologado\n'+
 '- Este teste inspeciona AST apenas; nao prova funcionamento com Google real\n');
console.log('VOICE_GUARD_ORDER_OK guardBeforeAttachments=true guardBeforeSend=true failClosed=true');
