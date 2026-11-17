import {prepareReview,isUuid} from '../lib/monitoria-review-validation.js';
const fail=(res,status,error)=>res.status(status).json({ok:false,error});
const dateOK=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const str=(x,n=300)=>String(x??'').trim().slice(0,n);
async function authenticate(req){
 const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const jwt=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'')?.[1];
 if(!base.startsWith('https://')||!key||!jwt)return {status:401,error:'Faça login'};
 const svc={apikey:key,Authorization:'Bearer '+key};
 const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+jwt},signal:AbortSignal.timeout(10000)});
 if(!auth.ok)return {status:401,error:'Sessão inválida'};
 const user=await auth.json();if(!isUuid(user?.id))return {status:401,error:'Usuário inválido'};
 const u=new URL(base+'/rest/v1/audit_users');
 u.searchParams.set('select','role,is_active');
 u.searchParams.set('user_id','eq.'+user.id);u.searchParams.set('limit','1');
 const r=await fetch(u,{headers:svc,signal:AbortSignal.timeout(10000)});
 if(!r.ok)return {status:503,error:'Perfis indisponíveis'};
 const rows=await r.json();
 const active=Array.isArray(rows)&&rows.some(v=>v.is_active===true);
 if(!active)return {status:403,error:'Acesso não autorizado'};
 const admin=rows.some(v=>v.is_active===true&&String(v.role).toLowerCase()==='admin');
 return {base,svc,userId:user.id,admin};
}
async function db(auth,table,params={},method='GET',body=null,extraHeaders={}){
 const url=new URL(auth.base+'/rest/v1/'+table);
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
 const r=await fetch(url,{
  method,headers:{...auth.svc,'Content-Type':'application/json',...extraHeaders},
  body:body==null?undefined:JSON.stringify(body),
  signal:AbortSignal.timeout(12000),redirect:'error'
 });
 if(!r.ok)throw new Error('Não foi possível acessar os registros de monitoria ('+r.status+')');
 if(r.status===204)return [];
 return await r.json();
}
function boundedDates(query){
 const today=new Date().toISOString().slice(0,10);
 const from=str(query.from||today.slice(0,7)+'-01',10);
 const to=str(query.to||today,10);
 if(!dateOK(from)||!dateOK(to)||from>to||
  (Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))>366*86400000)
  throw Error('Período de relatório inválido');
 return {from,to};
}
async function list(req,res,auth){
 const kind=str(req.query.kind,20);
 if(kind==='alerts'){
  const filter=auth.admin?{}:{manager_user_id:'eq.'+auth.userId};
  const result=await db(auth,'audit_monitoria_alerts',{
   select:'id,review_id,created_at,manager_user_id,sector,status,acknowledged_at,manager_feedback,audit_monitoria_reviews(channel,source_id,collaborator_name,score_suggested,critical_findings)',
   ...filter,order:'created_at.desc',limit:'150'
  });
  return res.status(200).json({ok:true,alerts:result,mode:'polling',intervalSeconds:15});
 }
 if(kind==='routes'){
  if(!auth.admin)return fail(res,403,'Configuração reservada a administradores');
  const routes=await db(auth,'audit_monitoria_manager_routes',{select:'sector,manager_user_id,active,configured_at',order:'sector.asc',limit:'100'});
  return res.status(200).json({ok:true,routes});
 }
 if(kind!=='reviews')return fail(res,400,'Consulta inválida');
 if(!auth.admin)return fail(res,403,'Relatórios disponíveis apenas para a Qualidade autorizada');
 const {from,to}=boundedDates(req.query);
 const collaborator=str(req.query.collaborator||'',160);
 const filter=collaborator?{collaborator_name:'eq.'+collaborator}:{};
 const rows=await db(auth,'audit_monitoria_reviews',{
  select:'id,created_at,created_by,channel,source_id,sector,collaborator_name,reviewer_name,monitored_at,recording_kind,evidence_reference,ruleset_version,score_suggested,score_approved,critical_suspected,critical_confirmed,critical_findings,criteria,review_status,approved_at,reviewer_notes,audit_monitoria_alerts(status,created_at,manager_user_id,acknowledged_at,manager_feedback)',
  monitored_at:'gte.'+from,
  and:'(monitored_at.lte.'+to+')',
  ...filter,
  order:'monitored_at.desc',limit:'1000'
 });
 return res.status(200).json({ok:true,reviews:rows,from,to,partial:rows.length>=1000});
}
async function submit(req,res,auth,body){
 if(!auth.admin)return fail(res,403,'Somente a Qualidade autorizada pode registrar avaliações');
 if(body.consent!==true)return fail(res,400,'Confirme o registro da monitoria');
 let review;
 try{review=prepareReview(body,auth.userId)}catch(e){return fail(res,400,e.message)}
 // Insert triggers a critical alert in the SAME database transaction.
 const rows=await db(auth,'audit_monitoria_reviews',{on_conflict:'client_request_id'},
  'POST',review,{Prefer:'return=representation,resolution=ignore-duplicates'});
 const item=rows[0];
 if(!item){
  const duplicate=await db(auth,'audit_monitoria_reviews',{
   select:'id,critical_suspected,review_status',client_request_id:'eq.'+review.client_request_id,created_by:'eq.'+auth.userId,limit:'1'
  });
  if(!duplicate.length)return fail(res,409,'Monitoria duplicada ou indisponível');
  return res.status(200).json({ok:true,review:duplicate[0],duplicate:true});
 }
 return res.status(201).json({ok:true,review:{id:item.id,critical_suspected:item.critical_suspected,review_status:item.review_status},
  immediateInternalAlert:item.critical_suspected,dispatchedEmail:false});
}
async function approve(req,res,auth,body){
 if(!auth.admin)return fail(res,403,'A aprovação pertence à Qualidade');
 if(!isUuid(body.reviewId)||typeof body.confirmCritical!=='boolean')return fail(res,400,'Confirme a classificação crítica');
 const match=await db(auth,'audit_monitoria_reviews',{
  select:'id,critical_suspected,score_suggested,review_status',
  id:'eq.'+body.reviewId,limit:'1'
 });
 const review=match[0];if(!review||review.review_status!=='provisional')return fail(res,409,'Monitoria inexistente ou já aprovada');
 const criticalConfirmed=review.critical_suspected&&body.confirmCritical;
 const approvedScore=criticalConfirmed?0:Number(body.score);
 if(!Number.isFinite(approvedScore)||approvedScore<0||approvedScore>100)
  return fail(res,400,'Nota aprovada inválida');
 const notes=str(body.notes,1800);
 const result=await db(auth,'audit_monitoria_reviews',{id:'eq.'+body.reviewId,review_status:'eq.provisional'},'PATCH',{
  review_status:'approved',score_approved:approvedScore,critical_confirmed:criticalConfirmed,
  approved_by:auth.userId,approved_at:new Date().toISOString(),reviewer_notes:notes
 },{Prefer:'return=representation'});
 if(result.length!==1)return fail(res,409,'Aprovação simultânea; atualize a monitoria');
 if(review.critical_suspected&&!criticalConfirmed){
  await db(auth,'audit_monitoria_alerts',{review_id:'eq.'+body.reviewId,status:'in.(unread,routing_pending)'},'PATCH',{
   status:'dismissed',manager_feedback:'Descartado após validação da Qualidade'
  },{Prefer:'return=minimal'});
 }
 return res.status(200).json({ok:true,reviewId:body.reviewId,scoreApproved:approvedScore,criticalConfirmed});
}
async function ack(req,res,auth,body){
 if(!isUuid(body.alertId))return fail(res,400,'Alerta inválido');
 const data=await db(auth,'audit_monitoria_alerts',{select:'id,manager_user_id,status',id:'eq.'+body.alertId,limit:'1'});
 const alert=data[0];if(!alert)return fail(res,404,'Alerta não localizado');
 if(!auth.admin&&alert.manager_user_id!==auth.userId)return fail(res,403,'Este alerta pertence a outro gestor');
 if(alert.status!=='unread')return fail(res,409,'Alerta não está pendente de ciência');
 const result=await db(auth,'audit_monitoria_alerts',{id:'eq.'+body.alertId,status:'eq.unread'},'PATCH',{
  status:'acknowledged',acknowledged_by:auth.userId,acknowledged_at:new Date().toISOString(),
  manager_feedback:str(body.notes,900)
 },{Prefer:'return=representation'});
 if(result.length!==1)return fail(res,409,'Alerta já tratado');
 return res.status(200).json({ok:true,alertId:body.alertId});
}
async function route(req,res,auth,body){
 if(!auth.admin)return fail(res,403,'Somente administradores configuram gestores');
 const sector=str(body.sector,100),managerId=str(body.managerUserId,40);
 if(!sector||!isUuid(managerId))return fail(res,400,'Setor ou identificador do gestor inválido');
 const eligible=await db(auth,'audit_users',{select:'user_id',user_id:'eq.'+managerId,is_active:'eq.true',limit:'1'});
 if(!eligible.length)return fail(res,400,'Gestor sem usuário ativo na Central');
 await db(auth,'audit_monitoria_manager_routes',{on_conflict:'sector'},'POST',
   {sector,manager_user_id:managerId,active:true},
   {Prefer:'resolution=merge-duplicates,return=representation'});
 const pending=await db(auth,'audit_monitoria_alerts',{sector:'eq.'+sector,status:'eq.routing_pending'},'PATCH',
  {manager_user_id:managerId,status:'unread'},
  {Prefer:'return=representation'});
 return res.status(200).json({ok:true,sector,assignedPending:pending.length,dispatchedEmail:false});
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method))return fail(res,405,'Método não permitido');
 try{
  const auth=await authenticate(req);
  if(auth.error)return fail(res,auth.status,auth.error);
  if(req.method==='GET')return await list(req,res,auth);
  const body=req.body&&typeof req.body==='object'?req.body:{};
  if(JSON.stringify(body).length>85000)return fail(res,413,'Monitoria excede o tamanho permitido');
  if(body.action==='submit')return await submit(req,res,auth,body);
  if(body.action==='approve')return await approve(req,res,auth,body);
  if(body.action==='ack')return await ack(req,res,auth,body);
  if(body.action==='route')return await route(req,res,auth,body);
  return fail(res,400,'Operação inválida');
 }catch(e){return fail(res,503,'Serviço de monitoria indisponível. Confira a migração e as permissões');}
}
