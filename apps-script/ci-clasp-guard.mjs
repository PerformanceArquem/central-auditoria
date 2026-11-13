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
  for(const match of source.matchAll(/^function\\s+([A-Za-z_$][\\w$]*)\\s*\\(/gm)){
   const name=match[1];
   const matches=declarations.get(name)||[];
   matches.push(path);
   declarations.set(name,matches);
  }
 }
 return [...declarations.entries()].filter(([,paths])=>paths.length>1).sort(([a],[b])=>a.localeCompare(b));
}
if(mode==='audit'){
 const d=snapshot(remote);
 appendFileSync(other,'### Auditoria read-only\n\nArquivos: '+d.paths.length+'\n\nSHA-256: '+d.sha+'\n\nArquivos: '+d.paths.join(', ')+'\n');
 const duplicates=duplicateTopLevelFunctions(remote,d.paths);
 appendFileSync(other,'\\n### Verificação de funções top-level duplicadas\\n\\n'+(duplicates.length?duplicates.map(([name,paths])=>'- \`'+name+'\`: '+paths.map(p=>'\`'+p+'\`').join(', ')).join('\\n'):'Nenhuma declaração duplicada encontrada pelo verificador estático.')+'\\n');
 console.log('Funções top-level duplicadas identificadas: '+duplicates.length);
 console.log('Auditoria de '+d.paths.length+' arquivos; SHA-256: '+d.sha);
}else if(mode==='compare'){
 if(snapshot(remote).sha!==other)throw Error('Código remoto alterado desde a auditoria.');
 console.log('Estado remoto confirmado.');
}else if(mode==='verify'){
 const current=snapshot(remote),source=snapshot(other);
 if(current.sha!==expectedRemote)throw Error('Remoto divergiu da auditoria.');
 if(source.sha!==expectedSource)throw Error('Origem revisada divergiu do hash aprovado.');
 if(current.paths.join('|')!==source.paths.join('|'))throw Error('Lista de arquivos difere; possível exclusão de função.');
 console.log('Hashes e inventário dos arquivos validados.');
}else throw Error('Modo inválido');
