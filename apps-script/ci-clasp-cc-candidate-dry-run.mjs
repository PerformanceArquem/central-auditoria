// Read-only CC candidate rehearsal. Never publish, upload source, execute mail or doPost.
import {readFileSync,writeFileSync,readdirSync,mkdirSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const [input,output,summary,modules]=process.argv.slice(2);
if(!input||!output||!summary||!modules)throw Error('Missing arguments');
const require=createRequire(join(modules,'package.json'));
const {parse}=require('acorn'),ast=s=>parse(s,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
const files=readdirSync(input).filter(x=>x.endsWith('.js')).sort();
if(files.length!==9||!files.includes('Código.js')||!files.includes('homologacao-pr103-isolada.js'))throw Error('Inventário não revisado');
const original=new Map(files.map(f=>[f,readFileSync(join(input,f),'utf8')]));
const src=original.get('Código.js'),parsed=ast(src);
const globals=tree=>tree.body.filter(n=>n.type==='FunctionDeclaration'&&n.id);
const posts=globals(parsed).filter(n=>n.id.name==='doPost');
if(posts.length!==1)throw Error('doPost ausente ou repetido');
const post=posts[0],body=src.slice(post.start,post.end);
if(!body.includes('MAIL_SECRET')||!body.includes('dados.token'))throw Error('Autenticação não revisada');
if(body.includes('ccSupported:true')||body.includes('const cc='))throw Error('CC pré-existente exige revisão');
function walk(n,visit){
 if(!n||typeof n!=='object')return;
 if(n.type)visit(n);
 for(const [k,v] of Object.entries(n)){if(k==='start'||k==='end')continue;
  if(Array.isArray(v))v.forEach(x=>x?.type&&walk(x,visit));else if(v?.type)walk(v,visit)}
}
const actions=[],mails=[];
walk(post,n=>{
 if(n.type==='IfStatement'&&src.slice(n.test.start,n.test.end).includes('capabilities'))actions.push(n);
 if(n.type==='CallExpression'&&n.callee?.type==='MemberExpression'&&
 n.callee.object?.name==='MailApp'&&n.callee.property?.name==='sendEmail')mails.push(n);
});
// Select an exact action guard rather than counting unrelated appearances of
// the word "capabilities" in other conditions or nested branches.
const isActionMember=n=>n?.type==='MemberExpression'&&!n.computed&&
 n.object?.type==='Identifier'&&['dados','data'].includes(n.object.name)&&
 n.property?.name==='action';
const isCapabilityLiteral=n=>n?.type==='Literal'&&n.value==='capabilities';
const isCapabilityTest=n=>n?.type==='BinaryExpression'&&['===','=='].includes(n.operator)&&
 ((isActionMember(n.left)&&isCapabilityLiteral(n.right))||
  (isActionMember(n.right)&&isCapabilityLiteral(n.left)));
const selected=actions.filter(n=>isCapabilityTest(n.test)&&
 mails.length===1&&n.end<mails[0].start);
const shape={capabilityIfs:actions.length,exactCapabilityIfs:selected.length,mailCalls:mails.length,
 mailArguments:mails.length===1?mails[0].arguments.length:-1,
 firstMailArgumentType:mails.length===1?(mails[0].arguments[0]?.type||'none'):'unknown',
 capabilityBeforeMail:selected.length===1&&mails.length===1?selected[0].end<mails[0].start:false};
console.log('CC_CANDIDATE_SHAPE '+Object.entries(shape).map(([k,v])=>k+'='+v).join(' '));
if(selected.length!==1||mails.length!==1||mails[0].arguments.length!==1||
 mails[0].arguments[0].type!=='ObjectExpression')
 throw Error('Formato de envio ou capabilities não revisado');
const capabilityGuard=selected[0],caps=[];
walk(capabilityGuard.consequent,n=>{
 if(n.type==='CallExpression'&&n.callee?.name==='arquemCapacidadesAnexos_')caps.push(n);
});
if(caps.length!==1)throw Error('Resposta capabilities não reconhecida');
const arg=mails[0].arguments[0];
if(arg.properties.some(x=>x.key?.name==='cc'||x.key?.value==='cc'))throw Error('CC já encontrado no MailApp');
const ccCode=[
 "const cc=Array.isArray(dados.cc)?dados.cc.map(v=>String(v).trim().toLowerCase()):[];",
 "if(dados.cc!==undefined&&!Array.isArray(dados.cc))throw Error('Formato CC inválido');",
 "if(cc.length>10||new Set(cc).size!==cc.length||",
 "cc.some(v=>!/^[^@\\s]+@arquem\\.com\\.br$/.test(v)||",
 "v===String(dados.email||'').trim().toLowerCase()))throw Error('Cópias inválidas');"
].join('\n');
// The original MailApp object may end with a trailing comma. Respect its
// separator so the injected conditional CC spread remains valid JavaScript.
const mailInner=src.slice(arg.start+1,arg.end-1);
const trailingComma=/,\s*$/.test(mailInner);
if(arg.properties.length===0)throw Error('MailApp object unexpectedly empty');
const ccSeparator=trailingComma?' ':", ";
const edits=[
 {at:caps[0].start,end:caps[0].end,text:'Object.assign({},'+src.slice(caps[0].start,caps[0].end)+',{ccSupported:true})'},
 {at:capabilityGuard.end,end:capabilityGuard.end,text:'\n'+ccCode+'\n'},
 {at:arg.end-1,end:arg.end-1,text:ccSeparator+"...(cc.length?{cc:cc.join(', ')}:{})"}
];
let modified=src;
for(const edit of edits.sort((a,b)=>b.at-a.at))
 modified=modified.slice(0,edit.at)+edit.text+modified.slice(edit.end);
const nextAst=ast(modified),before=globals(parsed),after=globals(nextAst);
if(JSON.stringify(before.map(x=>x.id.name))!==JSON.stringify(after.map(x=>x.id.name)))
 throw Error('Funções globais alteradas');
for(let i=0;i<before.length;i++)if(before[i].id.name!=='doPost'&&
 src.slice(before[i].start,before[i].end)!==modified.slice(after[i].start,after[i].end))
 throw Error('Função fora de doPost alterada');
const candidate=new Map(original);candidate.set('Código.js',modified);
const names=new Set();
for(const [,code] of candidate)for(const n of globals(ast(code))){
 if(names.has(n.id.name))throw Error('Duplicata global no candidato');
 names.add(n.id.name);
}
if(names.size!==49)throw Error('Inventário 9:49 modificado');
mkdirSync(output,{recursive:true});
for(const [name,code] of candidate)writeFileSync(join(output,name),code,{mode:0o600});
writeFileSync(join(output,'appsscript.json'),readFileSync(join(input,'appsscript.json')),{mode:0o600});
// Same deterministic file digest used by the controlled release and promotion gates.
// Only fingerprints, never source content, are written to the Actions summary.
const hashFiles=dir=>{
 const names=readdirSync(dir).filter(name=>name==='appsscript.json'||/\.(?:js|gs|html)$/.test(name)).sort();
 const hash=createHash('sha256');
 for(const name of names){hash.update(name);hash.update('\0');hash.update(readFileSync(join(dir,name)));hash.update('\0')}
 return {sha:hash.digest('hex'),count:names.length};
};
const remoteFingerprint=hashFiles(input),candidateFingerprint=hashFiles(output);
appendFileSync(summary,'\n### Assinaturas para publicação revisada de CC\n\n'+
 'Remoto (expected_remote_sha256): `'+remoteFingerprint.sha+'`\n\n'+
 'Candidato (approved_source_sha256): `'+candidateFingerprint.sha+'`\n\n'+
 'Arquivos: remoto '+remoteFingerprint.count+', candidato '+candidateFingerprint.count+
 '. Somente diagnóstico, sem publicação.\n');
console.log('APPSSCRIPT_CC_FINGERPRINT remote='+remoteFingerprint.sha+' candidate='+candidateFingerprint.sha);
appendFileSync(summary,'\n### CC candidato: apenas simulação read-only\n\nSomente doPost modificado em cópia temporária; autenticação, outras 48 funções, anexos e manifesto preservados. Nenhum envio, push ou deploy. Candidato exige revisão adicional e homologação funcional.\n');
console.log('APPSSCRIPT_CC_STAGING_OK globals=49 files=9 doPostOnly=true deployed=false');
