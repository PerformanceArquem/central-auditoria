import engine from '../lib/audit-productivity-comparisons.cjs';

const {analyzeProductivity,makeWindows,plusDays}=engine;
const PAGE=500,MAX_PAGES_PER_PERIOD=12;
const respond=(res,status,body)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Allow','GET, OPTIONS');
  return res.status(status).json(body);
};
function setup() {
  const base=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
  const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)||!key)return null;
  return {base,key,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}};
}
async function query(db,table,params,signal) {
  const url=new URL(db.base+'/rest/v1/'+table);
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  const response=await fetch(url,{
    method:'GET',headers:db.headers,
    signal,cache:'no-store',redirect:'error'
  });
  if(!response.ok)throw Error('Read-only query unavailable');
  const rows=await response.json();
  if(!Array.isArray(rows))throw Error('Invalid read-only query');
  return rows;
}
async function requireAdmin(req,db,signal){
  const match=/^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(req.headers.authorization||'');
  if(!match||match[1].length>16000)return {status:401,error:'Entre na Central de Auditoria.'};
  const auth=await fetch(db.base+'/auth/v1/user',{
    method:'GET',
    headers:{apikey:db.key,Authorization:'Bearer '+match[1]},
    signal,cache:'no-store',redirect:'error'
  });
  if(!auth.ok)return {status:401,error:'Sessão inválida ou expirada.'};
  const user=await auth.json();
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(user?.id||'')))
    return {status:401,error:'Sessão inválida.'};
  const acl=await query(db,'audit_users',{
    select:'role,is_active',user_id:'eq.'+user.id,limit:1
  },signal);
  if(!acl.some(x=>String(x.role||'').toLowerCase()==='admin'&&x.is_active!==false))
    return {status:403,error:'Comparativos de colaboradores disponíveis somente para administradores.'};
  return {status:200};
}
async function appointments(db,period,signal){
  const list=[],queryBase={
    select:'appointment_date,ticket_id,sector,collaborator_name,activity,duration_minutes',
    and:'(appointment_date.gte.'+period.from+',appointment_date.lte.'+period.to+')',
    order:'appointment_date.asc,ticket_id.asc,collaborator_name.asc,activity.asc'
  };
  for(let page=0;page<MAX_PAGES_PER_PERIOD;page++){
    const chunk=await query(db,'audit_direct_appointments',{
      ...queryBase,limit:PAGE,offset:page*PAGE
    },signal);
    list.push(...chunk);
    if(chunk.length<PAGE)return {rows:list,pages:page+1,partial:false};
  }
  return {rows:list,pages:MAX_PAGES_PER_PERIOD,partial:true};
}
function localToday(){
  const formatter=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  });
  const parts=Object.fromEntries(formatter.formatToParts(new Date())
    .filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Allow','GET, OPTIONS');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return respond(res,405,{error:'Somente consultas GET são permitidas.'});
  const daysValue=req.query?.days??'28';
  const comparison=req.query?.comparison??'previous';
  if(typeof daysValue!=='string'||!['7','28','56','84'].includes(daysValue)||
      typeof comparison!=='string'||!['previous','year-prior'].includes(comparison))
    return respond(res,400,{error:'Escolha um período e tipo de comparação válidos.'});
  const db=setup();if(!db)return respond(res,503,{error:'Consulta de produtividade indisponível.'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
  try{
    const auth=await requireAdmin(req,db,controller.signal);
    if(auth.status!==200)return respond(res,auth.status,{error:auth.error});
    const window=makeWindows(plusDays(localToday(),-1),Number(daysValue),comparison);
    const [current,baseline]=await Promise.all([
      appointments(db,window.current,controller.signal),
      appointments(db,window.baseline,controller.signal)
    ]);
    let holidays=null,holidayWarning=null;
    try{
      const from=window.baseline.from<window.current.from?window.baseline.from:window.current.from;
      const to=window.baseline.to>window.current.to?window.baseline.to:window.current.to;
      const data=await query(db,'audit_email_holidays',{
        select:'holiday_date',
        and:'(holiday_date.gte.'+from+',holiday_date.lte.'+to+')',
        affects_delivery:'eq.true',
        order:'holiday_date.asc',
        limit:500
      },controller.signal);
      if(data.length<500)holidays=new Set(data.map(x=>String(x.holiday_date||'')).filter(Boolean));
      else holidayWarning='Cadastro de feriados excedeu limite de leitura: classificação não disponível.';
    }catch{
      holidayWarning='Cadastro de feriados não disponível: não inferir dias úteis ou feriados.';
    }
    const result=analyzeProductivity(current.rows,baseline.rows,{
      to:window.current.to,days:Number(daysValue),comparison,holidays
    });
    return respond(res,200,{
      ...result,
      coverage:{
        ...result.coverage,
        source:'Supabase / audit_direct_appointments (workTime sincronizado do Movidesk)',
        currentPages:current.pages,baselinePages:baseline.pages,
        currentTruncated:current.partial,baselineTruncated:baseline.partial,
        registrationDatesVerified:false,
        syncFreshnessVerified:false,
        holidaysFromConfiguredDeliveryCalendar:holidays!==null
      },
      warnings:[
        ...result.warnings,
        ...(current.partial||baseline.partial?[
          'A paginação atingiu o limite em pelo menos um período; totais e comparativos são parciais.'
        ]:[]),
        ...(holidayWarning?[holidayWarning]:[]),
        'Resultados comparativos refletem apenas horas lançadas no período e não atestam presença nem carga de trabalho total.',
        'Horário do dia corrente é excluído para evitar comparar dias incompletos.'
      ],
      notificationsSent:0,changesWritten:0
    });
  }catch(error){
    return respond(res,502,{
      error:error?.name==='AbortError'?
        'A consulta excedeu o tempo limite; nenhum dado alterado.':
        'Não foi possível obter os comparativos; nenhum dado alterado.',
      notificationsSent:0,changesWritten:0
    });
  }finally{clearTimeout(timeout)}
}
