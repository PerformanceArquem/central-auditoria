// Auditoria de estimativas por regras, atualizada automaticamente no Supabase.
// Nenhum texto é enviado a um provedor de IA. Dados acessíveis só a admin autenticado.
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store, private');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método não permitido'});
 const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!/^https:\/\//.test(base)||!key)return res.status(503).json({ok:false,error:'Supabase não configurado'});
 const bearer=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'');
 if(!bearer)return res.status(401).json({ok:false,error:'Sessão necessária'});
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),15000);
 const svc={apikey:key,Authorization:'Bearer '+key};
 try{
  const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+bearer[1]},signal:ctrl.signal});
  if(!auth.ok)return res.status(401).json({ok:false,error:'Sessão expirada'});
  const user=await auth.json();
  if(!user?.id)return res.status(401).json({ok:false,error:'Usuário inválido'});
  const acl=new URL(base+'/rest/v1/audit_users');
  acl.searchParams.set('select','role,is_active');
  acl.searchParams.set('user_id','eq.'+user.id);
  acl.searchParams.set('limit','1');
  const ar=await fetch(acl,{headers:svc,signal:ctrl.signal});
  if(!ar.ok)return res.status(503).json({ok:false,error:'Não foi possível validar acesso'});
  const roles=await ar.json();
  if(!Array.isArray(roles)||!roles.some(r=>String(r.role).toLowerCase()==='admin'&&r.is_active!==false))
   return res.status(403).json({ok:false,error:'Consulta reservada a administradores'});
  const u=new URL(base+'/rest/v1/audit_forecast_variance_snapshots');
  u.searchParams.set('select','ticket_id,subject,client_name,sector,status,estimated_hours,actual_minutes,variance_percent,evidence,evidence_origin,confidence,updated_at');
  u.searchParams.set('order','variance_percent.desc,ticket_id.asc');
  u.searchParams.set('limit','500');
  const result=await fetch(u,{headers:svc,signal:ctrl.signal});
  if(!result.ok)return res.status(502).json({ok:false,error:'Falha ao consultar auditoria de previsões'});
  const records=await result.json();
  if(!Array.isArray(records))return res.status(502).json({ok:false,error:'Resposta inesperada'});
  return res.status(200).json({ok:true,source:'supabase-automatic',generatedAt:records[0]?.updated_at||null,
   items:records.map(r=>({id:String(r.ticket_id),subject:String(r.subject||''),
    client:String(r.client_name||''),sector:String(r.sector||''),status:String(r.status||''),
    pl:Number(r.estimated_hours),h:Number(r.actual_minutes)/60,
    percentage:Number(r.variance_percent),src:'Histórico Movidesk: '+String(r.evidence||''),
    confidence:String(r.confidence||'baixa'),evidence:String(r.evidence||'')}))});
 }catch(e){return res.status(502).json({ok:false,error:'Auditoria indisponível. Tente novamente.'})}
 finally{clearTimeout(timeout)}
}
