/**
 * GET /api/audit-direct-comparisons
 * Read-only aggregates of audit_direct_* tables for authorized admin dashboards.
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * The service role key never reaches the browser.
 */
const MAX_ROWS_PER_TABLE = 100000;
const PAGE_SIZE = 1000;
const brazilDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});
function readPeriod(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(brazilDate.formatToParts(date).map(p => [p.type, p.value]));
  return [Number(parts.year), Number(parts.month)];
}
function fail(res, code, error) { return res.status(code).json({error}); }
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  if (req.method !== 'GET') return fail(res, 405, 'Método não permitido.');
  const urlBase = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!/^https:\/\//.test(urlBase) || !serviceKey) return fail(res, 503, 'Configuração Supabase ausente no servidor.');
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) return fail(res, 401, 'Faça login para consultar os dados.');
  const serviceHeaders = {apikey: serviceKey, Authorization: `Bearer ${serviceKey}`};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);
  try {
    const auth = await fetch(`${urlBase}/auth/v1/user`, {
      headers: {apikey: serviceKey, Authorization: `Bearer ${match[1]}`},
      signal: controller.signal
    });
    if (!auth.ok) return fail(res, 401, 'Sessão inválida ou expirada.');
    const user = await auth.json();
    if (!user?.id) return fail(res, 401, 'Usuário não autenticado.');
    // All-employee aggregates are restricted to approved audit administrators.
    const acl = await fetch(`${urlBase}/rest/v1/audit_users?select=role,is_active&user_id=eq.${encodeURIComponent(user.id)}&limit=1`, {
      headers: serviceHeaders, signal: controller.signal
    });
    if (!acl.ok) return fail(res, 503, 'Não foi possível verificar o perfil administrativo.');
    const users = await acl.json();
    if (!Array.isArray(users) || !users.some(u => String(u.role).toLowerCase() === 'admin' && u.is_active !== false))
      return fail(res, 403, 'A visualização consolidada requer perfil administrador.');
    const fetchRows = async (table, columns) => {
      const found = [];
      let truncated = false;
      for (let offset = 0; offset < MAX_ROWS_PER_TABLE; offset += PAGE_SIZE) {
        const query = new URL(`${urlBase}/rest/v1/${table}`);
        query.searchParams.set('select', columns);
        query.searchParams.set('limit', String(PAGE_SIZE));
        query.searchParams.set('offset', String(offset));
        const r = await fetch(query.toString(), {headers: serviceHeaders, signal: controller.signal});
        if (!r.ok) throw new Error('Falha na consulta à tabela '+table+' (HTTP '+r.status+').');
        const batch = await r.json();
        if (!Array.isArray(batch)) throw new Error('Resposta inválida de '+table);
        found.push(...batch);
        if (batch.length < PAGE_SIZE) return {rows: found, truncated};
      }
      return {rows: found, truncated: true};
    };
    const appointments = await fetchRows('audit_direct_appointments', 'appointment_date,ticket_id,duration_minutes');
    const tickets = await fetchRows('audit_direct_tickets', 'ticket_id,created_at_source');
    const monthly = new Map(), annual = new Map();
    const bucket = (map, key, year, month) => {
      if (!map.has(key)) map.set(key, {year, ...(month === undefined ? {} : {month}), minutes:0, entries:0, opened:0, ticketIds: new Set()});
      return map.get(key);
    };
    for (const item of appointments.rows) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.appointment_date || '');
      if (!m) continue;
      const year = Number(m[1]), month = Number(m[2]);
      const duration = Number(item.duration_minutes) || 0;
      const ticketId = String(item.ticket_id || '').trim();
      for (const b of [bucket(monthly, `${year}-${month}`, year, month), bucket(annual, String(year), year)]) {
        b.minutes += duration; b.entries += 1;
        if (ticketId) b.ticketIds.add(ticketId);
      }
    }
    for (const item of tickets.rows) {
      const period = readPeriod(item.created_at_source);
      if (!period) continue;
      const [year, month] = period;
      bucket(monthly, `${year}-${month}`, year, month).opened += 1;
      bucket(annual, String(year), year).opened += 1;
    }
    const normalize = list => [...list.values()].map(({ticketIds, ...b}) => ({...b, tickets:ticketIds.size}))
      .sort((a, b) => a.year - b.year || (a.month || 0) - (b.month || 0));
    const stateResponse = await fetch(`${urlBase}/rest/v1/audit_direct_sync_state?select=next_offset,processed_tickets,completed,last_error,updated_at&job_name=eq.movidesk_backfill&limit=1`, {
      headers:serviceHeaders, signal:controller.signal
    });
    const states = stateResponse.ok ? await stateResponse.json() : [];
    return res.status(200).json({
      ok: true, monthly:normalize(monthly), annual:normalize(annual),
      sync:Array.isArray(states)?states[0]||null:null,
      totals:{appointments:appointments.rows.length,tickets:tickets.rows.length},
      truncated:appointments.truncated || tickets.truncated,
      generatedAt:new Date().toISOString()
    });
  } catch (error) {
    return fail(res, 502, error?.name === 'AbortError' ? 'Consulta demorou demais. Tente novamente.' : 'Falha ao obter os comparativos: '+error.message);
  } finally {clearTimeout(timeout);}
}

