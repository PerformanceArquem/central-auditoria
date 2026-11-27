// Presentation only: consumes simulations or read-only snapshots; never dispatches or persists.
export const GROUPS = ['Inteligência', 'Produção', 'Suporte'];
export const LEVELS = {preventive:'Preventivo', operational:'Responsável', management:'Gestão', review:'Revisão de dados'};
export const REASONS = {overdue:'Previsão vencida', preventive:'Aviso preventivo', escalation:'Escalonamento', idle:'Sem apontamentos', 'aged-triage':'Triagem antiga', 'stale-history':'Histórico desatualizado', 'missing-history':'Histórico ausente', 'history-coverage-unconfirmed':'Cobertura não confirmada', 'invalid-history':'Histórico inválido', 'unordered-history':'Ordem do histórico não confirmada', 'history-does-not-match-current-state':'Setor ou status divergente', 'invalid-sync-time':'Atualização não informada', 'not-found-by-api':'Chamado não localizado pela API', 'not-returned-by-api':'Consulta individual pendente'};
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const overviewReasons={'no-forecast':'Previsão não informada','owner-not-informed':'Responsável não informado','invalid-forecast':'Previsão inválida'};
function groupFor(sector) {
  const name = fold(sector);
  if (['intelligence','inteligencia','qualidade','quali','testes (qa)','qa','sucesso do cliente','sucesso','implantacao','treinamento'].includes(name)) return 'Inteligência';
  if (['producao','production'].includes(name)) return 'Produção';
  if (['suporte','support'].includes(name)) return 'Suporte';
  return 'Setor não identificado';
}
function sectorName(value) {
  return ({intelligence:'Inteligência',production:'Produção',support:'Suporte'})[value] || String(value || 'Setor não identificado');
}
function ownerName(ticket) {
  const owner = ticket.owner;
  const name = String(ticket.ownerName || (typeof owner === 'string' ? owner : owner?.businessName || owner?.name) || '').trim();
  const id = ticket.ownerId ?? (typeof owner === 'object' ? owner?.id : null);
  return name || (id!==null && id!==undefined && String(id).trim() ? 'ID '+String(id).trim() : 'Responsável não informado na consulta');
}
export function consolidateRobot({alerts = [], review = [], tickets = []} = {}) {
  const lookup = new Map(tickets.map(ticket => [String(ticket.id), ticket]));
  const rows = new Map();
  const reviewIds = new Set(review.map(row => String(row.ticketId)));
  function add(item, rule, isReview) {
    const id = String(item.ticketId ?? '');
    if (!id || (!isReview && reviewIds.has(id))) return;
    const ticket = {...lookup.get(id), ...item};
    const sector = sectorName(ticket.sector);
    const level = isReview ? 'review' : rule === 'escalation' || rule === 'aged-triage' ? 'management' : rule === 'preventive' ? 'preventive' : 'operational';
    const reason = REASONS[rule] || overviewReasons[rule] || (isReview ? 'Dados precisam de conferência' : 'Regra não identificada');
    const key = JSON.stringify([id, sector, level, rule]);
    rows.set(key, {ticketId:id, subject:String(ticket.subject || 'Assunto não informado'), sector, owner:ownerName(ticket), group:rule === 'aged-triage' && !isReview ? 'Produção' : groupFor(sector), level, reason, rule, review:isReview});
  }
  for (const alert of alerts) {
    // Appointment summaries are not ticket charges.
    if (Array.isArray(alert.tickets)) for (const ticket of alert.tickets) add(ticket, alert.rule, false);
    else if (alert.ticketId) add(alert, alert.rule, false);
  }
  for (const row of review) add(row, row.reason, true);
  return [...rows.values()].sort((a,b) => a.group.localeCompare(b.group,'pt-BR') || a.ticketId.localeCompare(b.ticketId,'pt-BR',{numeric:true}) || a.level.localeCompare(b.level));
}
export function filterRobot(rows, filters = {}) {
  return rows.filter(row => ['sector','owner','level','reason'].every(key => !filters[key] || row[key] === filters[key]));
}
export function summarizeRobot(rows) {
  const charges = rows.filter(row => !row.review);
  return {tickets:new Set(charges.map(row => row.ticketId)).size, occurrences:charges.length, review:new Set(rows.filter(row => row.review).map(row => row.ticketId)).size};
}
export function mountRobotDashboard(root) {
  let rows = [];
  let hasSnapshot = false;
  let source = 'simulation';
  const countLabel = (count, singular, plural) => count+' '+(count===1?singular:plural);
  const doc = root.ownerDocument;
  const element = (tag, text) => {const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node;};
  const heading = element('h2','Robô Fiscalizador · painel de simulação');
  const note = element('p','Filtros locais sobre o último cenário simulado. Nenhum registro no Movidesk ou alteração nos e-mails. Um chamado pode ter mais de um motivo.');
  note.className = 'muted';
  const controls = element('div'); controls.className = 'robot-filters';
  const selects = {};
  for (const [key,title] of [['sector','Setor'],['owner','Responsável'],['level','Nível'],['reason','Motivo da cobrança']]) {
    const label = element('label',title), select = element('select');
    select.id = 'robot-filter-'+key; select.className = 'tm-select';
    label.htmlFor = select.id; label.append(select); controls.append(label); selects[key] = select;
    select.addEventListener('change',render);
  }
  const reset = element('button','Limpar filtros'); reset.type = 'button';
  reset.addEventListener('click',()=>{for (const select of Object.values(selects)) select.value=''; render();});
  const status = element('p'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const cards = element('div'); cards.className = 'tm-grid';
  const chargeTitle = element('h3','Ocorrências para acompanhamento');
  const chargeTable = element('div'); chargeTable.className = 'scroll';
  const reviewTitle = element('h3','Chamados para revisão de dados');
  const reviewTable = element('div'); reviewTable.className = 'scroll';
  for (const [container,label] of [[chargeTable,'Ocorrências de cobrança simuladas'],[reviewTable,'Chamados para revisão de dados']]) {
    container.tabIndex=0; container.setAttribute('role','region'); container.setAttribute('aria-label',label);
  }
  root.replaceChildren(heading,note,controls,reset,status,cards,chargeTitle,chargeTable,reviewTitle,reviewTable);
  function table(container, data) {
    container.replaceChildren();
    if (!data.length) {
      const message = !hasSnapshot ? 'Execute “Simular alertas” para preencher este painel.' : rows.length ? 'Nenhum resultado para os filtros atuais.' : container===reviewTable ? 'Nenhum chamado para revisão neste cenário.' : 'Nenhuma ocorrência de cobrança neste cenário.';
      container.append(element('p',message)); return;
    }
    const table = element('table'), caption = element('caption', container === reviewTable ? 'Revisão de dados · fora da cobrança' : source==='triage-read-only' ? 'Triagem consultada · acompanhamento sem envio' : source==='overview-read-only' ? 'Setores consultados · acompanhamento sem envio' : 'Cobranças simuladas por chamado');
    const head = element('thead'), tr = element('tr'), body = element('tbody');
    for (const text of ['Chamado','Assunto','Grupo gerencial','Setor','Responsável','Nível','Motivo']) {const th = element('th',text); th.scope='col'; tr.append(th);}
    head.append(tr);
    for (const row of data) {
      const tr = element('tr');
      for (const text of ['#'+row.ticketId,row.subject,row.group,row.sector,row.owner,LEVELS[row.level],row.reason]) tr.append(element('td',text));
      body.append(tr);
    }
    table.append(caption,head,body); container.append(table);
  }
  function render() {
    const filters = Object.fromEntries(Object.entries(selects).map(([key,select])=>[key,select.value]));
    const filtered = filterRobot(rows,filters), summary = summarizeRobot(filtered), total = summarizeRobot(rows);
    status.textContent = summary.tickets+' de '+total.tickets+' chamados · '+summary.occurrences+' de '+total.occurrences+' ocorrências · '+summary.review+' de '+total.review+' chamados para revisão. '+(source!=='simulation'?'Consulta somente leitura; nenhum envio.':'Simulação.');
    const missingOwners = new Set(filtered.filter(row=>row.owner==='Responsável não informado na consulta').map(row=>row.ticketId)).size;
    if(missingOwners)status.textContent+=' '+countLabel(missingOwners,'chamado sem responsável informado na consulta.','chamados sem responsável informado na consulta.');
    cards.replaceChildren();
    const groups = [...GROUPS, ...new Set(filtered.map(row=>row.group).filter(group=>!GROUPS.includes(group)))];
    for (const group of groups) {
      const counts = summarizeRobot(filtered.filter(row=>row.group===group));
      const card = element('article'); card.className='tm-card tm-body';
      card.append(element('h3',group),element('p',countLabel(counts.tickets,'chamado','chamados')+' · '+countLabel(counts.occurrences,'ocorrência','ocorrências')),element('p',counts.review+' para revisão')); cards.append(card);
    }
    table(chargeTable,filtered.filter(row=>!row.review)); table(reviewTable,filtered.filter(row=>row.review));
  }
  function setData(data) {
    rows = consolidateRobot(data);
    hasSnapshot = Object.hasOwn(data,'alerts');
    const previousSource=source;
    source = ['triage-read-only','overview-read-only'].includes(data.source)?data.source:'simulation';
    heading.textContent=source==='triage-read-only'?'Robô Fiscalizador · triagem consultada':source==='overview-read-only'?'Robô Fiscalizador · setores consultados':'Robô Fiscalizador · painel de simulação';
    if(source==='triage-read-only') {
      const reference=new Date(data.referenceTime);
      note.textContent='Dados da consulta de triagem · '+(Number.isFinite(+reference)?reference.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Referência não informada')+' (Brasília). Limite: '+data.threshold+' dias úteis. '+(data.waiting||0)+' abaixo do limite · '+(data.outside||0)+' fora da triagem, excluídos das cobranças. Escopo: triagem consultada, sem varredura geral dos setores. Nenhum registro no Movidesk ou alteração nos e-mails.';
    } else if(source==='overview-read-only') {
      const reference=new Date(data.referenceTime);
      note.textContent='Setores da seleção consultada · '+reference.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília). '+data.recordsRead+' chamados lidos · '+data.excluded+' encerrados ou excluídos na origem · '+data.unflagged+' sem ocorrência nas regras avaliadas. Ausência de apontamentos e permanência na fila não avaliadas. Nenhuma gravação ou envio.';
    } else note.textContent='Filtros locais sobre o último cenário simulado. Nenhum registro no Movidesk ou alteração nos e-mails. Um chamado pode ter mais de um motivo.';
    chargeTable.setAttribute('aria-label',source!=='simulation'?'Ocorrências da consulta somente leitura':'Ocorrências de cobrança simuladas');
    for (const [key,select] of Object.entries(selects)) {
      const previous = previousSource===source?select.value:'';
      const all = element('option','Todos'); all.value=''; select.replaceChildren(all);
      const values = [...new Set(rows.map(row=>row[key]))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
      for (const value of values) {const option=element('option',key==='level'?LEVELS[value]:value); option.value=value; select.append(option);}
      select.value = values.includes(previous) ? previous : ''; select.disabled = !rows.length;
    }
    reset.disabled = !rows.length; render();
  }
  setData({});
  return {setData,clearTriage:()=>{if(source!=='simulation')setData({});}};
}
