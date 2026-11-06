// Central de Auditoria — Supabase direto -> Google Apps Script/Gmail
// Compatível com as ações existentes: status e test (admin JWT).
// NUNCA colocar credenciais no HTML. Nenhum disparo automático sem flags explícitas.
type R = Record<string, unknown>;
const E = (k: string) => Deno.env.get(k)?.trim() || '';
const TZ = 'America/Sao_Paulo';
const RELEASE_ID = 'email-manual-pilot-20261106-v6';
// CORS: permitir somente a origem oficial (e origens extras explicitamente configuradas).
// CORS nao substitui validacao JWT/admin nem a autenticacao do Cron.
const FRONTEND_ORIGINS = new Set([
  'https://central-auditoria-iota.vercel.app',
  ...E('REPORT_ALLOWED_ORIGINS').split(',').map(x => x.trim()).filter(Boolean)
]);
function corsHeaders(req: Request): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-report-secret',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  });
  const origin = req.headers.get('origin') || '';
  if (FRONTEND_ORIGINS.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}
function withCors(req: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  corsHeaders(req).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
const err = (x: unknown) => x instanceof Error ? x.message : String(x);
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const safe = (v: unknown) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 140);
const dateBR = (d = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(d);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const shift = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10);
};
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const duration = (minutes: number) => {
  const n = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00`;
};
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validUrl = () => {
  const u = new URL(E('GMAIL_WEBAPP_URL'));
  if (u.protocol !== 'https:' || u.hostname !== 'script.google.com' || !u.pathname.includes('/macros/') || !u.pathname.endsWith('/exec')) throw new Error('GMAIL_WEBAPP_URL invalida');
  return u.toString();
};
async function db(path: string, init: RequestInit = {}): Promise<any> {
  const url = E('SUPABASE_URL').replace(/\/$/, '');
  const key = E('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Secrets Supabase incompletos');
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init, headers: { apikey: key, Authorization: `Bearer ${key}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    signal: AbortSignal.timeout(20000)
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Supabase ${path.split('?')[0]} HTTP ${res.status}: ${body.slice(0, 140)}`);
  return body ? JSON.parse(body) : null;
}
async function list(table: string, suffix = '', limit = 25000): Promise<R[]> {
  const all: R[] = [];
  for (let off = 0; off < limit; off += 500) {
    const join = suffix ? '&' : '?';
    const result = await db(`${table}${suffix}${join}limit=500&offset=${off}`);
    if (!Array.isArray(result)) throw new Error(`Resposta inesperada de ${table}`);
    all.push(...result);
    if (result.length < 500) return all;
  }
  throw new Error(`Limite de registros em ${table}; envio bloqueado ate implementar paginacao maior`);
}
async function state() {
  const rows = await db('audit_direct_sync_state?job_name=eq.movidesk_backfill&select=completed,next_offset,updated_at,last_error&limit=1');
  if (!rows?.length) throw new Error('Checkpoint da importacao ausente');
  return rows[0] as R;
}
// Verificar cobertura completa + rotina incremental separadamente antes de disparos reais.
async function requireProductionReady() {
  const s = await state();
  if (s.completed !== true) throw new Error('Historico Movidesk incompleto: envio real bloqueado');
  if (E('REPORT_INCREMENTAL_READY') !== 'true') throw new Error('Rotina incremental ainda nao validada: envio bloqueado');
  if (s.last_error) throw new Error('Erro registrado no checkpoint: envio bloqueado');
  return s;
}
async function source(from: string, to: string) {
  // Datas de atividade, não datas de abertura dos tickets.
  const appts = await list('audit_direct_appointments',
    `?select=appointment_key,ticket_id,collaborator_name,sector,activity,appointment_date,duration_minutes&appointment_date=gte.${from}&appointment_date=lte.${to}&order=appointment_date.asc`);
  if (appts.some(a => !Number.isFinite(Number(a.duration_minutes)) || Number(a.duration_minutes) < 0))
    throw new Error('Duracao negativa ou invalida encontrada: validar base antes do envio');
  return appts;
}
async function recipientList() {
  return (await list('audit_email_recipients', '?select=*')).filter(r => r.active === true);
}
async function holidays() {
  return new Set((await list('audit_email_holidays', '?select=holiday_date,affects_delivery'))
    .filter(x => x.affects_delivery !== false).map(x => String(x.holiday_date)));
}
function workdays(from: string, to: string, ignored: Set<string>) {
  const out: string[] = [];
  for (let d = from, count = 0; d <= to && count < 370; d = shift(d, 1), count++)
    if (![0, 6].includes(weekday(d)) && !ignored.has(d)) out.push(d);
  return out;
}
function buildReport(rec: R, appts: R[], from: string, to: string, kind: string, hol: Set<string>, authorizedSingleManual = false) {
  const scope = String(rec.scope || 'sector');
  if (!['sector', 'management'].includes(scope)) throw new Error('Escopo de destinatario nao reconhecido');
  const person = norm(rec.collaborator_name);
  const sector = norm(rec.sector);
  if (scope === 'sector' && !sector) throw new Error('Destinatario setorial sem setor');
  if (scope === 'sector' && !person && !authorizedSingleManual && E('REPORT_ALLOW_SECTOR_EMAIL') !== 'true')
    throw new Error('Envio setorial coletivo exige REPORT_ALLOW_SECTOR_EMAIL=true e autorizacao da supervisao');
  // O Movidesk utiliza "Sucesso do Cliente", enquanto cadastros antigos usam "Sucesso".
  // Manter o alias restrito, sem misturar setores distintos.
  const sameSector = (sourceSector: unknown) =>
    norm(sourceSector) === sector ||
    (sector === 'sucesso' && norm(sourceSector) === 'sucesso do cliente');
  const selected = appts.filter(a =>
    (scope === 'management' || sameSector(a.sector)) &&
    (!person || norm(a.collaborator_name) === person));
  const minutes = selected.reduce((s, a) => s + Number(a.duration_minutes || 0), 0);
  const days = workdays(from, to, hol);
  const targetPerDay = Number(rec.daily_target_minutes ?? 480);
  const minimumPercent = Number(rec.minimum_percent ?? 80);
  if (!Number.isFinite(targetPerDay) || targetPerDay <= 0 || targetPerDay > 1440 ||
      !Number.isFinite(minimumPercent) || minimumPercent < 0 || minimumPercent > 100)
    throw new Error('Jornada ou percentual minimo invalidos no cadastro');
  const target = Math.round(days.length * targetPerDay);
  const minimum = Math.round(target * minimumPercent / 100);
  const byPerson = new Map<string, number>();
  const bySector = new Map<string, number>();
  for (const a of selected) {
    const n = String(a.collaborator_name || 'Nao informado');
    byPerson.set(n, (byPerson.get(n) || 0) + Number(a.duration_minutes || 0));
    const s = String(a.sector || 'Nao informado');
    bySector.set(s, (bySector.get(s) || 0) + Number(a.duration_minutes || 0));
  }
  const worked = new Set(selected.map(a => String(a.ticket_id))).size;
  const title = `${kind === 'weekly' ? 'Relatorio semanal' : 'Relatorio diario'} - ${scope === 'management' ? 'Gestao' : safe(rec.sector)}${person ? ' / ' + safe(rec.collaborator_name) : ''}`;
  const details = person ? selected.slice(0, 100).map(a =>
    `- ${String(a.appointment_date)} | #${safe(a.ticket_id)} | ${duration(Number(a.duration_minutes || 0))} | ${safe(a.activity)}`)
    : [...byPerson.entries()].sort((a, b) => b[1] - a[1]).map(([n, m]) => `- ${safe(n)}: ${duration(m)}`);
  const lines = [
    title, `Periodo: ${from} a ${to}`, 'ATENCAO: numeros representam apenas apontamentos importados do Movidesk.',
    `Dias uteis de referencia: ${days.length} (sem escala individual/afastamentos)`,
    `Chamados com apontamentos: ${worked}`, `Quantidade de apontamentos: ${selected.length}`,
    `Horas apontadas: ${duration(minutes)}`, `Meta minima: ${duration(minimum)}`,
    `Jornada de referencia: ${duration(target)}`,
    `Faltam para a minima: ${duration(Math.max(0, minimum - minutes))}`,
    `Faltam para a jornada: ${duration(Math.max(0, target - minutes))}`,
    `Excedente acima da jornada: ${duration(Math.max(0, minutes - target))}`,
    '', person ? 'Atividades registradas (primeiras 100):' : 'Horas registradas por colaborador:',
    ...(details.length ? details : ['Nenhum apontamento encontrado neste periodo.']),
    '', 'Este resumo mede tempo APONTADO, nao ponto eletronico, presenca ou produtividade individual definitiva.'
  ];
  if (scope === 'management') lines.push('', 'Horas por setor:', ...[...bySector].map(([s, m]) => `- ${safe(s)}: ${duration(m)}`));
  return { text: lines.join('\n'), metrics: { appointments: selected.length, tickets: worked, minutes, days: days.length } };
}
async function sendMail(email: string, subject: string, text: string) {
  if (!isEmail(email)) throw new Error('Endereco de e-mail invalido');
  if (!E('GMAIL_MAIL_SECRET')) throw new Error('GMAIL_MAIL_SECRET nao configurado');
  const res = await fetch(validUrl(), {
    method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: E('GMAIL_MAIL_SECRET'), email, assunto: subject, texto: text }),
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`Apps Script HTTP ${res.status}`);
  let result: R;
  try { result = await res.json(); } catch { throw new Error('Apps Script nao retornou JSON'); }
  if (result.sucesso !== true) throw new Error('Apps Script recusou mensagem: ' + safe(result.erro));
}
async function isAdmin(req: Request) {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  if (!token || !E('SUPABASE_ANON_KEY')) return false;
  const res = await fetch(`${E('SUPABASE_URL').replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: E('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) return false;
  const user = await res.json();
  if (!user?.id) return false;
  const users = await db(`audit_users?user_id=eq.${encodeURIComponent(user.id)}&role=eq.admin&is_active=eq.true&select=user_id&limit=1`);
  return users.length > 0;
}
async function adminAction(payload: R) {
  const action = String(payload.action);
  if (action === 'status') {
    const s = await state();
    const [tickets, appts, recipients] = await Promise.all([
      db('audit_direct_tickets?select=ticket_id&limit=1'),
      db('audit_direct_appointments?select=appointment_key&limit=1'), recipientList()
    ]);
    return json({ ok: true, gmailConfigured: !!(E('GMAIL_WEBAPP_URL') && E('GMAIL_MAIL_SECRET')),
      dataSources: { tickets: tickets.length > 0, appointments: appts.length > 0 },
      source: 'Supabase direto', release: RELEASE_ID, checkpoint: s.next_offset, completed: s.completed,
      incrementalReady: E('REPORT_INCREMENTAL_READY') === 'true',
      sendEnabled: E('REPORT_EMAIL_SEND_ENABLED') === 'true', activeRecipients: recipients.length });
  }
  if (action !== 'test') return json({ error: 'Acao invalida' }, 400);
  const id = String(payload.recipientId || '');
  if (!/^[a-f0-9-]{36}$/i.test(id)) return json({ error: 'recipientId invalido' }, 400);
  const rows = await db(`audit_email_recipients?id=eq.${encodeURIComponent(id)}&active=eq.true&select=id,name,email&limit=1`);
  if (!rows.length) return json({ error: 'Destinatario nao encontrado ou inativo' }, 404);
  // Teste envia mensagem neutra, sem dados de colaboradores.
  await sendMail(String(rows[0].email), 'Central de Auditoria - Teste de integracao',
    'Teste autorizado do Gmail com o Supabase. Nenhum dado de colaborador foi enviado. Envios automaticos permanecem separados deste teste.');
  return json({ ok: true, sentTo: String(rows[0].email), message: 'Apps Script aceitou mensagem. Confira a caixa de entrada.' });
}
// Envio manual isolado: um destinatario existente e ativo, autorizado pelo administrador.
// Nao executa a rotina automatica, nao percorre todos os destinatarios e nao altera o Cron.
async function manualOfficial(payload: R) {
  const id = String(payload.recipientId || '');
  const kind = String(payload.kind || 'daily');
  if (!/^[a-f0-9-]{36}$/i.test(id)) return json({ error: 'recipientId invalido' }, 400);
  if (kind !== 'daily' && kind !== 'weekly') return json({ error: 'Tipo de relatorio invalido' }, 400);
  const recipients = await db(`audit_email_recipients?id=eq.${encodeURIComponent(id)}&active=eq.true&select=*&limit=1`);
  if (!recipients.length) return json({ error: 'Destinatario nao cadastrado ou inativo' }, 404);
  const rec = recipients[0] as R;
  // Primeiro piloto autorizado pelo usuario: impede disparo para outros enderecos.
  if (String(rec.email || '').trim().toLowerCase() !== 'sucessocliente@arquem.com.br')
    return json({ error: 'Piloto permitido apenas para sucessocliente@arquem.com.br' }, 403);
  const today = dateBR();
  const referenceDate = String(payload.referenceDate || today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate) ||
      dateBR(new Date(referenceDate + 'T12:00:00Z')) !== referenceDate ||
      referenceDate > today || referenceDate < shift(today,-370))
    return json({ error: 'Data de referencia invalida, futura ou anterior a 370 dias' }, 400);
  const hol = await holidays();
  const day = weekday(referenceDate);
  let from = shift(referenceDate, -1), to = from;
  if (kind === 'weekly') {
    // Semana da data de referencia: segunda ate a data escolhida (inclusive).
    from = shift(referenceDate, -((day + 6) % 7));
    to = referenceDate;
  } else {
    while ([0, 6].includes(weekday(from)) || hol.has(from)) from = shift(from, -1);
    to = from;
  }
  const checkpoint = await state();
  const key = `manual-official:${id}:${kind}:${from}:${to}`;
  const existing = await db(`audit_email_sector_dispatches?dispatch_key=eq.${encodeURIComponent(key)}&select=status&limit=1`);
  if (existing.length) return json({ ok: true, skipped: 'Relatorio manual ja registrado para este destinatario e periodo', status: existing[0].status, from, to });
  const appts = await source(from, to);
  // Piloto manual autorizado: admin JWT + endereco fixo + confirmacao de UI.
  // A permissao coletiva global permanece exigida pelo Cron automatico.
  const report = buildReport(rec, appts, from, to, kind, hol, true);
  if (!report.metrics.appointments) {
    // Diagnostico baseado em dados importados, sem enviar e-mail vazio.
    const recent = await db(`audit_direct_appointments?select=appointment_date,sector,collaborator_name&appointment_date=gte.${shift(referenceDate,-120)}&appointment_date=lte.${referenceDate}&order=appointment_date.desc&limit=1000`);
    const sameSector = (s: unknown) => {
      const a = norm(s), b = norm(rec.sector);
      return String(rec.scope) === 'management' || a === b || (b === 'sucesso' && a === 'sucesso do cliente');
    };
    const matching = (recent as R[]).find(a => sameSector(a.sector) &&
      (!rec.collaborator_name || norm(a.collaborator_name) === norm(rec.collaborator_name)));
    return json({ ok: false, skipped: 'Nenhum apontamento importado no periodo selecionado; envio nao realizado',
      from, to, sector: String(rec.sector || ''), collaborator: String(rec.collaborator_name || ''),
      lastAvailableDate: matching ? String(matching.appointment_date) : null });
  }
  const partial = !checkpoint.completed;
  const subject = 'Central de Auditoria - Relatorio oficial '+(kind === 'weekly' ? 'semanal' : 'diario')+(partial?' [DADOS PARCIAIS]':'')+' - '+from;
  const body = 'ARQUEM | CENTRAL DE AUDITORIA\nRELATORIO OFICIAL - '+(kind === 'weekly' ? 'SEMANAL' : 'DIARIO')+'\n'+
    (partial?'ATENCAO: IMPORTACAO HISTORICA INCOMPLETA. INDICADORES PARCIAIS.\n':'')+
    'Destinatario: '+safe(rec.email)+'\n\n'+report.text;
  const inserted = await db('audit_email_sector_dispatches?on_conflict=dispatch_key', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({dispatch_key:key,recipient_id:id,report_kind:kind,period_from:from,period_to:to,status:'processing'})
  });
  if (!inserted?.length) return json({ ok: true, skipped: 'Relatorio ja reservado para envio' });
  try {
    await sendMail(String(rec.email),subject,body);
    await db(`audit_email_sector_dispatches?dispatch_key=eq.${encodeURIComponent(key)}`,{
      method:'PATCH',body:JSON.stringify({status:'sent',sent_at:new Date().toISOString(),provider_id:'gmail-apps-script'})
    });
    return json({ok:true,status:'sent',release: RELEASE_ID,recipient:String(rec.email),kind,from,to,partial,metrics:report.metrics,
      message:'Apps Script aceitou a mensagem; confira a entrega na caixa de entrada.'});
  } catch(ex) {
    await db(`audit_email_sector_dispatches?dispatch_key=eq.${encodeURIComponent(key)}`,{
      method:'PATCH',body:JSON.stringify({status:'failed',error_message:err(ex).slice(0,300)})
    }).catch(()=>{});
    return json({ok:false,error:err(ex),status:'failed',recipient:String(rec.email)},502);
  }
}
async function dispatch() {
  if (E('REPORT_EMAIL_SEND_ENABLED') !== 'true') return json({ ok: true, skipped: 'Envio automatico desativado' });
  await requireProductionReady();
  const today = dateBR();
  const dow = weekday(today);
  if ([0, 6].includes(dow)) return json({ ok: true, skipped: 'Fim de semana' });
  const hol = await holidays();
  if (hol.has(today)) return json({ ok: true, skipped: 'Feriado' });
  let prev = shift(today, -1);
  while ([0, 6].includes(weekday(prev)) || hol.has(prev)) prev = shift(prev, -1);
  // A semana anterior e enviada no primeiro dia util da semana atual.
  // Se segunda for feriado, adia para o proximo dia util cadastrado.
  const thisMonday = shift(today, -((dow + 6) % 7));
  const prevMonday = shift(thisMonday, -7);
  const prevSunday = shift(thisMonday, -1);
  let firstBusinessDay = thisMonday;
  while ([0, 6].includes(weekday(firstBusinessDay)) || hol.has(firstBusinessDay))
    firstBusinessDay = shift(firstBusinessDay, 1);
  const weeklyDue = today === firstBusinessDay;
  const tasks: { r: R; kind: 'daily' | 'weekly'; from: string; to: string }[] = [];
  for (const r of await recipientList()) {
    if (r.daily_enabled === true) tasks.push({ r, kind: 'daily', from: prev, to: prev });
    if (weeklyDue && r.weekly_enabled === true) tasks.push({ r, kind: 'weekly', from: prevMonday, to: prevSunday });
  }
  if (!tasks.length) return json({ ok: true, skipped: 'Sem relatorios programados' });
  // Leitura de periodo: somente datas necessarias. Sem fonte antiga Vercel.
  const from = tasks.reduce((s, t) => t.from < s ? t.from : s, tasks[0].from);
  const to = tasks.reduce((s, t) => t.to > s ? t.to : s, tasks[0].to);
  const appts = await source(from, to);
  const results: R[] = [];
  for (const t of tasks) {
    const id = String(t.r.id);
    const key = `${id}:${t.kind}:${t.from}:${t.to}`;
    try {
      const exists = await db(`audit_email_sector_dispatches?dispatch_key=eq.${encodeURIComponent(key)}&select=dispatch_key,status&limit=1`);
      if (exists.length) { results.push({ recipientId: id, kind: t.kind, skipped: 'Ja registrado; revisar status antes de retentar' }); continue; }
      const report = buildReport(t.r, appts, t.from, t.to, t.kind, hol);
      if (!report.metrics.appointments) { results.push({ recipientId: id, kind: t.kind, skipped: 'Sem apontamentos; envio suspenso' }); continue; }
      const inserted = await db('audit_email_sector_dispatches?on_conflict=dispatch_key', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ dispatch_key: key, recipient_id: id, report_kind: t.kind,
          period_from: t.from, period_to: t.to, status: 'processing' })
      });
      if (!inserted?.length) continue;
      try {
        await sendMail(String(t.r.email), `Central de Auditoria - ${t.kind === 'daily' ? 'Diario' : 'Semanal'} - ${t.from}`, report.text);
        await db(`audit_email_sector_dispatches?dispatch_key=eq.${encodeURIComponent(key)}`, {
          method: 'PATCH', body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), provider_id: 'gmail-apps-script' }) });
        results.push({ recipientId: id, kind: t.kind, status: 'sent', ...report.metrics });
      } catch (ex) {
        await db(`audit_email_sector_dispatches?dispatch_key=eq.${encodeURIComponent(key)}`, {
          method: 'PATCH', body: JSON.stringify({ status: 'failed', error_message: err(ex).slice(0, 300) }) }).catch(() => {});
        results.push({ recipientId: id, kind: t.kind, status: 'failed', error: err(ex) });
      }
    } catch (ex) { results.push({ recipientId: id, kind: t.kind, status: 'failed', error: err(ex) }); }
  }
  return json({ ok: !results.some(x => x.status === 'failed'), date: today, results });
}
async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Apenas POST' }, 405);
  let payload: R = {};
  try { payload = await req.json(); } catch { return json({ error: 'JSON invalido' }, 400); }
  try {
    const action = String(payload.action || '');
    if (action === 'status' || action === 'test' || action === 'manual_official') {
      if (!await isAdmin(req)) return json({ error: 'Acesso reservado ao administrador autenticado' }, 403);
      return action === 'manual_official' ? await manualOfficial(payload) : await adminAction(payload);
    }
    if (action !== 'dispatch') return json({ error: 'Acao desconhecida' }, 400);
    const expected = E('REPORT_CRON_SECRET');
    if (!expected || req.headers.get('x-report-secret') !== expected) return json({ error: 'Cron nao autorizado' }, 401);
    return await dispatch();
  } catch (ex) { console.error('audit-email-dispatch:', err(ex)); return json({ ok: false, error: err(ex), release: RELEASE_ID }, 500); }
}

Deno.serve(async (req: Request) => {
  // A preflight do browser deve responder antes da leitura do corpo e do JWT.
  if (req.method === 'OPTIONS') return withCors(req, new Response(null, { status: 204 }));
  return withCors(req, await handleRequest(req));
});