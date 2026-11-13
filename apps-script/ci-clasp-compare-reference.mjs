import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [remoteRoot,mainRoot,prRoot,summaryPath]=process.argv.slice(2);
if(!remoteRoot||!mainRoot||!prRoot||!summaryPath)throw Error('Uso: node ci-clasp-compare-reference.mjs <remote> <main> <pr> <summary>');
function sections(file){
 const source=readFileSync(file,'utf8').replace(/\r\n/g,'\n');
 const matches=[...source.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)];
 const found=new Map();
 for(let i=0;i<matches.length;i++){
  const start=matches[i].index,end=i+1<matches.length?matches[i+1].index:source.length;
  found.set(matches[i][1],source.slice(start,end).trim());
 }
 return found;
}
const remoteFiles=['ZenviaVozChat.js','arquem-relatorios-anexos.gs.js'];
const oldReference=sections(resolve(mainRoot,'apps-script/arquem-relatorios-anexos.gs'));
const newReference=sections(resolve(prRoot,'apps-script/arquem-relatorios-anexos.gs'));
const original=remoteFiles.map(f=>({file:f,sections:sections(resolve(remoteRoot,f))}));
const shared=[...original[0].sections.keys()].filter(n=>original[1].sections.has(n)).sort();
const rows=[];
for(const name of shared){
 const left=original[0].sections.get(name),right=original[1].sections.get(name);
 const match=(text,reference)=>reference===undefined?'não encontrada':text===reference?'igual':'diferente';
 rows.push({name,
  versionsMatch:left===right?'sim':'não',
  zenviaMain:match(left,oldReference.get(name)),
  zenviaPR68:match(left,newReference.get(name)),
  anexosMain:match(right,oldReference.get(name)),
  anexosPR68:match(right,newReference.get(name))
 });
}
appendFileSync(summaryPath,'\n### Comparação conservadora com referências GitHub\n\n');
appendFileSync(summaryPath,'Comparação textual de trechos de função; não prova equivalência funcional. Nenhum código-fonte ou credencial remota é exibido.\n\n');
appendFileSync(summaryPath,'| Função | Remotas iguais? | Zenvia vs main | Zenvia vs PR68 | Anexos vs main | Anexos vs PR68 |\n|---|---|---|---|---|---|\n');
for(const row of rows)appendFileSync(summaryPath,'| '+row.name+' | '+row.versionsMatch+' | '+row.zenviaMain+' | '+row.zenviaPR68+' | '+row.anexosMain+' | '+row.anexosPR68+' |\n');
console.log('Comparação segura concluída: '+rows.length+' funções duplicadas. Resultado no resumo do job.');
