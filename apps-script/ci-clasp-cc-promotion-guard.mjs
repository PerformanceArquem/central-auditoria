// Fail-closed gate for promoting a reviewed Apps Script version to the existing
// /exec deployment. Never prints deployment IDs, tokens, scripts or addresses.
import {readFileSync,appendFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const [mode,...args]=process.argv.slice(2);
const pattern=/^\s*[-*]?\s*(\S+)\s+@(\d+)\b/gm;
function deploymentVersion(file,id){
 const rows=[...readFileSync(file,'utf8').matchAll(pattern)].map(m=>({id:m[1],version:Number(m[2])}));
 const found=rows.filter(row=>row.id===id);
 if(found.length!==1||rows.length===0||rows.some(r=>!Number.isSafeInteger(r.version)))
  throw Error('Implantação alvo não identificada de forma única');
 return {version:found[0].version,deployments:rows.length};
}
function assertInputs(id,number){
 if(!id||!/^AKfy[A-Za-z0-9_-]{12,}$/.test(id))throw Error('ID de implantação ausente ou inválido');
 if(!Number.isSafeInteger(Number(number))||Number(number)<1)throw Error('Número de versão inválido');
}
if(mode==='deployment'){
 const [listing,targetId,version]=args;
 assertInputs(targetId,version);
 const result=deploymentVersion(listing,targetId);
 if(result.version!==Number(version))throw Error('Versão da implantação divergiu do valor aprovado');
 console.log('APPSSCRIPT_CC_DEPLOYMENT_MATCH version='+result.version+' deploymentCount='+result.deployments);
}else if(mode==='sha256'){
 const [folder,expectedSha]=args;
 if(!folder||!expectedSha||!(/^[a-f0-9]{64}$/.test(expectedSha)))throw Error('Assinatura SHA-256 aprovada obrigatória');
 const files=readdirSync(folder,{withFileTypes:true})
  .filter(entry=>entry.isFile()&&(entry.name==='appsscript.json'||/\\.(js|gs|html)$/.test(entry.name)))
  .map(entry=>entry.name).sort();
 if(!files.includes('appsscript.json')||files.length<7)
  throw Error('Inventário de versão candidata incompleto');
 const hash=createHash('sha256');
 for(const file of files){
  hash.update(file);hash.update('\\0');
  hash.update(readFileSync(join(folder,file)));hash.update('\\0');
 }
 const actual=hash.digest('hex');
 if(actual!==expectedSha)throw Error('SHA-256 da versão candidata divergiu da versão aprovada');
 console.log('APPSSCRIPT_CC_VERSION_SHA256_MATCH files='+files.length);
}else if(mode==='candidate'){
 const [folder,summaryPath,version]=args;
 if(!folder||!summaryPath||!Number.isSafeInteger(Number(version))||Number(version)<1)
  throw Error('Versão e pasta obrigatórias');
 const files=readdirSync(folder).filter(f=>/\.(js|gs)$/.test(f)).sort();
 const sources=files.map(file=>readFileSync(join(folder,file),'utf8'));
 const source=sources.join('\n');
 const postFunctions=sources.flatMap(src=>[...src.matchAll(/^function\s+doPost\s*\(/gm)]);
 if(postFunctions.length!==1)throw Error('Exigida uma única função global doPost');
 const secret=source.includes('MAIL_SECRET');
 const capabilities=/['"]capabilities['"]/.test(source);
 const ccResponse=/\bccSupported\s*:\s*true\b/.test(source);
 const realCc=/\bMailApp\.sendEmail\s*\(/.test(source)&&
  /\bcc\s*:\s*cc\.join\s*\(/.test(source);
 const validation=/dados\.cc|data\.cc/.test(source)&&
  /new Set\(cc\)/.test(source)&&/cc\.length/.test(source);
 const bodyNotEmpty=files.length>=6;
 if(![secret,capabilities,ccResponse,realCc,validation,bodyNotEmpty].every(Boolean))
  throw Error('Contrato de CC ausente ou sem validação de cópias; promoção bloqueada');
 appendFileSync(summaryPath,'\n### Contrato estático da versão candidata '+Number(version)+
  '\n- doPost global único: sim\n- Autenticação MAIL_SECRET e capabilities: sim'+
  '\n- Resposta ccSupported: true: sim\n- MailApp com CC: sim'+
  '\n- Validação de formato, duplicatas e quantidade de CC: sim'+
  '\n- **Não prova entrega real.** Ainda é obrigatória a sondagem autenticada da Central e homologação controlada.\n');
 console.log('APPSSCRIPT_CC_CANDIDATE_STATIC_OK version='+Number(version)+' files='+files.length);
}else throw Error('Modo desconhecido');
