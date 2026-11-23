import {inspectTickets,recordOccurrences} from '../lib/ticket-inspection.mjs';
const codes=['overdue','no_forecast','invalid_forecast','no_owner','no_appointments','idle','queue'];
const validBase=value=>/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(value);
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Allow','GET, POST');
  const fail=(status,error)=>res.status(status).json({ok:false,error});
  if(!['GET','POST'].includes(req.method))return fail(405,'Método não permitido');
  if(process.env.TICKET_INSPECTION_ENABLED!=='true')return fail(503,'Consulta sincronizada de fiscalização ainda não habilitada.');
  const id=String(req.query?.id||'');
  if(!/^\d{1,12}$/.test(id))return fail(400,'Número de chamado inválido');
  const bearer=/^Bearer ([A-Za-z0-9._-]{1,16000})$/.exec(req.headers.authorization||'');
  if(!bearer)return fail(401,'Entre no sistema para consultar a fiscalização.');
  const base=String(process.env.SUPABASE_URL||'').replace(/\/+$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!validBase(base)||!key)return fail(503,'Consulta sincronizada indisponível.');
  const historyBase=String(process.env.TICKET_INSPECTION_HISTORY_URL||'').replace(/\/+$/,''),historyKey=process.env.TICKET_INSPECTION_HISTORY_SERVICE_ROLE_KEY;
  // Persistence requires a different project and is forbidden in production.
  const storage=process.env.TICKET_INSPECTION_PERSIST==='true'&&process.env.VERCEL_ENV!=='production'&&validBase(historyBase)&&historyBase!==base&&!!historyKey;
  let requestId;
  if(req.method==='POST'){
    if(!storage)return fail(409,'Registro persistente desativado; utilize o projeto separado de homologação.');
    let body=req.body;
    try{if(typeof body==='string')body=JSON.parse(body);}catch{return fail(400,'Corpo inválido');}
    requestId=body?.requestId;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId||''))return fail(400,'Identificador de registro inválido');
  }
  const signal=AbortSignal.timeout(15000);
  async function request(url,headers,options={}){
    const r=await fetch(url,{...options,headers,signal,redirect:'error'});
    if(!r.ok)throw Error('Consulta indisponível');return r.json();
  }
  const headers={apikey:key,Authorization:'Bearer '+key};
  const hheaders={apikey:historyKey,Authorization:'Bearer '+historyKey};
  try{
    const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+bearer[1]},signal,redirect:'error'});
    if(!auth.ok)return fail(401,'Sessão expirada.');
    const user=await auth.json();if(!user?.id)return fail(401,'Sessão inválida.');
    const aclUrl=new URL(base+'/rest/v1/audit_users');
    aclUrl.search=new URLSearchParams({select:'role,is_active',user_id:'eq.'+user.id,limit:'1'}).toString();
    const acl=await request(aclUrl,headers);
    if(!Array.isArray(acl)||!acl.some(r=>r.role==='admin'&&r.is_active===true))return fail(403,'Consulta reservada a administradores ativos.');
    const url=new URL(base+'/rest/v1/audit_direct_tickets');
    url.search=new URLSearchParams({select:'ticket_id,payload,closed_at_source,source_synced_at',ticket_id:'eq.'+id,limit:'1'}).toString();
    const records=await request(url,headers);
    if(!Array.isArray(records))throw Error('Dados inválidos');
    if(!records.length)return fail(404,'Chamado não encontrado na base sincronizada.');
    const source=records[0],now=Date.now(),items=inspectTickets([source],{now});
    const item=items[0]||{id,findings:[],evaluatedCodes:codes,closed:true};
    const sourceAt=source.source_synced_at||null;
    const warnings=['Os resultados refletem somente os dados sincronizados; ausência de histórico não comprova ausência de transferências.'];
    if(!sourceAt||!Number.isFinite(Date.parse(sourceAt)))warnings.push('Data da sincronização indisponível: confira a atualização na origem.');
    else if(now-Date.parse(sourceAt)>86400000)warnings.push('Dados sincronizados há mais de 24 horas: confira a situação atual antes de cobrar o responsável.');
    let history=[],historyPartial=false,saved=false;
    if(storage){
      if(req.method==='POST'){
        if(!sourceAt||!Number.isFinite(Date.parse(sourceAt)))return fail(409,'A origem não informa quando o chamado foi sincronizado.');
        const result=await request(historyBase+'/rest/v1/rpc/audit_record_ticket_inspection',{...hheaders,'Content-Type':'application/json'},{method:'POST',body:JSON.stringify({p_request_id:requestId,p_ticket_id:id,p_source_synced_at:sourceAt,p_actor:user.id,p_findings:item.findings,p_evaluated_codes:item.evaluatedCodes,p_score:item.score??0})});
        if(result?.stale)return fail(409,'Uma fiscalização mais recente já foi registrada. Atualize a origem.');
        if(result?.saved!==true)throw Error('Registro não confirmado');
        saved=true;
      }
      const hu=new URL(historyBase+'/rest/v1/audit_ticket_inspection_snapshots');
      hu.search=new URLSearchParams({select:'findings,evaluated_codes,observed_at',ticket_id:'eq.'+id,order:'observed_at.desc,id.desc',limit:'1001'}).toString();
      const snapshots=await request(hu,hheaders);
      if(!Array.isArray(snapshots))throw Error('Histórico inválido');
      historyPartial=snapshots.length>1000;
      for(const snapshot of snapshots.slice(0,1000).reverse())history=recordOccurrences(history,[{id,findings:snapshot.findings,evaluatedCodes:snapshot.evaluated_codes}],Date.parse(snapshot.observed_at));
      if(historyPartial)warnings.push('Histórico limitado às últimas mil verificações; a primeira detecção exibida pode não ser a original.');
    }
    return res.status(200).json({ok:true,item,sourceSyncedAt:sourceAt,generatedAt:new Date(now).toISOString(),history,historyPartial,storageEnabled:storage,saved,warnings});
  }catch{return fail(502,'Não foi possível consultar ou registrar a fiscalização. Nenhum reenvio automático será realizado.');}
}
