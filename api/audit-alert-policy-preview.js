import policy from '../lib/audit-alert-policy.cjs';

const { evaluateAlertPolicies,canonicalTeam } = policy;
const PAGE=200,MAX_PAGES=5;
function send(res,status,body){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Allow','GET, OPTIONS');
  return res.status(status).json(body);
}
function serverConfig(){
  const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)||!key)return null;
  return {base,key};
}
async function read(config,table,params,signal){
  const url=new URL(config.base+'/rest/v1/'+table);
  for(const [key,value] of Object.entries(params))
    url.searchParams.set(key,String(value));
  const response=await fetch(url,{
    method:'GET',
    headers:{apikey:config.key,Authorization:'Bearer '+config.key,Accept:'application/json'},
    cache:'no-store',redirect:'error',signal
  });
  if(!response.ok)throw new Error('Read-only database query failed');
  const result=await response.json();
  if(!Array.isArray(result))throw new Error('Invalid read-only database response');
  return result;
}
async function verifyAdmin(req,config,signal){
  const match=/^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(req.headers.authorization||'');
  if(!match||match[1].length>16000)return {status:401,error:'Entre no sistema para consultar os alertas.'};
  const response=await fetch(config.base+'/auth/v1/user',{
    method:'GET',
    headers:{apikey:config.key,Authorization:'Bearer '+match[1]},
    cache:'no-store',redirect:'error',signal
  });
  if(!response.ok)return {status:401,error:'Sessão expirada.'};
  const user=await response.json();
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(user?.id||'')))
    return {status:401,error:'Sessão inválida.'};
  const acl=await read(config,'audit_users',{
    select:'role,is_active',user_id:'eq.'+user.id,limit:'1'
  },signal);
  if(!acl.some(x=>String(x.role||'').toLowerCase()==='admin'&&x.is_active!==false))
    return {status:403,error:'Prévia disponível somente para administradores.'};
  return {status:200};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Allow','GET, OPTIONS');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return send(res,405,{error:'Somente GET. Nenhuma operação de envio disponível.'});
  if(typeof req.query?.team!=='undefined'&&typeof req.query.team!=='string')
    return send(res,400,{error:'Setor inválido.'});
  const team=canonicalTeam(req.query?.team||'Implantação');
  if(!team)return send(res,400,{error:'Setor não permitido.'});
  const config=serverConfig();
  if(!config)return send(res,503,{error:'Integração Supabase indisponível.'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),35000);
  try{
    const auth=await verifyAdmin(req,config,controller.signal);
    if(auth.status!==200)return send(res,auth.status,{error:auth.error});
    const rows=[];
    let pageCount=0,partial=false;
    for(let i=0;i<MAX_PAGES;i++){
      const batch=await read(config,'audit_direct_tickets',{
        select:'ticket_id,payload,closed_at_source,source_synced_at',
        'payload->>ownerTeam':'eq.'+team,
        closed_at_source:'is.null',
        order:'source_synced_at.desc.nullslast,ticket_id.desc',
        limit:PAGE,offset:i*PAGE
      },controller.signal);
      rows.push(...batch);pageCount++;
      if(batch.length<PAGE)break;
      if(i===MAX_PAGES-1)partial=true;
    }
    const evaluatedAt=new Date();
    const report=evaluateAlertPolicies(rows,{team,now:evaluatedAt});
    const lastSync=rows.map(x=>x.source_synced_at).filter(Boolean).sort().at(-1)||null;
    return send(res,200,{
      ...report,
      coverage:{
        source:'Supabase / audit_direct_tickets (Movidesk sincronizado)',
        scope:'Somente '+team,scanned:rows.length,pages:pageCount,
        partial,historyCoverage:'Não conectado',
        latestRecordSync:lastSync,
        snapshotFreshnessEnforcedHours:24
      },
      notificationsSent:0,changesWritten:0
    });
  }catch(error){
    return send(res,502,{
      error:error?.name==='AbortError'?
        'A consulta excedeu o tempo limite. Nenhum dado foi alterado.':
        'Falha na consulta de alertas. Nenhum dado foi alterado.',
      notificationsSent:0,changesWritten:0
    });
  }finally{clearTimeout(timeout)}
}
