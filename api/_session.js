const allowedEmail = 'performance@arquem.com.br';

function publicConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
    throw new Error('Configure SUPABASE_URL com a URL do projeto Supabase.');
  }
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey) {
    try {
      publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon';
    } catch {}
  }
  if (!publicKey) throw new Error('Configure SUPABASE_PUBLISHABLE_KEY ou SUPABASE_ANON_KEY com a chave pública do projeto.');
  return { url, key };
}

async function verifyAccess(req) {
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.headers.authorization || '');
  if (!match || match[1].length > 16000) return { status: 401, error: 'Entre com sua Conta Google.' };
  let config;
  try { config = publicConfig(); }
  catch (error) { return { status: 503, error: error.message }; }
  try {
    const response = await fetch(config.url + '/auth/v1/user', {
      headers: { apikey: config.key, Authorization: 'Bearer ' + match[1] },
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      return response.status === 401 || response.status === 403
        ? { status: 401, error: 'Sessão expirada. Entre novamente.' }
        : { status: 503, error: 'Não foi possível verificar a sessão no Supabase.' };
    }
    const user = await response.json();
    const googleIdentity = (user.identities || []).some(identity =>
      identity.provider === 'google' &&
      identity.identity_data?.email_verified === true &&
      String(identity.identity_data.email || '').toLowerCase() === allowedEmail
    );
    if (user.is_anonymous || !user.email_confirmed_at ||
        String(user.email || '').toLowerCase() !== allowedEmail || !googleIdentity) {
      return { status: 403, error: 'Esta conta não tem acesso ao Ticket Manager.' };
    }
    return { status: 200, email: allowedEmail };
  } catch {
    return { status: 503, error: 'Não foi possível verificar a sessão no Supabase.' };
  }
}
module.exports = { publicConfig, verifyAccess };

