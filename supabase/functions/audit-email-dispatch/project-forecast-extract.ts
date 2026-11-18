// Conservative forecast extraction matching the deterministic rules of
// Projetos e Prazos. Never interpret delivery dates or SLA as effort hours.
export type ExtractedProjectForecast={hours:number;origin:string;confidence:'alta'|'média'};
const KW=String.raw`previs[aã]o|previst[oa]s?|estimativa|estimad[oa]s?|estimo|esfor[cç]o|or[cç]ad[oa]s?|or[cç]amento|vai\s+levar|levar[aá]|levaremos|leva\s+(?:cerca\s+de|uns?|aprox\w*)|tempo\s+(?:total\s+)?(?:de\s+)?(?:execu[cç][aã]o|desenvolvimento)`;
const NUM=String.raw`(\d{1,4}(?:[.,]\d{1,2})?)(?:\s*(?:a|à|-|até|ate)\s*(\d{1,4}(?:[.,]\d{1,2})?))?`;
const UN=String.raw`\s*(horas?|hrs?|hs|h|min(?:utos?)?|dias?)(?![a-zà-ú])`;
const EST_A=new RegExp('(?:'+KW+')([^0-9\\n]{0,30}?)'+NUM+UN,'i');
const EST_B=new RegExp(NUM+UN+'\\s*(?:de\\s+|em\\s+)?(?:previst[ao]s?|estimad[ao]s?|esfor[cç]o|or[cç]ad[ao]s?)','i');
const BAD=/entreg|prazo|venc|respost|retorn|sla|atendiment|reuni|hor[aá]rio|janela|plant[aã]o|dispon/i;
const NEG=/(?:\bsem|\bn[aã]o|nenhum[ao]?)\s+(?:\w+\s+){0,2}$/i;
const WORDS:Record<string,number>={um:1,uma:1,dois:2,duas:2,tres:3,'três':3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10};
const clean=(v:unknown)=>String(v??'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ')
 .replace(/\s+/g,' ').trim().slice(0,4000);
const prep=(v:unknown)=>clean(v)
 .replace(/(\d{1,3})h(\d{2})(?!\d)/gi,(_,h,m)=>(Number(h)+Number(m)/60).toFixed(2)+'h')
 .replace(/(\d{1,3})\s*h(?:oras?)?\s*e\s*(\d{1,2})\s*min\w*/gi,(_,h,m)=>(Number(h)+Number(m)/60).toFixed(2)+'h')
 .replace(/(\d+)\s*horas?\s*e\s*meia/gi,(_,h)=>String(Number(h)+0.5)+'h')
 .replace(/\bmeia\s+hora\b/gi,'0.5h').replace(/\bmeio\s+dia\b/gi,'0.5 dia')
 .replace(/\b(um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\s+(horas?|dias?)\b/gi,
   (_,word,unit)=>String(WORDS[word.toLowerCase()]||0)+' '+unit);
export function readProjectForecast(payload:Record<string,unknown>,workdayHours=8,fieldId=''):ExtractedProjectForecast|null{
 if(!Number.isFinite(workdayHours)||workdayHours<=0||workdayHours>24)throw Error('Jornada configurada para o projeto inválida.');
 // The field configured in the module has priority over textual estimates.
 const fields=Array.isArray(payload.customFieldValues)?payload.customFieldValues:[];
 if(fieldId){
   const field=fields.find(x=>x&&typeof x==='object'&&String((x as Record<string,unknown>).customFieldId||'')===fieldId) as Record<string,unknown>|undefined;
   if(field){
     const n=parseFloat(String(field.value??'').replace(',','.'));
     if(Number.isFinite(n)&&n>0&&n<10000)return {hours:n,origin:'Campo personalizado Movidesk',confidence:'alta'};
   }
 }
 const actions=(Array.isArray(payload.actions)?payload.actions:[])
   .filter(x=>x&&typeof x==='object')
   .map(x=>x as Record<string,unknown>)
   .sort((a,b)=>String(a.createdDate||'').localeCompare(String(b.createdDate||''))).slice(0,12);
 const sources:[string,unknown][]=[['Assunto Movidesk',payload.subject],
   ...actions.map((a,i)=>['Ação Movidesk '+(i+1),a.description||a.htmlDescription] as [string,unknown])];
 const found:ExtractedProjectForecast[]=[];
 for(const [origin,source] of sources){
   const value=prep(source);
   if(!value||value.includes('CENTRAL-AUDITORIA-COBRANCA:'))continue;
   let match=EST_A.exec(value),num:string|undefined,range:string|undefined,unit:string|undefined,confidence:'alta'|'média'='alta';
   if(match&&!BAD.test(match[1]||'')&&!NEG.test(value.slice(Math.max(0,match.index-25),match.index))){
     num=match[2];range=match[3];unit=match[4];
   }else{
     match=EST_B.exec(value);confidence='média';
     if(!match||NEG.test(value.slice(Math.max(0,match.index-25),match.index)))continue;
     num=match[1];range=match[2];unit=match[3];
   }
   const raw=Number(String(range||num||'').replace(',','.'));
   if(!Number.isFinite(raw)||raw<=0)continue;
   const hours=/^d/i.test(unit||'')?raw*workdayHours:/^min/i.test(unit||'')?raw/60:raw;
   if(hours<=0||hours>10000)continue;
   found.push({hours,origin,confidence});
 }
 return found.at(-1)||null;
}
