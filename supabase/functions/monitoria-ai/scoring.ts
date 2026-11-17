import {RULES,CRITICAL,RULESET_VERSION,rulesFor} from './rules.ts';
export type Channel='chat'|'voice';
export type Decision='conforme'|'parcial'|'nao_conforme'|'nao_verificavel'|'nao_aplicavel';
export type Observation={id:string;decision:Decision;evidence?:string;reason?:string};
const DECISIONS=new Set<Decision>(['conforme','parcial','nao_conforme','nao_verificavel','nao_aplicavel']);
export function evaluate(channel:Channel, observations:Observation[],criticalFindings:Observation[],source:string){
 const rules=rulesFor(channel);
 const byId=new Map(observations.map(o=>[o.id,o]));
 const results=rules.map(rule=>{
  const o=byId.get(rule.id);const values=rule[channel];
  const decision:Decision= o&&DECISIONS.has(o.decision)?o.decision:'nao_verificavel';
  const evidence=String(o?.evidence||'').trim().slice(0,600);
  // Evidence must be part of the submitted transcript, not a fabricated quote.
  const verified=!!evidence&&source.includes(evidence);
  // Every positive or negative finding requires a quote from the supplied evidence.
  // An unproved 'conforme' is just as uncertain as an unproved violation.
  const justified=decision==='nao_conforme'||decision==='parcial'||decision==='conforme';
  const partial=values.partial;
  // A modalidade "parcial" não existe para todos os critérios na planilha.
  // Nunca mantenha uma decisão parcial sem peso definido: isso impediria
  // o registro no backend, que revalida a rubrica de forma independente.
  const partialUnsupported=decision==='parcial'&&typeof partial!=='number';
  const accepted=(verified||!justified)&&!partialUnsupported;
  const effective=accepted?decision:'nao_verificavel';
  // Planilha: valores são descontos por infração; 'Parcial' indica desconto reduzido.
  const maxPoints=typeof values.points==='number'?values.points:0;
  const deduction=effective==='nao_conforme'?maxPoints:
    effective==='parcial'?(typeof partial==='number'?partial:0):0;
  return {id:rule.id,code:rule.code,block:rule.block,name:rule.name,decision:effective,
    evidence:verified?evidence:'',reason:(effective==='nao_verificavel'&&!String(o?.reason||'').trim()? 'Sem evidência suficiente no material fornecido; conferir conversa integral ou dados do ticket.' : String(o?.reason||'')).slice(0,450),
    deducted:deduction,maxDeduction:maxPoints,needsReview:!accepted};
 });
 const critical=CRITICAL.map(rule=>{
  const o=criticalFindings.find(f=>f.id===rule.code);
  const evidence=String(o?.evidence||'').trim();
  const confirmedByTranscript=!!evidence&&source.includes(evidence);
  return {code:rule.code,name:rule.name,suspected:o?.decision==='nao_conforme',
    evidence:confirmedByTranscript?evidence:'',needsReview:o?.decision==='nao_conforme'};
 });
 const zeroProposed=critical.some(x=>x.suspected&&x.evidence);
 const deducted=results.reduce((sum,x)=>sum+x.deducted,0);
 const known=results.filter(x=>x.decision==='conforme'||x.decision==='parcial'||x.decision==='nao_conforme').length;
 return {version:RULESET_VERSION,channel,scoreSuggestion:zeroProposed?0:Math.max(0,100-deducted),
   scoreBeforeCritical:Math.max(0,100-deducted),criticalFlag:zeroProposed,
   provisional:true,requiresHumanApproval:true,verifiedCriteria:known,totalCriteria:rules.length,
   incomplete:known<rules.length,reviewedCriteria:results.length,unverifiedCriteria:results.filter(x=>x.decision==='nao_verificavel').length,
   notApplicableCriteria:results.filter(x=>x.decision==='nao_aplicavel').length,
   scoreIsFinal:false,criteria:results,critical};
}
