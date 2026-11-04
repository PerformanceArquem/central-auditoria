const { createHmac, createHash, timingSafeEqual, randomBytes } = require('node:crypto');

const ttl = 12 * 60 * 60;
const name = '__Host-tm_session';
const digest = value => createHash('sha256').update(value).digest();
const configured = () => /^[a-f0-9]{64}$/i.test(process.env.TM_SESSION_SECRET || '') &&
  Buffer.byteLength(process.env.TM_ACCESS_PASSWORD || '') >= 16;
const passwordMatches = password => typeof password === 'string' &&
  Buffer.byteLength(password) <= 1024 &&
  timingSafeEqual(digest(password), digest(process.env.TM_ACCESS_PASSWORD));
const sign = value => createHmac('sha256', Buffer.from(process.env.TM_SESSION_SECRET, 'hex'))
  .update(digest(process.env.TM_ACCESS_PASSWORD)).update(value).digest('base64url');

function hasSession(req) {
  if (!configured()) return false;
  const cookie = (req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(name + '='));
  const match = cookie?.slice(name.length + 1).match(/^(\d{1,12})\.([\w-]{24})\.([\w-]{43})$/);
  if (!match || Number(match[1]) <= Math.floor(Date.now() / 1000)) return false;
  return timingSafeEqual(Buffer.from(match[3]), Buffer.from(sign(match[1] + '.' + match[2])));
}

function sessionCookie(active) {
  const value = active ? Math.floor(Date.now() / 1000) + ttl + '.' + randomBytes(18).toString('base64url') : '';
  return name + '=' + (active ? value + '.' + sign(value) : '') +
    '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + (active ? ttl : 0);
}

module.exports = { configured, passwordMatches, hasSession, sessionCookie };
