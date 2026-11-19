import engine from '../lib/audit-quality-review.cjs';
const {evaluateQualityRecords}=engine;
const PAGE=200,MAX_PAGES=5;
const send=(res,status,data)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Allow','GET, OPTIONS');
  return res.status(status).json(data);
};
function setup(){
  const base=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
  const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)||!key)return null;
  return {base,key};
}
async function read(db,table,params,signal){
  const url=new URL(db.base+'/rest/v1/'+table);
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  const response=await fetch(url,{
    method:'GET',
    headers:{apikey:db.key,Authorization:'Bearer '+db.key,Accept:'application/json'},
    signal,cache:'no-store',redirect:'error'
  });
  if(!response.ok)throw Error('read failed');
  const data=await response.json();
  if(!Array.isArray(data))throw Error('bad response');
  return data;
}
async function authorized(req,db,signal){
  const match=/^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(req.headers.authorization||'');
  if(!match||match[1].length>16000)return {status:401,error:'Faça login na Central.'};
  const response=await fetch(db.base+'/auth/v1/user',{
    method:'GET',headers:{apikey:db.key,Authorization:'Bearer '+match[1]},
    signal,cache:'no-store',redirect:'error'
  });
  if(!response.ok)return {status:401,error:'Sessão expirada.'};
  const user=await response.json();
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(user?.id||'')))
    return {status:401,error:'Usuário inválido.'};
  const acl=await read(db,'audit_users',{select:'role,is_active',
    user_id:'eq.'+user.id,limit:1},signal);
  if(!acl.some(x=>String(x.role||'').toLowerCase()==='admin'&&x.is_active!==false))
    return {status:403,error:'Prévia reservada a administradores.'};
  return {status:200};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Allow','GET, OPTIONS');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return send(res,405,{error:'Somente GET; nenhum envio permitido.'});
  const db=setup();if(!db)return send(res,503,{error:'Base de auditoria indisponível.'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),40000);
  try{
    const auth=await authorized(req,db,controller.signal);
    if(auth.status!==200)return send(res,auth.status,{error:auth.error});
    const records=[];let pagesRead=0,partial=false;
    for(let page=0;page<MAX_PAGES;page++){
      const chunk=await read(db,'audit_direct_tickets',{
        select:'ticket_id,payload,closed_at_source,source_synced_at',
        closed_at_source:'is.null',
        order:'source_synced_at.desc.nullslast,ticket_id.desc',
        limit:PAGE,offset:page*PAGE
      },controller.signal);
      records.push(...chunk);pagesRead++;
      if(chunk.length<PAGE)break;
      if(page===MAX_PAGES-1)partial=true;
    }
    const result=evaluateQualityRecords(records);
    return send(res,200,{
      ...result,
      source:'Supabase / Movidesk sincronizado',
      coverage:{
        pagesRead,paginationLimit:PAGE*MAX_PAGES,potentiallyTruncated:partial,
        notOfficialNC:true,
        fullHistoryVerified:false,
        lastSync:records.map(x=>x.source_synced_at).filter(Boolean).sort().at(-1)||null
      },
      warnings:[...result.warnings,
        ...(partial?['Limite de páginas atingido; amostra parcial.']:[]),
        'A análise considera apenas campos técnicos disponíveis no recorte e não equivale à monitoria completa.'],
      notificationsSent:0,nonConformitiesCreated:0,changesWritten:0
    });
  }catch(error){
    return send(res,502,{error:error?.name==='AbortError'?
      'Consulta excedeu o limite de tempo. Nenhum dado foi alterado.':
      'Consulta de qualidade indisponível. Nenhum dado foi alterado.',
      notificationsSent:0,nonConformitiesCreated:0,changesWritten:0
    });
  }finally{clearTimeout(timeout)}
}
