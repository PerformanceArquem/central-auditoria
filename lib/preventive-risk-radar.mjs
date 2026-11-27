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
