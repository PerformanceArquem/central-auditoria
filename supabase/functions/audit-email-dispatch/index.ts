import {forecastSection} from "./forecast-variance.ts";
// Central de Auditoria — Supabase direto -> Google Apps Script/Gmail
// Compatível com as ações existentes: status e test (admin JWT).
// NUNCA colocar credenciais no HTML. Nenhum disparo automático sem flags explícitas.
type R = Record<string, unknown>;
const E = (k: string) => Deno.env.get(k)?.trim() || '';
const TZ = 'America/Sao_Paulo';
const RELEASE_ID = 'report-calendar-20261110';
const DIRECTION_RECIPIENT_ID = '1b8168c6-bec0-4f6d-a3f9-feaec63ed147';
const DIRECTION_EMAIL = 'canestraro@arquem.com.br';
const FIRST_MONTHLY_RUN = '2026-12-01';
type ReportKind = 'daily' | 'weekly' | 'monthly' | 'annual';
type ScheduledReport = { r:R; kind:ReportKind; from:string; to:string; includeDecember?:boolean };
const REPORT_LABEL:Record<ReportKind,string> = {daily:'Diário',weekly:'Semanal',monthly:'Mensal',annual:'Anual'};
const directionRecipient = (rec:R) =>
  rec.id===DIRECTION_RECIPIENT_ID && norm(rec.email)===DIRECTION_EMAIL && rec.scope==='management';
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
async function source(from: string, to: string, limit = 25000) {
  // Datas de atividade, não datas de abertura dos tickets.
  const appts = await list('audit_direct_appointments',
    `?select=appointment_key,ticket_id,collaborator_name,sector,activity,appointment_date,duration_minutes&appointment_date=gte.${from}&appointment_date=lte.${to}&order=appointment_date.asc,appointment_key.asc`,limit);
  if (appts.some(a => !Number.isFinite(Number(a.duration_minutes)) || Number(a.duration_minutes) < 0))
    throw new Error('Duracao negativa ou invalida encontrada: validar base antes do envio');
  return appts;
}

type SupportRating = {
  service_date: string;
  channel: string;
  collaborator_name: string;
  ticket_id: string;
  score: number;
  source: 'movidesk' | 'manual';
};

async function supportRatings(from: string, to: string): Promise<SupportRating[]> {
  const [surveys, manual] = await Promise.all([
    list('audit_movidesk_survey_responses',
      `?select=ticket_id,response_date,owner_name,channel,score&owner_team=eq.Suporte&response_date=gte.${from}&response_date=lte.${to}&score=gte.0&score=lte.10&order=response_date.desc,ticket_id.asc,response_id.asc,question_id.asc`),
    list('audit_support_quality_ratings',
      `?select=ticket_id,service_date,collaborator_name,channel,score&service_date=gte.${from}&service_date=lte.${to}&score=gte.0&score=lte.10&order=service_date.desc,id.asc`)
  ]);
  const channel = (value: unknown) => ['voz', 'chat'].includes(norm(value)) ? norm(value) : 'outros';
  const imported: SupportRating[] = surveys.map(row => ({
    service_date: String(row.response_date),
    channel: channel(row.channel),
    collaborator_name: String(row.owner_name ?? ''),
    ticket_id: String(row.ticket_id ?? ''),
    score: Number(row.score),
    source: 'movidesk'
  }));
  const key = (ticket: unknown, origin: string) => `${String(ticket ?? '').trim()}:${origin}`;
  const importedKeys = new Set(imported.filter(row => row.ticket_id).map(row => key(row.ticket_id, row.channel)));
  const entered: SupportRating[] = manual
    .filter(row => !row.ticket_id || !importedKeys.has(key(row.ticket_id, channel(row.channel))))
    .map(row => ({
      service_date: String(row.service_date),
      channel: channel(row.channel),
      collaborator_name: String(row.collaborator_name ?? ''),
      ticket_id: String(row.ticket_id ?? ''),
      score: Number(row.score),
      source: 'manual'
    }));
  return [...imported, ...entered].sort((a, b) => b.service_date.localeCompare(a.service_date));
}

function ratingSummary(ratings: SupportRating[]) {
  const totalPoints = ratings.reduce((sum, row) => sum + row.score, 0);
  const high = ratings.filter(row => row.score >= 8);
  const superadorPoints = high.reduce((sum, row) => sum + row.score, 0);
  const positive = ratings.filter(row => row.score >= 9).length;
  const percent = (numerator: number, denominator: number) =>
    denominator ? Math.round(numerator / denominator * 10000) / 100 : null;
  const movidesk = ratings.filter(row => row.source === 'movidesk').length;
  return {
    total: ratings.length, ruim: ratings.length - high.length, excelente: high.length,
    csatPositive: positive, csatPercent: percent(positive, ratings.length),
    superadores: { points: superadorPoints, totalPoints, percent: percent(superadorPoints, totalPoints) },
    movidesk, manual: ratings.length - movidesk
  };
}

async function supportQualityMetrics(payload: R) {
  const from = String(payload.from ?? '');
  const to = String(payload.to ?? '');
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(from) || !validDate(to) || from > to || to > shift(from, 369))
    return json({ ok: false, error: 'Selecione um período válido de até 370 dias.' }, 400);

  const [ratings, ignored, appointments] = await Promise.all([
    supportRatings(from, to), holidays(),
    list('audit_direct_appointments',
      `?select=appointment_key,ticket_id,collaborator_name,duration_minutes&sector=eq.Suporte&appointment_date=gte.${from}&appointment_date=lte.${to}&order=appointment_date.asc,appointment_key.asc`)
  ]);
  const team = new Map<string, { person: string; minutes: number; appointments: number; tickets: Set<string>; ratings: number; excellent: number }>();
  const personFor = (name: unknown) => {
    const key = norm(name);
    let person = team.get(key);
    if (!person) {
      person = { person: String(name || 'Não informado'), minutes: 0, appointments: 0, tickets: new Set(), ratings: 0, excellent: 0 };
      team.set(key, person);
    }
    return person;
  };
  const tickets = new Set<string>();
  let minutes = 0;
  for (const row of appointments) {
    const person = personFor(row.collaborator_name);
    const duration = Number(row.duration_minutes) || 0;
    person.minutes += duration;
    minutes += duration;
    person.appointments++;
    if (row.ticket_id) {
      tickets.add(String(row.ticket_id));
      person.tickets.add(String(row.ticket_id));
    }
  }
  for (const row of ratings) {
    const person = personFor(row.collaborator_name);
    person.ratings++;
    person.excellent += Number(row.score >= 8);
  }
  const chatTimes: R[] = [];
  const ticketIds = [...tickets].filter(id => /^\d+$/.test(id));
  for (let offset = 0; offset < ticketIds.length; offset += 150) {
    chatTimes.push(...await list('audit_support_chat_times',
      `?select=talk_seconds,wait_seconds&ticket_id=in.(${ticketIds.slice(offset, offset + 150).join(',')})`));
  }
  const seconds = (field: string) => chatTimes
    .filter(row => row[field] != null && Number.isFinite(Number(row[field])) && Number(row[field]) >= 0)
    .map(row => Number(row[field]));
  const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const talk = seconds('talk_seconds'), wait = seconds('wait_seconds');
  const csat = ratingSummary(ratings.filter(row => row.channel !== 'outros'));
  return json({
    ok: true, businessDays: workdays(from, to, ignored).length,
    metrics: { minutes, appointments: appointments.length, tickets: tickets.size, collaborators: team.size },
    quality: ['voz', 'chat', 'outros'].map(channel => ({ channel, ...ratingSummary(ratings.filter(row => row.channel === channel)) })),
    csat: { percent: csat.csatPercent, positive: csat.csatPositive, total: csat.total,
      movidesk: csat.movidesk, manual: csat.manual, unclassified: ratings.length - csat.total },
    superadores: ratingSummary(ratings).superadores,
    ratings: ratings.slice(0, 100),
    measuredChat: { tmaSeconds: average(talk), tmeSeconds: average(wait), tmaSamples: talk.length, tmeSamples: wait.length },
    collaborators: [...team.values()].map(row => ({ ...row, tickets: row.tickets.size }))
      .sort((a, b) => b.minutes - a.minutes || a.person.localeCompare(b.person, 'pt-BR'))
  });
}

function supportRatingCache() {
  const periods = new Map<string, Promise<SupportRating[] | null>>();
  return async (rec: R, from: string, to: string) => {
    const sectors = Array.isArray(rec.sectors) && rec.sectors.length ? rec.sectors : [rec.sector];
    if (!sectors.some(sector => norm(sector) === 'suporte')) return { text: '', html: '', metric: null };
    const key = `${from}:${to}`;
    let pending = periods.get(key);
    if (!pending) {
      pending = supportRatings(from, to).catch(error => {
        console.error('Avaliações de Suporte indisponíveis:', err(error));
        return null;
      });
      periods.set(key, pending);
    }
    const rows = await pending;
    const person = norm(rec.collaborator_name);
    const metric = rows && ratingSummary(rows.filter(row => !person || norm(row.collaborator_name) === person)).superadores;
    const result = metric?.percent != null
      ? `${metric.percent.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% (${metric.points} de ${metric.totalPoints} pontos)`
      : rows ? 'Sem pontuação no período' : 'Avaliações indisponíveis no momento';
    const text = `Qualidade do Suporte — Superadores: ${result}.`;
    return { text: '\n\n' + text, html: '<p><strong>' + emailEsc(text) + '</strong></p>', metric };
  };
}

