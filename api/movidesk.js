
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const MOVIDESK_TOKEN = process.env.MOVIDESK_TOKEN || '';

const MOVIDESK_URL = 'https://api.movidesk.com/public/v1/tickets';

function respond(res, status, data) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(data);
}

async function authenticate(req) {
  const authorization = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);

  if (!match) {
    return { error: 'Sessão não enviada', status: 401 };
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${match[1]}`
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    return { error: 'Sessão inválida ou expirada', status: 401 };
  }

  const user = await response.json();

  if (!user.id || !user.email) {
    return { error: 'Usuário inválido', status: 401 };
  }

  const allowed = (process.env.SUPABASE_ALLOWED_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.length) {
    return {
      error: 'Configure SUPABASE_ALLOWED_EMAILS na Vercel',
      status: 503
    };
  }

  if (!allowed.includes(user.email.toLowerCase())) {
    return {
      error: 'Usuário sem autorização para consultar Movidesk',
      status: 403
    };
  }

  return { user };
}

export default async function handler(req, res) {
  res.setHeader('Allow', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return respond(res, 405, {
      error: 'Método não permitido'
    });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return respond(res, 503, {
      error: 'Supabase não configurado na Vercel'
    });
  }

  if (!MOVIDESK_TOKEN) {
    return respond(res, 503, {
      error: 'MOVIDESK_TOKEN não configurado na Vercel'
    });
  }

  try {
    const auth = await authenticate(req);

    if (auth.error) {
      return respond(res, auth.status, {
        error: auth.error
      });
    }

    const allowedParams = [
      '$select',
      '$expand',
      '$filter',
      '$orderby',
      '$top',
      '$skip'
    ];

    const params = new URLSearchParams();

    for (const key of allowedParams) {
      const value = req.query[key];

      if (value === undefined) continue;

      if (typeof value !== 'string') {
        return respond(res, 400, {
          error: `Parâmetro inválido: ${key}`
        });
      }

      if (value.length > 3000) {
        return respond(res, 400, {
          error: `Parâmetro muito longo: ${key}`
        });
      }

      params.set(key, value);
    }

    const top = Number(params.get('$top') || 100);
    const skip = Number(params.get('$skip') || 0);

    if (
      !Number.isInteger(top) ||
      top < 1 ||
      top > 100 ||
      !Number.isInteger(skip) ||
      skip < 0 ||
      skip > 1000000
    ) {
      return respond(res, 400, {
        error: 'Paginação inválida'
      });
    }

    params.set('$top', String(top));
    params.set('$skip', String(skip));
    params.set('token', MOVIDESK_TOKEN);

    const url = `${MOVIDESK_URL}?${params.toString()}`;

    // Consulta somente leitura: uma nova tentativa apenas para falhas transitórias.
    // Nunca registrar o endereço completo, pois contém o token da API.
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(attempt === 0 ? 12000 : 10000)
        });
        if (![429, 502, 503, 504].includes(response.status) || attempt === 1) break;
      } catch (error) {
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        if (!timeout || attempt === 1) {
          if (timeout) {
            console.error('Movidesk: consulta excedeu tempo de resposta');
            return respond(res, 504, {
              error: 'Tempo de resposta do Movidesk excedido. Tente novamente.',
              source: 'movidesk',
              retryable: true
            });
          }
          throw error;
        }
      }
    }

    if (!response.ok) {
      console.error(
        'Movidesk HTTP:',
        response.status
      );

      if (response.status === 401 || response.status === 403) {
        return respond(res, 502, {
          error: 'Movidesk recusou as credenciais configuradas no servidor',
          source: 'movidesk'
        });
      }

      if (response.status === 429) {
        return respond(res, 429, {
          error: 'Limite de requisições do Movidesk atingido',
          source: 'movidesk',
          retryable: true
        });
      }

      return respond(res, 502, {
        error: `Falha na consulta Movidesk (HTTP ${response.status})`,
        source: 'movidesk'
      });
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return respond(res, 502, {
        error: 'Movidesk retornou JSON inválido ou incompleto',
        source: 'movidesk',
        retryable: true
      });
    }

    if (!Array.isArray(data)) {
      return respond(res, 502, {
        error: 'Resposta inesperada da API Movidesk',
        source: 'movidesk'
      });
    }

    return respond(res, 200, data);

  } catch (error) {
    console.error('Erro API Movidesk:', error.message);

    return respond(res, 502, {
      error: 'Falha de comunicação com a API Movidesk'
    });
  }
}
