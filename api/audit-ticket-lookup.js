// Busca individual de chamado para a aba Projetos; sem expor service_role no navegador.
export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store, private');
  if(req.method!=='GET')return res.status(405).json({error:'Método não permitido'});
  const id=String(req.query.id||'').trim();
  if(!/^\d{1,12}$/.test(id))return res.status(400).json({error:'Número de chamado inválido'});
  const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!/^https:\/\//.test(base)||!serviceKey)return res.status(503).json({error:'Supabase indisponível'});
  const bearer=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'');
  if(!bearer)return res.status(401).json({error:'Entre no sistema para consultar o chamado'});
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
  const svc={apikey:serviceKey,Authorization:'Bearer '+serviceKey};
  try {
    const auth=await fetch(base+'/auth/v1/user',{
      headers:{apikey:serviceKey,Authorization:'Bearer '+bearer[1]},signal:ctrl.signal
    });
    if(!auth.ok)return res.status(401).json({error:'Sessão expirada'});
    const user=await auth.json();
    if(!user?.id)return res.status(401).json({error:'Usuário inválido'});
    const acl=new URL(base+'/rest/v1/audit_users');
    acl.searchParams.set('select','role,is_active');
    acl.searchParams.set('user_id','eq.'+user.id);
    acl.searchParams.set('limit','1');
    const aclResult=await fetch(acl,{headers:svc,signal:ctrl.signal});
    if(!aclResult.ok)return res.status(503).json({error:'Falha na validação de acesso'});
    const users=await aclResult.json();
    if(!Array.isArray(users)||!users.some(u=>String(u.role).toLowerCase()==='admin'&&u.is_active!==false))
      return res.status(403).json({error:'Consulta reservada a administradores autorizados'});
    const u=new URL(base+'/rest/v1/audit_direct_tickets');
    u.searchParams.set('select','ticket_id,payload');
    u.searchParams.set('ticket_id','eq.'+id);
    u.searchParams.set('limit','1');
    const result=await fetch(u,{headers:svc,signal:ctrl.signal});
    if(!result.ok)return res.status(502).json({error:'Não foi possível consultar o chamado'});
    const records=await result.json();
    if(!Array.isArray(records)||!records.length)return res.status(200).json({found:false,id});
    const ticket=records[0].payload||{};
    const client=Array.isArray(ticket.clients)?ticket.clients[0]:null;
    const name=x=>typeof x==='string'?x:(x?.businessName||x?.name||'');
    return res.status(200).json({found:true,ticket:{
      id:String(records[0].ticket_id),subject:String(ticket.subject||'Sem assunto').slice(0,300),
      client:String(name(client?.organization)||name(client)||'Não informado').slice(0,150),
      status:String(ticket.status||'Não informado').slice(0,100)
    }});
  }catch(e){
    return res.status(502).json({error:'Consulta indisponível; tente novamente'});
  }finally{clearTimeout(timer)}
}
