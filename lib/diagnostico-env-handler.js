
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Método não permitido'
    });
  }

  const names = [
    'MOVIDESK_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_ALLOWED_EMAILS',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];

  const variables = Object.fromEntries(
    names.map(name => [
      name,
      typeof process.env[name] === 'string' &&
      process.env[name].trim().length > 0
        ? 'CONFIGURADA'
        : 'AUSENTE_OU_VAZIA'
    ])
  );

  return res.status(200).json({
    status: 'diagnostico',
    variables
  });
}

