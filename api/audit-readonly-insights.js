import engine from '../lib/audit-readonly-insights.cjs';

const { evaluateAuditInsights } = engine;
const PAGE_TICKETS = 200;
const MAX_TICKET_PAGES = 5;
const PAGE_APPOINTMENTS = 500;
const MAX_APPOINTMENT_PAGES = 4;

const json = (res,code,body) => {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Allow','GET, OPTIONS');
  return res.status(code).json(body);
};
const localDay = date => new Intl.DateTimeFormat('en-CA', {
  timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
}).format(date);
function config() {
  const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)||!key) return null;
  return {base,key,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}};
}
async function readSupabase(config,table,params,signal) {
  const url=new URL(config.base+'/rest/v1/'+table);
  for(const [key,val] of Object.entries(params))url.searchParams.set(key,String(val));
  const response=await fetch(url,{
    method:'GET',headers:config.headers,signal,cache:'no-store',redirect:'error'
  });
  if (!response.ok) throw new Error('Consulta indisponível: '+table);
  const data=await response.json();
  if (!Array.isArray(data)) throw new Error('Resposta inesperada: '+table);
  return data;
}
async function authorized(req,config,signal) {
  const match=/^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(req.headers.authorization||'');
  if (!match || match[1].length>16000) return {status:401,error:'Faça login para consultar a auditoria.'};
  const response=await fetch(config.base+'/auth/v1/user',{
    method:'GET',headers:{apikey:config.key,Authorization:'Bearer '+match[1]},
    signal,cache:'no-store',redirect:'error'
  });
  if (!response.ok) return {status:401,error:'Sessão expirada ou inválida.'};
  const user=await response.json();
  if(!user?.id || !/^[A-Za-z0-9_-]{1,128}$/.test(String(user.id)))
    return {status:401,error:'Usuário inválido.'};
  const acl=await readSupabase(config,'audit_users',{
    select:'role,is_active',user_id:'eq.'+user.id,limit:'1'
  },signal);
  if (!acl.some(x=>String(x.role||'').toLowerCase()==='admin'&&x.is_active!==false))
    return {status:403,error:'Somente administradores podem acessar esta prévia.'};
  return {status:200};
}
async function readPaged(config,table,baseParams,pageSize,maxPages,signal) {
  const rows=[];
  let hitLimit=false;
  for (let i=0;i<maxPages;i++) {
    const batch=await readSupabase(config,table,{
      ...baseParams,limit:pageSize,offset:i*pageSize
    },signal);
    rows.push(...batch);
    if(batch.length<pageSize)return {rows,partial:false,pages:i+1};
    if(i===maxPages-1)hitLimit=true;
  }
  return {rows,partial:hitLimit,pages:maxPages};
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Allow','GET, OPTIONS');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return json(res,405,{error:'A prévia aceita somente consultas GET.'});
  const c=config();
  if(!c)return json(res,503,{error:'Fonte de dados da auditoria indisponível.'});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),40000);
  try {
    const access=await authorized(req,c,controller.signal);
    if(access.status!==200)return json(res,access.status,{error:access.error});
    const to=localDay(new Date());
    const from=localDay(new Date(Date.now()-29*86400000));
    const [tickets,appointments]=await Promise.all([
      readPaged(c,'audit_direct_tickets',{
        select:'ticket_id,payload,created_at_source,closed_at_source,source_synced_at',
        closed_at_source:'is.null',
        order:'source_synced_at.desc.nullslast,ticket_id.desc'
      },PAGE_TICKETS,MAX_TICKET_PAGES,controller.signal),
      readPaged(c,'audit_direct_appointments',{
        select:'ticket_id,appointment_date,duration_minutes,collaborator_name,activity',
        and:'(appointment_date.gte.'+from+',appointment_date.lte.'+to+')',
        order:'appointment_date.desc,ticket_id.desc'
      },PAGE_APPOINTMENTS,MAX_APPOINTMENT_PAGES,controller.signal)
    ]);
    const result=evaluateAuditInsights(tickets.rows,appointments.rows);
    return json(res,200,{
      ...result,
      period:{appointmentsFrom:from,appointmentsTo:to,basis:'últimos 30 dias corridos'},
      coverage:{
        ...result.coverage,
        ticketsMayBePartial:tickets.partial,
        appointmentsMayBePartial:appointments.partial,
        ticketsPages:tickets.pages,appointmentPages:appointments.pages,
        lastTicketSync:tickets.rows.map(x=>x.source_synced_at).filter(Boolean).sort().at(-1)||null,
        dataMayBeStale:true
      },
      warnings:[
        ...result.warnings,
        ...(tickets.partial?['Limite de registros de chamados atingido: totais parciais.']:[]),
        ...(appointments.partial?['Limite de apontamentos atingido: horas parciais.']:[]),
        'Fontes sincronizadas podem estar desatualizadas; conferir datas antes de cobranças.'
      ],
      notificationsSent:0,changesWritten:0
    });
  } catch(error) {
    return json(res,502,{error:error?.name==='AbortError'?
      'Tempo limite da prévia excedido. Nenhum dado foi alterado.':
      'Falha na leitura dos dados de auditoria. Nenhum dado foi alterado.',
      notificationsSent:0,changesWritten:0});
  } finally {
    clearTimeout(timer);
  }
}