// Resiliência: falhas do módulo de previsões não bloqueiam relatórios oficiais.
async function optionalForecast(rec:R){
 try{return await forecastSection(rec,{db,norm,duration,emailEsc});}
 catch(e){console.error('Bloco de previsões indisponível:',err(e));
  return {text:'',html:'',rows:[]};}
}
// Snapshot atual de chamados importados do Movidesk. Não confundir com horas do período.
async function clientSource() {
 return list('audit_ticket_client_summary','?select=ticket_id,client_name');
}
async function ticketSource() {
  // Usar a mesma base já sincronizada do painel, mas só tickets abertos
  // e campos necessários. Evita carregar megabytes de actions/histories.
  return list('audit_email_open_ticket_snapshot',
    '?select=ticket_id,payload,created_at_source,last_update_source,closed_at_source');
}
type TicketAlert = {
  id:string;subject:string;status:string;owner:string;sector:string;
  sla:string|null;lastAction:string|null;ageDays:number;url:string;
};
function ticketAlerts(rec:R,records:R[]) {
  const scope=String(rec.scope||'sector');
  const person=norm(rec.collaborator_name);
  const sectorNames=Array.isArray(rec.sectors)&&rec.sectors.length
    ?rec.sectors.map((s:unknown)=>norm(s)).filter(Boolean)
    :[norm(rec.sector)].filter(Boolean);
  const matchesSector=(v:unknown)=>{
    const s=norm(v);
    return sectorNames.some(n=>n===s||(n==='sucesso'&&s==='sucesso do cliente'));
  };
  // O "atraso" é atraso de SLA válido, não antiguidade do ticket.
  // Exclui fechado/resolvido/cancelado/concluído. Status do ticket é o estado atual.
  const closedStatuses=new Set(['fechado','resolvido','cancelado','concluido','concluido (sem confirmacao)']);
  const now=dateBR();
  const todayMs=Date.parse(now+'T12:00:00Z');
  const active:TicketAlert[]=[];
  const overdue:TicketAlert[]=[];
  const stalled:TicketAlert[]=[];
  let withoutSla=0;
  for (const r of records) {
    const t=(r.payload&&typeof r.payload==='object'?r.payload:{}) as R;
    const status=String(t.status||'Não informado');
    if(closedStatuses.has(norm(status))||r.closed_at_source||t.canceledIn||t.closedIn||t.isDeleted===true)continue;
    const ownerData=(t.owner && typeof t.owner==='object')?t.owner as R:{} as R;
    const owner=String(ownerData.businessName||ownerData.name||'Sem responsável');
    const sector=String(t.ownerTeam||'Sem setor');
    if(scope==='management'){
      if(sectorNames.length&&!matchesSector(sector))continue;
    }else{
      if(!matchesSector(sector))continue;
      // Relatório individual: somente tickets atualmente atribuídos à pessoa,
      // não todos os tickets nos quais ela já apontou horas.
      if(person&&norm(owner)!==person)continue;
    }
    const id=String(r.ticket_id||t.id||'');
    if(!/^\d+$/.test(id))continue;
    const sla=typeof t.slaSolutionDate==='string'&&/^\d{4}-\d{2}-\d{2}/.test(t.slaSolutionDate)?t.slaSolutionDate.slice(0,10):null;
    const lastRaw=String(t.lastActionDate||t.createdDate||r.created_at_source||'');
    const lastDate=/^\d{4}-\d{2}-\d{2}/.test(lastRaw)?lastRaw.slice(0,10):null;
    const ageDays=lastDate?Math.max(0,Math.floor((todayMs-Date.parse(lastDate+'T12:00:00Z'))/86400000)):0;
    const alert:TicketAlert={id,subject:safe(t.subject)||'Sem assunto',
      owner,sector,status,sla,lastAction:lastDate,ageDays,
      url:'https://arquem.movidesk.com/Ticket/Edit/'+id};
    active.push(alert);
    const paused=t.slaSolutionDateIsPaused===true||String(t.slaSolutionDateIsPaused).toLowerCase()==='true';
    if(sla&&!paused&&sla<now)overdue.push(alert);
    if(!sla)withoutSla++;
    // Ausência de ação há >= 7 dias, não equivale necessariamente a falta de trabalho.
    if(ageDays>=7)stalled.push(alert);
  }
  overdue.sort((a,b)=>(a.sla||'').localeCompare(b.sla||'')||b.ageDays-a.ageDays);
  stalled.sort((a,b)=>b.ageDays-a.ageDays);
  const ticketLine=(a:TicketAlert,mode:'sla'|'idle')=>'#'+a.id+' | '+
    (mode==='sla'?'SLA: '+(a.sla?displayDate(a.sla):'—'):'Sem ação há '+a.ageDays+' dias')+
    ' | '+a.status+' | '+a.owner+' | '+a.sector+' | '+a.subject+
    '\n'+a.url;
  const limited=8;
  const lines=['','━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'PANORAMA DE CHAMADOS EM ABERTO (SITUAÇÃO ATUAL)',
    'Base: chamados já importados do Movidesk. Dados podem estar incompletos.',
    'Chamados em aberto no escopo: '+active.length,
    'Com SLA vencido: '+overdue.length,
    'Sem ação há 7 dias ou mais: '+stalled.length,
    'Sem data de SLA informada: '+withoutSla,
    '',
    'CHAMADOS COM SLA VENCIDO ('+overdue.length+')',
    ...(overdue.slice(0,limited).map(a=>ticketLine(a,'sla'))||[]),
    ...(overdue.length?[]:['Nenhum nos dados importados.']),
    ...(overdue.length>limited?['Outros '+(overdue.length-limited)+' não listados.']:[]),
    '',
    'CHAMADOS SEM AÇÃO HÁ 7+ DIAS ('+stalled.length+')',
    ...stalled.slice(0,limited).map(a=>ticketLine(a,'idle')),
    ...(stalled.length?[]:['Nenhum nos dados importados.']),
    ...(stalled.length>limited?['Outros '+(stalled.length-limited)+' não listados.']:[]),
    '',
    'CRITÉRIOS: SLA vencido exige data de solução anterior à data de hoje e SLA não pausado.',
    'Sem andamento = última ação registrada há pelo menos 7 dias; requer análise humana.',
    'Um chamado pode aparecer nas duas categorias. O e-mail mostra até '+limited+' por categoria.',
    'Os alertas refletem a situação atual, mesmo se o relatório de horas for de uma data passada.'];
  const htmlRow=(a:TicketAlert,mode:'sla'|'idle')=>
    '<tr><td style="padding:10px 8px;border-bottom:1px solid #e8edf5;font-size:12px;vertical-align:top">'+
    '<a style="color:#1c5dcc;font-weight:bold;text-decoration:underline" href="'+emailEsc(a.url)+'">#'+emailEsc(a.id)+'</a>'+
    '</td><td style="padding:10px 8px;border-bottom:1px solid #e8edf5;font-size:12px">'+
    '<strong>'+emailEsc(a.subject)+'</strong><div style="color:#66758c;margin-top:4px">'+
    emailEsc(a.status)+' · '+emailEsc(a.owner)+' · '+emailEsc(a.sector)+'</div></td>'+
    '<td style="padding:10px 8px;border-bottom:1px solid #e8edf5;font-size:12px;white-space:nowrap">'+
    emailEsc(mode==='sla'?(a.sla?displayDate(a.sla):'—'):String(a.ageDays)+' dias')+'</td></tr>';
  const section=(title:string,items:TicketAlert[],mode:'sla'|'idle')=>
    '<h3 style="font-size:15px;color:#17345d;margin:25px 0 10px">'+emailEsc(title)+' ('+items.length+')</h3>'+
    (items.length?'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dee7f3;border-radius:8px">'+
    '<tr style="background:#f1f5fb"><th align="left" style="padding:9px 8px;font-size:11px">Ticket</th>'+
    '<th align="left" style="padding:9px 8px;font-size:11px">Assunto, status e responsável</th>'+
    '<th align="left" style="padding:9px 8px;font-size:11px">'+(mode==='sla'?'Prazo':'Sem ação')+'</th></tr>'+
    items.slice(0,limited).map(a=>htmlRow(a,mode)).join('')+'</table>'+
    (items.length>limited?'<p style="font-size:12px;color:#65748b">Mais '+(items.length-limited)+' chamados não exibidos.</p>':''):
    '<p style="font-size:12px;color:#60718a">Nenhum encontrado nos registros importados.</p>');
  const html='<div style="border-top:2px solid #dce6f4;margin-top:28px;padding-top:10px">'+
    '<h2 style="color:#102c4f;font-size:20px;margin:12px 0">Pendências e chamados em aberto</h2>'+
    '<p style="font-size:12px;color:#66758c">Fotografia atual dos tickets sincronizados com o Movidesk (pode estar incompleta).</p>'+
    '<table role="presentation" width="100%" cellpadding="6" cellspacing="0" style="background:#edf3fb;border-radius:8px">'+
    '<tr><td style="font-size:12px">Em aberto<br><strong style="font-size:20px">'+active.length+'</strong></td>'+
    '<td style="font-size:12px">SLA vencido<br><strong style="font-size:20px;color:#b63333">'+overdue.length+'</strong></td>'+
    '<td style="font-size:12px">Sem ação 7+ dias<br><strong style="font-size:20px;color:#ad6513">'+stalled.length+'</strong></td>'+
    '<td style="font-size:12px">Sem SLA<br><strong style="font-size:20px">'+withoutSla+'</strong></td></tr></table>'+
    section('Prazo de SLA vencido',overdue,'sla')+
    section('Sem ação registrada há 7 dias ou mais',stalled,'idle')+
    '<p style="font-size:11px;line-height:1.5;color:#64748b;margin-top:20px">SLA vencido: data anterior a hoje, excluindo SLA pausado. '+
    'Sem ação: última ação registrada há 7 dias ou mais. Um ticket pode estar nas duas listas. '+
    'Os alertas refletem a situação atual e somente os tickets já importados.</p></div>';
  return {text:lines.join('\n'),html,activeTickets:active,
    attachmentTickets:[...new Map([...overdue.slice(0,30),...stalled.slice(0,30)]
      .map(a=>[a.id,{id:a.id,client:'',owner:a.owner,status:a.status,ageDays:a.ageDays,url:a.url}])).values()].slice(0,60),
    metrics:{open:active.length,overdue:overdue.length,stalled:stalled.length,withoutSla},
    preview:{overdue:overdue.slice(0,5).map(a=>({id:a.id,subject:a.subject,owner:a.owner,sector:a.sector,sla:a.sla,url:a.url})),
      stalled:stalled.slice(0,5).map(a=>({id:a.id,subject:a.subject,owner:a.owner,sector:a.sector,days:a.ageDays,url:a.url}))}
  };
}

function directionOverviewCache() {
  let history: Promise<R[] | null> | undefined;
  return async (rec:R, from:string, to:string, open:TicketAlert[], kind:ReportKind = 'weekly') => {
    const empty = { text:'', html:'', metrics:null };
    if (!directionRecipient(rec)) return empty;
    const configured = Array.isArray(rec.sectors) && rec.sectors.length ? rec.sectors : [rec.sector];
    const allowed = new Set(configured.map(norm).filter(Boolean));
    if (!allowed.size) return empty;
    history ??= list('audit_direct_tickets',
      '?select=ticket_id,created_at_source,closed_at_source,sector:payload->>ownerTeam&order=ticket_id.asc', 100000
    ).catch(error => {
      console.error('Comparativo da Direção indisponível:', err(error));
      return null;
    });
    return directionTicketOverview(await history, open, allowed, from, to, kind);
  };
}

