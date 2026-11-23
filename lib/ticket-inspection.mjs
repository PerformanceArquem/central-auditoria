const DAY = 86400000;
const name = value => typeof value === 'string' ? value.trim() : String(value?.businessName || value?.name || '').trim();
const norm = value => name(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const instant = value => {
  if (!value) return null;
  const text = String(value);
  const n = Date.parse(/Z$|[+-]\d\d:\d\d$/i.test(text) ? text : text + 'Z');
  return Number.isFinite(n) ? n : null;
};
export function inspectTickets(tickets, {now = Date.now(), idleDays = 7} = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(idleDays) || idleDays <= 0) throw Error('Critérios inválidos');
  return tickets.flatMap(source => {
    const t = source.payload || source;
    if (t.isDeleted || source.closed_at_source || t.closedIn || /^(closed|resolved|canceled|cancelled)$/.test(norm(t.baseStatus)) || /fechad|resolvid|cancelad|concluid|encerrad|finalizad/.test(norm(t.status))) return [];
    const id = String(source.ticket_id || t.id || '');
    if (!id) return [];
    const actions = Array.isArray(t.actions) ? t.actions : [];
    const dates = actions.map(a => instant(a.createdDate)).filter(n => n !== null && n <= now);
    const last = dates.length ? Math.max(...dates) : null;
    const age = last === null ? null : (now - last) / DAY;
    const dueRaw = t.slaSolutionDate || t.dueDate;
    const due = instant(dueRaw);
    const histories = (Array.isArray(t.ownerHistories) ? t.ownerHistories : [])
      .map(h => ({at: instant(h.changedDate), sector: name(h.ownerTeam), owner: name(h.owner)}))
      .filter(h => h.at !== null && h.at <= now).sort((a,b) => a.at-b.at);
    const timeline = histories.map((h,i) => ({...h, until: histories[i+1]?.at ?? now, hours: ((histories[i+1]?.at ?? now)-h.at)/3600000}));
    const sector = name(t.ownerTeam) || 'Sem setor';
    const latest = timeline.at(-1);
    let queueStart=latest?.at;
    for(let i=timeline.length-2;i>=0&&timeline[i].sector===latest?.sector;i--)queueStart=timeline[i].at;
    // Only a matching, dated history establishes current queue residence.
    const queueDays = latest && latest.sector === name(t.ownerTeam) ? (now-queueStart)/DAY : null;
    const findings = [];
    const add = (code,label) => findings.push({code,label});
    if (due !== null && due < now) add('overdue','Chamado vencido');
    if (!dueRaw) add('no_forecast','Sem previsão');
    else if (due === null) add('invalid_forecast','Previsão inválida: conferir origem');
    if (!name(t.owner)) add('no_owner','Sem responsável');
    if (Array.isArray(t.actions) && !actions.some(a => Array.isArray(a.timeAppointments) && a.timeAppointments.length)) add('no_appointments','Sem apontamentos nos dados carregados');
    if (age !== null && age >= idleDays) add('idle','Sem ação recente');
    if (queueDays !== null && queueDays >= idleDays) add('queue','Permanência prolongada no setor');
    const reasons = [];
    let score = 0;
    if (due !== null && due < now) { score=100; reasons.push('Prazo vencido'); }
    else {
      if (due !== null && due-now <= 2*DAY) {score+=45; reasons.push('Prazo em até 48 horas');}
      if (findings.some(f=>f.code==='no_owner')) {score+=25; reasons.push('Sem responsável');}
      if (findings.some(f=>['idle','queue'].includes(f.code))) {score+=25; reasons.push('Inatividade ou fila prolongada');}
      if (findings.some(f=>f.code==='no_appointments')) {score+=10; reasons.push('Sem apontamentos carregados');}
    }
    score=Math.min(100,score);
    const evaluatedCodes=['overdue','no_forecast','invalid_forecast','no_owner',...(Array.isArray(t.actions)?['no_appointments']:[]),...(last!==null?['idle']:[]),...(queueDays!==null?['queue']:[])];
    return [{id, subject:String(t.subject || ''), sector, client:name(t.clients?.[0]?.organization)||name(t.clients?.[0])||'Sem cliente', owner:name(t.owner)||'Sem responsável', findings, evaluatedCodes, timeline, queueDays, score, reasons, criticality:score>=70?'Crítica':score>=40?'Alta':score>0?'Média':'Baixa', forecastKnown:due!==null, gaps:[...(!Array.isArray(t.actions)?['Ações não carregadas']:[]),...(!timeline.length?['Histórico de transferências indisponível']:[]),...(latest&&latest.sector!==name(t.ownerTeam)?['Histórico não confirma o setor atual']:[])]}];
  }).sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id));
}
export function filterInspections(rows, {sector='',client='',criticality=''}={}) {
  return rows.filter(r=>(!sector||r.sector===sector)&&(!client||norm(r.client).includes(norm(client)))&&(!criticality||r.criticality===criticality));
}
// Session-only history: no server writes, no storage of ticket descriptions.
export function recordOccurrences(previous, rows, at) {
  const observed=new Map(rows.map(r=>[r.id,r]));
  const active=new Set(rows.flatMap(r=>r.findings.map(f=>r.id+':'+f.code)));
  const result=previous.map(e=>{
    const row=observed.get(e.id),code=e.key.slice(e.id.length+1);
    return row&&(!row.evaluatedCodes||row.evaluatedCodes.includes(code))&&!e.resolvedAt&&!active.has(e.key)?{...e,resolvedAt:at}:e;
  });
  for(const r of rows) for(const f of r.findings) {
    const key=r.id+':'+f.code;
    if(!result.some(e=>e.key===key&&!e.resolvedAt)) result.push({key,id:r.id,label:f.label,openedAt:at,resolvedAt:null});
  }
  return result;
}
