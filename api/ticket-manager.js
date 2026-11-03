
'use strict';

// ============================================================
// TICKET MANAGER + SUPABASE
// Arquivo: api/ticket-manager.js
// Backend para Vercel
//
// A SUPABASE_SERVICE_ROLE_KEY permanece somente no servidor.
// ============================================================

const crypto = require('crypto');

const TABLE_TICKETS = 'ticket_manager_tickets';
const TABLE_STATE = 'ticket_manager_state';
const WORKSPACE_KEY = process.env.TICKET_WORKSPACE_KEY || 'default';

const MAX_TICKETS_PER_BATCH = 25;
const MAX_PAGE_SIZE = 200;

// ============================================================
// RESPOSTAS
// ============================================================

function send(res, statusCode, payload) {
  return res.status(statusCode).json(payload);
}

// ============================================================
// VALIDAÇÃO SEGURA DA CHAVE
// ============================================================

function safeEqual(received, expected) {
  if (!received || !expected) return false;

  const receivedBuffer = Buffer.from(String(received), 'utf8');
  const expectedBuffer = Buffer.from(String(expected), 'utf8');

  return (
    receivedBuffer.length === expectedBuffer.length &&
    receivedBuffer.length > 0 &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function getHeader(req, name) {
  const value = req.headers && req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

// ============================================================
// LEITURA DO JSON RECEBIDO PELA VERCEL
// ============================================================

function parseRequestBody(req) {
  if (
    req.body === undefined ||
    req.body === null ||
    req.body === ''
  ) {
    return {};
  }

  if (Buffer.isBuffer(req.body)) {
    const text = req.body.toString('utf8');
    return text.trim() ? JSON.parse(text) : {};
  }

  if (typeof req.body === 'string') {
    return req.body.trim() ? JSON.parse(req.body) : {};
  }

  if (
    typeof req.body === 'object' &&
    !Array.isArray(req.body)
  ) {
    return req.body;
  }

  throw new Error(
    'Corpo da requisição inválido. Envie um objeto JSON.'
  );
}

function getQueryValue(req, name, fallback = '') {
  const value = req.query && req.query[name];

  if (Array.isArray(value)) {
    return String(value[0] ?? fallback);
  }

  return (
    value === undefined || value === null
      ? fallback
      : String(value)
  );
}

// ============================================================
// CONFIGURAÇÃO DO SUPABASE
// ============================================================

function supabaseConfig() {
  const url = String(
    process.env.SUPABASE_URL || ''
  ).trim().replace(/\/+$/, '');

  const serviceKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ''
  ).trim();

  if (!url || !serviceKey) {
    throw new Error(
      'Variáveis ausentes na Vercel: configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  if (!/^https:\/\/[a-zA-Z0-9.-]+$/.test(url)) {
    throw new Error(
      'SUPABASE_URL inválida. Informe a URL HTTPS do projeto Supabase.'
    );
  }

  return {
    url,
    serviceKey
  };
}

// ============================================================
// COMUNICAÇÃO COM O SUPABASE
// CORREÇÃO: ENVIO EXPLÍCITO DO JSON E DOS CABEÇALHOS
// ============================================================

function buildSupabaseUrl(baseUrl, path) {
  return `${baseUrl}/rest/v1/${path}`;
}

async function supabaseRequest(path, options = {}) {
  const { url, serviceKey } = supabaseConfig();

  const method = String(
    options.method || 'GET'
  ).toUpperCase();

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: 'application/json',

    ...(method === 'GET'
      ? { 'Accept-Profile': 'public' }
      : { 'Content-Profile': 'public' }),

    ...(options.headers || {})
  };

  const fetchOptions = {
    method,
    headers
  };

  // Tratamento explícito do corpo JSON.
  if (
    options.body !== undefined &&
    options.body !== null
  ) {
    let jsonBody;

    if (typeof options.body === 'string') {
      // Confere se o JSON é válido antes do envio.
      JSON.parse(options.body);
      jsonBody = options.body;
    } else {
      jsonBody = JSON.stringify(options.body);
    }

    if (
      typeof jsonBody !== 'string' ||
      jsonBody.trim() === ''
    ) {
      throw new Error(
        'O corpo JSON da operação no Supabase está vazio.'
      );
    }

    headers['Content-Type'] =
      'application/json; charset=utf-8';

    fetchOptions.body = jsonBody;
  }

  let response;

  try {
    response = await fetch(
      buildSupabaseUrl(url, path),
      fetchOptions
    );
  } catch (networkError) {
    throw new Error(
      `Não foi possível alcançar o Supabase: ${networkError.message}`
    );
  }

  const rawResponse = await response.text();

  let responseData = null;

  if (rawResponse) {
    try {
      responseData = JSON.parse(rawResponse);
    } catch (_parseError) {
      responseData = rawResponse;
    }
  }

  if (!response.ok) {
    const detail =
      typeof responseData === 'string'
        ? responseData
        : JSON.stringify(responseData);

    const bodySize = fetchOptions.body
      ? Buffer.byteLength(fetchOptions.body, 'utf8')
      : 0;

    throw new Error(
      `Supabase HTTP ${response.status} ` +
      `(${method}; ${bodySize} bytes): ` +
      `${String(detail).slice(0, 700)}`
    );
  }

  return responseData;
}

// ============================================================
// UTILITÁRIOS
// ============================================================

function encodeFilterValue(value) {
  return encodeURIComponent(String(value));
}

function getTicketId(ticket) {
  if (
    !ticket ||
    typeof ticket !== 'object' ||
    Array.isArray(ticket)
  ) {
    return '';
  }

  const value =
    ticket.id ??
    ticket.ticket_id ??
    ticket.ticketId;

  return (
    value === undefined || value === null
      ? ''
      : String(value).trim()
  );
}

// ============================================================
// FUNÇÃO PRINCIPAL DA API
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader(
    'Cache-Control',
    'no-store, max-age=0'
  );

  res.setHeader(
    'X-Content-Type-Options',
    'nosniff'
  );

  // ----------------------------------------------------------
  // MÉTODOS PERMITIDOS
  // ----------------------------------------------------------

  if (
    req.method !== 'GET' &&
    req.method !== 'POST'
  ) {
    res.setHeader('Allow', 'GET, POST');

    return send(res, 405, {
      error: 'Método não permitido.'
    });
  }

  // ----------------------------------------------------------
  // AUTENTICAÇÃO DO TICKET MANAGER
  // ----------------------------------------------------------

  const expectedKey =
    process.env.TICKET_SYNC_KEY;

  const providedKey =
    getHeader(req, 'x-access-key');

  if (!safeEqual(providedKey, expectedKey)) {
    return send(res, 401, {
      error:
        'Chave de sincronização inválida ou não configurada na Vercel.'
    });
  }

  try {
    const body =
      req.method === 'POST'
        ? parseRequestBody(req)
        : {};

    const action = getQueryValue(
      req,
      'action',
      body.action || ''
    );

    // ========================================================
    // TESTE DE CONEXÃO
    // GET /api/ticket-manager?action=health
    // ========================================================

    if (
      req.method === 'GET' &&
      action === 'health'
    ) {
      const rows = await supabaseRequest(
        `${TABLE_STATE}?select=workspace_key&limit=1`
      );

      return send(res, 200, {
        ok: true,
        supabase: 'connected',
        stateTableAccessible: Array.isArray(rows),
        timestamp: new Date().toISOString()
      });
    }

    // ========================================================
    // CARREGAR CONFIGURAÇÕES COMPARTILHADAS
    // GET /api/ticket-manager?action=loadState
    // ========================================================

    if (
      req.method === 'GET' &&
      action === 'loadState'
    ) {
      const rows = await supabaseRequest(
        `${TABLE_STATE}?select=payload,updated_at` +
        `&workspace_key=eq.${encodeFilterValue(WORKSPACE_KEY)}` +
        '&limit=1'
      );

      const row = Array.isArray(rows)
        ? rows[0]
        : null;

      return send(res, 200, {
        state:
          row &&
          row.payload &&
          typeof row.payload === 'object'
            ? row.payload
            : {},

        updated_at: row
          ? row.updated_at
          : null
      });
    }

    // ========================================================
    // CARREGAR CHAMADOS COM PAGINAÇÃO
    // GET /api/ticket-manager?action=loadTickets
    // ========================================================

    if (
      req.method === 'GET' &&
      action === 'loadTickets'
    ) {
      const requestedLimit = Number.parseInt(
        getQueryValue(req, 'limit', '150'),
        10
      );

      const requestedOffset = Number.parseInt(
        getQueryValue(req, 'offset', '0'),
        10
      );

      const limit = Number.isFinite(requestedLimit)
        ? Math.min(
            MAX_PAGE_SIZE,
            Math.max(1, requestedLimit)
          )
        : 150;

      const offset = Number.isFinite(requestedOffset)
        ? Math.max(0, requestedOffset)
        : 0;

      const rows = await supabaseRequest(
        `${TABLE_TICKETS}?select=ticket_id,payload,updated_at` +
        `&order=ticket_id.asc` +
        `&limit=${limit}` +
        `&offset=${offset}`
      );

      const tickets = Array.isArray(rows)
        ? rows
            .map(row => row && row.payload)
            .filter(Boolean)
        : [];

      return send(res, 200, {
        tickets,
        count: tickets.length,
        limit,
        offset
      });
    }

    // ========================================================
    // BUSCAR ALTERAÇÕES DESDE UMA DATA
    // GET /api/ticket-manager?action=changes
    // ========================================================

    if (
      req.method === 'GET' &&
      action === 'changes'
    ) {
      const since = getQueryValue(
        req,
        'since',
        '1970-01-01T00:00:00.000Z'
      );

      if (!Number.isFinite(Date.parse(since))) {
        return send(res, 400, {
          error:
            'Parâmetro since inválido. Use uma data ISO 8601.'
        });
      }

      const rows = await supabaseRequest(
        `${TABLE_TICKETS}?select=ticket_id,payload,updated_at` +
        `&updated_at=gt.${encodeFilterValue(since)}` +
        '&order=updated_at.asc&limit=500'
      );

      const tickets = Array.isArray(rows)
        ? rows
            .map(row => row && row.payload)
            .filter(Boolean)
        : [];

      return send(res, 200, {
        tickets,
        count: tickets.length
      });
    }

    // ========================================================
    // SALVAR CONFIGURAÇÕES E ESTADO
    // POST /api/ticket-manager?action=saveState
    // ========================================================

    if (
      req.method === 'POST' &&
      action === 'saveState'
    ) {
      const state = body.state;

      if (
        !state ||
        typeof state !== 'object' ||
        Array.isArray(state)
      ) {
        return send(res, 400, {
          error:
            'O campo state deve conter um objeto JSON.'
        });
      }

      const timestamp =
        new Date().toISOString();

      const rowsToSave = [
        {
          workspace_key: WORKSPACE_KEY,
          payload: state,
          updated_at: timestamp
        }
      ];

      await supabaseRequest(
        `${TABLE_STATE}?on_conflict=workspace_key`,
        {
          method: 'POST',

          headers: {
            Prefer:
              'resolution=merge-duplicates,return=minimal'
          },

          // O objeto é convertido e validado como JSON
          // dentro de supabaseRequest().
          body: rowsToSave
        }
      );

      return send(res, 200, {
        ok: true,
        updated_at: timestamp
      });
    }

    // ========================================================
    // INSERIR OU ATUALIZAR CHAMADOS EM LOTES
    // POST /api/ticket-manager?action=upsertTickets
    // ========================================================

    if (
      req.method === 'POST' &&
      action === 'upsertTickets'
    ) {
      const tickets = body.tickets;

      if (
        !Array.isArray(tickets) ||
        tickets.length < 1 ||
        tickets.length > MAX_TICKETS_PER_BATCH
      ) {
        return send(res, 400, {
          error:
            `Envie entre 1 e ${MAX_TICKETS_PER_BATCH} chamados por lote.`
        });
      }

      const timestamp =
        new Date().toISOString();

      const rowsToSave = tickets.map(
        (ticket, index) => {
          const ticketId = getTicketId(ticket);

          if (!ticketId) {
            throw new Error(
              `O chamado da posição ${index + 1} não possui id ou ticket_id.`
            );
          }

          return {
            ticket_id: ticketId,
            payload: ticket,
            updated_at: timestamp
          };
        }
      );

      await supabaseRequest(
        `${TABLE_TICKETS}?on_conflict=ticket_id`,
        {
          method: 'POST',

          headers: {
            Prefer:
              'resolution=merge-duplicates,return=minimal'
          },

          body: rowsToSave
        }
      );

      return send(res, 200, {
        ok: true,
        count: rowsToSave.length,
        updated_at: timestamp
      });
    }

    // ========================================================
    // AÇÃO NÃO RECONHECIDA
    // ========================================================

    return send(res, 400, {
      error: 'Ação não reconhecida.',

      availableActions: [
        'health',
        'loadState',
        'loadTickets',
        'changes',
        'saveState',
        'upsertTickets'
      ]
    });

  } catch (error) {
    console.error(
      '[ticket-manager-supabase]',
      error && error.stack
        ? error.stack
        : error
    );

    return send(res, 500, {
      error:
        error && error.message
          ? error.message
          : 'Erro interno ao sincronizar com o Supabase.'
    });
  }
};

// ============================================================
// CONFIGURAÇÃO DO PARSER DA VERCEL
// ============================================================

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb'
    }
  }
};
