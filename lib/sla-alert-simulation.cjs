'use strict';

// Pure, offline-safe SLA simulator. This module never accesses network or storage.
// No message is sent and no claim of prior delivery is inferred from a simulation.
const TEAM = 'Implantação';
const ACTIVE = new Set(['New', 'InAttendance']);
const CLOSED = new Set(['Canceled', 'Resolved', 'Closed']);

function text(value, max = 180) {
  return String(value ?? '').trim().slice(0, max);
}

function dateMs(value) {
  if (typeof value !== 'string' || !/(Z|[+-][0-9]{2}:[0-9]{2})$/i.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function messageFor(ticketId, ownerName) {
  const greeting = ownerName ? `Olá, ${ownerName}! Tudo bem?` : 'Olá! Tudo bem?';
  return [
    greeting,
    '',
    `Identificamos que o chamado #${ticketId} está com o prazo de solução (SLA) vencido.`,
    '',
    'Poderia, por gentileza, verificar o andamento e registrar a próxima etapa de tratamento?',
    '',
    'Caso exista algum impedimento, pedimos que seja informado no próprio chamado para acompanhamento.',
    '',
    'Agradecemos pela colaboração!'
  ].join('\n');
}

function simulateSlaAlerts(tickets, options = {}) {
  const now = options.now instanceof Date ? options.now.getTime()
    : options.now === undefined ? Date.now() : Number(options.now);
  if (!Number.isFinite(now)) throw new Error('Data da simulação inválida');
  if (!Array.isArray(tickets)) throw new TypeError('A simulação exige uma lista de chamados');
  const seen = new Set();
  const known = options.previouslyNotifiedKeys instanceof Set ? options.previouslyNotifiedKeys : new Set();
  const included = [], excluded = [];
  const reasons = {};

  for (const ticket of tickets) {
    const id = text(ticket?.id, 20);
    const team = text(ticket?.ownerTeam, 128);
    const status = text(ticket?.baseStatus, 40);
    const due = dateMs(ticket?.slaSolutionDate);
    const ownerId = text(ticket?.owner?.id, 60);
    const ownerName = text(ticket?.owner?.businessName || ticket?.owner?.name, 100);
    const key = id && due !== null ? id + ':' + new Date(due).toISOString() : '';
    let reason = null;

    if (team.toLocaleLowerCase('pt-BR') !== TEAM.toLocaleLowerCase('pt-BR')) {
      reason = 'OUTRO_SETOR';
    } else if (!id) {
      reason = 'SEM_IDENTIFICADOR';
    } else if (CLOSED.has(status)) {
      reason = 'CHAMADO_CONCLUIDO';
    } else if (!ACTIVE.has(status)) {
      reason = status === 'Stopped' ? 'CHAMADO_PARADO' : 'STATUS_NAO_ELEGIVEL';
    } else if (ticket.slaSolutionDateIsPaused !== false) {
      reason = 'SLA_PAUSADO_OU_INDEFINIDO';
    } else if (due === null) {
      reason = 'SEM_PRAZO_UTC_VALIDO';
    } else if (due >= now) {
      reason = 'DENTRO_DO_PRAZO';
    } else if (!ownerId) {
      reason = 'SEM_RESPONSAVEL';
    } else if (seen.has(key) || known.has(key)) {
      reason = 'ALERTA_DUPLICADO';
    }

    if (reason) {
      reasons[reason] = (reasons[reason] || 0) + 1;
      excluded.push({ ticketId: id || null, reason });
      continue;
    }

    seen.add(key);
    included.push({
      ticketId: id,
      subject: text(ticket.subject, 240),
      ownerTeam: TEAM,
      ownerId,
      ownerName: ownerName || null,
      dueAt: new Date(due).toISOString(),
      overdueMinutes: Math.max(1, Math.floor((now - due) / 60000)),
      lastActionDate: dateMs(ticket.lastActionDate) === null
        ? null : new Date(dateMs(ticket.lastActionDate)).toISOString(),
      deduplicationKey: key,
      channel: 'movidesk-internal-note',
      preview: messageFor(id, ownerName),
      sent: false
    });
  }

  return {
    mode: 'dry-run',
    team: TEAM,
    evaluatedAt: new Date(now).toISOString(),
    examined: tickets.length,
    eligibleCount: included.length,
    excludedCount: excluded.length,
    reasons,
    eligible: included,
    excluded,
    notificationsSent: 0
  };
}

module.exports = { simulateSlaAlerts, messageFor, TEAM };