function directionTicketOverview(history:R[]|null, open:TicketAlert[], allowed:Set<string>, from:string, to:string, kind:ReportKind = 'weekly') {
  type Counts = { opened:number; closed:number };
  type SectorCounts = Counts & { name:string; open:number; updateQueue:number };
  const newCounts = ():Counts => ({opened:0,closed:0});
  const keyFor = (sector:unknown) => {
    const key = norm(sector);
    if (allowed.has(key)) return key;
    return key === 'sucesso do cliente' && allowed.has('sucesso') ? 'sucesso' : '';
  };
  const groupedName = (sector:string) => {
    const key = norm(sector);
    if (['producao','producao - cpo'].includes(key)) return 'Produção';
    if (['financeiro','financeiro - cfo'].includes(key)) return 'Financeiro';
    return sector;
  };
  const bySector = new Map<string,SectorCounts>();
  const sectorBucket = (sector:string) => {
    const name = groupedName(sector);
    const key = norm(name);
    let bucket = bySector.get(key);
    if (!bucket) {
      bucket = { name, opened:0, closed:0, open:0, updateQueue:0 };
      bySector.set(key,bucket);
    }
    return bucket;
  };
  for (const ticket of open) {
    if (!keyFor(ticket.sector)) continue;
    const row = sectorBucket(ticket.sector);
    row.open++;
    if (row.name === 'Produção' && norm(ticket.status) === 'liberar atualizacao') row.updateQueue++;
  }
  const currentOpen = [...bySector.values()].reduce((sum,row)=>sum+row.open,0);
  const updateQueue = bySector.get('producao')?.updateQueue ?? 0;
  const queueInScope = allowed.has('producao') || allowed.has('producao - cpo');
  const queueText = queueInScope ? ` · Produção em “Liberar Atualização”: ${updateQueue}` : '';
  const snapshot = `Chamados em aberto em ${displayDate(dateBR())}: ${currentOpen}${queueText}.`;
  const title = 'Resumo executivo de chamados';
  const heading = '<h2 style="font-size:17px;color:#18385e;margin:24px 0 8px">'+title+'</h2>';
  if (!history) return {
    text:'\n\n'+title+'\n'+snapshot+'\nHistórico de aberturas e encerramentos indisponível nesta consulta.',
    html:heading+'<p>'+emailEsc(snapshot)+'</p><p>Histórico de aberturas e encerramentos indisponível nesta consulta.</p>',
    metrics:{currentOpen,updateQueue:queueInScope?updateQueue:null,historyAvailable:false}
  };

  const dateFormat = new Intl.DateTimeFormat('sv-SE',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'});
  const byDay = new Map<string,Counts>();
  const months = new Map<string,Counts>();
  const weeks = new Map<string,Counts>();
  const bucket = (map:Map<string,Counts>, key:string) => {
    let row = map.get(key);
    if (!row) { row = newCounts(); map.set(key,row); }
    return row;
  };
  const monday = (date:string) => shift(date,-((weekday(date)+6)%7));
  const period = newCounts();
  const add = (value:unknown, kind:keyof Counts, sector:SectorCounts) => {
    if (!value) return;
    const parsed = new Date(String(value));
    if (!Number.isFinite(parsed.getTime())) return;
    const date = dateFormat.format(parsed);
    if (date > to) return;
    bucket(byDay,date)[kind]++;
    bucket(weeks,monday(date))[kind]++;
    bucket(months,date.slice(0,7))[kind]++;
    if (date >= from) { period[kind]++; sector[kind]++; }
  };
  for (const ticket of history) {
    if (!keyFor(ticket.sector)) continue;
    const sector = sectorBucket(String(ticket.sector));
    add(ticket.created_at_source,'opened',sector);
    add(ticket.closed_at_source,'closed',sector);
  }
  const daily = Array.from({length:7},(_,i)=>{
    const day = shift(to,-i);
    return { label:displayDate(day),...(byDay.get(day)??newCounts()) };
  });
  const weekly = Array.from({length:8},(_,i)=>{
    const start = shift(monday(to),-7*i);
    const end = shift(start,6);
    return { label:displayDate(start)+' a '+displayDate(end>to?to:end),...(weeks.get(start)??newCounts()) };
  });
  const monthly = [];
  const firstMonth = [...months.keys()].sort()[0];
  for (let month = to.slice(0,7); firstMonth && month >= firstMonth;) {
    monthly.push({label:month.slice(5)+'/'+month.slice(0,4),...(months.get(month)??newCounts())});
    month = shift(month+'-01',-1).slice(0,7);
  }
  const sectors = [...bySector.values()].filter(x=>x.open||x.opened||x.closed).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  const summary = `No período de ${displayDate(from)} a ${displayDate(to)}: ${period.opened} abertos e ${period.closed} encerrados.`;
  const note = 'Contagens da base sincronizada do Movidesk, em horário de Brasília. Abertos pela data de criação e encerrados pela data de encerramento registrada. O mês e a semana mais recentes vão até o fim do período deste relatório. A fila de atualização da Produção faz parte dos chamados em aberto.';
  const sections = kind==='annual'
    ? [{title:'Meses do ano fechado',rows:monthly.filter(x=>x.label.endsWith('/'+to.slice(0,4)))}]
    : kind==='monthly'
    ? [{title:'Comparativo mensal · histórico importado',rows:monthly}]
    : [
      { title:'Comparativo mensal · últimos 3 meses', rows:monthly.slice(0,3) },
      { title:'Comparativo semanal · últimas 8 semanas', rows:weekly },
      { title:'Comparativo diário · últimos 7 dias', rows:daily }
    ];
  const textRows = sections.flatMap(s=>['',s.title,'Período | Abertos | Encerrados',
    ...s.rows.map(x=>`${x.label} | ${x.opened} | ${x.closed}`)]);
  const table = (columns:string[],rows:(string|number)[][]) => {
    const cell = 'padding:6px 8px;border-bottom:1px solid #e5edf7;text-align:left';
    return '<table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;border-collapse:collapse"><thead><tr style="background:#f1f5fb">'+
      columns.map(x=>'<th style="'+cell+'">'+emailEsc(x)+'</th>').join('')+'</tr></thead><tbody>'+
      rows.map(row=>'<tr>'+row.map(x=>'<td style="'+cell+'">'+emailEsc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  };
  const subtitle = (text:string) => '<h3 style="font-size:14px;color:#17345d;margin:16px 0 6px">'+emailEsc(text)+'</h3>';
  return {
    text:['','',title,summary,snapshot,'','Por setor no período | Abertos | Encerrados | Em aberto agora',
      ...sectors.map(x=>`${safe(x.name)} | ${x.opened} | ${x.closed} | ${x.open}`),...textRows,'',note].join('\n'),
    html:heading+'<p><strong>'+emailEsc(summary)+'</strong><br>'+emailEsc(snapshot)+'</p>'+
      subtitle('Por setor · período do relatório e fila atual')+
      table(['Setor','Abertos','Encerrados','Em aberto agora'],sectors.map(x=>[x.name,x.opened,x.closed,x.open]))+
      sections.map(s=>subtitle(s.title)+table(['Período','Abertos','Encerrados'],s.rows.map(x=>[x.label,x.opened,x.closed]))).join('')+
      '<p style="font-size:11px;color:#64748b">'+emailEsc(note)+'</p>',
    metrics:{period,currentOpen,updateQueue:queueInScope?updateQueue:null,historyAvailable:true,sectors,monthly,weekly,daily}
  };
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

const emailEsc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));
const displayDate=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)?d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4):d;
function reportEmailHtml(rec:R,report:{text:string;teamJourneyHtml?:string;metrics:{appointments:number;tickets:number;minutes:number;days:number}},from:string,to:string,kind:ReportKind,partial:boolean,manual:boolean,alertsHtml='',detailsHtml='',executiveHtml='',forecastHtml=''){
 const m=report.metrics;
 const targetPerDay=Number(rec.daily_target_minutes??480);
 const minPercent=Number(rec.minimum_percent??80);
 const target=Math.round(targetPerDay*m.days);
 const minimum=Math.round(target*minPercent/100);
 const missing=m.appointments===0;
 const person=safe(rec.collaborator_name)||'Equipe';
 const sector=(Array.isArray(rec.sectors)&&rec.sectors.length?rec.sectors.map(safe).join(' · '):(safe(rec.sector)||(rec.scope==='management'?'Todos os setores':'')))||'Gestão';
 const k=REPORT_LABEL[kind];
 const badge=manual?'TESTE MANUAL':partial?'DADOS PARCIAIS':'RELATÓRIO DE APONTAMENTOS';
 const esc=emailEsc;
 const tile=(label:string,value:string)=>'<td width="50%" valign="top" style="padding:8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f6fc;border:1px solid #e0e7f2;border-radius:10px"><tr><td style="padding:15px 16px"><div style="color:#65748b;font-size:12px;font-weight:600">'+esc(label)+'</div><div style="color:#102b51;font-size:23px;font-weight:750;margin-top:6px">'+esc(value)+'</div></td></tr></table></td>';
 const detail=report.text.split('\n').filter(x=>x.startsWith('- ')).slice(0,12);
 const lines=detail.length?detail.map((s,i)=>'<tr><td style="padding:10px 12px;background:'+(i%2?'#f5f8fc':'#ffffff')+';border-bottom:1px solid #e7edf6;color:#293b54;font-size:12px">'+esc(s.slice(2))+'</td></tr>').join(''):
   '<tr><td style="padding:15px 12px;color:#65748b;font-size:13px">Não há apontamentos importados para este período.</td></tr>';
 const completeness=partial?'A sincronização dos registros do Movidesk ainda está em andamento. Os números podem mudar.':
    'Indicadores baseados nos registros importados do Movidesk para o período informado.';
 const note=missing?'SEM REGISTROS IMPORTADOS: não é possível concluir ausência de trabalho nem avaliar cumprimento de jornada.':
   'O tempo apresentado é tempo apontado no Movidesk; não representa controle de ponto ou avaliação definitiva de produtividade.';
 const missingMetrics=missing?'<div style="color:#66768d;font-size:13px;margin-top:12px">Metas de referência não avaliadas por ausência de apontamentos importados.</div>':
   '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px"><tr>'+
     tile('Meta mínima de referência',duration(minimum))+tile('Jornada de referência',duration(target))+'</tr><tr>'+
     tile('Diferença para a mínima',duration(Math.max(0,minimum-m.minutes)))+
     tile('Diferença para a jornada',duration(Math.max(0,target-m.minutes)))+'</tr></table>';
 const test=manual?'<div style="background:#eaf3ff;color:#174c99;border:1px solid #c8ddff;padding:14px 16px;border-radius:8px;margin:0 0 18px;font-size:13px"><strong>ENVIO DE TESTE</strong> — Mensagem para verificar o recebimento. Não substitui um relatório definitivo.</div>':'';
 const warning=(partial||missing)?'<div style="background:#fff8e9;color:#86520f;border-left:4px solid #e4ad38;padding:14px 16px;border-radius:7px;font-size:13px;margin:18px 0">'+esc(completeness)+'<div style="margin-top:7px">'+esc(note)+'</div></div>':
   '<p style="color:#65748b;font-size:12px;line-height:1.5">'+esc(note)+'</p>';
 return '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
 '<body style="margin:0;padding:0;background:#edf2f9;font-family:Arial,Helvetica,sans-serif;color:#1e304a">'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#edf2f9"><tr><td align="center" style="padding:32px 12px">'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:650px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe5f2">'+
 '<tr><td style="background:#102c4f;padding:28px 30px;color:#fff">'+
 '<div style="font-size:13px;letter-spacing:2px;font-weight:750;color:#8fd5e7">ARQUEM SISTEMAS</div>'+
 '<div style="font-size:26px;font-weight:750;margin-top:12px">Central de Auditoria</div>'+
 '<div style="font-size:13px;color:#bed1e8;margin-top:8px">'+esc(kind==='monthly'||kind==='annual'?'Balancete '+k.toLowerCase():'Relatório '+k.toLowerCase()+' de apontamentos')+'</div>'+
 '</td></tr><tr><td style="padding:26px 26px 12px">'+test+
 '<div style="font-size:11px;color:#3873ae;letter-spacing:1px;font-weight:700">'+esc(badge)+'</div>'+
 '<h1 style="font-size:23px;line-height:1.2;margin:10px 0 8px;color:#102b51">'+esc(person)+'</h1>'+
 '<div style="color:#5e718b;font-size:14px">'+esc(sector)+' &nbsp;·&nbsp; '+esc(displayDate(from))+' a '+esc(displayDate(to))+'</div>'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:23px -8px 5px"><tr>'+
 tile('Horas apontadas',duration(m.minutes))+tile('Apontamentos',String(m.appointments))+'</tr><tr>'+
 tile('Chamados com horas',String(m.tickets))+tile('Dias úteis de referência',String(m.days))+'</tr></table>'+
 warning+
 executiveHtml+forecastHtml+
 (report.teamJourneyHtml||
   '<div style="font-size:15px;color:#18385e;font-weight:700;margin:23px 0 6px">Referências de jornada</div>'+missingMetrics)+
 (report.teamJourneyHtml?'':'<div style="font-size:15px;color:#18385e;font-weight:700;margin:24px 0 12px">'+
   esc(rec.collaborator_name?'Destaques dos apontamentos':'Resumo por colaborador')+'</div>'+
   '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5edf7;border-radius:8px;overflow:hidden">'+lines+'</table>')+
 detailsHtml+alertsHtml+
 '<p style="font-size:11px;line-height:1.6;color:#64748b;margin:22px 0">Fonte: API Movidesk / Central de Auditoria. Registros importados; não substitui o ponto eletrônico e não comprova produtividade ou presença.</p>'+
 '</td></tr><tr><td style="background:#f4f7fb;border-top:1px solid #dce5f0;padding:20px 26px;color:#718096;font-size:11px">'+
 'ARQUEM SISTEMAS &nbsp;|&nbsp; Central de Auditoria &nbsp;|&nbsp; Mensagem automática, não responda</td></tr>'+
 '</table></td></tr></table></body></html>';
}
function buildReport(rec: R, appts: R[], from: string, to: string, kind: ReportKind, hol: Set<string>, authorizedSingleManual = false, clients: R[] = []) {
  const scope = String(rec.scope || 'sector');
  if (!['sector', 'management'].includes(scope)) throw new Error('Escopo de destinatario nao reconhecido');
  const person = norm(rec.collaborator_name);
  // Compatibilidade: cadastros antigos usam sector, novos podem ter varios sectors.
  const sectorLabels = (Array.isArray(rec.sectors) && rec.sectors.length ? rec.sectors : [rec.sector]).map(safe).filter(Boolean);
  const selectedSectors = [...new Set(sectorLabels.map(norm))];
  const scopedManagement = scope === 'management' && selectedSectors.length > 0;
  if (scope === 'sector' && !selectedSectors.length) throw new Error('Destinatario setorial sem setor');
  if (scope === 'sector' && !person && !authorizedSingleManual && E('REPORT_ALLOW_SECTOR_EMAIL') !== 'true')
    throw new Error('Envio setorial coletivo exige REPORT_ALLOW_SECTOR_EMAIL=true e autorizacao da supervisao');
  // O Movidesk utiliza "Sucesso do Cliente", enquanto cadastros antigos usam "Sucesso".
  // Manter o alias restrito, sem misturar setores distintos.
  const sameSector = (sourceSector: unknown) => {
    const value = norm(sourceSector);
    return selectedSectors.some(sector =>
      value === sector || (sector === 'sucesso' && value === 'sucesso do cliente'));
  };
  const selected = appts.filter(a =>
    ((scope === 'management' && !selectedSectors.length) || sameSector(a.sector)) &&
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
    const n = String(a.collaborator_name || 'Não informado');
    byPerson.set(n, (byPerson.get(n) || 0) + Number(a.duration_minutes || 0));
    const s = String(a.sector || 'Nao informado');
    bySector.set(s, (bySector.get(s) || 0) + Number(a.duration_minutes || 0));
  }
  const worked = new Set(selected.map(a => String(a.ticket_id))).size;
  const dayMap=new Map<string,number>();
  const sectorsByDay=new Map<string,Set<string>>();
  const daySet=new Set(days);
  const clientsById=new Map(clients.map(x=>[String(x.ticket_id),String(x.client_name||'').trim()]));
  const companyMap=new Map<string,{minutes:number;tickets:Set<string>}>();
  const teamMembers=new Map<string,{sectors:Set<string>;tickets:Set<string>;clients:Set<string>;dates:Set<string>;entries:number;offMinutes:number}>();
  for(const a of selected){
    const who=String(a.collaborator_name||'Não informado');
    const day=String(a.appointment_date||'').slice(0,10);
    const mins=Number(a.duration_minutes||0);
    const k=who+'|'+day;dayMap.set(k,(dayMap.get(k)||0)+mins);
    const id=String(a.ticket_id||''),company=clientsById.get(id)||'Empresa não identificada';
    if(scopedManagement){
      let member=teamMembers.get(who);
      if(!member){
        member={sectors:new Set(),tickets:new Set(),clients:new Set(),dates:new Set(),entries:0,offMinutes:0};
        teamMembers.set(who,member);
      }
      member.entries++;
      member.sectors.add(String(a.sector||''));
      const daySectors=sectorsByDay.get(k)??new Set<string>();
      daySectors.add(String(a.sector||''));
      sectorsByDay.set(k,daySectors);
      if(id)member.tickets.add(id);
      if(clientsById.get(id))member.clients.add(company);
      if(day){
        member.dates.add(day);
        if(!daySet.has(day))member.offMinutes+=mins;
      }
    }
    if(!companyMap.has(company))companyMap.set(company,{minutes:0,tickets:new Set()});
    const row=companyMap.get(company)!;row.minutes+=mins;if(id)row.tickets.add(id);
  }
  const daily=[...dayMap].map(([key,minutes])=>{const i=key.lastIndexOf('|');return {name:key.slice(0,i),day:key.slice(i+1),minutes};})
    .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.day.localeCompare(b.day));
  const companies=[...companyMap].map(([name,x])=>({name,minutes:x.minutes,tickets:x.tickets.size}))
    .sort((a,b)=>b.minutes-a.minutes).slice(0,10);
  const cell='padding:9px 8px;border-bottom:1px solid #e5edf7;text-align:left';
  const detailTable=(cols:string[],rows:string[][])=>
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;border-collapse:collapse">'+
    '<tr style="background:#f1f5fb">'+cols.map(c=>'<th style="'+cell+'">'+emailEsc(c)+'</th>').join('')+'</tr>'+
    rows.map(row=>'<tr>'+row.map(c=>'<td style="'+cell+'">'+emailEsc(c)+'</td>').join('')+'</tr>').join('')+'</table>';
  const periodReference=(minutes:number,capacity:number,min:number)=>({
    percent:capacity>0?Math.round(100*minutes/capacity):null,
    minimumGap:Math.max(0,min-minutes),
    targetGap:Math.max(0,capacity-minutes),
    status:capacity===0?'Sem jornada de referência':minutes>=min?'Mínimo atingido':'Abaixo do mínimo de referência'
  });
  const journey=[...teamMembers].map(([name,member])=>{
    const minutes=byPerson.get(name)??0;
    return {
      name,sector:[...member.sectors].sort().join(' · '),minutes,
      entries:member.entries,tickets:member.tickets.size,clients:member.clients.size,days:member.dates.size,
      averageMinutes:member.dates.size?minutes/member.dates.size:null,offMinutes:member.offMinutes,
      targetMinutes:target,minimumMinutes:minimum,...periodReference(minutes,target,minimum)
    };
  }).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  const dailyJourney=daily.map(x=>{
    const workday=daySet.has(x.day),referenceMinutes=workday?targetPerDay:0;
    const minimumMinutes=workday?Math.round(targetPerDay*minimumPercent/100):0;
    const comparison=periodReference(x.minutes,referenceMinutes,minimumMinutes);
    const sector=[...(sectorsByDay.get(x.name+'|'+x.day)??[])].sort().join(' · ');
    return {...x,sector,referenceMinutes,minimumMinutes,...comparison,status:workday?comparison.status:'Dia não útil'};
  });
  const showJourneyPercent=(n:number|null)=>n===null?'—':n+'%';
  const emailTeam=journey.slice(0,24);
  const journeyNote='Referência por colaborador conforme o cadastro do destinatário e os dias úteis do período. Horas em dias não úteis entram no total. São exibidos apenas colaboradores com apontamentos nos setores vinculados.';
  const teamJourneyHtml=scopedManagement?
    '<h2 style="font-size:17px;color:#18385e;margin:23px 0 6px">Colaboradores: horas apontadas e jornada</h2>'+
    '<p style="font-size:12px;color:#65748b">'+emailEsc(journeyNote)+'</p>'+
    (journey.length?detailTable(['Colaborador','Equipe','Apontadas','Capacidade','Mínimo','%'],emailTeam.map(x=>
      [x.name,x.sector,duration(x.minutes),duration(x.targetMinutes),duration(x.minimumMinutes),showJourneyPercent(x.percent)]))+
    '<h3 style="font-size:14px;color:#17345d">Diferenças e situação</h3>'+
    detailTable(['Colaborador','Falta mínimo','Falta jornada','Situação'],emailTeam.map(x=>
      [x.name,duration(x.minimumGap),duration(x.targetGap),x.status]))+
    '<h3 style="font-size:14px;color:#17345d">Volume de apontamentos</h3>'+
    detailTable(['Colaborador','Lançamentos','Chamados','Clientes','Dias','Média/dia','Dias não úteis'],emailTeam.map(x=>
      [x.name,String(x.entries),String(x.tickets),String(x.clients),String(x.days),x.averageMinutes===null?'—':duration(x.averageMinutes),duration(x.offMinutes)]))+
    (journey.length>emailTeam.length?'<p style="font-size:12px">Mostrando '+emailTeam.length+' de '+journey.length+' colaboradores. Consulte o Excel, quando disponível, para mais detalhes.</p>':''):
      '<p style="font-size:12px">Sem apontamentos importados nos setores vinculados.</p>'):'';
  const emailDailyLimit=12;
  const detailsHtml='<div style="margin-top:24px;border-top:2px solid #dce6f4;padding-top:12px">'+
    '<h3 style="color:#17345d;font-size:15px">Horas por colaborador, dia a dia</h3>'+
    (daily.length?(scopedManagement?
      detailTable(['Colaborador','Data','Horas','Jornada','%','Falta jornada','Situação'],dailyJourney.slice(0,emailDailyLimit).map(x=>
        [x.name,displayDate(x.day),duration(x.minutes),x.referenceMinutes?duration(x.referenceMinutes):'—',
          showJourneyPercent(x.percent),x.referenceMinutes?duration(x.targetGap):'—',x.status])):
      detailTable(['Colaborador','Data','Horas'],daily.slice(0,emailDailyLimit).map(x=>[x.name,displayDate(x.day),duration(x.minutes)]))):
      '<p style="font-size:12px">Sem apontamentos importados.</p>')+
    (daily.length>emailDailyLimit?'<p style="font-size:12px">Resumo no e-mail: '+emailDailyLimit+' de '+daily.length+' linhas. Consulte o Excel, quando disponível, para mais detalhes.</p>':'')+
    '<h3 style="color:#17345d;font-size:15px;margin-top:24px">Empresas com maior consumo de horas</h3>'+
    (companies.length?detailTable(['Empresa','Tempo','Chamados'],companies.map(x=>[x.name,duration(x.minutes),String(x.tickets)])):
      '<p style="font-size:12px">Sem empresas identificadas.</p>')+
    '<p style="font-size:11px;color:#64748b">Somente horas importadas do Movidesk; ausência de lançamento não comprova falta de trabalho.</p></div>';
  const title = `${kind==='monthly'||kind==='annual'?'Balancete':'Relatório'} ${REPORT_LABEL[kind].toLowerCase()} - ${scope === 'management' ? 'Gestao / ' + (sectorLabels.join(' + ') || 'Todos os setores') : sectorLabels.join(' + ')}${person ? ' / ' + safe(rec.collaborator_name) : ''}`;
  const details = person ? selected.slice(0, 100).map(a =>
    `- ${String(a.appointment_date)} | #${safe(a.ticket_id)} | ${duration(Number(a.duration_minutes || 0))} | ${safe(a.activity)}`)
    : [...byPerson.entries()].sort((a, b) => b[1] - a[1]).map(([n, m]) => `- ${safe(n)}: ${duration(m)}`);
  // Texto legível no Gmail mesmo se o Apps Script ainda não usar htmlBody.
  // Ausência de lançamentos importados não equivale a ausência de trabalho.
  const lines = [
    'ARQUEM SISTEMAS  |  CENTRAL DE AUDITORIA',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    title.toUpperCase(),
    `PERÍODO: ${displayDate(from)} a ${displayDate(to)}`,
    '',
    'RESUMO DOS APONTAMENTOS',
    '────────────────────────────────────────',
    `Horas apontadas ............ ${duration(minutes)}`,
    `Apontamentos importados .... ${selected.length}`,
    `Chamados com horas ......... ${worked}`,
    `Dias úteis de referência ... ${days.length}`,
    '',
    scopedManagement?'COLABORADORES: HORAS APONTADAS E JORNADA':'REFERÊNCIAS DE JORNADA',
    '────────────────────────────────────────',
    ...(scopedManagement ? [
      journeyNote,
      ...emailTeam.map(x=>`${safe(x.name)} | ${safe(x.sector)} | ${duration(x.minutes)} apontadas | jornada ${duration(x.targetMinutes)} | mínimo ${duration(x.minimumMinutes)} | ${showJourneyPercent(x.percent)} | faltam ${duration(x.minimumGap)} para o mínimo e ${duration(x.targetGap)} para a jornada | ${x.status}`),
      ...(journey.length>emailTeam.length?[`Mostrando ${emailTeam.length} de ${journey.length} colaboradores. Consulte o Excel, quando disponível, para mais detalhes.`]:[]),
      ...(!journey.length?['Sem apontamentos importados nos setores vinculados.']:[])
    ] : selected.length ? [
      `Meta mínima de referência . ${duration(minimum)}`,
      `Jornada de referência ..... ${duration(target)}`,
      `Diferença para a mínima ... ${duration(Math.max(0, minimum-minutes))}`,
      `Diferença para a jornada .. ${duration(Math.max(0, target-minutes))}`,
      `Tempo acima da jornada .... ${duration(Math.max(0, minutes-target))}`
    ] : [
      'Metas não avaliadas: nenhum apontamento importado neste período.',
      'Isso NÃO comprova ausência de trabalho.'
    ]),
    '',
    person ? 'ATIVIDADES REGISTRADAS (ATÉ 100)' : 'HORAS POR COLABORADOR',
    '────────────────────────────────────────',
    ...(details.length ? details : ['Nenhum registro importado para o período.']),
    '',
    'HORAS POR COLABORADOR E DIA',
    '────────────────────────────────────────',
    ...dailyJourney.slice(0,emailDailyLimit).map(x=>'- '+safe(x.name)+' | '+displayDate(x.day)+' | '+duration(x.minutes)+
      (scopedManagement?' | '+(x.referenceMinutes?duration(x.referenceMinutes)+' de jornada | '+showJourneyPercent(x.percent)+' | ':'')+x.status:'')),
    '',
    'EMPRESAS QUE MAIS CONSUMIRAM TEMPO',
    '────────────────────────────────────────',
    ...companies.map(x=>'- '+safe(x.name)+' | '+duration(x.minutes)+' | '+x.tickets+' chamados'),
    '',
    'INFORMAÇÃO IMPORTANTE',
    '────────────────────────────────────────',
    'Este relatório considera somente apontamentos importados do Movidesk.',
    'A sincronização pode estar incompleta. Não é controle de ponto',
    'nem comprovação definitiva de presença ou produtividade.',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'ARQUEM | Relatório emitido pela Central de Auditoria'
  ];
  if (scope === 'management') lines.push('', 'Horas por setor:', ...[...bySector].map(([s, m]) => `- ${safe(s)}: ${duration(m)}`));
  const byActivity=new Map<string,number>();
  for(const a of selected){
    const name=String(a.activity||'Não informado');
    byActivity.set(name,(byActivity.get(name)||0)+Number(a.duration_minutes||0));
  }
  const exportData={
    collaborators:scopedManagement?journey.slice(0,70).map(x=>({
      name:x.name,sector:x.sector,minutes:x.minutes,minimumMinutes:x.minimumMinutes,targetMinutes:x.targetMinutes,
      minimumGap:x.minimumGap,targetGap:x.targetGap,ruleSource:'Referência do cadastro; não é controle de ponto'
    })):[...byPerson.entries()].sort((a,b)=>b[1]-a[1]).slice(0,70)
      .map(([name,minutes])=>({name,sector:scope==='management'?'Setores selecionados':String(rec.sector||(Array.isArray(rec.sectors)?rec.sectors[0]:'')||''),
        minutes,minimumMinutes:days.length*targetPerDay*minimumPercent/100,
        targetMinutes:days.length*targetPerDay,minimumGap:Math.max(0,days.length*targetPerDay*minimumPercent/100-minutes),
        targetGap:Math.max(0,days.length*targetPerDay-minutes),ruleSource:'Referência padrão; não é controle de ponto'})),
    daily:dailyJourney.slice(0,90).map(x=>({date:x.day,person:x.name,
      sector:scopedManagement?x.sector:
        scope==='management'?'Setores selecionados':String(rec.sector||(Array.isArray(rec.sectors)?rec.sectors[0]:'')||''),
      minutes:x.minutes,referenceMinutes:x.referenceMinutes,minimumMinutes:x.minimumMinutes,
      status:scopedManagement?x.status:'Apontamento importado'})),
    customers:companies.map(x=>({name:x.name,minutes:x.minutes,tickets:x.tickets,appointments:0})),
    activities:[...byActivity].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([name,minutes])=>({name,minutes}))
  };
  return { text: lines.join('\n'), detailsHtml, teamJourneyHtml, teamJourney:journey, exportData,
    metrics: { appointments: selected.length, tickets: worked, minutes, days: days.length } };
}
function reportPacket(rec:R,report:R,tickets:R,from:string,to:string,kind:ReportKind,partial:boolean,historicalIncomplete:boolean,clients:R[],forecastRows:unknown[]=[]):R {
 const data=report.exportData as R;
 const clientNames=new Map(clients.map(x=>[String(x.ticket_id),String(x.client_name||'')]));
 return {
   schema:'arquem-mail-v1',
   title:(kind==='monthly'||kind==='annual'?'Balancete ':'Relatório ')+REPORT_LABEL[kind].toLowerCase()+' - '+safe(rec.name||rec.sector||'Gestão'),
   from,to,partial,historicalIncomplete,
   metrics:report.metrics,
   collaborators:data.collaborators||[],daily:data.daily||[],
   customers:data.customers||[],
   tickets:(Array.isArray(tickets.attachmentTickets)?tickets.attachmentTickets:[])
     .map(x=>({...x,client:clientNames.get(String(x.id))||'Não identificado'})),
   activities:data.activities||[],forecastVariances:forecastRows
 };
}
async function sendMail(email: string, subject: string, text: string, html?: string, reportData?:R) {
  if (!isEmail(email)) throw new Error('Endereco de e-mail invalido');
  if (!E('GMAIL_MAIL_SECRET')) throw new Error('GMAIL_MAIL_SECRET nao configurado');
  const withAttachments=E('REPORT_ATTACHMENTS_ENABLED')==='true' && !!reportData;
  const endpoint=validUrl();
  if(withAttachments) {
    // Exigir gerador validado e modelo timbrado antes de tentar um envio com anexos.
    const cap=await fetch(endpoint,{
      method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({token:E('GMAIL_MAIL_SECRET'),action:'capabilities'}),
      signal:AbortSignal.timeout(12000)
    });
    if(!cap.ok)throw new Error('Verificação de anexos indisponível (HTTP '+cap.status+')');
    const capabilities=await cap.json().catch(()=>null) as R|null;
    if(capabilities?.sucesso!==true || !Array.isArray(capabilities.formats) ||
       !capabilities.formats.includes('pdf') || !capabilities.formats.includes('xlsx') ||
       capabilities.paperTemplateConfigured!==true)
      throw new Error('PDF/XLSX ainda não validados no Apps Script com papel timbrado');
  }
  const res = await fetch(endpoint, {
    method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: E('GMAIL_MAIL_SECRET'), email, assunto: subject,
      texto: text, html: html || undefined,
      ...(withAttachments?{reportData}:{}) }),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error(`Apps Script HTTP ${res.status}`);
  let result: R;
  try { result = await res.json(); } catch { throw new Error('Apps Script nao retornou JSON'); }
  if (result.sucesso !== true) throw new Error('Apps Script recusou mensagem: ' + safe(result.erro));
  // Caso o provedor aceite a mensagem mas não retorne anexos, registrar a
  // divergência para auditoria. Não tentar reenviar automaticamente.
  if(withAttachments && Number(result.anexos)!==2)
    throw new Error('Entrega de PDF/XLSX não confirmada pelo Apps Script. Verificar Gmail antes de qualquer reenvio.');
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
  if (action === 'attachment_health') {
    // Consulta autenticada ao Apps Script, sem e-mail e sem anexos gerados.
    // Não expor URL privada ou segredos no retorno administrativo.
    const flag=E('REPORT_ATTACHMENTS_ENABLED')==='true';
    if (!E('GMAIL_WEBAPP_URL') || !E('GMAIL_MAIL_SECRET'))
      return json({ok:true,enabled:flag,ready:false,
        status:'Integração Gmail incompleta no servidor; verificar configurações.'});
    try {
      const response=await fetch(validUrl(),{
        method:'POST',redirect:'follow',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({token:E('GMAIL_MAIL_SECRET'),action:'capabilities'}),
        signal:AbortSignal.timeout(12000)
      });
      if(!response.ok)return json({ok:true,enabled:flag,ready:false,
        status:'Apps Script indisponível para verificação (HTTP '+response.status+').'});
      const capabilities=await response.json().catch(()=>null) as R|null;
      const formats=Array.isArray(capabilities?.formats)?capabilities.formats:[];
      const ready=capabilities?.sucesso===true &&
        formats.includes('pdf') && formats.includes('xlsx') &&
        capabilities.paperTemplateConfigured===true;
      return json({ok:true,enabled:flag,ready,
        templateConfigured:capabilities?.paperTemplateConfigured===true,
        formats:formats.filter(x=>x==='pdf'||x==='xlsx'),
        status:ready?(flag?'PDF/XLSX habilitados; validar entrega real em teste autorizado.':
          'Gerador e timbrado anunciados pelo Apps Script; falta autorizar a ativação.'):
          'Apps Script não confirmou PDF, Excel e papel timbrado configurado.'});
    }catch(ex){
      return json({ok:true,enabled:flag,ready:false,
        status:'Falha na verificação do Apps Script: '+safe(err(ex))});
    }
  }
  if (action === 'dispatch_health') {
    // Monitor administrativo de leitura: nenhuma reserva de envio ou disparo.
    const [history, incremental, recentSync, logs, recipients] = await Promise.all([
      state(),
      db('audit_incremental_state?job_name=eq.movidesk_incremental&select=last_success_at,last_error,window_end&limit=1'),
      db('audit_recent_reconcile_state?job_name=eq.movidesk_recent_reconcile&select=completed,last_success_at,last_error,period_start,period_end,next_offset&limit=1'),
      db('audit_email_sector_dispatches?select=recipient_id,report_kind,period_from,period_to,status,created_at,sent_at,error_message&order=created_at.desc&limit=100'),
      db('audit_email_recipients?select=id,name&limit=200')
    ]);
    const now = Date.now();
    const ageMinutes = (value: unknown): number | null => {
      const parsed = Date.parse(String(value || ''));
      return Number.isFinite(parsed) ? Math.max(0, Math.round((now - parsed) / 60000)) : null;
    };
    const names = new Map<string,string>((recipients as R[]).map(x => [String(x.id), safe(x.name)]));
    const records = (logs as R[]).map(x => {
      const elapsed = ageMinutes(x.created_at);
      return {
        recipient: names.get(String(x.recipient_id)) || 'Destinatário não identificado',
        from: String(x.period_from || ''),
        to: String(x.period_to || ''),
        kind: String(x.report_kind || ''),
        status: String(x.status || ''),
        sentAt: x.sent_at || null,
        stalled: x.status === 'processing' && elapsed !== null && elapsed > 30,
        error: safe(x.error_message || '')
      };
    });
    const incr = (incremental as R[])[0] || {};
    const rec = (recentSync as R[])[0] || {};
    const incrementalAge = ageMinutes(incr.last_success_at);
    const recentAge = ageMinutes(rec.last_success_at);
    return json({
      ok: true, release: RELEASE_ID, checkedAt: new Date(now).toISOString(),
      summary: {
        sent: records.filter(x => x.status === 'sent').length,
        failed: records.filter(x => x.status === 'failed').length,
        processing: records.filter(x => x.status === 'processing').length,
        staleProcessing: records.filter(x => x.stalled).length
      },
      recent: records,
      historical: {
        completed: history.completed === true,
        nextOffset: history.next_offset,
        updatedAt: history.updated_at,
        error: safe(history.last_error || '')
      },
      sync: {
        incremental: {
          lastSuccess: incr.last_success_at || null,
          ageMinutes: incrementalAge,
          fresh: incrementalAge !== null && incrementalAge <= 30 && !incr.last_error,
          error: safe(incr.last_error || '')
        },
        reconciliation: {
          completed: rec.completed === true,
          lastSuccess: rec.last_success_at || null,
          ageMinutes: recentAge,
          fresh: rec.completed === true && recentAge !== null && recentAge <= 720 && !rec.last_error,
          periodFrom: rec.period_start || null,
          periodTo: rec.period_end || null,
          error: safe(rec.last_error || '')
        }
      },
      attachmentIntegration: {
        enabled: false,
        status: 'Confirmação automática de anexos ainda não implementada; verificar teste no Apps Script.'
      },
      note: 'Envio aceito pelo provedor não comprova entrega na caixa postal. Monitor somente leitura.'
    });
  }
  if (action === 'directory') {
    // Consulta administrativa. A ultima data importada nao prova atividade nem ausencia de trabalho.
    const [rows,checkpoint,incremental,recent] = await Promise.all([
      list('audit_direct_appointments', '?select=sector,collaborator_name,appointment_date,source_synced_at'),
      state(),
      db('audit_incremental_state?job_name=eq.movidesk_incremental&select=window_end,next_offset,last_success_at,last_error&limit=1'),
      db('audit_recent_reconcile_state?job_name=eq.movidesk_recent_reconcile&select=period_start,period_end,next_offset,completed,last_success_at,last_error&limit=1')
    ]);
    const groups = new Map<string, Set<string>>();
    const coverage = new Map<string,{sector:string;collaborator:string;lastAppointment:string;lastImport:string;count:number}>();
    for (const row of rows) {
      const sector = String(row.sector || '').trim();
      const person = String(row.collaborator_name || '').trim();
      if (!sector) continue;
      if (!groups.has(sector)) groups.set(sector, new Set());
      if (person) groups.get(sector)!.add(person);
      if (!person) continue;
      const key = sector+'\u0000'+person;
      const previous=coverage.get(key)||{sector,collaborator:person,lastAppointment:'',lastImport:'',count:0};
      const date=String(row.appointment_date||'').slice(0,10);
      const synced=String(row.source_synced_at||'');
      if (date>previous.lastAppointment)previous.lastAppointment=date;
      if (synced>previous.lastImport)previous.lastImport=synced;
      previous.count++;
      coverage.set(key,previous);
    }
    const sectors = [...groups].map(([sector,names]) => ({
      sector, collaborators:[...names].sort((a,b) => a.localeCompare(b,'pt-BR'))
    })).sort((a,b) => a.sector.localeCompare(b.sector,'pt-BR'));
    const people=[...coverage.values()].sort((a,b)=>a.sector.localeCompare(b.sector,'pt-BR')||a.collaborator.localeCompare(b.collaborator,'pt-BR'));
    return json({ok:true,release:RELEASE_ID,source:'audit_direct_appointments',sectors,
      totalSectors:sectors.length,
      totalCollaborators:new Set(sectors.flatMap(s=>s.collaborators)).size,
      coverage:people,
      sync:{historyComplete:checkpoint.completed===true,historicalOffset:checkpoint.next_offset,
        historicalUpdatedAt:checkpoint.updated_at,incrementalWindowEnd:incremental?.[0]?.window_end||null,
        incrementalUpdatedAt:incremental?.[0]?.last_success_at||null,
        incrementalError:incremental?.[0]?.last_error||null,
        recent:recent?.[0]||null}});
  }
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
// Não declarar completos resultados recentes enquanto a conciliação pela data do apontamento estiver em andamento.
async function recentCoverage(from:string,to:string) {
  const rows = await db('audit_recent_reconcile_state?job_name=eq.movidesk_recent_reconcile&select=period_start,period_end,completed,next_offset,last_success_at,last_error&limit=1');
  if (!rows?.length) throw new Error('Checkpoint da conciliacao diaria ausente');
  const s=rows[0] as R;
  // Não considerar pronto um período fora da janela: é justamente o erro
  // que deixava passar dados antigos sem conciliação.
  const covered=from>=String(s.period_start) && to<String(s.period_end);
  const lastSuccessMs=Date.parse(String(s.last_success_at||''));
  const ageMinutes=Number.isFinite(lastSuccessMs)
    ? Math.max(0,Math.round((Date.now()-lastSuccessMs)/60000)) : null;
  // A conciliacao reabre a cada 6 horas; tolerar ate 12 horas antes de
  // considerar o snapshot velho e impedir um relatorio oficial incorreto.
  const fresh=ageMinutes!==null && ageMinutes<=720;
  const ready=covered && s.completed===true && !s.last_error && fresh;
  return {ready,covered,fresh,ageMinutes,maxAgeMinutes:720,
    from:s.period_start,to:s.period_end,offset:s.next_offset,
    completed:s.completed,lastSuccess:s.last_success_at,lastError:s.last_error};
}
async function manualOfficial(payload: R) {
  const id = String(payload.recipientId || '');
  const kind = String(payload.kind || 'daily');
  const previewOnly = payload.previewOnly === true;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return json({ error: 'recipientId invalido' }, 400);
  if (kind !== 'daily' && kind !== 'weekly') return json({ error: 'Tipo de relatorio invalido' }, 400);
  const recipients = await db(`audit_email_recipients?id=eq.${encodeURIComponent(id)}&active=eq.true&select=*&limit=1`);
  if (!recipients.length) return json({ error: 'Destinatario nao cadastrado ou inativo' }, 404);
  const rec = recipients[0] as R;
  // Testes manuais somente para destinatarios ativos cadastrados e dominios corporativos.
  // Selecao individual explicita por admin; nao ha disparo em massa.
  const target = String(rec.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@arquem\.com\.br$/.test(target))
    return json({ error: 'Teste manual permitido somente para e-mails corporativos @arquem.com.br' }, 403);
  if (!previewOnly && (rec.scope !== 'sector' || !String(rec.collaborator_name || '').trim()))
    return json({ error: 'Teste manual exige um colaborador individual vinculado ao cadastro' }, 403);
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
    // A data de referencia e a data do ENVIO: usar a semana anterior ja encerrada.
    const thisMonday = shift(referenceDate, -((day + 6) % 7));
    from = shift(thisMonday, -7);
    to = shift(thisMonday, -1);
  } else {
    while ([0, 6].includes(weekday(from)) || hol.has(from)) from = shift(from, -1);
    to = from;
  }
  // Teste manual autorizado: nao depende da conclusao da conciliacao historica/recente.
  // Chave exclusiva por tentativa para permitir repetir testes no mesmo periodo.
  const checkpoint = await state();
  const coverage = await recentCoverage(from,to);
  const key = `manual-test:${id}:${kind}:${from}:${to}:${crypto.randomUUID()}`;
  const [appts,clients] = await Promise.all([source(from,to),clientSource()]);
  // Piloto manual autorizado: admin JWT + endereco fixo + confirmacao de UI.
  // A permissao coletiva global permanece exigida pelo Cron automatico.
  const report = buildReport(rec, appts, from, to, kind, hol, true, clients);
  const tickets = ticketAlerts(rec, await ticketSource());
  const quality = await supportRatingCache()(rec, from, to);
  const overview = await directionOverviewCache()(rec, from, to, tickets.activeTickets,kind);
  const forecast=await optionalForecast(rec);
  // Mesmo com zero apontamentos, o teste manual verifica o envio e informa a ausencia no corpo.
  const partial = !checkpoint.completed || !coverage.ready;
  const empty = !report.metrics.appointments;
  // Prévia de auditoria não cria disparos, não acessa o Gmail e não muda agendamentos.
  if (previewOnly) return json({ok:true,preview:true,release:RELEASE_ID,
    recipient:target,kind,from,to,partial,empty,
    metrics:report.metrics,ticketMetrics:tickets.metrics,superadores:quality.metric,teamJourney:report.teamJourney,
    directionOverview:overview.metrics,forecastPreview:forecast.rows,
    // Até cinco exemplos por categoria para conferência sem expor todos os dados.
    ticketPreview:tickets.preview
  });
  const subject = '[TESTE MANUAL] Central de Auditoria - Relatorio '+(kind === 'weekly' ? 'semanal' : 'diario')+
    (partial?' [DADOS PARCIAIS]':'')+(empty?' [SEM APONTAMENTOS]':'')+' - '+from;
  const body = '[TESTE MANUAL DE ENVIO]'+
    '\nEste e-mail verifica o recebimento e não é um relatório definitivo.'+
    (partial?'\nATENÇÃO: sincronização incompleta; indicadores parciais.':'')+
    (empty?'\nSEM APONTAMENTOS IMPORTADOS: não é possível concluir ausência de trabalho.':'')+
    '\nDestinatário: '+safe(rec.email)+'\n\n'+report.text+overview.text+quality.text+'\n\n'+tickets.text+forecast.text;
  const inserted = await db('audit_email_sector_dispatches?on_conflict=dispatch_key', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({dispatch_key:key,recipient_id:id,report_kind:kind,period_from:from,period_to:to,status:'processing'})
  });
  if (!inserted?.length) return json({ ok: true, skipped: 'Relatorio ja reservado para envio' });
  try {
    await sendMail(String(rec.email),subject,body,reportEmailHtml(rec,report,from,to,kind,partial,true,tickets.html,report.detailsHtml+quality.html,overview.html,forecast.html),
      reportPacket(rec,report,tickets,from,to,kind,partial,checkpoint.completed!==true,clients,forecast.rows));
    await db(`audit_email_sector_dispatches?dispatch_key=eq.${encodeURIComponent(key)}`,{
      method:'PATCH',body:JSON.stringify({status:'sent',sent_at:new Date().toISOString(),provider_id:'gmail-apps-script'})
    });
    return json({ok:true,status:'sent',manualTest:true,release: RELEASE_ID,recipient:String(rec.email),kind,from,to,partial,empty,metrics:report.metrics,
      message:'Apps Script aceitou a mensagem; confira a entrega na caixa de entrada.'});
  } catch(ex) {
    await db(`audit_email_sector_dispatches?dispatch_key=eq.${encodeURIComponent(key)}`,{
      method:'PATCH',body:JSON.stringify({status:'failed',error_message:err(ex).slice(0,300)})
    }).catch(()=>{});
    return json({ok:false,error:err(ex),status:'failed',recipient:String(rec.email)},502);
  }
}

