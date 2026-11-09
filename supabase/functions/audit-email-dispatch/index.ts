// Central de Auditoria — Supabase direto -> Google Apps Script/Gmail
// Compatível com as ações existentes: status e test (admin JWT).
// NUNCA colocar credenciais no HTML. Nenhum disparo automático sem flags explícitas.
type R = Record<string, unknown>;
const E = (k: string) => Deno.env.get(k)?.trim() || '';
const TZ = 'America/Sao_Paulo';
const RELEASE_ID = 'email-support-details-20261109-v25';
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
  const limited=20;
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
    'Um mesmo chamado pode aparecer nas duas categorias. A lista mostra os 20 primeiros de cada.',
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
  return {text:lines.join('\n'),html,
    metrics:{open:active.length,overdue:overdue.length,stalled:stalled.length,withoutSla},
    preview:{overdue:overdue.slice(0,5).map(a=>({id:a.id,subject:a.subject,owner:a.owner,sector:a.sector,sla:a.sla,url:a.url})),
      stalled:stalled.slice(0,5).map(a=>({id:a.id,subject:a.subject,owner:a.owner,sector:a.sector,days:a.ageDays,url:a.url}))}
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
function reportEmailHtml(rec:R,report:{text:string;metrics:{appointments:number;tickets:number;minutes:number;days:number}},from:string,to:string,kind:string,partial:boolean,manual:boolean,alertsHtml='',detailsHtml=''){
 const m=report.metrics;
 const targetPerDay=Number(rec.daily_target_minutes??480);
 const minPercent=Number(rec.minimum_percent??80);
 const target=Math.round(targetPerDay*m.days);
 const minimum=Math.round(target*minPercent/100);
 const missing=m.appointments===0;
 const person=safe(rec.collaborator_name)||'Equipe';
 const sector=(Array.isArray(rec.sectors)&&rec.sectors.length?rec.sectors.map(safe).join(' · '):(rec.scope==='management'?'Todos os setores':safe(rec.sector)))||'Gestão';
 const k=kind==='weekly'?'SEMANAL':'DIÁRIO';
 const badge=manual?'TESTE MANUAL':partial?'DADOS PARCIAIS':'RELATÓRIO DE APONTAMENTOS';
 const esc=emailEsc;
 const tile=(label:string,value:string)=>'<td width="50%" valign="top" style="padding:8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f6fc;border:1px solid #e0e7f2;border-radius:10px"><tr><td style="padding:15px 16px"><div style="color:#65748b;font-size:12px;font-weight:600">'+esc(label)+'</div><div style="color:#102b51;font-size:23px;font-weight:750;margin-top:6px">'+esc(value)+'</div></td></tr></table></td>';
 const detail=report.text.split('\n').filter(x=>x.startsWith('- ')).slice(0,30);
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
 '<div style="font-size:13px;color:#bed1e8;margin-top:8px">Relatório '+esc(k.toLowerCase())+' de apontamentos</div>'+
 '</td></tr><tr><td style="padding:26px 26px 12px">'+test+
 '<div style="font-size:11px;color:#3873ae;letter-spacing:1px;font-weight:700">'+esc(badge)+'</div>'+
 '<h1 style="font-size:23px;line-height:1.2;margin:10px 0 8px;color:#102b51">'+esc(person)+'</h1>'+
 '<div style="color:#5e718b;font-size:14px">'+esc(sector)+' &nbsp;·&nbsp; '+esc(displayDate(from))+' a '+esc(displayDate(to))+'</div>'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:23px -8px 5px"><tr>'+
 tile('Horas apontadas',duration(m.minutes))+tile('Apontamentos',String(m.appointments))+'</tr><tr>'+
 tile('Chamados com horas',String(m.tickets))+tile('Dias úteis de referência',String(m.days))+'</tr></table>'+
 warning+
 '<div style="font-size:15px;color:#18385e;font-weight:700;margin:23px 0 6px">Referências de jornada</div>'+
 missingMetrics+
 '<div style="font-size:15px;color:#18385e;font-weight:700;margin:24px 0 12px">Atividades e lançamentos</div>'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5edf7;border-radius:8px;overflow:hidden">'+lines+'</table>'+
 detailsHtml+alertsHtml+
 '<p style="font-size:11px;line-height:1.6;color:#64748b;margin:22px 0">Fonte: API Movidesk / Central de Auditoria. Registros importados; não substitui o ponto eletrônico e não comprova produtividade ou presença.</p>'+
 '</td></tr><tr><td style="background:#f4f7fb;border-top:1px solid #dce5f0;padding:20px 26px;color:#718096;font-size:11px">'+
 'ARQUEM SISTEMAS &nbsp;|&nbsp; Central de Auditoria &nbsp;|&nbsp; Mensagem automática, não responda</td></tr>'+
 '</table></td></tr></table></body></html>';
}
function buildReport(rec: R, appts: R[], from: string, to: string, kind: string, hol: Set<string>, authorizedSingleManual = false, clients: R[] = []) {
  const scope = String(rec.scope || 'sector');
  if (!['sector', 'management'].includes(scope)) throw new Error('Escopo de destinatario nao reconhecido');
  const person = norm(rec.collaborator_name);
  // Compatibilidade: cadastros antigos usam sector, novos podem ter varios sectors.
  const selectedSectors = Array.isArray(rec.sectors) && rec.sectors.length
    ? [...new Set(rec.sectors.map((v:unknown)=>norm(v)).filter(Boolean))]
    : [norm(rec.sector)].filter(Boolean);
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
    const n = String(a.collaborator_name || 'Nao informado');
    byPerson.set(n, (byPerson.get(n) || 0) + Number(a.duration_minutes || 0));
    const s = String(a.sector || 'Nao informado');
    bySector.set(s, (bySector.get(s) || 0) + Number(a.duration_minutes || 0));
  }
  const worked = new Set(selected.map(a => String(a.ticket_id))).size;
  const dayMap=new Map<string,number>();
  const clientsById=new Map(clients.map(x=>[String(x.ticket_id),String(x.client_name||'').trim()]));
  const companyMap=new Map<string,{minutes:number;tickets:Set<string>}>();
  for(const a of selected){
    const who=String(a.collaborator_name||'Não informado');
    const day=String(a.appointment_date||'').slice(0,10);
    const mins=Number(a.duration_minutes||0);
    const k=who+'|'+day;dayMap.set(k,(dayMap.get(k)||0)+mins);
    const id=String(a.ticket_id||''),company=clientsById.get(id)||'Empresa não identificada';
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
  const detailsHtml='<div style="margin-top:24px;border-top:2px solid #dce6f4;padding-top:12px">'+
    '<h3 style="color:#17345d;font-size:15px">Horas por colaborador, dia a dia</h3>'+
    (daily.length?detailTable(['Colaborador','Data','Horas'],daily.slice(0,90).map(x=>[x.name,displayDate(x.day),duration(x.minutes)])):
      '<p style="font-size:12px">Sem apontamentos importados.</p>')+
    (daily.length>90?'<p style="font-size:12px">Exibindo 90 de '+daily.length+' linhas.</p>':'')+
    '<h3 style="color:#17345d;font-size:15px;margin-top:24px">Empresas com maior consumo de horas</h3>'+
    (companies.length?detailTable(['Empresa','Tempo','Chamados'],companies.map(x=>[x.name,duration(x.minutes),String(x.tickets)])):
      '<p style="font-size:12px">Sem empresas identificadas.</p>')+
    '<p style="font-size:11px;color:#64748b">Somente horas importadas do Movidesk; ausência de lançamento não comprova falta de trabalho.</p></div>';
  const title = `${kind === 'weekly' ? 'Relatorio semanal' : 'Relatorio diario'} - ${scope === 'management' ? (selectedSectors.length ? 'Gestao / ' + rec.sectors.map(safe).join(' + ') : 'Gestao / Todos os setores') : (Array.isArray(rec.sectors) && rec.sectors.length ? rec.sectors.map(safe).join(' + ') : safe(rec.sector))}${person ? ' / ' + safe(rec.collaborator_name) : ''}`;
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
    'REFERÊNCIAS DE JORNADA',
    '────────────────────────────────────────',
    ...(selected.length ? [
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
    ...daily.slice(0,90).map(x=>'- '+safe(x.name)+' | '+displayDate(x.day)+' | '+duration(x.minutes)),
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
  return { text: lines.join('\n'), detailsHtml, metrics: { appointments: selected.length, tickets: worked, minutes, days: days.length } };
}
async function sendMail(email: string, subject: string, text: string, html?: string) {
  if (!isEmail(email)) throw new Error('Endereco de e-mail invalido');
  if (!E('GMAIL_MAIL_SECRET')) throw new Error('GMAIL_MAIL_SECRET nao configurado');
  const res = await fetch(validUrl(), {
    method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: E('GMAIL_MAIL_SECRET'), email, assunto: subject, texto: text, html: html || undefined }),
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
  // Mesmo com zero apontamentos, o teste manual verifica o envio e informa a ausencia no corpo.
  const partial = !checkpoint.completed || !coverage.ready;
  const empty = !report.metrics.appointments;
  // Prévia de auditoria não cria disparos, não acessa o Gmail e não muda agendamentos.
  if (previewOnly) return json({ok:true,preview:true,release:RELEASE_ID,
    recipient:target,kind,from,to,partial,empty,
    metrics:report.metrics,ticketMetrics:tickets.metrics,
    // Até cinco exemplos por categoria para conferência sem expor todos os dados.
    ticketPreview:tickets.preview
  });
  const subject = '[TESTE MANUAL] Central de Auditoria - Relatorio '+(kind === 'weekly' ? 'semanal' : 'diario')+
    (partial?' [DADOS PARCIAIS]':'')+(empty?' [SEM APONTAMENTOS]':'')+' - '+from;
  const body = '[TESTE MANUAL DE ENVIO]'+
    '\nEste e-mail verifica o recebimento e não é um relatório definitivo.'+
    (partial?'\nATENÇÃO: sincronização incompleta; indicadores parciais.':'')+
    (empty?'\nSEM APONTAMENTOS IMPORTADOS: não é possível concluir ausência de trabalho.':'')+
    '\nDestinatário: '+safe(rec.email)+'\n\n'+report.text+'\n\n'+tickets.text;
  const inserted = await db('audit_email_sector_dispatches?on_conflict=dispatch_key', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({dispatch_key:key,recipient_id:id,report_kind:kind,period_from:from,period_to:to,status:'processing'})
  });
  if (!inserted?.length) return json({ ok: true, skipped: 'Relatorio ja reservado para envio' });
  try {
    await sendMail(String(rec.email),subject,body,reportEmailHtml(rec,report,from,to,kind,partial,true,tickets.html,report.detailsHtml));
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
  const results:R[]=[];
  for(const r of recipients){
    const id=String(r.id);
    const key='preliminary-authorized-20261109:'+id+':weekly:'+from+':'+to;
    try{
      const exists=await db('audit_email_sector_dispatches?dispatch_key=eq.'+encodeURIComponent(key)+'&select=dispatch_key,status&limit=1');
      if(exists.length){results.push({recipientId:id,status:'skipped',reason:'Envio preliminar já registrado'});continue;}
      const report=buildReport(r,appts,from,to,'weekly',hol,false,clients);
      const alerts=ticketAlerts(r,allTickets);
      const empty=!report.metrics.appointments;
      const subject='[BALANCETE PRELIMINAR - DADOS PARCIAIS] Central de Auditoria - Semana 02 a 08/11/2026'+(empty?' [SEM APONTAMENTOS]':'');
      const disclaimer='BALANCETE SEMANAL PRELIMINAR — 02 A 08/11/2026\n'+
        'SINCRONIZAÇÃO DO MOVIDESK AINDA EM ANDAMENTO. NÃO É FECHAMENTO DEFINITIVO.\n'+
        '02/11: FINADOS (FERIADO). DIAS ÚTEIS: 03, 04, 05 E 06/11.\n'+
        'HORAS E DIFERENÇAS PARA METAS PODEM MUDAR APÓS A CONCILIAÇÃO.\n'+
        'NÃO USAR ESTE DOCUMENTO PARA AVALIAÇÃO DEFINITIVA DE JORNADA OU PRODUTIVIDADE.\n\n';
      const html=reportEmailHtml(r,report,from,to,'weekly',true,true,alerts.html,report.detailsHtml);
      const inserted=await db('audit_email_sector_dispatches?on_conflict=dispatch_key',{
        method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
        body:JSON.stringify({dispatch_key:key,recipient_id:id,report_kind:'weekly',
          period_from:from,period_to:to,status:'processing'})
      });
      if(!inserted?.length){results.push({recipientId:id,status:'skipped',reason:'Outra execução reservou o envio'});continue;}
      try{
        await sendMail(String(r.email),subject,disclaimer+report.text+'\n\n'+alerts.text,html);
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
async function dispatch() {
  if (E('REPORT_EMAIL_SEND_ENABLED') !== 'true') return json({ ok: true, skipped: 'Envio automatico desativado' });
  // Envio oficial: exigir conciliação completa das datas do relatório.
  // O histórico total de chamados pode continuar em backfill sem impedir
  // resultados do período conciliado diretamente pela API Movidesk.
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
  // A partir do primeiro dia util: se a conciliacao atrasar na segunda,
  // tentar novamente nos dias uteis seguintes. A chave por periodo/destinatario
  // impede o envio duplicado de uma semana ja registrada.
  const weeklyDue = today >= firstBusinessDay;
  const tasks: { r: R; kind: 'daily' | 'weekly'; from: string; to: string }[] = [];
  for (const r of await recipientList()) {
    if (r.daily_enabled === true) tasks.push({ r, kind: 'daily', from: prev, to: prev });
    if (weeklyDue && r.weekly_enabled === true) tasks.push({ r, kind: 'weekly', from: prevMonday, to: prevSunday });
  }
  if (!tasks.length) return json({ ok: true, skipped: 'Sem relatorios programados' });
  // Leitura de periodo: somente datas necessarias. Sem fonte antiga Vercel.
  const from = tasks.reduce((s, t) => t.from < s ? t.from : s, tasks[0].from);
  const to = tasks.reduce((s, t) => t.to > s ? t.to : s, tasks[0].to);
  const coverage = await recentCoverage(from,to);
  if (!coverage.ready) return json({ok:true,skipped:'Conciliação incompleta ou desatualizada para o período; próximo agendamento fará nova tentativa',from,to,coverage});
  const [appts,allTickets,clients]=await Promise.all([source(from,to),ticketSource(),clientSource()]);
  const results: R[] = [];
  for (const t of tasks) {
    const id = String(t.r.id);
    const key = `${id}:${t.kind}:${t.from}:${t.to}`;
    try {
      const exists = await db(`audit_email_sector_dispatches?dispatch_key=eq.${encodeURIComponent(key)}&select=dispatch_key,status&limit=1`);
      if (exists.length) { results.push({ recipientId: id, kind: t.kind, skipped: 'Ja registrado; revisar status antes de retentar' }); continue; }
      const report = buildReport(t.r, appts, t.from, t.to, t.kind, hol, false, clients);
      const tickets = ticketAlerts(t.r, allTickets);
      if (!report.metrics.appointments) { results.push({ recipientId: id, kind: t.kind, skipped: 'Sem apontamentos; envio suspenso' }); continue; }
      const inserted = await db('audit_email_sector_dispatches?on_conflict=dispatch_key', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ dispatch_key: key, recipient_id: id, report_kind: t.kind,
          period_from: t.from, period_to: t.to, status: 'processing' })
      });
      if (!inserted?.length) continue;
      try {
        await sendMail(String(t.r.email), `Central de Auditoria - ${t.kind === 'daily' ? 'Diario' : 'Semanal'} - ${t.from}`, report.text+'\n\n'+tickets.text,reportEmailHtml(t.r,report,t.from,t.to,t.kind,false,false,tickets.html));
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
    if (action === 'status' || action === 'test' || action === 'directory' || action === 'manual_official' || action === 'preview_audit' || action === 'dispatch_health') {
      if (!await isAdmin(req)) return json({ error: 'Acesso reservado ao administrador autenticado' }, 403);
      return action === 'manual_official' ? await manualOfficial(payload)
        : action === 'preview_audit' ? await manualOfficial({...payload,previewOnly:true})
        : await adminAction(payload);
    }
    if (action !== 'dispatch' && action !== 'dispatch_weekly_preliminary') return json({ error: 'Acao desconhecida' }, 400);
    const expected = E('REPORT_CRON_SECRET');
    if (!expected || req.headers.get('x-report-secret') !== expected) return json({ error: 'Cron nao autorizado' }, 401);
    return action === 'dispatch_weekly_preliminary' ? await dispatchWeeklyPreliminary() : await dispatch();
  } catch (ex) { console.error('audit-email-dispatch:', err(ex)); return json({ ok: false, error: err(ex), release: RELEASE_ID }, 500); }
}

Deno.serve(async (req: Request) => {
  // A preflight do browser deve responder antes da leitura do corpo e do JWT.
  if (req.method === 'OPTIONS') return withCors(req, new Response(null, { status: 204 }));
  return withCors(req, await handleRequest(req));
});