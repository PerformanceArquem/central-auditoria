
const MAX_BODY_TICKETS = 5;
const stateId = 'shared';

const urlBase = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

function reply(res, status, data) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(data);
}

function getToken(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

async function authenticate(req) {
  const token = getToken(req);
  if (!token) return null;

  const r = await fetch(`${urlBase}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!r.ok) return null;

  const user = await r.json();
  return user && user.id ? user : null;
}

async function db(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: adminKey,
    Authorization: `Bearer ${adminKey}`,
    Accept: 'application/json'
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (prefer) headers.Prefer = prefer;

  const serialized = body === undefined ? undefined : JSON.stringify(body);
  if (body !== undefined && (!serialized || !serialized.trim())) {
    throw Object.assign(new Error('JSON de sincronização não serializável'), { status: 400 });
  }
  const bodyBytes = serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8');
  if (bodyBytes > 250000) {
    throw Object.assign(new Error('Lote de sincronização excede o limite do servidor; tente lotes menores'), { status: 413 });
  }
  const r = await fetch(`${urlBase}/rest/v1/${path}`, {
    method,
    headers,
    body: serialized,
    signal: AbortSignal.timeout(25000)
  });

  const raw = await r.text();
  let result;

  try {
    result = raw ? JSON.parse(raw) : null;
  } catch {
    result = { message: raw.slice(0, 250) };
  }

  if (!r.ok) {
    // Diagnóstico sem payload, identidade, token ou conteúdo de tickets.
    console.error('ticket-manager upstream', {
      operation: path.split('?')[0],
      method,
      upstreamStatus: r.status,
      requestBytes: bodyBytes,
      contentType: r.headers.get('content-type')?.split(';')[0] || 'unknown',
      responseIsJson: raw ? (() => { try { JSON.parse(raw); return true; } catch { return false; } })() : false
    });
    throw Object.assign(
      new Error(result?.message || result?.error || `Supabase HTTP ${r.status}`),
      { status: 502 }
    );
  }

  return result;
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    if (!body.trim()) {
      throw Object.assign(new Error('Corpo JSON vazio'), { status: 400 });
    }
    try {
      body = JSON.parse(body);
    } catch {
      throw Object.assign(new Error('Corpo JSON inválido'), { status: 400 });
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Envie um objeto JSON válido'), { status: 400 });
  }
  return body;
}

export default async function handler(req, res) {
  res.setHeader('Allow', 'GET, POST');

  if (!['GET', 'POST'].includes(req.method)) {
    return reply(res, 405, {
      error: 'Método não permitido'
    });
  }

  if (!urlBase || !adminKey || !anonKey) {
    return reply(res, 503, {
      error: 'Variáveis Supabase não configuradas na Vercel'
    });
  }

  try {
    const user = await authenticate(req);

    if (!user) {
      return reply(res, 401, {
        error: 'Sessão inválida. Faça login novamente.'
      });
    }

    const allowed = (process.env.SUPABASE_ALLOWED_EMAILS || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    if (!allowed.length) {
      return reply(res, 503, {
        error: 'Configure SUPABASE_ALLOWED_EMAILS na Vercel'
      });
    }

    if (!allowed.includes((user.email || '').toLowerCase())) {
      return reply(res, 403, {
        error: 'Usuário sem acesso ao Ticket Manager'
      });
    }

    const action = String(req.query.action || '');

    // CARREGAR TODOS OS CHAMADOS
    if (req.method === 'GET' && action === 'loadTickets') {
      const offset = Math.max(
        0,
        Math.min(1000000, Number.parseInt(req.query.offset, 10) || 0)
      );

      const limit = Math.max(
        1,
        Math.min(150, Number.parseInt(req.query.limit, 10) || 150)
      );

      const data = await db(
        `tm_tickets?select=data&order=id.asc&offset=${offset}&limit=${limit}`
      );

      return reply(res, 200, {
        tickets: data.map(x => x.data)
      });
    }

    // CONSULTAR ALTERAÇÕES
    if (req.method === 'GET' && action === 'changes') {
      const since = String(
        req.query.since || '1970-01-01T00:00:00.000Z'
      );

      if (!Number.isFinite(Date.parse(since))) {
        return reply(res, 400, {
          error: 'Data since inválida'
        });
      }

      const data = await db(
        `tm_tickets?select=data&updated_at=gt.${encodeURIComponent(
          new Date(since).toISOString()
        )}&order=updated_at.asc&limit=1000`
      );

      return reply(res, 200, {
        tickets: data.map(x => x.data)
      });
    }

    // CARREGAR CONFIGURAÇÕES
    if (req.method === 'GET' && action === 'loadState') {
      const data = await db(
        `tm_state?select=state,updated_at&id=eq.${stateId}&limit=1`
      );

      return reply(res, 200, {
        state: data[0]?.state || {},
        updated_at: data[0]?.updated_at || null
      });
    }

    // SALVAR CHAMADOS
    if (req.method === 'POST' && action === 'upsertTickets') {
      const body = parseBody(req);

      if (
        !Array.isArray(body.tickets) ||
        !body.tickets.length ||
        body.tickets.length > MAX_BODY_TICKETS
      ) {
        return reply(res, 400, {
          error: `Envie de 1 a ${MAX_BODY_TICKETS} chamados por lote`
        });
      }

      const tickets = body.tickets.map(t => {
        const id = String(t?.id ?? '').trim();

        if (
          !id ||
          id.length > 100 ||
          !t ||
          typeof t !== 'object' ||
          Array.isArray(t)
        ) {
          throw Object.assign(
            new Error('Ticket inválido'),
            { status: 400 }
          );
        }

        return {
          id,
          data: t,
          updated_at: new Date().toISOString()
        };
      });

      await db('tm_tickets?on_conflict=id', {
        method: 'POST',
        body: tickets,
        prefer: 'resolution=merge-duplicates,return=minimal'
      });

      return reply(res, 200, {
        ok: true,
        count: tickets.length
      });
    }

    // SALVAR CONFIGURAÇÕES
    if (req.method === 'POST' && action === 'saveState') {
      const { state } = parseBody(req);

      if (
        !state ||
        typeof state !== 'object' ||
        Array.isArray(state)
      ) {
        return reply(res, 400, {
          error: 'Configurações inválidas'
        });
      }

      const safe = {};

      for (const [k, v] of Object.entries(state)) {
        if (
          /^md_[a-z0-9_]+$/i.test(k) &&
          !/token|key|secret|password|senha/i.test(k) &&
          typeof v === 'string'
        ) {
          safe[k] = v;
        }
      }

      await db('tm_state?on_conflict=id', {
        method: 'POST',
        body: [{
          id: stateId,
          state: safe,
          updated_at: new Date().toISOString()
        }],
        prefer: 'resolution=merge-duplicates,return=minimal'
      });

      return reply(res, 200, { ok: true });
    }

    return reply(res, 400, {
      error: 'Ação não reconhecida ou método incorreto'
    });

  } catch (e) {
    // Nunca registrar bearer token nem corpo das requisicoes.
    console.error('ticket-manager:', e.message);

    return reply(
      res,
      [400, 413].includes(e.status) ? e.status : 502,
      {
        error: [400, 413].includes(e.status)
          ? e.message
          : 'Falha ao acessar os dados compartilhados'
      }
    );
  }
}
