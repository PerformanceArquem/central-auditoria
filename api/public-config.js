
export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Método não permitido'
    });
  }

  res.setHeader('Cache-Control', 'no-store');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(503).json({
      error: 'Configure SUPABASE_URL e SUPABASE_ANON_KEY na Vercel'
    });
  }

  return res.status(200).json({
    supabaseUrl,
    supabaseAnonKey
  });
}

