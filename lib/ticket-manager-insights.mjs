import {inspectTickets,filterInspections} from './ticket-inspection.mjs';
import {radarCategory,preventiveGuidance} from './preventive-risk-radar.mjs';
import {identifyTraceabilitySignals,summarizeSectorTraceability} from './sector-traceability.mjs';
import {summarizeManagement} from './live-management-dashboard.mjs';
export const INSIGHT_OPTIONS=[
 ['risk','Quais chamados estão em risco?'],
 ['idle','Quais chamados estão parados?'],
 ['bottlenecks','Quais setores apresentam gargalos?'],
 ['returns','Quais chamados retornaram ao setor anterior?'],
 ['vip','Quais clientes VIP precisam de atenção?'],
 ['daily','Resumo gerencial diário']
];
const fmt=n=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(n);
export function localInsight(intent,{tickets=[],appointments=[],sector='',client='',collaborator='',day,now=Date.now(),clientCriticality={},vipKnown=false}={}){
 if(!INSIGHT_OPTIONS.some(([key])=>key===intent))throw Error('Consulta local não reconhecida.');
 if(!tickets.length)throw Error('Base de chamados ainda não carregada.');
 const all=inspectTickets(tickets,{now,clientCriticality});
 const rows=filterInspections(all,{sector,client}).filter(r=>!collaborator||r.owner===collaborator);
 const header=['Fonte: chamados carregados na sessão; cobertura sujeita à sincronização.','Escopo atual: '+(sector||'Todos os setores')+' · '+rows.length+' chamados abertos na seleção.'];
 const result=(title,lines)=>({title,answer:[title,...header,...lines].join('\n')});
 const list=(items,describe)=>[items.length+' chamados identificados.',...items.slice(0,20).map(describe),...(items.length>20?['Exibidos os primeiros 20.']:[])];
 const ref=r=>'#'+r.id+' · '+r.sector+' · '+r.owner;
 if(intent==='risk'){
  const items=rows.filter(r=>['high','critical'].includes(radarCategory(r)));
  return result('Radar preventivo — riscos futuros', [...list(items,r=>ref(r)+' · índice '+r.risk.score+'/100 · cobertura '+r.risk.coverage+'% · '+preventiveGuidance(r).join(' ')),rows.filter(r=>radarCategory(r)==='overdue').length+' já vencidos (separados do risco futuro).',rows.filter(r=>radarCategory(r)==='unknown').length+' com risco indeterminado. Índice heurístico, não probabilidade.']);
 }
 if(intent==='idle')return result('Chamados com sinais de inatividade',list(rows.filter(r=>r.findings.some(f=>['idle','queue','no_appointments'].includes(f.code))),r=>ref(r)+' · '+r.findings.filter(f=>['idle','queue','no_appointments'].includes(f.code)).map(f=>f.label).join('; ')));
 if(intent==='returns'||intent==='bottlenecks'){
  const signals=identifyTraceabilitySignals(rows);
  if(intent==='returns')return result('Retornos observados a setores anteriores',[...list(signals.filter(r=>r.returns>0),r=>ref(r)+' · '+r.returns+' retornos'), 'Retorno não comprova retrabalho.']);
  const trace=summarizeSectorTraceability(rows);
  return result('Gargalos e permanência observada',[...trace.sectors.slice(0,10).map(r=>r.sector+' · '+fmt(r.hours)+' horas corridas · '+r.tickets+' chamados'),...list(signals,r=>ref(r)+' · '+r.signals.join('; ')),trace.missing+' sem histórico. Horas corridas não representam esforço ou responsabilidade pelo atraso.']);
 }
 if(intent==='vip'){
  if(!vipKnown)return result('Monitoramento VIP',['Lista corporativa não confirmada; indicador indisponível.']);
  const names=new Set(Object.keys(clientCriticality));
  return result('Clientes VIP com vencimento ou risco elevado',list(rows.filter(r=>names.has(r.client)&&['overdue','high','critical'].includes(radarCategory(r))),r=>ref(r)+' · '+r.client+' · '+radarCategory(r)));
 }
 if(client||collaborator)throw Error('Resumo diário disponível apenas por setor; limpe os filtros de cliente e colaborador.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day||''))throw Error('Selecione uma data válida.');
 const d=summarizeManagement({tickets,appointments,day,now,sector,clientCriticality,vipKnown});
 return result('Resumo gerencial — '+day,[d.opened+' entradas · '+d.closed+' encerramentos confirmados · '+fmt(d.hours)+' h apontadas na data.',d.backlog+' abertos atualmente · '+d.radar.overdue+' vencidos · '+(d.radar.high+d.radar.critical)+' em risco alto/crítico · '+d.gaps+' com sinais de gargalo.',d.unknownClosure+' encerrados sem data confirmada. Setor de entradas/saídas corresponde ao setor atual.']);
}
