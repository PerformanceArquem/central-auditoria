// Read-only deployment candidate: never writes to Apps Script and never exports source.
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
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
// Two explicitly reviewed states are safe: legacy double definitions (18), or
// already reconciled remote source (0). Every other count fails closed.
if(duplicated.length!==18 && duplicated.length!==0)
 throw Error('Unreviewed duplicate count: '+duplicated.length);
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
// Build an AST-backed inventory of all declarations, including duplicates within
// the SAME file. This must run BEFORE validating counts: a changed remote inventory
// is not safe simply because it contains an expected number of functions.
const declarations=new Map();
for(const [file,source] of sources)for(const fn of functions(source)){
 const members=declarations.get(fn.name)||[];
 members.push({file,start:fn.start,end:fn.end,body:source.slice(fn.start,fn.end)});
 declarations.set(fn.name,members);
}
// Content hashes provide reviewable, non-source fingerprints without exporting
// proprietary Apps Script code from the runner or writing it to GitHub.
const fingerprint=body=>createHash('sha256').update(body).digest('hex').slice(0,16);
const exactDuplicates=[],conflicting=[];
const removeByFile=new Map();
for(const [name,members] of declarations){
 if(members.length<2)continue;
 // Do not select a winner when definitions differ: that needs a manual review
 // of the actual remote implementation, not just a signature comparison.
 const identical=members.every(m=>m.body===members[0].body);
 if(!identical){
  conflicting.push({name,owners:members.map(m=>m.file+' ('+fingerprint(m.body)+')')});
  continue;
 }
 exactDuplicates.push({name,owners:members.map(m=>m.file+' ('+fingerprint(m.body)+')')});
 // Remove byte-identical duplicates only from the TEMPORARY candidate;
 // prefer the canonical source when present and retain one declaration.
 const keeper=members.find(m=>m.file===zenvia)||members[0];
 for(const m of members){
  if(m===keeper)continue;
  const ranges=removeByFile.get(m.file)||[];
  ranges.push(m);
  removeByFile.set(m.file,ranges);
 }
}
const {appendFileSync}=await import('node:fs');
appendFileSync(summary,'\n### Diagnóstico seguro de funções duplicadas (somente leitura)\n\n'+
 '- Duplicidades textualmente idênticas encontradas: '+exactDuplicates.length+'\n'+
 '- Conflitos com implementações diferentes: '+conflicting.length+'\n'+
 exactDuplicates.map(x=>'- Idêntica: `'+x.name+'` em '+x.owners.join(', ')).join('\n')+'\n'+
 conflicting.map(x=>'- **Exige revisão:** `'+x.name+'` em '+x.owners.join(', ')).join('\n')+
 '\n\nNenhum código remoto foi modificado ou exportado.\n');
for(const [file,ranges] of removeByFile){
 let source=sources.get(file);
 for(const m of ranges.sort((a,b)=>b.start-a.start))
  source=source.slice(0,m.start)+source.slice(m.end);
 sources.set(file,source);
}
// Re-scan after the exact-only in-memory removals. A conflicting duplicate
// always blocks publication even when every other check would pass.
const remainingDeclarations=new Map();
for(const [file,source] of sources)for(const fn of functions(source)){
 const owners=remainingDeclarations.get(fn.name)||[];
 owners.push(file);
 remainingDeclarations.set(fn.name,owners);
}
const conflicts=[...remainingDeclarations].filter(([,owners])=>owners.length>1)
 .map(([name,owners])=>name+' ['+owners.join(', ')+']').sort();
if(conflicts.length)throw Error('AUDITORIA BLOQUEADA: '+conflicts.length+
 ' funções com implementações divergentes: '+conflicts.join('; ')+
 '. Duplicidades byte a byte removidas apenas da cópia temporária: '+
 [...removeByFile.values()].reduce((n,ranges)=>n+ranges.length,0)+
 '. Revisão da origem obrigatória; nenhum deploy.');
// Contract remains intact: exact duplicate removal must not delete names.
const afterExact=new Set(remainingDeclarations.keys());
if(afterExact.size!==afterNames.size || [...afterNames].some(name=>!afterExact.has(name)))
 throw Error('Contrato global alterado durante deduplicação idêntica');
const finalDeclarations=new Map([...remainingDeclarations].map(([name,owners])=>[name,owners[0]]));
// Do not automatically bless new files/functions. The two allowed inventory states
// are explicitly audited snapshots, including exact names of remote source files.
const originalFiles=[
 'Código.js','ZenviaVozChat.js','arquem-relatorios-anexos.gs.js',
 'homologacao-zenvia-pr68.js','intelligence-triage-mail.js','validacao-sem-envio.js'
];
const observedAdded=['arquem-comparativos.gs.js','homologacao-pr103-isolada.js'];
const expectedLegacy=originalFiles;
const expectedCurrent=[...originalFiles,...observedAdded].sort();
const sameFiles=(expected)=>JSON.stringify([...expected].sort())===JSON.stringify(original);
const legacyInventory=sameFiles(expectedLegacy)&&afterNames.size===39;
const currentInventory=sameFiles(expectedCurrent)&&afterNames.size===48;
if(!legacyInventory&&!currentInventory)
 throw Error('Unexpected inventory: files='+original.length+' functions='+afterNames.size+
  '; names='+original.join(', ')+'. Revisão manual obrigatória.');
const missingCritical=critical.filter(name=>!afterNames.has(name));
if(missingCritical.length)throw Error('Funções críticas não encontradas: '+missingCritical.join(', '));
const remainingFns=new Map();
for(const [name,owner] of finalDeclarations)remainingFns.set(name,owner);
mkdirSync(outputDir,{recursive:true});
for(const [file,text] of sources)writeFileSync(join(outputDir,file),text,{mode:0o600});
const manifest=readFileSync(join(remoteDir,'appsscript.json'));
writeFileSync(join(outputDir,'appsscript.json'),manifest,{mode:0o600});
if(!readFileSync(join(outputDir,'appsscript.json')).equals(manifest))throw Error('Manifesto original foi modificado');
const total=original.length;
const append='\n### Reconciliação simulada (NÃO publicada)\n\n'+
'- Arquivos JavaScript preservados: '+total+'\n'+
'- Definições repetidas desativadas apenas na cópia temporária: '+(duplicated.length+[...removeByFile.values()].reduce((sum,items)=>sum+items.length,0))+'\n'+
'- Funções exclusivas do arquivo de anexos preservadas: '+uniqueLegacy.length+'\n'+
'- Nomes duplicados após reconciliação simulada: 0\n'+
'- Análise sintática dos arquivos JavaScript: aprovada\n'+
'- Contrato de funções globais preservado: '+afterNames.size+' nomes únicos\n'+
'- Funções críticas confirmadas: '+critical.length+'\n'+
'- Manifesto Apps Script preservado byte a byte\n'+
'- Código-fonte remoto: NÃO foi enviado ao GitHub nem incluído em artefatos\n'+
'- Execução de funções, e-mails, push ou deployment: NENHUM\n\n'+
'**Atenção:** passar na análise sintática não valida operações do Google, PDF, Excel, destinatários nem rotina das 09h. Origem remota permanece intacta.\n';

appendFileSync(summary,append);
console.log('CONCILIACAO_DRY_RUN_OK sourceFiles='+total+' removedDeclarations='+duplicated.length+' keptLegacyUnique='+uniqueLegacy.length+' duplicatesRemaining=0 globalNames='+afterNames.size+' criticalNames='+critical.length+' manifestUnchanged=true');
