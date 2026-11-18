// Safe, read-only rehearsal of how PR103 duplicate declarations could be
// resolved in a temporary runner directory. Never authorized for publication.
import {readFileSync,writeFileSync,mkdirSync,readdirSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const [remoteDir,outputDir,summaryPath,modulesDir]=process.argv.slice(2);
if(!remoteDir||!outputDir||!summaryPath||!modulesDir)throw Error('Usage: <remote> <temp-output> <summary> <acorn-node-modules>');
const require=createRequire(join(modulesDir,'package.json'));
const {parse}=require('acorn');
const filenames=readdirSync(remoteDir).filter(x=>x.endsWith('.js')).sort();
const isolate='homologacao-pr103-isolada.js';
const zenvia='ZenviaVozChat.js',legacy='arquem-relatorios-anexos.gs.js';
if(filenames.length!==9||![isolate,zenvia,legacy,'Código.js'].every(x=>filenames.includes(x)))
 throw Error('Inventário mudou: simulação interrompida; revisão necessária');
const allowed=new Set(['arquemAjustesValidos_','arquemAmostraAjustes_','arquemAssinarAjustes_',
 'arquemCreateReportAttachments_','arquemHomologarAjustesSemEnvio','arquemPdf_',
 'arquemPrepararRevisaoVisualAjustesSemEnvio','arquemXlsx_']);
const sources=new Map(filenames.map(name=>[name,readFileSync(join(remoteDir,name),'utf8')]));
const decl=(src)=>{
 const ast=parse(src,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
 return ast.body.filter(x=>x.type==='FunctionDeclaration'&&x.id).map(x=>({
  name:x.id.name,start:x.start,end:x.end,body:src.slice(x.start,x.end)}));
};
const functions=new Map(filenames.map(name=>[name,decl(sources.get(name))]));
const byName=new Map();
for(const [file,nodes] of functions)for(const node of nodes)
 byName.set(node.name,[...(byName.get(node.name)||[]),{file,...node}]);
const duplicates=[...byName].filter(([,v])=>v.length>1).map(([name])=>name);
// Log names only. This is not code and contains no deployment IDs or secrets.
console.log('PR103_DECLARATIONS files='+filenames.length+' globals='+byName.size+' repeated='+duplicates.length);
for(const name of duplicates)console.log('PR103_REPEATED_NAME '+name+
 ' occurrenceCount='+byName.get(name).length);
// A text grep also counts functions nested inside other functions. AST
// recognizes only top-level declarations here. The actual remote currently has
// zero top-level duplicates despite eight textual matches in the legacy scan.
const alreadyUnique=duplicates.length===0&&byName.size===49;
if(!alreadyUnique&&(duplicates.length!==8||duplicates.some(n=>!allowed.has(n))||
 [...allowed].some(n=>!duplicates.includes(n)))){
 const missing=[...allowed].filter(name=>!duplicates.includes(name));
 const unexpected=duplicates.filter(name=>!allowed.has(name));
 console.log('PR103_DUPLICATE_MISMATCH missing='+missing.join(',')+' unexpected='+unexpected.join(','));
 throw Error('Conjunto de duplicatas inesperado: nenhuma mudança simulada');
}
if(alreadyUnique)console.log('PR103_GLOBALS_ALREADY_UNIQUE no source transformations needed');
for(const name of duplicates){
 const copies=byName.get(name);
 if(copies.some(x=>x.file!==isolate&&x.file!==zenvia&&x.file!==legacy))
  throw Error('Origem de duplicata inesperada: '+name);
}
const isolates=functions.get(isolate),seen=new Set(),toDrop=[];
for(const node of isolates){
 const copies=byName.get(node.name)||[];
 if(copies.length>1){
  // Preserve canonical definitions outside the PR103 file. The single
  // PR103-only function is retained once, after a strict duplicate-body check.
  const external=copies.filter(c=>c.file!==isolate);
  if(external.length){toDrop.push(node);continue}
  if(seen.has(node.name)){toDrop.push(node);continue}
  const own=copies.filter(c=>c.file===isolate);
  if(own.some(c=>c.body!==own[0].body))
   throw Error('Definições internas divergentes: revisão humana necessária');
  seen.add(node.name);
 }
}
let clean=sources.get(isolate);
for(const n of toDrop.sort((a,b)=>b.start-a.start))clean=clean.slice(0,n.start)+clean.slice(n.end);
const modified=new Map(sources);
modified.set(isolate,clean);
const remaining=new Map();
for(const [file,body] of modified)for(const node of decl(body)){
 if(remaining.has(node.name))throw Error('Duplicata permaneceu: '+node.name);
 remaining.set(node.name,file);
}
if(remaining.size!==49||remaining.size!==byName.size)
 throw Error('Quantidade de funções únicas mudou');
const critical=['doPost','arquemCreateReportAttachments_','arquemCapacidadesAnexos_',
 'arquemHomologarKeilaSemEnvio','arquemValidarPublicacaoSemEnvio'];
if(critical.some(x=>!remaining.has(x)))throw Error('Função crítica ausente');
mkdirSync(outputDir,{recursive:true});
for(const [file,body] of modified)writeFileSync(join(outputDir,file),body,{mode:0o600});
const manifest=readFileSync(join(remoteDir,'appsscript.json'));
writeFileSync(join(outputDir,'appsscript.json'),manifest,{mode:0o600});
const report=[
 '### Simulação PR103 — somente arquivos temporários do runner','',
 '- Inventário de entrada: 9 arquivos JS e 49 funções globais únicas',
 '- Funções duplicadas encontradas: '+duplicates.length,
 '- Declarações eliminadas **apenas na cópia simulada**: '+toDrop.length,
 '- AST identificou duplicatas globais: '+duplicates.length+
   (alreadyUnique?' (nenhuma; varredura textual anterior incluía escopos internos)':''),
 '- Inventário da cópia temporária: '+modified.size+' arquivos JS e '+remaining.size+' funções únicas',
 '- Nenhuma função original fora do arquivo PR103 foi modificada',
 '- Manifesto Apps Script copiado sem alterações',
 '',
 '**Não é uma autorização de publicação:** quatro definições remotas diferem do PR103.',
 'A simulação preserva as implementações canônicas, mas dependências e saídas PDF/XLSX',
 'precisam de homologação antes de qualquer deploy.',
 'Nenhuma chamada a doPost, Apps Script push, serviço Gmail ou envio de e-mail foi realizada.',
 ''
].join('\n');
appendFileSync(summaryPath,'\n'+report);
console.log('PR103_OVERLAY_DRY_RUN_OK duplicates='+duplicates.length+' removed='+toDrop.length+
 ' globals='+remaining.size+' files='+modified.size+' deployAuthorized=false');
