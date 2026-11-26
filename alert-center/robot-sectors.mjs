const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
const teams=new Map([
 ['producao - cpo','Produção'],['producao','Produção'],['testes (qa)','QA'],['qa','QA'],
 ['inteligencia','Inteligência'],['implantacao','Implantação'],['sucesso do cliente','Sucesso do Cliente'],
 ['treinamento','Treinamento'],['suporte','Suporte'],['qualidade','Qualidade']
]);
// Exact aliases only; unknown or unassigned teams must not be charged.
export function mapRobotSector(ownerTeam){return typeof ownerTeam==='string'?teams.get(norm(ownerTeam))??null:null;}
const intelligence=new Set(['Inteligência','QA','Qualidade','Sucesso do Cliente','Implantação','Treinamento']);
export function robotGroup(sector){return intelligence.has(sector)?'Inteligência':['Suporte','Produção'].includes(sector)?sector:null;}
export function robotSchedule(ownerTeam){const sector=mapRobotSector(ownerTeam);return sector?{sector,group:robotGroup(sector),clock:sector==='Produção'?'05:30':'18:05',timezone:'America/Sao_Paulo'}:null;}

