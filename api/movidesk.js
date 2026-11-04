const { verifyAccess } = require('./_session.js');

const expands = new Set([
  'owner,clients($expand=organization),actions($select=id,createdDate,createdBy,description,timeAppointments;$expand=createdBy($select=id,businessName),timeAppointments)',
  'owner,clients($expand=organization),actions($expand=createdBy,timeAppointments)',
  'owner,clients,actions($expand=createdBy,timeAppointments)',
  'owner,clients,actions'
]);
const select = 'id,createdDate,lastUpdate,subject,category,status,serviceFirstLevel,ownerTeam,owner,clients,actions,slaSolutionDate';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  const access = await verifyAccess(req);
  if (access.status !== 200) return res.status(access.status).json({ error: access.error });

  const { $select, $expand, $filter, $orderby, $top, $skip } = req.query || {};
  if (($select !== select && $select !== select + ',customFieldValues') ||
      !expands.has($expand) || typeof $filter !== 'string' ||
      !/^lastUpdate ge \d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.00z$/.test($filter) ||
      $orderby !== 'lastUpdate desc' || $top !== '100' ||
      typeof $skip !== 'string' || !/^\d{1,5}$/.test($skip) || Number($skip) > 20000) {
    return res.status(400).json({ error: 'Parâmetros de consulta inválidos.' });
  }
  const token = process.env.MOVIDESK_TOKEN;
  if (!token) return res.status(503).json({ error: 'Integração Movidesk indisponível.' });

  const url = new URL('https://api.movidesk.com/public/v1/tickets');
  url.search = new URLSearchParams({ token, $select, $expand, $filter, $orderby, $top, $skip });
  try {
    const upstream = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(25000) });
    if (!upstream.ok) {
      if (upstream.status === 429) return res.status(429).json({ error: 'Limite da API Movidesk atingido.' });
      if (upstream.status === 400) return res.status(400).json({ error: 'O Movidesk recusou a consulta.' });
      if ([401, 403].includes(upstream.status)) {
        return res.status(502).json({ error: 'O Movidesk recusou a credencial configurada na Vercel.' });
      }
      return res.status(502).json({ error: 'O Movidesk retornou um erro.' });
    }
    const tickets = await upstream.json();
    if (!Array.isArray(tickets)) return res.status(502).json({ error: 'Resposta inesperada do Movidesk.' });
    return res.status(200).json(tickets);
  } catch {
    return res.status(502).json({ error: 'Falha na conexão com o Movidesk.' });
  }
};
