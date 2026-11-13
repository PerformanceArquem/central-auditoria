// Read-only staging simulation. Nothing is executed or published.
import {readFileSync,writeFileSync,readdirSync,mkdirSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const [inputDir,outputDir,summaryPath,modulesDir]=process.argv.slice(2);
if(!inputDir||!outputDir||!summaryPath||!modulesDir)throw Error('Required input/output/summary/parser');
const require=createRequire(join(modulesDir,'package.json'));
const {parse}=require('acorn');
const parseFile=src=>parse(src,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
const funcs=(src,file)=>{
 const names=new Map();
 for(const n of parseFile(src).body)if(n.type==='FunctionDeclaration'&&n.id){
  if(names.has(n.id.name))throw Error('Duplicate global in '+file);
  names.set(n.id.name,{start:n.start,end:n.end,body:src.slice(n.start,n.end)});
 }
 return names;
};
const files=readdirSync(inputDir).filter(f=>f.endsWith('.js')).sort();
if(files.length!==6||!files.includes('Código.js'))throw Error('Unexpected input files');
const original=new Map(files.map(f=>[f,readFileSync(join(inputDir,f),'utf8')]));
const source=original.get('Código.js');
const listed=funcs(source,'Código.js');
const decl=parseFile(source).body.find(n=>n.type==='FunctionDeclaration'&&n.id?.name==='doPost');
if(!decl)throw Error('Official doPost missing');
const matches=[];
function visit(n,ancestors=[]){
 if(!n||typeof n!=='object')return;
 if(n.type==='CallExpression'&&n.callee?.type==='Identifier'&&n.callee.name==='arquemCreateReportAttachments_')matches.push({node:n,ancestors});
 for(const [key,v] of Object.entries(n)){
  if(key==='start'||key==='end')continue;
  if(Array.isArray(v)){for(const child of v)if(child?.type)visit(child,[...ancestors,n]);}
  else if(v&&typeof v==='object'&&v.type)visit(v,[...ancestors,n]);
 }
}
visit(decl);
if(matches.length!==1)throw Error('Expected one attachment-generation call inside doPost, found '+matches.length);
const match=matches[0],arg=match.node.arguments?.[0];
if(!arg||arg.type!=='MemberExpression'||arg.computed||arg.property?.name!=='reportData'||arg.object?.type!=='Identifier')
 throw Error('Unrecognized reportData expression');
const reference=source.slice(arg.start,arg.end);
const nearest=match.ancestors.filter(n=>['ExpressionStatement','VariableDeclaration'].includes(n.type)).at(-1);
if(!nearest||nearest.start<decl.body.start||nearest.end>decl.body.end)throw Error('No safe insertion statement');
const marker='Anexos Zenvia Voz x Chat nao homologados nesta implantacao';
if(source.slice(decl.start,decl.end).includes(marker))throw Error('Guard already present');
const insert='if ('+reference+' && '+reference+'.zenviaVoice &&\n'+
 '      (typeof arquemCapacidadesAnexos_ !== "function" ||\n'+
 '       arquemCapacidadesAnexos_().zenviaVoiceReady !== true ||\n'+
 '       arquemCapacidadesAnexos_().zenviaVoiceVersion !== "arquem-voice-chat-v1")) {\n'+
 '      throw new Error("'+marker+'");\n    }\n    ';
const patched=source.slice(0,nearest.start)+insert+source.slice(nearest.start);
parseFile(patched);
const after=funcs(patched,'Código.js');
if(after.size!==listed.size||[...after.keys()].join('|')!==[...listed.keys()].join('|'))throw Error('Declaration inventory changed');
const changes=[...listed.keys()].filter(n=>listed.get(n).body!==after.get(n).body);
if(changes.length!==1||changes[0]!=='doPost')throw Error('Unexpected function body changed');
const originalDoPost=source.slice(decl.start,decl.end);
const patchedDoPost=after.get('doPost').body;
if(patchedDoPost.replace(insert,'')!==originalDoPost)throw Error('Official doPost not preserved exactly apart from guard');
const all=new Map(original);all.set('Código.js',patched);
const inventory=new Map();
for(const [file,src] of all)for(const [name,n] of funcs(src,file)){
 if(inventory.has(name))throw Error('Duplicate global: '+name);
 inventory.set(name,file);
}
if(inventory.size!==38)throw Error('Expected all 38 function names intact');
mkdirSync(outputDir,{recursive:true});
for(const [file,src] of all)writeFileSync(join(outputDir,file),src,{mode:0o600});
const manifest=readFileSync(join(inputDir,'appsscript.json'));
writeFileSync(join(outputDir,'appsscript.json'),manifest,{mode:0o600});
if(!readFileSync(join(outputDir,'appsscript.json')).equals(manifest))throw Error('Manifest changed');
appendFileSync(summaryPath,'\n### Protetor de anexos de Voz x Chat — apenas simulacao\n\n'+
 '- doPost oficial preservado integralmente, com insercao de guarda antes do gerador de anexos\n'+
 '- Ausencia de capacidade Zenvia e versao esperada bloqueia geracao\n'+
 '- 38 funcoes globais, 0 duplicadas; manifesto intocado\n'+
 '- Nenhum script executado, e-mail enviado, push ou deploy efetuado\n'+
 '- Nao equivale a homologacao com servicos Google reais\n');
console.log('DOPOST_VOICE_GUARD_DRYRUN_OK globalFunctions=38 changedOnly=doPost otherFunctionsPreserved=true manifestUnchanged=true');
