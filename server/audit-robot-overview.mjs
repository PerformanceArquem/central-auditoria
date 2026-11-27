import {buildRobotOverview,OVERVIEW_SCOPES} from '../alert-center/robot-overview.mjs';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Allow','GET');
  const fail=(status,error)=>res.status(status).json({ok:false,error});
  if(req.method!=='GET')return fail(405,'Somente consulta sem gravação.');
  if(process.env.ROBOT_OVERVIEW_ENABLED!=='true')return fail(503,'Visão dos setores ainda não habilitada neste ambiente.');
  const scope=req.query?.scope??'all';
  if(typeof scope!=='string'||!Object.hasOwn(OVERVIEW_SCOPES,scope))return fail(400,'Grupo inválido.');
  const bearer=/^Bearer ([A-Za-z0-9._-]{1,16000})$/.exec(req.headers?.authorization||'');
  if(!bearer)return fail(401,'Entre na Central para consultar os setores.');
  const base=String(process.env.SUPABASE_URL||'').replace(/\/+$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)||!key)return fail(503,'Consulta indisponível neste ambiente.');
  const signal=AbortSignal.timeout(20000),headers={apikey:key,Authorization:'Bearer '+key};
  const read=async(url,auth=headers)=>{const r=await fetch(url,{method:'GET',headers:auth,signal,redirect:'error'});if(!r.ok)throw Error('Upstream unavailable');return r.json();};
  try {
    const auth=await fetch(base+'/auth/v1/user',{method:'GET',headers:{apikey:key,Authorization:'Bearer '+bearer[1]},signal,redirect:'error'});
    if(!auth.ok)return fail(401,'Sessão expirada. Entre novamente.');
    const user=await auth.json();if(typeof user?.id!=='string'||!user.id)return fail(401,'Sessão inválida.');
    const acl=new URL(base+'/rest/v1/audit_users');acl.search=new URLSearchParams({select:'role,is_active',user_id:'eq.'+user.id,limit:'2'}).toString();
    const users=await read(acl);
    if(!Array.isArray(users)||users.length!==1||users[0].role!=='admin'||users[0].is_active!==true)return fail(403,'Consulta reservada a administradores ativos.');
    const url=new URL(base+'/rest/v1/audit_reporting_tickets');
    const fields=['subject','ownerTeam','owner','status','baseStatus','slaSolutionDate','slaSolutionDateIsPaused','closedIn','canceledIn','isDeleted'];
    url.search=new URLSearchParams({select:'ticket_id,source_synced_at,closed_at_source,'+fields.map(field=>field+':payload->'+field).join(','),'payload->>ownerTeam':'in.('+OVERVIEW_SCOPES[scope].map(value=>JSON.stringify(value)).join(',')+')',closed_at_source:'is.null',order:'ticket_id.asc',limit:'1001'}).toString();
    const rows=await read(url);
    if(!Array.isArray(rows))throw Error('Invalid response');
    if(rows.length>1000)return fail(409,'Mais de mil chamados no escopo. Selecione um grupo menor; nenhum resultado parcial será exibido.');
    const records=rows.map(({ticket_id,source_synced_at,closed_at_source,...payload})=>({ticket_id,source_synced_at,closed_at_source,payload}));
    const snapshot=buildRobotOverview(records,{now:new Date().toISOString(),scope});
    return res.status(200).json({ok:true,mode:'read-only',...snapshot});
  }catch{return fail(502,'Consulta não concluída. Nenhum dado foi gravado e nenhum envio foi realizado.');}
}
