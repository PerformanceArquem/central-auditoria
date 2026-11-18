// Read-only audit of Apps Script deployment versions. No requests are sent to
// the /exec endpoint, no doPost is run, and no source or secrets are logged.
import {readFileSync,readdirSync,appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const [mode,listPath,root,summaryPath]=process.argv.slice(2);
if(!['versions','report'].includes(mode)||!listPath)throw Error('Usage: audit <versions|report> <list> [versions-dir] [summary]');
const listing=readFileSync(listPath,'utf8');
const versions=[...new Set([...listing.matchAll(/@([0-9]+)(?=\s|$|\r|\n|-)/g)].map(x=>Number(x[1])))]
 .filter(x=>Number.isSafeInteger(x)&&x>0).sort((a,b)=>b-a);
if(mode==='versions'){
 if(versions.length>25)throw Error('More than 25 versioned deployments: manual inventory required');
 process.stdout.write(versions.join(' '));
 process.exit(0);
}
if(!root||!summaryPath)throw Error('Missing audit paths');
function sourceFiles(dir){
 if(!existsSync(dir))return [];
 const found=[];
 for(const item of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,item.name);
  if(item.isDirectory())found.push(...sourceFiles(path));
  else if(item.isFile()&&/\.(gs|js)$/.test(item.name))found.push(readFileSync(path,'utf8'));
 }
 return found;
}
function inspect(dir){
 const sources=sourceFiles(dir),joined=sources.join('\n');
 const actions=/(['"]capabilities['"])/.test(joined);
 const ccResponse=/\bccSupported\s*:\s*true\b/.test(joined);
 const ccDelivered=/\bMailApp\.sendEmail\s*\(/.test(joined)&&
  /\bcc\s*:\s*cc\.join\s*\(/.test(joined);
 return {fileCount:sources.length,actions,ccResponse,ccDelivered,
  ready:actions&&ccResponse&&ccDelivered};
}
const head=inspect(join(root,'head'));
const checks=versions.map(v=>({version:v,...inspect(join(root,'versions','v'+v))}));
const completed=checks.filter(x=>x.fileCount>0);
const report=[
 '### Apps Script — auditoria estática de CC nas versões implantadas',
 '',
 '**Somente leitura**: nenhum código publicado, nenhum teste de envio e nenhuma execução de doPost.',
 '',
 'Projeto HEAD (código salvo, NÃO necessariamente /exec): '+(head.ready?'contrato CC encontrado':'contrato CC não comprovado')+'.',
 '',
 '| Versão implantada | Ação capabilities | Declara ccSupported | Chamada MailApp com CC | Resultado estático |',
 '|---|---|---|---|---|',
 ...checks.map(c=>'| '+c.version+' | '+(c.actions?'sim':'não')+' | '+(c.ccResponse?'sim':'não')+
  ' | '+(c.ccDelivered?'sim':'não')+' | '+(c.ready?'compatível no código':'incompleto / revisar')+' |'),
 '',
 completed.length?'Versões recuperadas: '+completed.length+'.':'Não foi possível recuperar uma versão implantada para análise.',
 '',
 '**Limite:** confirmar qual ID de implantação corresponde ao URL /exec realmente configurado no Supabase é indispensável. Esta auditoria não valida a resposta HTTP real do gateway.',
 ''
].join('\n');
appendFileSync(summaryPath,'\n'+report);
console.log('CC_VERSION_AUDIT head='+head.ready+' versioned='+checks.length+
 ' checked='+completed.length+' compatible='+checks.filter(x=>x.ready).length);
// Do not fail the whole audit because an older legacy deployment lacks CC.