// Disparo avulso explicitamente autorizado: balancete semanal PRELIMINAR.
// Não substitui nem marca como enviado o relatório oficial agendado.
async function dispatchWeeklyPreliminary() {
  const today=dateBR();
  // Restrito à semana de 02/11 a 08/11/2026: nunca se repete automaticamente.
  if(today !== '2026-11-09') return json({ok:false,error:'A autorização avulsa vale somente para 09/11/2026'},409);
  const from='2026-11-02',to='2026-11-08';
  const hol=await holidays();
  if(!hol.has('2026-11-02')) return json({ok:false,error:'Feriado de Finados não cadastrado: corrigir antes do envio'},409);
  const coverage=await recentCoverage(from,to);
  const recipients=(await recipientList()).filter(r=>r.weekly_enabled===true);
  if(!recipients.length) return json({ok:false,error:'Sem destinatários semanais ativos'},409);
  const [appts,allTickets,clients]=await Promise.all([source(from,to),ticketSource(),clientSource()]);
  const getQuality = supportRatingCache();
  const getOverview = directionOverviewCache();
  const results:R[]=[];
  for(const r of recipients){
    const id=String(r.id);
    const key='preliminary-authorized-20261109:'+id+':weekly:'+from+':'+to;
    try{
      const exists=await db('audit_email_sector_dispatches?dispatch_key=eq.'+encodeURIComponent(key)+'&select=dispatch_key,status&limit=1');
      if(exists.length){results.push({recipientId:id,status:'skipped',reason:'Envio preliminar já registrado'});continue;}
      const report=buildReport(r,appts,from,to,'weekly',hol,false,clients);
      const alerts=ticketAlerts(r,allTickets);
      const quality = await getQuality(r, from, to);
      const overview = await getOverview(r, from, to, alerts.activeTickets);
      const empty=!report.metrics.appointments;
      const subject='[BALANCETE PRELIMINAR - DADOS PARCIAIS] Central de Auditoria - Semana 02 a 08/11/2026'+(empty?' [SEM APONTAMENTOS]':'');
      const disclaimer='BALANCETE SEMANAL PRELIMINAR — 02 A 08/11/2026\n'+
        'SINCRONIZAÇÃO DO MOVIDESK AINDA EM ANDAMENTO. NÃO É FECHAMENTO DEFINITIVO.\n'+
        '02/11: FINADOS (FERIADO). DIAS ÚTEIS: 03, 04, 05 E 06/11.\n'+
        'HORAS E DIFERENÇAS PARA METAS PODEM MUDAR APÓS A CONCILIAÇÃO.\n'+
        'NÃO USAR ESTE DOCUMENTO PARA AVALIAÇÃO DEFINITIVA DE JORNADA OU PRODUTIVIDADE.\n\n';
      const html=reportEmailHtml(r,report,from,to,'weekly',true,true,alerts.html,report.detailsHtml+quality.html,overview.html);
      const inserted=await db('audit_email_sector_dispatches?on_conflict=dispatch_key',{
        method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
        body:JSON.stringify({dispatch_key:key,recipient_id:id,report_kind:'weekly',
          period_from:from,period_to:to,status:'processing'})
      });
      if(!inserted?.length){results.push({recipientId:id,status:'skipped',reason:'Outra execução reservou o envio'});continue;}
      try{
        await sendMail(String(r.email),subject,disclaimer+report.text+overview.text+quality.text+'\n\n'+alerts.text,html,
          reportPacket(r,report,alerts,from,to,'weekly',true,true,clients));
        await db('audit_email_sector_dispatches?dispatch_key=eq.'+encodeURIComponent(key),{
          method:'PATCH',body:JSON.stringify({status:'sent',sent_at:new Date().toISOString(),provider_id:'gmail-apps-script'})
        });
        results.push({recipientId:id,status:'sent',email:String(r.email),appointments:report.metrics.appointments,
          minutes:report.metrics.minutes,tickets:alerts.metrics});
      }catch(ex){
        await db('audit_email_sector_dispatches?dispatch_key=eq.'+encodeURIComponent(key),{
          method:'PATCH',body:JSON.stringify({status:'failed',error_message:err(ex).slice(0,300)})
        }).catch(()=>{});
        results.push({recipientId:id,status:'failed',error:err(ex)});
      }
    }catch(ex){results.push({recipientId:id,status:'failed',error:err(ex)});}
  }
  return json({ok:!results.some(x=>x.status==='failed'),preliminary:true,period:{from,to},
    coverageComplete:coverage.ready,results});
}
function scheduledReports(today:string, hol:Set<string>, recipients:R[]):ScheduledReport[] {
  const dow = weekday(today);
  const businessDay = ![0,6].includes(dow) && !hol.has(today);
  let prev = shift(today, -1);
  while ([0, 6].includes(weekday(prev)) || hol.has(prev)) prev = shift(prev, -1);
  const thisMonday = shift(today, -((dow + 6) % 7));
  const prevMonday = shift(thisMonday, -7);
  const prevSunday = shift(thisMonday, -1);
  const monthStart = today.slice(0,7)+'-01';
  const prevMonthEnd = shift(monthStart,-1);
  const priorYear = prevMonthEnd.slice(0,4);
  const periodic = monthStart >= FIRST_MONTHLY_RUN;
  const january = today.slice(5,7)==='01';
  const tasks:ScheduledReport[] = [];
  for (const r of recipients) {
    const director = directionRecipient(r);
    if (businessDay && !director && r.daily_enabled===true)
      tasks.push({r,kind:'daily',from:prev,to:prev});
    if ((businessDay || (director && dow===1)) && r.weekly_enabled===true)
      tasks.push({r,kind:'weekly',from:prevMonday,to:prevSunday});
    const linked = (Array.isArray(r.sectors)&&r.sectors.length?r.sectors:[r.sector]).some(x=>norm(x));
    if (!periodic || r.scope!=='management' || !linked) continue;
    if (director && january && r.annual_enabled===true) {
      tasks.push({r,kind:'annual',from:priorYear+'-01-01',to:priorYear+'-12-31',includeDecember:r.monthly_enabled===true});
    } else if (r.monthly_enabled===true) {
      tasks.push({r,kind:'monthly',from:prevMonthEnd.slice(0,7)+'-01',to:prevMonthEnd});
    }
  }
  // Primeiro os fechamentos de período e os relatórios da Direção; nenhuma chave é
  // repetida se o agendamento precisar aguardar a conciliação.
  const order:Record<ReportKind,number>={annual:0,monthly:1,weekly:2,daily:3};
  return tasks.sort((a,b)=>order[a.kind]-order[b.kind]||Number(directionRecipient(b.r))-Number(directionRecipient(a.r)));
}

