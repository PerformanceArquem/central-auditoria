// Read-only release gap inventory. Never emit Apps Script source or properties.
import {readFileSync,readdirSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const [remoteDir,prSource,summaryPath,modulesDir]=process.argv.slice(2);
if(!remoteDir||!prSource||!summaryPath||!modulesDir)throw Error('Expected remote dir, PR source file, summary and parser dir');
const require=createRequire(join(modulesDir,'package.json'));
const {parse}=require('acorn');
const extract=source=>{
 const normalized=source.replace(/\r\n?/g,'\n');
 const ast=parse(normalized,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
 const out=new Map();
 for(const node of ast.body){
  if(node.type==='FunctionDeclaration'&&node.id){
   if(out.has(node.id.name))throw Error('Duplicate top-level declaration in one file: '+node.id.name);
   out.set(node.id.name,normalized.slice(node.start,node.end).trim());
  }
 }
 return out;
};
const remoteFiles=readdirSync(remoteDir).filter(x=>x.endsWith('.js')).sort();
if(remoteFiles.length<2)throw Error('Unexpected remote Apps Script inventory');
const remote=new Map(), duplicates=new Map();
for(const file of remoteFiles){
 const functions=extract(readFileSync(join(remoteDir,file),'utf8'));
 for(const [name,body] of functions){
  if(remote.has(name)){
   const prior=duplicates.get(name)||1;
   duplicates.set(name,prior+1);
  }else remote.set(name,body);
 }
}
const pr=extract(readFileSync(prSource,'utf8'));
if(pr.size<15||remote.size<15)throw Error('Too few functions; refusing incomplete inventory');
const absent=[...pr.keys()].filter(name=>!remote.has(name)).sort();
const modified=[...pr.keys()].filter(name=>remote.has(name)&&pr.get(name)!==remote.get(name)).sort();
const same=[...pr.keys()].filter(name=>remote.has(name)&&pr.get(name)===remote.get(name)).sort();
const remoteOnly=[...remote.keys()].filter(name=>!pr.has(name)).sort();
const summary=[
 '### PR #68 × Apps Script oficial — lacunas de funções (somente leitura)',
 '',
 '- Arquivos JavaScript do projeto oficial analisados: '+remoteFiles.length,
 '- Funções globais distintas identificadas no projeto oficial: '+remote.size,
 '- Funções encontradas no pacote completo da PR: '+pr.size,
 '- Funções da PR ausentes no projeto oficial: '+absent.length,
 '- Funções comuns com texto diferente: '+modified.length,
 '- Funções comuns com texto igual: '+same.length,
 '- Funções exclusivas do projeto oficial (preservar): '+remoteOnly.length,
 '- Nomes de funções com múltiplas definições remotas: '+duplicates.size,
 '',
 'Funções ausentes no oficial: '+(absent.join(', ')||'nenhuma')+'.',
 '',
 '**Não é plano de publicação automático.** Comparação textual conservadora de declarações AST; não verifica inicializadores globais, dependências entre arquivos, permissões, anexos reais nem comportamento. Nunca substituir o conjunto oficial pelo pacote da PR sem preservar as funções exclusivas e reconciliar as duplicações. Nenhum código ou segredo foi exportado.',
 ''
].join('\n');
appendFileSync(summaryPath,'\n'+summary);
console.log('RELEASE_GAP_AUDIT_OK remoteFiles='+remoteFiles.length+' officialNames='+remote.size+' prNames='+pr.size+' absent='+absent.length+' modified='+modified.length+' same='+same.length+' remoteOnly='+remoteOnly.length+' duplicateNames='+duplicates.size);
