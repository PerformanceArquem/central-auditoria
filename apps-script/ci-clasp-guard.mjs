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
if(mode==='audit'){
 const d=snapshot(remote);
 appendFileSync(other,'### Auditoria read-only\n\nArquivos: '+d.paths.length+'\n\nSHA-256: '+d.sha+'\n\nArquivos: '+d.paths.join(', ')+'\n');
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
