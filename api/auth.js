const { publicConfig, verifyAccess } = require('./_session.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    try { return res.status(200).json(publicConfig()); }
    catch (error) { return res.status(503).json({ error: error.message }); }
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  const result = await verifyAccess(req);
  return res.status(result.status).json(result.status === 200
    ? { authenticated: true, email: result.email }
    : { authenticated: false, error: result.error });
};

