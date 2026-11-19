const sectors = ['Treinamento', 'Qualidade', 'Implantação', 'Sucesso do Cliente', 'Testes (QA)'];
const trainingActivity = 'TRE - Aplicação do treinamento';
const activityCriteria = new Map([
  ['Treinamento', trainingActivity],
  ['Qualidade', 'Atividade registrada no setor']
]);
const dateFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});

type Ticket = {ticket_id?: unknown; owner_histories?: unknown};

type Appointment = {ticket_id?: unknown; sector?: unknown; activity?: unknown; appointment_date?: unknown};

export function validEntriesPeriod(from: string, to: string, today: string): boolean {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return valid(from) && valid(to) && from <= to && to <= today;
}

export function sectorEntries(tickets: Ticket[], appointments: Appointment[], from: string, to: string) {
  const bySector = new Map(sectors.map(name => [name, new Set<string>()]));
  const distinct = new Set<string>();
  let incomplete = 0;

  for (const ticket of tickets) {
    const id = String(ticket.ticket_id ?? '').trim();
    if (!id || !Array.isArray(ticket.owner_histories) || !ticket.owner_histories.length) {
      incomplete++;
      continue;
    }
    const history = ticket.owner_histories.map(event => {
      const date = String(event?.changedDate ?? '');
      const team = String(event?.ownerTeam ?? '').trim();
      const at = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(date)
        ? Date.parse(/[zZ]$|[+-]\d{2}:\d{2}$/.test(date) ? date : date + 'Z')
        : NaN;
      return {team, at};
    });
    if (history.some(event => !Number.isFinite(event.at))) {
      incomplete++;
      continue;
    }
    history.sort((a, b) => a.at - b.at);
    let previous = '';
    for (const {team, at} of history) {
      const changed = team !== previous;
      previous = team;
      const entries = bySector.get(team);
      if (!changed || !entries || activityCriteria.has(team)) continue;
      const date = dateFormat.format(at);
      if (date < from || date > to) continue;
      entries.add(id);
      distinct.add(id);
    }
  }

  for (const appointment of appointments) {
    const team = String(appointment.sector ?? '').trim();
    const activity = String(appointment.activity ?? '').trim();
    const date = String(appointment.appointment_date ?? '');
    const id = String(appointment.ticket_id ?? '').trim();
    const entries = bySector.get(team);
    if (!entries || !activityCriteria.has(team) || !activity || !id || date < from || date > to) continue;
    if (team === 'Treinamento' && activity !== trainingActivity) continue;
    entries.add(id);
    distinct.add(id);
  }

  const rows = [...bySector].map(([sector, ids]) => ({
    sector, entries: ids.size, basis: activityCriteria.get(sector) ?? 'Entrada no histórico de equipes'
  }));
  return {rows, total: rows.reduce((sum, row) => sum + row.entries, 0), distinct: distinct.size, incomplete};
}
