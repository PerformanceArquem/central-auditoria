const { configured, passwordMatches, hasSession, sessionCookie } = require('./_session.js');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const authenticated = hasSession(req);
    return res.status(authenticated ? 200 : 401).json({ authenticated });
  }
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  if (!req.headers.host || req.headers.origin !== 'https://' + req.headers.host) {
    return res.status(403).json({ error: 'Origem não permitida.' });
  }
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', sessionCookie(false));
    return res.status(200).json({ authenticated: false });
  }
  if (!configured()) return res.status(503).json({ error: 'Autenticação indisponível.' });
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    return res.status(415).json({ error: 'Formato inválido.' });
  }
  if (!passwordMatches(req.body?.password)) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }
  res.setHeader('Set-Cookie', sessionCookie(true));
  return res.status(200).json({ authenticated: true });
};

