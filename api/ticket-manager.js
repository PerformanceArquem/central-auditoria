import { timingSafeEqual } from 'node:crypto';

// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   SUPABASE_URL                 ex.: https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    chave service_role (nunca vai para o navegador)
//   SYNC_ACCESS_KEY              a "chave de sincronização" digitada no painel
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ACCESS_KEY = process.env.SYNC_ACCESS_KEY || '';

const STATE_ID = 'main';

function sameKey(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// Chamada ao PostgREST do Supabase, com tempo limite para nunca ficar pendurada
async function sb(path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      const e = new Error('JSON malformatado enviado ao servidor.');
      e.status = 400;
      throw e;
    }
  }
  return body || {};
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!SB_URL || !SB_KEY || !ACCESS_KEY) {
      return res.status(500).json({
        error: 'Servidor sem configuração: defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SYNC_ACCESS_KEY na Vercel.',
      });
    }
    if (!sameKey(req.headers['x-access-key'], ACCESS_KEY)) {
      return res.status(401).json({ error: 'Chave de sincronização inválida.' });
    }

    const action = String(req.query.action || '');

    // ---- leitura ----
    if (req.method === 'GET') {
      if (action === 'loadState') {
        const rows = await sb(`tm_state?select=state,updated_at&id=eq.${STATE_ID}&limit=1`);
        const row = rows?.[0];
        return res.status(200).json({ state: row?.state || {}, updated_at: row?.updated_at || '' });
      }

      if (action === 'loadTickets') {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        const rows = await sb(`tm_tickets?select=data&order=id.asc&limit=${limit}&offset=${offset}`);
        return res.status(200).json({ tickets: (rows || []).map(r => r.data) });
      }

      if (action === 'changes') {
        const t = Date.parse(req.query.since || '');
        const since = new Date(Number.isFinite(t) ? t : 0).toISOString();
        const rows = await sb(
          `tm_tickets?select=data&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc&limit=500`
        );
        return res.status(200).json({ tickets: (rows || []).map(r => r.data) });
      }

      return res.status(400).json({ error: `Ação GET desconhecida: "${action}".` });
    }

    // ---- escrita ----
    if (req.method === 'POST') {
      const body = readBody(req);

      if (action === 'upsertTickets') {
        if (!Array.isArray(body.tickets)) {
          return res.status(400).json({ error: 'Payload de tickets ausente ou inválido.' });
        }
        const now = new Date().toISOString();
        const rows = body.tickets
          .filter(t => t && t.id != null && String(t.id) !== '')
          .map(t => ({ id: String(t.id), data: t, updated_at: now }));
        if (rows.length) {
          await sb('tm_tickets?on_conflict=id', {
            method: 'POST',
            body: rows,
            prefer: 'resolution=merge-duplicates,return=minimal',
          });
        }
        return res.status(200).json({ ok: true, saved: rows.length });
      }

      if (action === 'saveState') {
        if (!body.state || typeof body.state !== 'object') {
          return res.status(400).json({ error: 'Estado ausente ou inválido.' });
        }
        const updated_at = new Date().toISOString();
        await sb('tm_state?on_conflict=id', {
          method: 'POST',
          body: [{ id: STATE_ID, state: body.state, updated_at }],
          prefer: 'resolution=merge-duplicates,return=minimal',
        });
        return res.status(200).json({ ok: true, updated_at });
      }

      return res.status(400).json({ error: `Ação POST desconhecida: "${action}".` });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return res.status(e.status || (timeout ? 504 : 500)).json({
      error: timeout ? 'O Supabase não respondeu a tempo (projeto pausado?).' : String(e.message || e),
    });
  }
}
