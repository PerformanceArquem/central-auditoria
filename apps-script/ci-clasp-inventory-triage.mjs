// Read-only inventory triage of an Apps Script clasp pull.
// Logs only filenames, global declaration names and counts, not code or secrets.
// This does not authorize release or modify the remote script.
import {readFileSync,readdirSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
const [sourceDir,summaryPath]=process.argv.slice(2);
if(!sourceDir||!summaryPath)throw Error('Usage: inventory <remote-folder> <summary.md>');
const files=readdirSync(sourceDir).filter(f=>/\.js$/.test(f)).sort();
const occurrences=new Map(),stats=[];
for(const file of files){
 const src=readFileSync(join(sourceDir,file),'utf8');
 const matches=[...src.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(x=>x[1]);
 stats.push({file,count:matches.length});
 for(const name of matches)occurrences.set(name,[...(occurrences.get(name)||[]),file]);
}
const dup=[...occurrences].filter(([,origins])=>origins.length>1)
 .map(([name,origins])=>({name,origins}));
const critical=['doPost','arquemCreateReportAttachments_','arquemCapacidadesAnexos_',
 'arquemHomologarKeilaSemEnvio','arquemValidarPublicacaoSemEnvio'];
const missing=critical.filter(name=>!occurrences.has(name));
const safe=(s)=>String(s).replace(/[|\r\n]/g,' ').slice(0,110);
const lines=['### Inventário remoto do Apps Script (somente leitura)','',
 '- Arquivos JavaScript: '+files.length,
 '- Funções globais únicas: '+occurrences.size,
 '- Funções com múltiplas definições: '+dup.length,
 '- Funções críticas não identificadas: '+(missing.length?missing.join(', '):'nenhuma'),
 '',
 '#### Funções por arquivo','',
 '| Arquivo | Declarações de função |','|---|---:|',
 ...stats.map(({file,count})=>'| '+safe(file)+' | '+count+' |'),
 '',
 '#### Definições repetidas','',
 '| Função | Origem |','|---|---|',
 ...(dup.length?dup.map(({name,origins})=>'| '+safe(name)+' | '+origins.map(safe).join(', ')+' |'):['| Nenhuma | — |']),
 '',
 '**Segurança:** somente diagnóstico. Contagem 9:49 não equivale a aprovação da nova origem.',
 'Não adicionar uma assinatura de inventário à lista aprovada sem revisão separada das alterações e de suas dependências.',
 'Não publica Apps Script, não executa doPost e não envia e-mails.',''];
appendFileSync(summaryPath,'\n'+lines.join('\n'));
console.log('APPS_SCRIPT_INVENTORY files='+files.length+' globals='+occurrences.size+
 ' duplicates='+dup.length+' missingCritical='+missing.length);
for(const {name,origins} of dup)console.log('INVENTORY_DUPLICATE '+safe(name)+' sources='+origins.map(safe).join(','));
if(missing.length)console.log('INVENTORY_MISSING_CRITICAL '+missing.join(','));
