// Read-only deployment candidate: never writes to Apps Script and never exports source.
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const [remoteDir,outputDir,summary,modulesDir]=process.argv.slice(2);
if(!remoteDir||!outputDir||!summary||!modulesDir)throw Error('Usage: reconcile-dry-run remote out summary modules');
const require=createRequire(join(modulesDir,'package.json'));
const {parse}=require('acorn');
const parseJs=(text,file)=>parse(text,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
const functions=text=>parseJs(text).body.filter(n=>n.type==='FunctionDeclaration'&&n.id).map(n=>({name:n.id.name,start:n.start,end:n.end}));
const original=readdirSync(remoteDir).filter(p=>p.endsWith('.js')).sort();
const zenvia='ZenviaVozChat.js',legacy='arquem-relatorios-anexos.gs.js';
if(!original.includes(zenvia)||!original.includes(legacy))throw Error('Expected two source files absent: no reconciliation');
const sources=new Map(original.map(f=>[f,readFileSync(join(remoteDir,f),'utf8')]));
const canonicalFns=new Map(functions(sources.get(zenvia)).map(f=>[f.name,f]));
const legacyFns=functions(sources.get(legacy));
const duplicated=legacyFns.filter(f=>canonicalFns.has(f.name));
if(duplicated.length!==18)throw Error('Duplicate count has changed from reviewed audit: '+duplicated.length);
const uniqueLegacy=legacyFns.filter(f=>!canonicalFns.has(f.name)).map(f=>f.name);
let cleaned=sources.get(legacy);
for(const f of duplicated.sort((a,b)=>b.start-a.start))cleaned=cleaned.slice(0,f.start)+cleaned.slice(f.end);
sources.set(legacy,cleaned);
// Falha se a consolidação remover nomes globais de funções usados no projeto.
const beforeNames=new Set(original.flatMap(file=>functions(readFileSync(join(remoteDir,file),'utf8')).map(fn=>fn.name)));
const afterNames=new Set([...sources.values()].flatMap(text=>functions(text).map(fn=>fn.name)));
const lostNames=[...beforeNames].filter(name=>!afterNames.has(name));
const newNames=[...afterNames].filter(name=>!beforeNames.has(name));
if(lostNames.length||newNames.length)throw Error('Contrato de funções alterado: removidas='+lostNames.length+' adicionadas='+newNames.length);
const critical=['doPost','arquemCreateReportAttachments_','arquemCapacidadesAnexos_','arquemHomologarKeilaSemEnvio','arquemValidarPublicacaoSemEnvio'];
const missingCritical=critical.filter(name=>!afterNames.has(name));
if(missingCritical.length)throw Error('Funções críticas não encontradas: '+missingCritical.join(', '));
const remainingFns=new Map();
for(const [file,text] of sources)for(const f of functions(text)){
 const previous=remainingFns.get(f.name);
 if(previous)throw Error('Duplicate remains in test candidate: '+f.name+' in '+previous+' and '+file);
 remainingFns.set(f.name,file);
}
mkdirSync(outputDir,{recursive:true});
for(const [file,text] of sources)writeFileSync(join(outputDir,file),text,{mode:0o600});
const manifest=readFileSync(join(remoteDir,'appsscript.json'));
writeFileSync(join(outputDir,'appsscript.json'),manifest,{mode:0o600});
if(!readFileSync(join(outputDir,'appsscript.json')).equals(manifest))throw Error('Manifesto original foi modificado');
const total=original.length;
const append='\n### Reconciliação simulada (NÃO publicada)\n\n'+
'- Arquivos JavaScript preservados: '+total+'\n'+
'- Definições repetidas desativadas apenas na cópia temporária: '+duplicated.length+'\n'+
'- Funções exclusivas do arquivo de anexos preservadas: '+uniqueLegacy.length+'\n'+
'- Nomes duplicados após reconciliação simulada: 0\n'+
'- Análise sintática dos arquivos JavaScript: aprovada\n'+
'- Contrato de funções globais preservado: '+afterNames.size+' nomes únicos\n'+
'- Funções críticas confirmadas: '+critical.length+'\n'+
'- Manifesto Apps Script preservado byte a byte\n'+
'- Código-fonte remoto: NÃO foi enviado ao GitHub nem incluído em artefatos\n'+
'- Execução de funções, e-mails, push ou deployment: NENHUM\n\n'+
'**Atenção:** passar na análise sintática não valida operações do Google, PDF, Excel, destinatários nem rotina das 09h. Origem remota permanece intacta.\n';
const {appendFileSync}=await import('node:fs');
appendFileSync(summary,append);
console.log('CONCILIACAO_DRY_RUN_OK sourceFiles='+total+' removedDeclarations='+duplicated.length+' keptLegacyUnique='+uniqueLegacy.length+' duplicatesRemaining=0 globalNames='+afterNames.size+' criticalNames='+critical.length+' manifestUnchanged=true');
