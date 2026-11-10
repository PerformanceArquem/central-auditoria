// Leitura protegida da fonte consolidada do Movidesk usada pelos relatórios de e-mail.
// Não envia e-mails e não altera tabelas.
const env = name => process.env[name] || '';
const json = (res, code, data) => { res.setHeader('Cache-Control','no-store'); return res.status(code).json(data); };
const label = x => x && typeof x === 'object' ? String(x.name || x.description || x.businessName || x.fullName || '') : String(x || '');
const person = x => x && typeof x === 'object' ? String(x.businessName || x.name || x.fullName || x.userName || x.email || '') : String(x || '');
const hours = x => { if(x==null||x==='')return 0; if(typeof x==='number')return x; const s=String(x).split(':').map(Number); return s.length>1&&s.every(Number.isFinite)?s[0]+s[1]/60+(s[2]||0)/3600:Number(String(x).replace(',','.'))||0; };
const safeDate = x => typeof x === 'string' ? x.slice(0,32) : '';
const normalTicket = t => ({
 ticket_id:String(t.id||t.ticket_id||''),subject:String(t.subject||'').slice(0,350),
 client_name:person((t.clients||[])[0]?.organization)||person((t.clients||[])[0])||String(t.client_name||''),
 status:label(t.status),category:label(t.category),service_name:label(t.serviceFirstLevel||t.service_name),
 sector:label(t.ownerTeam||t.sector||t.team)||'Sem equipe',owner_name:person(t.owner)||String(t.owner_name||''),
 created_at_source:safeDate(t.createdDate||t.created_at_source),last_update_source:safeDate(t.lastUpdate||t.last_update_source),
 closed_at_source:safeDate(t.closedIn||t.closedAt||t.closedDate||t.resolvedIn||t.closed_at)
});
const appointments = t => {
 const out=[],team=label(t.ownerTeam||t.sector||t.team)||'Sem equipe';
 for(const a of (Array.isArray(t.actions)?t.actions:[])){
  const aps=Array.isArray(a.timeAppointments)?a.timeAppointments:[];
  const append=(hrs,collaborator,date,activity,sector)=>{
   const minutes=Math.round(hours(hrs)*60); if(!Number.isFinite(minutes)||minutes<=0||minutes>24*60*365)return;
   out.push({ticket_id:String(t.id),collaborator_name:person(collaborator)||person(t.owner)||'Não informado',
    appointment_date:safeDate(date||a.createdDate).slice(0,10),duration_minutes:minutes,activity:label(activity)||'Geral',sector:label(sector)||team});
  };
  if(aps.length)for(const p of aps)append(p.workTime??p.accountedTime,p.createdBy||p.agent||a.createdBy,p.date,p.activity,p.createdByTeam);
  else append(a.timeWorked,a.createdBy,a.createdDate,a.activity,null);
 }
 return out;
};
export default async function handler(req,res){
 if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
 // Segredo exclusivamente no servidor. Não enviar este valor pelo navegador.
 const secret=env('REPORT_SOURCE_SECRET');
 if(!secret||req.headers['x-report-source-secret']!==secret)return json(res,401,{error:'Não autorizado'});
 const url=env('SUPABASE_URL').replace(/\/$/,'');const key=env('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)return json(res,503,{error:'Variáveis do Supabase não configuradas na Vercel'});
 try{
  const offset=Math.max(0,Number.parseInt(req.query.offset,10)||0);
  const limit=100;
  if(offset>50000||offset%limit!==0)return json(res,400,{error:'Offset inválido'});
  const source=await fetch(`${url}/rest/v1/audit_direct_tickets?select=payload&order=ticket_id.asc&limit=${limit}&offset=${offset}`,{
   headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(18000)});
  if(!source.ok)return json(res,502,{error:`Falha ao consultar tickets na fonte Vercel: HTTP ${source.status}`});
  const data=await source.json();const tickets=[],appts=[];
  for(const row of data){const t=row?.payload;if(!t||typeof t!=='object'||Array.isArray(t))continue;
   const x=normalTicket(t);if(!x.ticket_id)continue;tickets.push(x);appts.push(...appointments(t));}
  return json(res,200,{ok:true,tickets,appointments:appts,count:data.length,hasMore:data.length===limit,
   source:'supabase-audit_direct_tickets',generatedAt:new Date().toISOString()});
 }catch(e){return json(res,500,{error:String(e?.message||e).slice(0,250)});}
}

