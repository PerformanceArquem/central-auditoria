const DAY=86400000;
const name=v=>typeof v==='string'?v.trim():String(v?.businessName||v?.name||'').trim();
const norm=v=>name(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const at=v=>{if(!v)return null;const s=String(v),n=Date.parse(/Z$|[+-]\d\d:\d\d$/i.test(s)?s:s+'Z');return Number.isFinite(n)?n:null;};
const cohortKey=t=>{const s=norm(t.ownerTeam),c=norm(t.category),service=norm(t.serviceFirstLevel);return s&&c&&service?JSON.stringify([s,c,service]):null;};
const closed=t=>/^(closed|resolved)$/.test(norm(t.baseStatus))||/^(fechad|resolvid|encerrad|concluid|finalizad)/.test(norm(t.status));
export function buildDelayHistory(records,{now=Date.now()}={}){
  const groups=new Map(),seen=new Set();
  for(const source of records){
    const t=source.payload||source,id=String(source.ticket_id||t.id||''),key=cohortKey(t);
    if(!id||seen.has(id)||!key||t.isDeleted||!closed(t)||/cancel/.test(norm(t.status)))continue;
    const end=at(t.resolvedIn||t.closedIn||source.closed_at_source),due=at(t.slaSolutionDate||t.dueDate),opened=at(t.createdDate);
    if(end===null||due===null||end>now||(opened!==null&&opened>end))continue;
    seen.add(id);const group=groups.get(key)||{samples:0,late:0,byId:new Map()};group.samples++;group.late+=Number(end>due);group.byId.set(id,end>due);groups.set(key,group);
  }
  return groups;
}
export function calculateDelayRisk(source,{now=Date.now(),history=new Map(),clientCriticality={}}={}){
  if(!Number.isFinite(now))throw Error('Instante de avaliação inválido');
  const t=source.payload||source,id=String(source.ticket_id||t.id||''),components=[];
  function add(key,label,max,points,value,basis){components.push({key,label,max,points:points===null?null:Math.min(max,Math.max(0,points)),value,basis,available:points!==null});}
  const due=at(t.slaSolutionDate||t.dueDate),remaining=due===null?null:(due-now)/DAY;
  add('deadline','Proximidade do vencimento',30,remaining===null?null:remaining<=1?30:remaining<=2?24:remaining<=3?18:remaining<=7?8:0,remaining,'Dias corridos até o prazo de solução');
  const actions=Array.isArray(t.actions)?t.actions:null;
  const appointments=(actions||[]).flatMap(a=>Array.isArray(a.timeAppointments)?a.timeAppointments:[]);
  const appointmentsComplete=actions!==null&&actions.every(a=>Array.isArray(a.timeAppointments));
  const dated=appointmentsComplete?appointments.map(p=>at(p.date||p.startDate)).filter(n=>n!==null&&n<=now):[];
  const opened=at(t.createdDate||source.created_at_source);
  const appointmentBasis=dated.length?'Último apontamento datado':appointmentsComplete&&appointments.length===0?'Sem apontamentos carregados; contagem desde a abertura':'Data ou cobertura dos apontamentos indisponível';
  const lastAppointment=dated.length?Math.max(...dated):appointmentsComplete&&appointments.length===0&&opened!==null&&opened<=now?opened:null;
  const idle=lastAppointment===null?null:(now-lastAppointment)/DAY;
  add('appointment','Tempo sem apontamento',20,idle===null?null:idle>=7?20:idle>=3?12:idle>=1?6:0,idle,appointmentBasis);
  const rawHistories=Array.isArray(t.ownerHistories)?t.ownerHistories:[];
  const histories=rawHistories.map((h,i)=>({at:at(h.changedDate),sector:norm(h.ownerTeam),seq:i})).filter(h=>h.at!==null&&h.at<=now).sort((a,b)=>a.at-b.at||a.seq-b.seq);
  const validHistory=histories.length>0&&histories.length===rawHistories.length&&histories.every(h=>h.sector);
  const transfers=validHistory?histories.reduce((n,h,i)=>n+Number(i>0&&h.sector!==histories[i-1].sector),0):null;
  add('transfers','Transferências entre setores',15,transfers===null?null:transfers>=5?15:transfers>=3?10:transfers>=1?5:0,transfers,'Trocas de setor observadas; troca de responsável no mesmo setor não conta');
  const group=history.get(cohortKey(t)),self=group?.byId.has(id);
  const samples=(group?.samples||0)-Number(!!self),late=(group?.late||0)-Number(self&&group.byId.get(id));
  const lateRate=samples>=5?late/samples:null;
  add('similar','Histórico semelhante',15,lateRate===null?null:lateRate*15,{samples,late,lateRate},'Mesmo setor, categoria e serviço; mínimo de cinco resolvidos com prazo e conclusão válidos');
  const levels=new Map([['critica',10],['alta',7],['media',3],['baixa',0]]);
  const clients=Array.isArray(t.clients)?t.clients:[];
  const matches=clients.flatMap(c=>[c?.organization?.id,c?.id,name(c?.organization),name(c)].filter(v=>v!==undefined&&v!==null&&v!=='').map(v=>String(v)));
  const configured=Object.entries(clientCriticality).filter(([key])=>matches.some(v=>norm(v)===norm(key))).map(([,value])=>norm(value)).filter(v=>levels.has(v));
  const priority=configured.length?Math.max(...configured.map(v=>levels.get(v))):null;
  add('client','Criticidade do cliente',10,priority,configured.length?configured.join(', '):null,'Cadastro explícito ou VIP corporativo confirmado (Alta); ausência não significa Baixa');
  const current=norm(t.ownerTeam),last=histories.at(-1);
  let queueDays=null;
  if(validHistory&&current&&last?.sector===current){
    queueDays=histories.reduce((sum,h,i)=>sum+(h.sector===current?((histories[i+1]?.at??now)-h.at)/DAY:0),0);
  }
  add('queue','Tempo acumulado na fila',10,queueDays===null?null:queueDays>=15?10:queueDays>=7?7:queueDays>=3?3:0,queueDays,'Tempo observado no setor atual, somando retornos; horas corridas');
  const availableWeight=components.filter(c=>c.available).reduce((s,c)=>s+c.max,0),points=components.reduce((s,c)=>s+(c.points??0),0);
  const score=due===null?null:remaining<0?100:Math.round(points/availableWeight*100);
  const coverage=availableWeight;
  return {version:'delay-risk-v2',score,band:score===null?'Indeterminada':score>=70?'Crítica':score>=40?'Alta':score>0?'Média':'Baixa',state:due===null?'Sem prazo válido':remaining<0?'Já vencido':'Risco de atraso',coverage,coverageLabel:coverage>=85?'Alta':coverage>=60?'Média':'Baixa',components,missing:components.filter(c=>!c.available).map(c=>c.label),lastAppointmentAt:dated.length?new Date(lastAppointment).toISOString():null,transfers,queueDays,similarity:{samples,late,lateRate},notice:'Índice heurístico sobre os fatores disponíveis; cobertura de dados não é precisão estatística nem probabilidade de atraso.'};
}
