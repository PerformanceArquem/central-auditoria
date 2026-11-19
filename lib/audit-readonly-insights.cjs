'use strict';

// Motor determinístico de diagnóstico. Não envia mensagens, não usa IA e não grava dados.
// Dados incompletos devem ser explicitamente indicados; nunca estimar apontamentos.
const normalize = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const name = value => String(value?.businessName || value?.name || '').trim().slice(0,120);
const text = (value, max=300) => String(value ?? '').trim().slice(0,max);
const terminal = value => /^(closed|resolved|canceled|cancelled|fechado|resolvido|concluido|cancelado|encerrado|finalizado)/.test(normalize(value));
const {parseMovideskUtc}=require('./audit-movidesk-datetime.cjs');
const utc=parseMovideskUtc;
const iso = n => n === null ? null : new Date(n).toISOString();
const hours = n => Math.round(n / 3600000 * 10) / 10;
const days = n => Math.floor(n / 86400000);

function queueEntry(histories, team, now) {
  if (!Array.isArray(histories)) return null;
  const valid = histories.map((h, i) => ({team: normalize(h?.ownerTeam), at: utc(h?.changedDate), i}))
    .filter(h => h.at !== null && h.at <= now)
    .sort((a,b) => a.at - b.at || a.i - b.i);
  let entry = null, previous = null;
  for (const step of valid) {
    if (step.team === team && previous !== team) entry = step.at;
    previous = step.team;
  }
  return previous === team ? entry : null;
}