type ReportTotals = {appointments:number;tickets:number;minutes:number;days:number};
function annualHighlights(task:ScheduledReport, report:ReportTotals, previous:ReportTotals, december:ReportTotals|null, months:{label:string;opened:number;closed:number}[]) {
  const year = task.from.slice(0,4);
  const previousYear = String(Number(year)-1);
  const row = (label:string, totals:ReportTotals, filter:(month:string)=>boolean) => {
    const counts = months.filter(x=>filter(x.label)).reduce((acc,x)=>({opened:acc.opened+x.opened,closed:acc.closed+x.closed}),{opened:0,closed:0});
    return [label,duration(totals.minutes),String(totals.appointments),String(totals.tickets),months.length?String(counts.opened):'—',months.length?String(counts.closed):'—'];
  };
  const rows = [row(year,report,x=>x.endsWith('/'+year)),row(previousYear,previous,x=>x.endsWith('/'+previousYear))];
  if (december) rows.push(row('Dezembro '+year,december,x=>x==='12/'+year));
  const cols=['Período','Horas','Apontamentos','Com horas','Abertos','Encerrados'];
  const note='Comparação de anos fechados, com os registros disponíveis na base. A cobertura histórica pode diferir entre anos; os totais não comprovam variação de produtividade.';
  return {
    text:'\n\nCOMPARATIVO ANUAL\n'+cols.join(' | ')+'\n'+rows.map(x=>x.join(' | ')).join('\n')+'\n'+note,
    html:'<h2 style="font-size:17px;color:#18385e;margin:24px 0 8px">Comparativo anual</h2>'+
      '<table width="100%" cellpadding="6" cellspacing="0" style="font-size:12px;border-collapse:collapse">'+
      '<tr style="background:#edf3fb">'+cols.map(x=>'<th align="left">'+emailEsc(x)+'</th>').join('')+'</tr>'+
      rows.map(x=>'<tr>'+x.map(cell=>'<td>'+emailEsc(cell)+'</td>').join('')+'</tr>').join('')+'</table>'+
      '<p style="font-size:12px;color:#64748b">'+emailEsc(note)+'</p>'
  };
}

