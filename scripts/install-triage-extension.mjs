import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2],source=process.argv[3];
const names=fs.readdirSync(root).filter(x=>x.endsWith('.js'));
const posts=names.filter(x=>/function\s+doPost\s*\(/.test(fs.readFileSync(path.join(root,x),'utf8')));
if(posts.length!==1)throw Error('Esperado exatamente um doPost; nenhum arquivo alterado');
const target=path.join(root,posts[0]);let text=fs.readFileSync(target,'utf8');
const marker="if (dados.action === 'capabilities')";
const index=text.indexOf(marker);
const auth=text.indexOf('dados.token');
if(index<0||auth<0||auth>index||!text.slice(auth,index).includes('throw'))throw Error('Ponto de integração autenticado não reconhecido; preservar instalação');
if(!text.includes('arquemTriageAction_(dados)'))text=text.slice(0,index)+"if (dados.action === 'triage_validate' || dados.action === 'triage_send') { return resposta(arquemTriageAction_(dados)); }\n    "+text.slice(index);
new Function(text);
const extension=fs.readFileSync(source,'utf8');new Function(extension);
fs.writeFileSync(target,text);fs.writeFileSync(path.join(root,'intelligence-triage-mail.js'),extension);
console.log('Extensão de triagem integrada após autenticação; demais rotinas preservadas.');