function evaluateAuditInsights(records, appointments, options = {}) {
  if (!Array.isArray(records) || !Array.isArray(appointments)) throw new TypeError('Fontes inválidas');
  const now = options.now instanceof Date ? options.now.getTime() :
    options.now === undefined ? Date.now() : Number(options.now);
  if (!Number.isFinite(now)) throw new TypeError('Horário inválido');
  const alerts = [], queueItems = [], quality = [], queueGroups = new Map(), people = new Map();
  const ticketsById = new Map();
  let openCount = 0, unknownQueueEntry = 0, invalidAppointments = 0;
  const warnings = [];
  const nextDay = now + 24 * 3600000;

  for (const row of records) {
    const p = row?.payload || row;
    if (!p || typeof p !== 'object') continue;
    const id = text(row?.ticket_id || p.id, 20);
    if (!/^\d{1,12}$/.test(id) || ticketsById.has(id)) continue;
    const team = text(p.ownerTeam || '', 128);
    const teamNorm = normalize(team);
    ticketsById.set(id, team || 'Não informado');
    if (row.closed_at_source || p.isDeleted === true ||
        terminal(p.baseStatus) || terminal(p.status) ||
        p.resolvedIn || p.closedIn) continue;
    openCount++;
    const owner = name(p.owner);
    const subject = text(p.subject);
    const client = name(p.clients?.[0]?.organization) || name(p.clients?.[0]) || 'Não informado';
    const due = utc(p.slaSolutionDate);
    const last = utc(p.lastActionDate); // Somente última ação real, não lastUpdate genérico.
    const age = last !== null && last <= now ? days(now - last) : null;
    const entry = queueEntry(p.ownerHistories, teamNorm, now);
    if (entry === null) unknownQueueEntry++;

    let group = queueGroups.get(team) || {team:team||'Não informado',opened:0,withVerifiedEntry:0,daysInQueueTotal:0,
      overdue:0,withoutMovementSevenDays:0};
    group.opened++;
    if (entry !== null) {group.withVerifiedEntry++;group.daysInQueueTotal += days(now-entry);}
    if (age !== null && age >= 7) group.withoutMovementSevenDays++;
    if (due !== null && due < now && p.slaSolutionDateIsPaused === false) group.overdue++;
    queueGroups.set(team, group);
    queueItems.push({id,team:team||'Não informado',owner:owner||'Não atribuído',
      queueSince:iso(entry),queueDays:entry===null?null:days(now-entry),
      lastActionAt:iso(last),idleDays:age,subject});

    const shared = {ticketId:id,team:team||'Não informado',owner:owner||'Não atribuído',
      subject,client,slaDue:iso(due),lastActionAt:iso(last)};
    if (due !== null && p.slaSolutionDateIsPaused === false) {
      let kind;
      if (due < now) kind='SLA_VENCIDO';
      else if (due <= nextDay) kind='SLA_PREVENTIVO_24H';
      if (kind) alerts.push({...shared,kind,overdueHours:due<now?hours(now-due):0,
        messagePreview: 'Olá! Identificamos que o chamado #'+id+
          (kind==='SLA_VENCIDO'?' está com o SLA de solução vencido.':' está próximo do vencimento do SLA.')+
          ' Poderia, por gentileza, verificar o andamento e registrar a próxima etapa? '+
          'Caso exista algum impedimento, favor sinalizar no próprio chamado. Obrigado!'});
    }
    if (age !== null && age >= 7) alerts.push({...shared,kind:'SEM_MOVIMENTACAO_7D',
      idleDays:age,messagePreview:'Olá! O chamado #'+id+' está sem movimentação há '+age+
      ' dias. Poderia atualizar o andamento e informar os próximos passos, por gentileza?'});

    const signals = [];
    if (!p.owner?.id) signals.push({code:'SEM_RESPONSAVEL',evidence:'Não foi identificado responsável atual'});
    if (subject.length < 12) signals.push({code:'ASSUNTO_POUCO_DESCRITIVO',evidence:'Assunto com menos de 12 caracteres'});
    if (due === null) signals.push({code:'PRAZO_NAO_IDENTIFICADO',evidence:'SLA de solução indisponível no registro'});
    if (!Array.isArray(p.ownerHistories) || p.ownerHistories.length === 0)
      signals.push({code:'HISTORICO_INDISPONIVEL',evidence:'Histórico de responsáveis ausente no registro'});
    if (age !== null && age >= 7)
      signals.push({code:'SEM_MOVIMENTACAO',evidence:'Última ação registrada há '+age+' dias'});
    if (signals.length) quality.push({...shared,signals,classification:'REVISÃO_HUMANA_OBRIGATÓRIA'});
  }
  queueItems.sort((a,b)=>(b.queueDays??-1)-(a.queueDays??-1)||(b.idleDays??-1)-(a.idleDays??-1));
  alerts.sort((a,b)=>Number(b.kind==='SLA_VENCIDO')-Number(a.kind==='SLA_VENCIDO')||
    (b.overdueHours||b.idleDays||0)-(a.overdueHours||a.idleDays||0));
  quality.sort((a,b)=>b.signals.length-a.signals.length);
  const allQueues=[...queueGroups.values()].map(g=>({
    team:g.team,open:g.opened,verifiedEntry:g.withVerifiedEntry,
    queueDaysAverage:g.withVerifiedEntry?Math.round(g.daysInQueueTotal/g.withVerifiedEntry*10)/10:null,
    withoutMovementSevenDays:g.withoutMovementSevenDays,overdue:g.overdue
  })).sort((a,b)=>b.open-a.open);

  for (const a of appointments) {
    const id = text(a?.ticket_id,20);
    const minutes = Number(a?.duration_minutes);
    const collaborator = text(a?.collaborator_name,160);
    if (!/^\d{1,12}$/.test(id) || !collaborator ||
       a?.duration_minutes === null || a?.duration_minutes === '' ||
       !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
      invalidAppointments++;continue;
    }
    // A data vem do banco filtrada para o período selecionado. Não converter
    // apontamentos inexistentes, previsão ou lastUpdate em horas.
    const key = normalize(collaborator);
    let person = people.get(key);
    if (!person) person={name:collaborator,minutes:0,records:0,ticketIds:new Set(),activities:new Map(),teams:new Set()};
    person.minutes+=minutes;person.records++;person.ticketIds.add(id);
    const activity = text(a?.activity || 'Não informada',128);
    person.activities.set(activity,(person.activities.get(activity)||0)+minutes);
    if (ticketsById.has(id)) person.teams.add(ticketsById.get(id));
    people.set(key,person);
  }
  const productivity=[...people.values()].map(p=>({
    collaborator:p.name,minutes:p.minutes,hours:Math.round(p.minutes/60*100)/100,
    appointmentCount:p.records,ticketCount:p.ticketIds.size,
    teams:[...p.teams].sort(),activities:[...p.activities].map(([activity,minutes])=>({activity,minutes}))
      .sort((a,b)=>b.minutes-a.minutes)
  })).sort((a,b)=>b.minutes-a.minutes||a.collaborator.localeCompare(b.collaborator));
  if (unknownQueueEntry) warnings.push('Tempo em fila só é exibido quando o histórico confirma a entrada na equipe atual.');
  if (invalidAppointments) warnings.push('Apontamentos inválidos ou sem duração real foram desconsiderados.');
  warnings.push('Sinais de qualidade são sugestões para revisão, não não conformidades concluídas nem avaliação por IA.');
  return {
    mode:'dry-run',source:'movidesk-sync-supabase-read-only',generatedAt:new Date(now).toISOString(),
    alerts:{total:alerts.length,preview:alerts.slice(0,30)},
    queues:{teams:allQueues,preview:queueItems.slice(0,30),withoutVerifiedEntry:unknownQueueEntry},
    quality:{totalFlagged:quality.length,preview:quality.slice(0,30),method:'regras_deterministicas_sem_ia'},
    productivity:{collaborators:productivity.slice(0,30),collaboratorsTotal:productivity.length,
      validAppointments:appointments.length-invalidAppointments,invalidAppointments,
      totalMinutes:productivity.reduce((s,p)=>s+p.minutes,0)},
    coverage:{ticketRecords:records.length,uniqueTickets:ticketsById.size,openTickets:openCount,
      appointmentRecords:appointments.length},
    warnings,notificationsSent:0,changesWritten:0
  };
}
module.exports={evaluateAuditInsights,utc,queueEntry};
