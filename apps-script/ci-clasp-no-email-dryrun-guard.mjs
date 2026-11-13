// Static AST safety check: does not evaluate code or call Google services.
import {readFileSync,readdirSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const [sourceDir,summary,modulesDir]=process.argv.slice(2);
if(!sourceDir||!summary||!modulesDir)throw Error('Usage: guard <temporary-source-dir> <summary> <parser-dir>');
const require=createRequire(join(modulesDir,'package.json'));
const {parse}=require('acorn');
const functions=new Map();
const files=readdirSync(sourceDir).filter(n=>n.endsWith('.js'));
for(const filename of files){
 const input=readFileSync(join(sourceDir,filename),'utf8');
 const ast=parse(input,{ecmaVersion:'latest',sourceType:'script'});
 for(const item of ast.body)if(item.type==='FunctionDeclaration'&&item.id){
  if(functions.has(item.id.name))throw Error('Function declaration repeated in candidate: '+item.id.name);
  functions.set(item.id.name,{filename,ast:item});
 }
}
const targets=['arquemHomologarVozChatSemEnvio','arquemHomologarKeilaSemEnvio','arquemValidarPublicacaoSemEnvio','arquemTesteAnexosSemEnvio','arquemTesteKeilaSemEnvio'];
const misses=targets.filter(n=>!functions.has(n));
if(misses.length)throw Error('Expected no-email validation functions missing: '+misses.join(', '));
function inspect(fn){
 const direct=new Set();
 const bad=[];
 const traverse=node=>{
  if(!node||typeof node!=='object')return;
  if(node.type==='CallExpression'){
   if(node.callee?.type==='Identifier')direct.add(node.callee.name);
   if(node.callee?.type==='MemberExpression'&&!node.callee.computed){
    const p=node.callee.property?.name;
    const obj=node.callee.object;
    if((obj?.name==='GmailApp'||obj?.name==='MailApp')&&['sendEmail','send'].includes(p))bad.push((obj?.name||'')+'.'+p);
    // Reject any direct .sendEmail call, including aliases with renamed objects.
    if(p==='sendEmail')bad.push('*.sendEmail');
   }
  }
  for(const [key,value] of Object.entries(node)){
   if(['start','end','loc'].includes(key))continue;
   if(Array.isArray(value))for(const child of value){if(child&&typeof child.type==='string')traverse(child);}
   else if(value&&typeof value.type==='string')traverse(value);
  }
 };
 traverse(fn.ast.body);
 return {direct,bad};
}
let inspected=0;
for(const entry of targets){
 const stack=[entry],visited=new Set();
 while(stack.length){
  const name=stack.pop();
  if(visited.has(name))continue;
  visited.add(name);const fn=functions.get(name);
  if(!fn)continue;
  inspected++;
  const {direct,bad}=inspect(fn);
  if(bad.length)throw Error('Potential e-mail side effect reachable from '+entry+' via '+name+': '+bad.join(', '));
  for(const next of direct)if(functions.has(next))stack.push(next);
 }
}
appendFileSync(summary,'\n### Validações sem envio — checagem estática\n\n'+
'- Entradas de homologação analisadas: '+targets.length+'\n'+
'- Funções alcançáveis inspecionadas (com repetições entre entradas): '+inspected+'\n'+
'- Chamadas diretas de envio de e-mail encontradas no grafo: 0\n'+
'- Nenhuma função foi executada: análise estática AST, não prova de execução real\n'+
'- Testes PDF/XLSX reais e privilégios do Google: ainda pendentes\n');
console.log('NO_EMAIL_DRYRUN_STATIC_GUARD_OK entries='+targets.length+' visited='+inspected);
