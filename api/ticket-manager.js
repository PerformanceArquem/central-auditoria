
// Backend Vercel para sincronizar o Ticket Manager com o Supabase.
// A chave service_role fica exclusivamente nas variáveis de ambiente do servidor.
const crypto = require('crypto');

const TABLE_TICKETS = 'ticket_manager_tickets';
const TABLE_STATE = 'ticket_manager_state';
const WORKSPACE_KEY = 'default';

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function send(res, status, body) {
  res.status(status).json(body);
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente da Vercel.');
  }

  return { url, key };
}

async function sbRequest(path, options = {}) {
  const { url, key } = supabaseConfig();

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!response.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Supabase HTTP ${response.status}: ${String(detail).slice(0, 500)}`);
  }

  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'Método não permitido.' });
  }

  const expected = process.env.TICKET_SYNC_KEY;
  const provided = req.headers['x-access-key'];

  if (!expected || !safeEqual(provided, expected)) {
    return send(res, 401, {
      error: 'Chave de sincronização inválida ou não configurada.'
    });
  }

  try {
    const action = String(req.query.action || req.body?.action || '');

    if (req.method === 'GET' && action === 'loadState') {
      const rows = await sbRequest(
        `${TABLE_STATE}?select=payload,updated_at&workspace_key=eq.${encodeURIComponent(WORKSPACE_KEY)}&limit=1`
      );

      const row = Array.isArray(rows) ? rows[0] : null;

      return send(res, 200, {
        state: row?.payload || {},
        updated_at: row?.updated_at || null
      });
    }

    if (req.method === 'GET' && action === 'loadTickets') {
      const limit = Math.min(
        200,
        Math.max(1, Number.parseInt(req.query.limit, 10) || 150)
      );

      const offset = Math.max(
        0,
        Number.parseInt(req.query.offset, 10) || 0
      );

      const rows = await sbRequest(
        `${TABLE_TICKETS}?select=ticket_id,payload,updated_at&order=ticket_id.asc&limit=${limit}&offset=${offset}`
      );

      return send(res, 200, {
        tickets: (rows || []).map(row => row.payload).filter(Boolean),
        count: (rows || []).length
      });
    }

    if (req.method === 'GET' && action === 'changes') {
      const since = String(
        req.query.since || '1970-01-01T00:00:00.000Z'
      );

      if (!Number.isFinite(Date.parse(since))) {
        return send(res, 400, { error: 'Parâmetro since inválido.' });
      }

      const filter = encodeURIComponent(`gt.${since}`);

      const rows = await sbRequest(
        `${TABLE_TICKETS}?select=payload,updated_at&updated_at=${filter}&order=updated_at.asc&limit=500`
      );

      return send(res, 200, {
        tickets: (rows || []).map(row => row.payload).filter(Boolean),
        count: (rows || []).length
      });
    }

    if (req.method === 'POST' && action === 'saveState') {
      const state = req.body?.state;

      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        return send(res, 400, {
          error: 'O campo state deve ser um objeto.'
        });
      }

      const row = [{
        workspace_key: WORKSPACE_KEY,
        payload: state,
        updated_at: new Date().toISOString()
      }];

      await sbRequest(`${TABLE_STATE}?on_conflict=workspace_key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(row)
      });

      return send(res, 200, {
        ok: true,
        updated_at: row[0].updated_at
      });
    }

    if (req.method === 'POST' && action === 'upsertTickets') {
      const tickets = req.body?.tickets;

      if (!Array.isArray(tickets) || tickets.length < 1 || tickets.length > 25) {
        return send(res, 400, {
          error: 'Envie entre 1 e 25 chamados por lote.'
        });
      }

      const now = new Date().toISOString();

      const rows = tickets.map(ticket => {
        if (
          !ticket ||
          ticket.id === undefined ||
          ticket.id === null ||
          String(ticket.id).trim() === ''
        ) {
          throw new Error('Foi recebido um chamado sem identificador.');
        }

        return {
          ticket_id: String(ticket.id),
          payload: ticket,
          updated_at: now
        };
      });

      await sbRequest(`${TABLE_TICKETS}?on_conflict=ticket_id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(rows)
      });

      return send(res, 200, {
        ok: true,
        count: rows.length,
        updated_at: now
      });
    }

    return send(res, 400, {
      error: 'Ação não reconhecida.'
    });

  } catch (error) {
    console.error('[ticket-manager]', error.message);

    return send(res, 500, {
      error: error.message || 'Erro interno ao sincronizar com o Supabase.'
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb'
    }
  }
};

