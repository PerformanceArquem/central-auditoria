import queueEngine from '../lib/audit-queue-flow.cjs';

const {analyzeQueueFlow}=queueEngine;
const PAGE=200,MAX_PAGES=5;
const respond=(res,status,data)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Allow','GET, OPTIONS');
  return res.status(status).json(data);
};
function config(){
  const base=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)||!key)return null;
  return {base,key,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}};
}
async function read(db,table,params,signal){
  const url=new URL(db.base+'/rest/v1/'+table);
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  const response=await fetch(url,{
    method:'GET',headers:db.headers,signal,cache:'no-store',redirect:'error'
  });
  if(!response.ok)throw Error('Falha em consulta somente leitura');
  const value=await response.json();
  if(!Array.isArray(value))throw Error('Resposta incompatível da consulta');
  return value;
}
async function authorize(req,db,signal) {
  const match=/^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(req.headers.authorization||'');
  if(!match||match[1].length>16000)
    return {status:401,error:'Faça login para visualizar a fiscalização das filas.'};
  const response=await fetch(db.base+'/auth/v1/user',{
    method:'GET',
    headers:{apikey:db.key,Authorization:'Bearer '+match[1]},
    cache:'no-store',redirect:'error',signal
  });
  if(!response.ok)return {status:401,error:'Sessão expirada ou inválida.'};
  const user=await response.json();
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(user?.id||'')))
    return {status:401,error:'Usuário inválido.'};
  const acl=await read(db,'audit_users',{
    select:'role,is_active',user_id:'eq.'+user.id,limit:1
  },signal);
  if(!acl.some(x=>String(x.role||'').toLowerCase()==='admin'&&x.is_active!==false))
    return {status:403,error:'Visualização reservada a administradores autorizados.'};
  return {status:200};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Allow','GET, OPTIONS');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return respond(res,405,{error:'Somente GET — não existe ação de envio.'});
  const db=config();
  if(!db)return respond(res,503,{error:'Integração de leitura indisponível.'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),40000);
  try{
    const auth=await authorize(req,db,controller.signal);
    if(auth.status!==200)return respond(res,auth.status,{error:auth.error});
    const records=[];
    let partial=false,pagesRead=0;
    for(let page=0;page<MAX_PAGES;page++){
      const batch=await read(db,'audit_direct_tickets',{
        select:'ticket_id,payload,closed_at_source,source_synced_at',
        order:'source_synced_at.desc.nullslast,ticket_id.desc',
        limit:PAGE,offset:page*PAGE
      },controller.signal);
      records.push(...batch);
      pagesRead++;
      if(batch.length<PAGE)break;
      if(page===MAX_PAGES-1)partial=true;
    }
    const summary=analyzeQueueFlow(records);
    const latestSync=records.map(x=>x.source_synced_at).filter(Boolean).sort().at(-1)||null;
    return respond(res,200,{
      ...summary,
      coverage:{
        ...summary.coverage,
        source:'Supabase / audit_direct_tickets (Movidesk sincronizado)',
        pagesRead,paginationLimit:PAGE*MAX_PAGES,potentiallyTruncated:partial,
        latestRecordSync:latestSync,includesStaleSnapshotsInTotals:false,
        fullHistoryVerified:false
      },
      warnings:[
        ...summary.warnings,
        ...(partial?['Foram atingidos os limites de paginação: resultados parciais.']:[]),
        'As transferências abrangem somente os chamados encontrados e sincronizados recentemente.',
        'Sem homologação de completude da importação histórica: não interpretar como estatística global.'
      ],
      notificationsSent:0,changesWritten:0
    });
  }catch(error){
    return respond(res,502,{
      error:error?.name==='AbortError'?
        'A consulta excedeu o tempo limite. Nenhuma alteração foi feita.':
        'Não foi possível consultar a movimentação das filas. Nenhuma alteração foi feita.',
      notificationsSent:0,changesWritten:0
    });
  }finally{clearTimeout(timeout)}
}
