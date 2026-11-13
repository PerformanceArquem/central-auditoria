// In-runner simulation only: overlay the reviewed PDF and XLSX functions,
// preserve the production doPost and all other code. NEVER push or publish.
import {readFileSync,writeFileSync,readdirSync,mkdirSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const [baselineDir,prFile,candidateDir,summaryPath,modulesDir]=process.argv.slice(2);
if(!baselineDir||!prFile||!candidateDir||!summaryPath||!modulesDir)throw Error('Usage: safe-overlays baseline PR-file output summary modules');
const require=createRequire(join(modulesDir,'package.json'));
const {parse}=require('acorn');
const scan=(src,file)=>{
 const ast=parse(src,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
 const found=new Map();
 for(const node of ast.body)if(node.type==='FunctionDeclaration'&&node.id){
  if(found.has(node.id.name))throw Error('Duplicate in '+file+': '+node.id.name);
  found.set(node.id.name,{start:node.start,end:node.end,text:src.slice(node.start,node.end)});
 }
 return found;
};
const files=readdirSync(baselineDir).filter(f=>f.endsWith('.js')).sort();
if(files.length!==6)throw Error('Unexpected original file count');
const canonical='ZenviaVozChat.js';
if(!files.includes(canonical))throw Error('Missing canonical PDF/XLSX script');
const original=new Map(files.map(f=>[f,readFileSync(join(baselineDir,f),'utf8')]));
const existingNames=new Map();
for(const [file,src] of original)for(const [name,meta] of scan(src,file)){
 if(existingNames.has(name))throw Error('Baseline still has duplicate '+name);
 existingNames.set(name,{file,text:meta.text});
}
if(existingNames.size!==38)throw Error('Unexpected baseline global function count: '+existingNames.size);
const prSource=readFileSync(prFile,'utf8');
const reviewed=scan(prSource,'PR68');
for(const name of ['arquemPdf_','arquemXlsx_']){
 if(!reviewed.has(name))throw Error('Missing reviewed function: '+name);
 if(existingNames.get(name)?.file!==canonical)throw Error('Unexpected source file for '+name);
}
const originalDoPost=existingNames.get('doPost');
if(!originalDoPost)throw Error('Official doPost absent');
let canonicalSource=original.get(canonical);
const canonicalFns=scan(canonicalSource,canonical);
const edits=['arquemPdf_','arquemXlsx_'].map(name=>({name,...canonicalFns.get(name),replacement:reviewed.get(name).text}))
 .sort((a,b)=>b.start-a.start);
for(const edit of edits){
 canonicalSource=canonicalSource.slice(0,edit.start)+edit.replacement+canonicalSource.slice(edit.end);
}
const candidate=new Map(original);
candidate.set(canonical,canonicalSource);
const finalNames=new Map();
for(const [file,src] of candidate)for(const [name,meta] of scan(src,file)){
 if(finalNames.has(name))throw Error('Candidate has duplicate global function '+name);
 finalNames.set(name,{file,text:meta.text});
}
const missing=[...existingNames.keys()].filter(name=>!finalNames.has(name));
const added=[...finalNames.keys()].filter(name=>!existingNames.has(name));
if(missing.length||added.length)throw Error('Functions lost or added; rejected');
const changed=[...finalNames.keys()].filter(name=>finalNames.get(name).text!==existingNames.get(name).text).sort();
if(JSON.stringify(changed)!==JSON.stringify(['arquemPdf_','arquemXlsx_']))throw Error('Unexpected changes to functions');
if(finalNames.get('doPost').text!==originalDoPost.text)throw Error('Production doPost modified');
for(const name of ['arquemPdf_','arquemXlsx_'])
 if(finalNames.get(name).text!==reviewed.get(name).text)throw Error('Reviewed '+name+' not applied exactly');
for(const name of [...existingNames.keys()].filter(name=>!reviewed.has(name)))
 if(finalNames.get(name).text!==existingNames.get(name).text)throw Error('Unique official function modified: '+name);
const manifest=readFileSync(join(baselineDir,'appsscript.json'));
mkdirSync(candidateDir,{recursive:true});
for(const [file,src] of candidate)writeFileSync(join(candidateDir,file),src,{mode:0o600});
writeFileSync(join(candidateDir,'appsscript.json'),manifest,{mode:0o600});
if(!readFileSync(join(candidateDir,'appsscript.json')).equals(manifest))throw Error('Manifest changed');
const notice=[
 '### Simulação de sobreposição PDF/XLSX (não publicada)',
 '',
 '- Funções globais preservadas: 38; duplicadas: 0',
 '- Funções com código substituído em memória: arquemPdf_ e arquemXlsx_',
 '- Ambas reproduzem exatamente as versões revisadas na PR #68',
 '- doPost oficial e as outras 36 funções mantidos byte a byte no corpo',
 '- Seis arquivos JS e manifesto preservados em diretório temporário do runner',
 '- Não é fonte aprovada para publicação. doPost da PR #68 continua **não conciliada**',
 '- Não executa serviços Google, não gera PDF/XLSX reais e não envia e-mails',
 ''
].join('\n');
appendFileSync(summaryPath,'\n'+notice);
console.log('SAFE_OVERLAY_DRY_RUN_OK functions=38 changed=2 preserved=36 duplicates=0 doPostOriginal=true manifestOriginal=true');
