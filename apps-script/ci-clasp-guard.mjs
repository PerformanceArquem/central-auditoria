import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
const [mode,remote,other,expectedRemote,expectedSource]=process.argv.slice(2);
const allowed=['.js','.gs','.html','.json'];
function walk(dir,prefix=''){
 const out=[];
 for(const item of readdirSync(join(dir,prefix),{withFileTypes:true})){
  if(item.name.startsWith('.')||item.name==='node_modules')continue;
  const rel=join(prefix,item.name);
  if(item.isDirectory())out.push(...walk(dir,rel));
  else if(item.isFile()&&allowed.some(ext=>item.name.endsWith(ext)))out.push(rel.replaceAll('\\','/'));
 }
 return out.sort();
}
function snapshot(dir){
 const paths=walk(dir);
 if(!paths.includes('appsscript.json'))throw Error('Manifesto Apps Script ausente');
 const h=createHash('sha256');
 for(const p of paths){h.update(p);h.update('\0');h.update(readFileSync(join(dir,p)));h.update('\0');}
 return {paths,sha:h.digest('hex')};
}
function duplicateTopLevelFunctions(dir,paths){
 const declarations=new Map();
 for(const path of paths.filter(p=>p.endsWith('.js')||p.endsWith('.gs'))){
  const source=readFileSync(join(dir,path),'utf8');
  for(const match of source.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)){
   const name=match[1];
   const matches=declarations.get(name)||[];
   matches.push(path);
   declarations.set(name,matches);
  }
 }
 return [...declarations.entries()].filter(([,paths])=>paths.length>1).sort(([a],[b])=>a.localeCompare(b));
}
// Comparacao conservadora de trechos: nao comprova equivalencia semantica.
function duplicateTextFingerprints(dir,duplicates){
 const records=new Map();
 for(const [,paths] of duplicates){
  for(const path of paths){
   if(records.has(path))continue;
   const source=readFileSync(join(dir,path),'utf8');
   const matches=[...source.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)];
   const fragments=new Map();
   for(let i=0;i<matches.length;i++){
    const start=matches[i].index;
    const end=i+1<matches.length?matches[i+1].index:source.length;
    const section=source.slice(start,end).trim();
    fragments.set(matches[i][1],createHash('sha256').update(section).digest('hex'));
   }
   records.set(path,fragments);
  }
 }
 return duplicates.map(([name,paths])=>{
  const hashes=paths.map(path=>records.get(path).get(name));
  return {name,paths,identicalText:hashes.every(hash=>hash===hashes[0])};
 });
}
if(mode==='audit'){
 const d=snapshot(remote);
 appendFileSync(other,'### Auditoria read-only\n\nArquivos: '+d.paths.length+'\n\nSHA-256: '+d.sha+'\n\nArquivos: '+d.paths.join(', ')+'\n');
 const duplicates=duplicateTopLevelFunctions(remote,d.paths);
 appendFileSync(other,'\n### Verificação de funções top-level duplicadas\n\n'+(duplicates.length?duplicates.map(([name,paths])=>'- \`'+name+'\`: '+paths.map(p=>'\`'+p+'\`').join(', ')).join('\n'):'Nenhuma declaração duplicada encontrada pelo verificador estático.')+'\n');
 console.log('Funções top-level duplicadas identificadas: '+duplicates.length);
 for(const [name, locations] of duplicates) console.log('DUPLICADA '+name+' em '+locations.join(', '));
 const fingerprints=duplicateTextFingerprints(remote,duplicates);
 const same=fingerprints.filter(f=>f.identicalText);
 const different=fingerprints.filter(f=>!f.identicalText);
 console.log('TRECHOS COM TEXTO IGUAL (comparacao conservadora): '+same.length);
 console.log('TRECHOS COM TEXTO DIFERENTE: '+different.length);
 for(const item of fingerprints)console.log('ASSINATURA '+(item.identicalText?'IGUAL':'DIFERENTE')+' '+item.name);
 appendFileSync(other,'\\n### Comparacao textual dos trechos duplicados (nao semantica)\\n\\nTrechos iguais: '+same.length+'; trechos diferentes: '+different.length+'\\n\\n'+fingerprints.map(item=>'- '+item.name+': '+(item.identicalText?'texto idêntico':'texto diferente — revisar manualmente')).join('\\n')+'\\n');

 console.log('Auditoria de '+d.paths.length+' arquivos; SHA-256: '+d.sha);
}else if(mode==='compare'){
 if(snapshot(remote).sha!==other)throw Error('Código remoto alterado desde a auditoria.');
 console.log('Estado remoto confirmado.');
}else if(mode==='verify'){
 const current=snapshot(remote),source=snapshot(other);
 if(current.sha!==expectedRemote)throw Error('Remoto divergiu da auditoria.');
 if(source.sha!==expectedSource)throw Error('Origem revisada divergiu do hash aprovado.');
 if(current.paths.join('|')!==source.paths.join('|'))throw Error('Lista de arquivos difere; possível exclusão de função.');
 const remaining=duplicateTopLevelFunctions(other,source.paths);
 if(remaining.length)throw Error('Publicação bloqueada: '+remaining.length+' funções top-level duplicadas na origem revisada: '+remaining.map(([name,paths])=>name+' ['+paths.join(', ')+']').join('; '));
 console.log('Hashes e inventário dos arquivos validados.');
}else throw Error('Modo inválido');
