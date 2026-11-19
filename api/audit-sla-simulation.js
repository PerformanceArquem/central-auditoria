// Read-only SLA simulation for the Implantação team.
// No writes, scheduled jobs, emails, internal notes or database mutations.
import simulation from '../lib/sla-alert-simulation.cjs';

const { simulateSlaAlerts } = simulation;
const TICKETS_URL = 'https://api.movidesk.com/public/v1/tickets';
const PAGE_SIZE = 100;
const MAX_PAGES = 2; // Maximum two Movidesk API calls (10/min is the documented limit).

function respond(res, status, data) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Allow', 'GET, OPTIONS');
  return res.status(status).json(data);
}

async function authenticate(req) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
  const allowed = (process.env.SUPABASE_ALLOWED_EMAILS || '')
    .split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl) || !anonKey || !allowed.length) {
    return { status: 503, error: 'Autenticação de leitura não configurada' };
  }
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(req.headers.authorization || '');
  if (!match || match[1].length > 16000) {
    return { status: 401, error: 'Entre no sistema para simular os alertas' };
  }
  try {
    const response = await fetch(supabaseUrl + '/auth/v1/user', {
      method: 'GET',
      headers: { apikey: anonKey, Authorization: 'Bearer ' + match[1] },
      redirect: 'error',
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return { status: 401, error: 'Sessão inválida ou expirada' };
    const user = await response.json();
    if (!user?.id || !allowed.includes(String(user.email || '').toLowerCase())) {
      return { status: 403, error: 'Usuário sem permissão para consultar o Movidesk' };
    }
    return { status: 200 };
  } catch {
    return { status: 503, error: 'Não foi possível verificar a sessão' };
  }
}

async function fetchPage(token, skip) {
  const params = new URLSearchParams({
    token,
    '$top': String(PAGE_SIZE),
    '$skip': String(skip),
    '$filter': "ownerTeam eq 'Implantação'",
    '$select': 'id,subject,ownerTeam,owner,baseStatus,slaSolutionDate,slaSolutionDateIsPaused,lastActionDate',
    '$expand': 'owner($select=id,businessName)'
  });
  const response = await fetch(TICKETS_URL + '?' + params, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    // Avoid logging the URL: it contains the Movidesk API token.
    const error = new Error('Movidesk indisponível para consulta');
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Resposta inválida do Movidesk');
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Allow', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return respond(res, 405, { error: 'Simulação aceita somente GET' });

  const auth = await authenticate(req);
  if (auth.status !== 200) return respond(res, auth.status, { error: auth.error });
  const token = process.env.MOVIDESK_TOKEN || '';
  if (!token) return respond(res, 503, { error: 'Integração de leitura Movidesk indisponível' });

  const tickets = [];
  let lastPageLength = 0;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await fetchPage(token, page * PAGE_SIZE);
      tickets.push(...batch);
      lastPageLength = batch.length;
      if (batch.length < PAGE_SIZE) break;
    }
    const summary = simulateSlaAlerts(tickets);
    return respond(res, 200, {
      ...summary,
      source: 'movidesk-tickets-read-only',
      coverage: {
        pagesRead: Math.ceil(tickets.length / PAGE_SIZE),
        maxPages: MAX_PAGES,
        potentiallyTruncated: tickets.length === PAGE_SIZE * MAX_PAGES && lastPageLength === PAGE_SIZE,
        excludesTicketsNotUpdatedInLast90Days: true,
        note: 'Prévia limitada à API /tickets e à paginação configurada. Não é um total histórico.'
      },
      // No persisted notifications are checked in dry-run. The duplicate check is
      // only within the current response; actual sending requires a separate audit.
      duplicateCheck: 'within-current-simulation-only',
      notificationsSent: 0
    });
  } catch (error) {
    return respond(res, error.status === 429 ? 429 : 502, {
      error: error.status === 429
        ? 'Limite de requisições do Movidesk atingido. Tente mais tarde.'
        : 'Não foi possível consultar os chamados para a simulação',
      notificationsSent: 0
    });
  }
}
