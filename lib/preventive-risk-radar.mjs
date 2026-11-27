// Radar exclusivamente analítico: não dispara cobranças nem altera chamados.
export const RADAR_CATEGORIES=[
 ['overdue','Vencidos'],['critical','Risco crítico'],['high','Risco alto'],
 ['medium','Risco moderado'],['low','Risco baixo'],['unknown','Dados insuficientes']
];
export function radarCategory(row){
 const r=row.risk;
 if(r?.state==='Já vencido')return 'overdue';
 if(!r||!Number.isFinite(r.score)||!Number.isFinite(r.coverage)||r.coverage<60)return 'unknown';
 return r.score>=70?'critical':r.score>=40?'high':r.score>0?'medium':'low';
}
export function summarizeRadar(rows){
 const counts=Object.fromEntries(RADAR_CATEGORIES.map(([key])=>[key,0])),sectors=new Map(),owners=new Map();
 for(const row of rows){
 const category=radarCategory(row);counts[category]++;
 if(!['critical','high'].includes(category))continue;
 for(const [map,key] of [[sectors,row.sector||'Sem setor'],[owners,row.owner||'Sem responsável']])map.set(key,(map.get(key)||0)+1);
 }
 const rank=map=>[...map].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'pt-BR'));
 return {counts,sectors:rank(sectors),owners:rank(owners)};
}
export function filterRadar(rows,{category='',owner=''}={}){
 return rows.filter(row=>(!category||radarCategory(row)===category)&&(!owner||row.owner===owner));
}

const GUIDANCE={
 deadline:'Conferir o prazo com o responsável e validar o planejamento das próximas atividades.',
 appointment:'Conferir os apontamentos e registrar as atividades realizadas que ainda não constam no chamado.',
 transfers:'Revisar o encaminhamento e confirmar o setor responsável pela próxima etapa.',
 similar:'Consultar os gargalos observados em chamados semelhantes e revisar o planejamento.',
 client:'Considerar a criticidade cadastrada do cliente ao organizar as prioridades.',
 queue:'Avaliar o tempo de permanência no setor e identificar impedimentos para o andamento.'
};
export function preventiveGuidance(row){
 const category=radarCategory(row);
 if(category==='unknown')return ['Conferir prazo e cobertura dos dados antes de definir prioridades.'];
 if(category==='overdue')return ['Prazo já vencido: revisar o andamento e a previsão com o responsável.'];
 if(category==='low')return ['Manter o acompanhamento regular conforme o planejamento.'];
 const factors=(row.risk?.components||[]).filter(c=>c.available&&Number.isFinite(c.points)&&c.points>0&&Object.hasOwn(GUIDANCE,c.key)).sort((a,b)=>b.points-a.points);
 return [...new Set(factors.map(c=>GUIDANCE[c.key]))].slice(0,3);
}