// Relatorio preliminar independente da conclusao da conciliacao recente.
// Nunca substitui o envio oficial: usa chave separada e banner inequivoco.
async function dispatchPreliminary(t:ScheduledReport,hol:Set<string>,clientsAndTickets:()=>Promise<[R[],R[]]>) {
  if (E('REPORT_PRELIMINARY_SEND_ENABLED')!=='true' || !['daily','weekly'].includes(t.kind))
    return {recipientId:String(t.r.id),kind:t.kind,skipped:'Aguardando conciliação do período'};
  const id=String(t.r.id);
  const key='preliminary:'+id+':'+t.kind+':'+t.from+':'+t.to;
  const existing=await db('audit_email_sector_dispatches?dispatch_key=eq.'+encodeURIComponent(key)+'&select=dispatch_key,status&limit=1');
  if(existing.length)return {recipientId:id,kind:t.kind,skipped:'Preliminar ja registrado'};
  const [allTickets,clients]=await clientsAndTickets();
  const appts=await source(t.from,t.to);
  const report=buildReport(t.r,appts,t.from,t.to,t.kind,hol,false,clients);
  const alerts=ticketAlerts(t.r,allTickets);
  const quality=await supportRatingCache()(t.r,t.from,t.to);
  const overview=await directionOverviewCache()(t.r,t.from,t.to,alerts.activeTickets,t.kind);
  const inserted=await db('audit_email_sector_dispatches?on_conflict=dispatch_key',{
    method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
    body:JSON.stringify({dispatch_key:key,recipient_id:id,report_kind:t.kind,
      period_from:t.from,period_to:t.to,status:'processing'})
  });
  if(!inserted?.length)return {recipientId:id,kind:t.kind,skipped:'Preliminar reservado por outra execução'};
  try{
    const notice='RELATORIO PRELIMINAR - CONCILIACAO MOVIDESK EM ANDAMENTO. Os totais ainda podem mudar. Este documento NAO substitui o fechamento oficial.\\n\\n';
    await sendMail(String(t.r.email),'[PRELIMINAR - DADOS PARCIAIS] Central de Auditoria - '+REPORT_LABEL[t.kind]+' - '+t.from,
      notice+report.text+overview.text+quality.text+'\\n\\n'+alerts.text,
      reportEmailHtml(t.r,report,t.from,t.to,t.kind,true,true,alerts.html,report.detailsHtml+quality.html,overview.html),
      reportPacket(t.r,report,alerts,t.from,t.to,t.kind,true,true,clients));
    await db('audit_email_sector_dispatches?dispatch_key=eq.'+encodeURIComponent(key),{
      method:'PATCH',body:JSON.stringify({status:'sent',sent_at:new Date().toISOString(),provider_id:'gmail-apps-script'})
    });
    return {recipientId:id,kind:t.kind,status:'sent_preliminary',appointments:report.metrics.appointments};
  }catch(ex){
    // Uma mensagem pode ter sido aceita pelo provedor antes da falha no checkpoint.
    // Bloquear nova tentativa automatica evita envio duplicado sem reconciliar o provedor.
    await db('audit_email_sector_dispatches?dispatch_key=eq.'+encodeURIComponent(key),{
      method:'PATCH',body:JSON.stringify({status:'failed',error_message:err(ex).slice(0,300)})
    }).catch(()=>{});
    return {recipientId:id,kind:t.kind,status:'failed',error:err(ex)};
  }
}
// Preparar o email oficial sem enviar mensagens. Cache privado e descartavel.
async function prepareReports() {
  const today=dateBR();
  const [hol, recipients]=await Promise.all([holidays(),recipientList()]);
  const tasks=scheduledReports(today,hol,recipients).filter(t=>t.kind==='daily'||t.kind==='weekly');
  const getQuality=supportRatingCache(),getOverview=directionOverviewCache();
  const periodData=new Map<string,Promise<R[]>>();
  let reference:Promise<[R[],R[]]>|undefined;
  const results:R[]=[];
  for(const t of tasks){
    const key=String(t.r.id)+':'+t.kind+':'+t.from+':'+t.to;
    const previouslySent=await db('audit_email_sector_dispatches?dispatch_key=eq.'+encodeURIComponent(key)+'&select=status&limit=1');
    if(previouslySent.length){results.push({key,skipped:'Envio ja registrado'});continue;}
    const coverage=await recentCoverage(t.from,t.to);
    if(!coverage.ready){results.push({key,skipped:'Conciliação recente incompleta'});continue;}
    const checkpoint=await state();
    if(checkpoint.completed!==true||checkpoint.last_error){
      results.push({key,skipped:'Historico incompleto'});continue;
    }
    // Cada tentativa prepara no maximo 2 destinatarios, para nao ultrapassar
    // os limites de execucao das Edge Functions em janelas concorridas.
    const existing=await db('audit_email_prepared_reports?dispatch_key=eq.'+encodeURIComponent(key)+
      '&select=dispatch_key,reconciliation_success_at,expires_at,report_data&limit=1');
    if(existing.length && Date.parse(String(existing[0].reconciliation_success_at))===Date.parse(String(coverage.lastSuccess)) &&
      Date.parse(String(existing[0].expires_at))>Date.now()+5*60000 &&
      Array.isArray(existing[0].report_data?.forecastVariances)){
      results.push({key,skipped:'Conteudo ja preparado'});continue;
    }
    if(results.filter(x=>x.status==='prepared').length>=2)break;
    let appts=periodData.get(t.from+':'+t.to);
    if(!appts){appts=source(t.from,t.to);periodData.set(t.from+':'+t.to,appts);}
    reference ??= Promise.all([ticketSource(),clientSource()]);
    const [allTickets,clients]=await reference;
    const report=buildReport(t.r,await appts,t.from,t.to,t.kind,hol,false,clients);
    if(!report.metrics.appointments){
      results.push({key,skipped:'Nenhum apontamento importado'});continue;
    }
    const tickets=ticketAlerts(t.r,allTickets);
    const quality=await getQuality(t.r,t.from,t.to);
    const overview=await getOverview(t.r,t.from,t.to,tickets.activeTickets,t.kind);
    const forecast=await optionalForecast(t.r);
    const packet=reportPacket(t.r,report,tickets,t.from,t.to,t.kind,false,false,clients,forecast.rows);
    const subject='Central de Auditoria - '+REPORT_LABEL[t.kind]+' - '+t.from;
    const bodyText=report.text+overview.text+quality.text+'\n\n'+tickets.text+forecast.text;
    const bodyHtml=reportEmailHtml(t.r,report,t.from,t.to,t.kind,false,false,
      tickets.html,report.detailsHtml+quality.html,overview.html,forecast.html);
    // O cache expira antes do dia seguinte. A rotina de envio valida a cobertura novamente.
    const expires=new Date(Date.now()+90*60000).toISOString();
    await db('audit_email_prepared_reports?on_conflict=dispatch_key',{
      method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},
      body:JSON.stringify({dispatch_key:key,recipient_id:t.r.id,report_kind:t.kind,
        period_from:t.from,period_to:t.to,subject,body_text:bodyText,body_html:bodyHtml,
        report_data:packet,reconciliation_success_at:coverage.lastSuccess,
        prepared_at:new Date().toISOString(),expires_at:expires,status:'ready'})
    });
    results.push({key,status:'prepared',appointments:report.metrics.appointments,minutes:report.metrics.minutes});
  }
  return json({ok:true,mode:'prepare_only',date:today,prepared:results.filter(x=>x.status==='prepared').length,
    pending:results.filter(x=>x.skipped).length,results});
}
async function cachedReport(t:ScheduledReport) {
  if(t.kind!=='daily'&&t.kind!=='weekly')return null;
  const key=String(t.r.id)+':'+t.kind+':'+t.from+':'+t.to;
  const rows=await db('audit_email_prepared_reports?dispatch_key=eq.'+encodeURIComponent(key)+
    '&status=eq.ready&select=subject,body_text,body_html,report_data,reconciliation_success_at,expires_at&limit=1');
  if(!rows.length||Date.parse(String(rows[0].expires_at))<=Date.now()||
    !Array.isArray(rows[0].report_data?.forecastVariances))return null;
  const coverage=await recentCoverage(t.from,t.to);
  if(!coverage.ready||Date.parse(String(coverage.lastSuccess))!==Date.parse(String(rows[0].reconciliation_success_at)))return null;
  return rows[0] as R;
}
async function dispatch() {
  if (E('REPORT_EMAIL_SEND_ENABLED') !== 'true') return json({ ok: true, skipped: 'Envio automatico desativado' });
  const today = dateBR();
  const [hol, recipients] = await Promise.all([holidays(),recipientList()]);
  const tasks = scheduledReports(today,hol,recipients);
  if (!tasks.length) return json({ ok: true, skipped: 'Sem relatorios programados' });
  const periods = new Map<string,Promise<R[]|null>>();
  let history:ReturnType<typeof state>|undefined;
  let referenceData:Promise<[R[],R[]]>|undefined;
  const readPeriod = (t:ScheduledReport) => {
    const key = t.kind+':'+t.from+':'+t.to;
    let pending = periods.get(key);
    if (!pending) {
      pending = (async () => {
        const closing = t.kind==='monthly'||t.kind==='annual';
        // Períodos longos usam o histórico e exigem conciliação recente do
        // trecho final, que é o trecho ainda sujeito a importações de fechamento.
        const tail = shift(t.to,-6);
        const coverage = await recentCoverage(closing&&tail>t.from?tail:t.from,t.to);
        if (!coverage.ready) return null;
        if (closing) {
          history ??= state();
          const checkpoint = await history;
          if (checkpoint.completed!==true || checkpoint.last_error) return null;
        }
        return source(t.from,t.to,t.kind==='annual'?100000:25000);
      })();
      periods.set(key,pending);
    }
    return pending;
  };
  const getQuality = supportRatingCache();
  const getOverview = directionOverviewCache();
  const results: R[] = [];
  for (const t of tasks) {
    const id = String(t.r.id);
    const key = `${id}:${t.kind}:${t.from}:${t.to}`;
    try {
      const exists = await db(`audit_email_sector_dispatches?dispatch_key=eq.${encodeURIComponent(key)}&select=dispatch_key,status&limit=1`);
      if (exists.length) { results.push({ recipientId: id, kind: t.kind, skipped: 'Ja registrado; revisar status antes de retentar' }); continue; }
      // Conteudo pronto evita recalcular HTML e dados dos anexos as 9h.
      // O snapshot so pode ser usado se a conciliacao ainda estiver valida.
      const prepared=await cachedReport(t);
      if(prepared){
        const inserted=await db('audit_email_sector_dispatches?on_conflict=dispatch_key',{
          method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
          body:JSON.stringify({dispatch_key:key,recipient_id:id,report_kind:t.kind,
            period_from:t.from,period_to:t.to,status:'processing'})
        });
        if(!inserted?.length)continue;
        try{
          await sendMail(String(t.r.email),String(prepared.subject),String(prepared.body_text),
            String(prepared.body_html),prepared.report_data as R);
          await db('audit_email_sector_dispatches?dispatch_key=eq.'+encodeURIComponent(key),{
            method:'PATCH',body:JSON.stringify({status:'sent',sent_at:new Date().toISOString(),
              provider_id:'gmail-apps-script'})
          });
          results.push({recipientId:id,kind:t.kind,status:'sent',source:'prepared_8h'});
        }catch(ex){
          await db('audit_email_sector_dispatches?dispatch_key=eq.'+encodeURIComponent(key),{
            method:'PATCH',body:JSON.stringify({status:'failed',error_message:err(ex).slice(0,300)})
          }).catch(()=>{});
          results.push({recipientId:id,kind:t.kind,status:'failed',error:err(ex)});
        }
        continue;
      }
      const appts = await readPeriod(t);
      if (!appts) {
        referenceData ??= Promise.all([ticketSource(),clientSource()]);
        results.push(await dispatchPreliminary(t,hol,()=>referenceData!));
        continue;
      }
      referenceData ??= Promise.all([ticketSource(),clientSource()]);
      const [allTickets,clients] = await referenceData;
      const report = buildReport(t.r, appts, t.from, t.to, t.kind, hol, false, clients);
      const tickets = ticketAlerts(t.r, allTickets);
      if (!report.metrics.appointments && (t.kind==='daily'||t.kind==='weekly')) { results.push({ recipientId: id, kind: t.kind, skipped: 'Sem apontamentos; envio suspenso' }); continue; }
      const quality = await getQuality(t.r, t.from, t.to);
      const overview = await getOverview(t.r, t.from, t.to, tickets.activeTickets,t.kind);
      const forecast=await optionalForecast(t.r);
      let annual = {text:'',html:''};
      if (t.kind==='annual') {
        const year = t.from.slice(0,4), prior = String(Number(year)-1);
        const previous = buildReport(t.r,await source(prior+'-01-01',prior+'-12-31',100000),prior+'-01-01',prior+'-12-31','annual',hol,false,clients);
        const december = t.includeDecember
          ? buildReport(t.r,appts.filter(x=>String(x.appointment_date).startsWith(year+'-12-')),year+'-12-01',t.to,'monthly',hol,false,clients).metrics
          : null;
        annual = annualHighlights(t,report.metrics,previous.metrics,december,overview.metrics&&'monthly' in overview.metrics?(overview.metrics.monthly||[]):[]);
      }
      const inserted = await db('audit_email_sector_dispatches?on_conflict=dispatch_key', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ dispatch_key: key, recipient_id: id, report_kind: t.kind,
          period_from: t.from, period_to: t.to, status: 'processing' })
      });
      if (!inserted?.length) continue;
      try {
        const label = t.includeDecember?'Anual e fechamento de dezembro':REPORT_LABEL[t.kind];
        await sendMail(String(t.r.email), `Central de Auditoria - ${label} - ${t.from}`, report.text+annual.text+overview.text+quality.text+'\n\n'+tickets.text+forecast.text,
          reportEmailHtml(t.r,report,t.from,t.to,t.kind,false,false,tickets.html,report.detailsHtml+quality.html,annual.html+overview.html,forecast.html),
          reportPacket(t.r,report,tickets,t.from,t.to,t.kind,false,false,clients,forecast.rows));
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
// Prévia executiva semanal: apenas leitura, sem Gmail, sem fila de envio e sem cache de disparos.
// Escopo e formatação baseados nos cadastros e no mesmo relatório corporativo da Direção.
async function directorPreview(payload:R):Promise<Response>{
 const selected=String(payload.date||'');
 const today=dateBR();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(selected)||
   selected>today||selected<shift(today,-370)||
   Number.isNaN(Date.parse(selected+'T12:00:00Z')))
  return json({ok:false,error:'Selecione uma data de referência válida, não futura (até 370 dias).'},400);
 const dow=weekday(selected);
 // O cartão seleciona domingo. Em qualquer outro dia, usar a semana completa anterior.
 const end=dow===0?selected:shift(selected,-dow),start=shift(end,-6);
 const recipients=await recipientList(),rec=recipients.find(directionRecipient);
 if(!rec)return json({ok:false,error:'Destinatário de Direção não cadastrado ou inativo.'},404);
 const sectors=(Array.isArray(rec.sectors)&&rec.sectors.length?rec.sectors:[rec.sector]).map(norm).filter(Boolean);
 if(!sectors.length)return json({ok:false,error:'Direção sem setores autorizados.'},422);
 const [appts,hol,clients]=await Promise.all([source(start,end),holidays(),clientSource()]);
 const report=buildReport(rec,appts,start,end,'weekly',hol,false,clients);
 const scoped=appts.filter(a=>sectors.includes(norm(a.sector)));
 const groups=new Map<string,{sector:string;minutes:number;entries:number;tickets:Set<string>;collaborators:Set<string>}>();
 const people=new Map<string,{sector:string;collaborator:string;minutes:number;entries:number;tickets:Set<string>}>();
 const dates=new Map<string,{date:string;minutes:number;entries:number;tickets:Set<string>}>();
 for(const a of scoped){
  const sector=String(a.sector||'Sem setor'),person=String(a.collaborator_name||'Sem colaborador');
  const id=String(a.ticket_id||''),minutes=Math.max(0,Number(a.duration_minutes)||0);
  const group=groups.get(sector)||{sector,minutes:0,entries:0,tickets:new Set<string>(),collaborators:new Set<string>()};
  group.minutes+=minutes;group.entries++;group.tickets.add(id);group.collaborators.add(person);groups.set(sector,group);
  const pk=sector+'|'+person,prow=people.get(pk)||{sector,collaborator:person,minutes:0,entries:0,tickets:new Set<string>()};
  prow.minutes+=minutes;prow.entries++;prow.tickets.add(id);people.set(pk,prow);
  const date=String(a.appointment_date||''),d=dates.get(date)||{date,minutes:0,entries:0,tickets:new Set<string>()};
  d.minutes+=minutes;d.entries++;d.tickets.add(id);dates.set(date,d);
 }
 const sectorRows=[...groups.values()].map(x=>({sector:x.sector,minutes:x.minutes,entries:x.entries,
  tickets:x.tickets.size,collaborators:x.collaborators.size})).sort((a,b)=>b.minutes-a.minutes);
 const collaboratorRows=[...people.values()].map(x=>({sector:x.sector,collaborator:x.collaborator,minutes:x.minutes,
  entries:x.entries,tickets:x.tickets.size})).sort((a,b)=>b.minutes-a.minutes);
 const dailyRows=[...dates.values()].map(x=>({date:x.date,minutes:x.minutes,entries:x.entries,tickets:x.tickets.size})).sort((a,b)=>a.date.localeCompare(b.date));
 // Pendências são o estado presente no Movidesk: não confundir com horas da semana.
 const tickets=ticketAlerts(rec,await ticketSource());
 const forecast=await optionalForecast(rec);
 const html=reportEmailHtml(rec,report,start,end,'weekly',false,false,tickets.html,
   report.detailsHtml,'',forecast.html);
 const covered=await recentCoverage(start,end).catch(()=>({ready:false}));
 return json({
  ok:true,preview:true,start,end,generatedAt:new Date().toISOString(),partial:covered.ready!==true,
  metrics:{...report.metrics,sectors:sectorRows.length,collaborators:new Set(scoped.map(a=>String(a.collaborator_name||'')).filter(Boolean)).size},
  ticketMetrics:tickets.metrics,sectorRows,collaboratorRows,dailyRows,
  alerts:{overdue:tickets.preview.overdue,stalled:tickets.preview.stalled},
  impact:{customersByHours:report.exportData?.customers||[],activities:report.exportData?.activities||[]},
  forecastVariances:forecast.rows,emailHtml:html
 });
}
async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Apenas POST' }, 405);
  let payload: R = {};
  try { payload = await req.json(); } catch { return json({ error: 'JSON invalido' }, 400); }
  try {
    const action = String(payload.action || '');
    if (action === 'director_preview' || action === 'status' || action === 'test' || action === 'directory' || action === 'manual_official' || action === 'preview_audit' || action === 'dispatch_health' || action === 'attachment_health' || action === 'support_quality_metrics') {
      if (!await isAdmin(req)) return json({ error: 'Acesso reservado ao administrador autenticado' }, 403);
      return action === 'director_preview' ? await directorPreview(payload)
        : action === 'manual_official' ? await manualOfficial(payload)
        : action === 'preview_audit' ? await manualOfficial({...payload,previewOnly:true})
        : action === 'support_quality_metrics' ? await supportQualityMetrics(payload)
        : await adminAction(payload);
    }
    if (action !== 'dispatch' && action !== 'dispatch_weekly_preliminary' && action !== 'prepare' && action !== 'attachment_probe') return json({ error: 'Acao desconhecida' }, 400);
    const expected = E('REPORT_CRON_SECRET');
    if (!expected || req.headers.get('x-report-secret') !== expected) return json({ error: 'Cron nao autorizado' }, 401);
    return action === 'attachment_probe' ? await adminAction({action:'attachment_health'}) : action === 'prepare' ? await prepareReports() : action === 'dispatch_weekly_preliminary' ? await dispatchWeeklyPreliminary() : await dispatch();
  } catch (ex) { console.error('audit-email-dispatch:', err(ex)); return json({ ok: false, error: err(ex), release: RELEASE_ID }, 500); }
}

Deno.serve(async (req: Request) => {
  // A preflight do browser deve responder antes da leitura do corpo e do JWT.
  if (req.method === 'OPTIONS') return withCors(req, new Response(null, { status: 204 }));
  return withCors(req, await handleRequest(req));
});
