const { publicConfig } = require('./_session.js');


module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Método não permitido'
    });
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    const { url, key } = publicConfig();
    return res.status(200).json({ supabaseUrl: url, supabaseAnonKey: key });
  } catch {
    return res.status(503).json({ error: 'Configuração pública do Supabase indisponível.' });
  }
};
