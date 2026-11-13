// Static-only contract review; never execute doPost or remote Apps Script.
import {readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const [remoteDir,prFile,summaryPath,modulesDir]=process.argv.slice(2);
if(!remoteDir||!prFile||!summaryPath||!modulesDir)throw Error('Missing args');
const require=createRequire(join(modulesDir,'package.json'));
const {parse}=require('acorn');
const findDoPost=(file)=>{
 const source=readFileSync(file,'utf8');
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
 const f=ast.body.filter(x=>x.type==='FunctionDeclaration'&&x.id?.name==='doPost');
 if(f.length!==1)throw Error('doPost count is not one in '+file);
 const n=f[0];
 return source.slice(n.start,n.end);
};
const official=findDoPost(join(remoteDir,'Código.js'));
const candidate=findDoPost(prFile);
const checks=[
 ['checks MAIL_SECRET',/MAIL_SECRET/],
 ['validates request token',/dados\.token|request\.token|data\.token/],
 ['handles capabilities action',/capabilities/],
 ['validates recipient',/Destinat[aá]rio|[Ii]nvalid.*email|email.*[Ii]nvalid/],
 ['checks mail quota',/getRemainingDailyQuota/],
 ['requires attachments validation',/ARQUEM_ATTACHMENTS_VALIDATED/],
 ['calls attachment generator',/arquemCreateReportAttachments_/],
 ['checks zenviaVoice explicitly',/zenviaVoice/],
 ['calls MailApp sendEmail',/MailApp\.sendEmail/],
 ['uses structured error response',/sucesso:false|success:false/]
];
const values=(src)=>Object.fromEntries(checks.map(([n,rx])=>[n,rx.test(src)]));
const a=values(official),b=values(candidate);
if(!a['checks MAIL_SECRET']||!a['handles capabilities action']||!a['calls MailApp sendEmail'])
 throw Error('Official doPost contract has changed; manual review required');
if(!b['checks MAIL_SECRET']||!b['handles capabilities action']||!b['checks zenviaVoice explicitly'])
 throw Error('PR68 doPost lacks expected controls');
const diff=checks.filter(([name])=>a[name]!==b[name]);
const lines=[
 '### doPost — comparação estática com a implementação oficial',
 '',
 '| Marcador | Oficial | PR #68 |',
 '|---|---|---|',
 ...checks.map(([name])=>'| '+name+' | '+(a[name]?'presente':'não identificado')+' | '+(b[name]?'presente':'não identificado')+' |'),
 '',
 '- Marcadores diferentes: '+diff.length,
 '- Diferenças por busca textual/AST de declaração, não prova de segurança ou equivalência.',
 '- O doPost oficial **não é substituído** nesta auditoria.',
 '- NENHUMA função é executada e NENHUM e-mail é enviado.',
 ''
].join('\n');
appendFileSync(summaryPath,'\n'+lines);
console.log('DOPOST_CONTRACT_REVIEW_OK officialMarkers='+Object.values(a).filter(Boolean).length+' prMarkers='+Object.values(b).filter(Boolean).length+' differentMarkers='+diff.length);
for(const [name] of diff)console.log('DOPOST_MARKER_DIFFERENCE '+name+' official='+a[name]+' pr='+b[name]);
