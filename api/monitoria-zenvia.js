// Consulta protegida de ligações e áudio TotalVoice. Chats são atendidos exclusivamente pelo Movidesk.
// Não responde tokens, números de telefone, URLs de mídia ou mensagens para usuários não autorizados.
// Somente GET, sem envio de mensagens, sem alterar gravações ou configurações da Zenvia.
const VOICE='https://voice-api.zenvia.com';
const MAX_AUDIO=16*1024*1024;
const send=(res,status,data)=>res.status(status).json(data);
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const idOK=s=>/^\d{1,14}$/.test(s);
const days=(a,b)=>(Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000;

async function authorize(req){
 const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const jwt=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'')?.[1];
 if(!/^https:\/\//.test(base)||!key||!jwt)return {error:'Autenticação indisponível',status:401};
 const h={apikey:key,Authorization:'Bearer '+key};
 const u=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+jwt},signal:AbortSignal.timeout(12000)});
 if(!u.ok)return {error:'Sessão inválida',status:401};
 const user=await u.json();
 if(!user?.id)return {error:'Sessão inválida',status:401};
 const url=new URL(base+'/rest/v1/audit_users');
 url.searchParams.set('select','role,is_active');
 url.searchParams.set('user_id','eq.'+user.id);url.searchParams.set('limit','1');
 const response=await fetch(url,{headers:h,signal:AbortSignal.timeout(12000)});
 if(!response.ok)return {error:'Não foi possível validar permissões',status:503};
 const acl=await response.json();
 if(!Array.isArray(acl)||!acl.some(r=>r.is_active===true))
  return {error:'Usuário sem acesso ativo à Central',status:403};
 const admin=acl.some(r=>String(r.role).toLowerCase()==='admin'&&r.is_active===true);
 if(admin)return {ok:true,admin:true};
 // Managers may open only an approved recording for their own sector.
 // Never grant bulk call searches or access to arbitrary call identifiers.
 if(req.query.action!=='audio')return {error:'Listagem de chamadas restrita à Qualidade',status:403};
 const callId=String(req.query.id||''),kind=String(req.query.kind||'');
 if(!idOK(callId)||!['outbound','inbound'].includes(kind))
  return {error:'Identificação de gravação inválida',status:400};
 // Route must match the user's verified account and the review's sector.
 // Query only approved records of the requested call, then check manager routing.
 const reviews=new URL(base+'/rest/v1/audit_monitoria_reviews');
 reviews.searchParams.set('select','id,sector,source_id,recording_kind');
 reviews.searchParams.set('source_id','eq.'+callId);
 reviews.searchParams.set('recording_kind','eq.'+kind);
 reviews.searchParams.set('channel','eq.voice');
 reviews.searchParams.set('review_status','eq.approved');
 reviews.searchParams.set('limit','50');
 const matches=await fetch(reviews,{headers:h,signal:AbortSignal.timeout(12000)});
 if(!matches.ok)return {error:'Não foi possível conferir o acesso à gravação',status:503};
 const allowedReviews=await matches.json();
 if(!Array.isArray(allowedReviews)||allowedReviews.length===0)
  return {error:'Gravação sem monitoria aprovada vinculada',status:403};
 const routes=new URL(base+'/rest/v1/audit_monitoria_manager_routes');
 routes.searchParams.set('select','sector,manager_user_id,active');
 routes.searchParams.set('manager_user_id','eq.'+user.id);
 routes.searchParams.set('active','eq.true');
 routes.searchParams.set('limit','100');
 const routeRes=await fetch(routes,{headers:h,signal:AbortSignal.timeout(12000)});
 if(!routeRes.ok)return {error:'Não foi possível conferir vínculo do gestor',status:503};
 const rows=await routeRes.json();
 const assigned=new Set(Array.isArray(rows)?rows.filter(r=>r.active===true).map(r=>r.sector):[]);
 if(!allowedReviews.some(r=>assigned.has(r.sector)))
  return {error:'Gravação não atribuída a este gestor',status:403};
 return {ok:true,admin:false,scoped:true};
}
function normalizeCall(call,kind){
 const id=String(call?.id||'');
 if(!idOK(id))return null;
 const direction=kind==='outbound'?'Efetuada':'Recebida';
 const started=String(call?.data_criacao||call?.data_inicio||'').slice(0,32);
 const leg=kind==='outbound'?call.destino||{}:call;
 const length=Number(leg.duracao_falada_segundos??leg.duracao_segundos??0);
 return {id,kind,direction,started,status:String(leg.status||call.status_geral||'').slice(0,50),
  durationSeconds:Number.isFinite(length)&&length>=0?Math.round(length):0,
  recordingAvailable:!!call.url_gravacao};
}
async function provider(url,token,accept='application/json'){
 return fetch(url,{method:'GET',headers:{'Access-Token':token,Accept:accept},redirect:'error',signal:AbortSignal.timeout(25000)});
}
async function calls(req,res){
 const token=process.env.ZENVIA_VOICE_ACCESS_TOKEN;
 if(!token)return send(res,503,{ok:false,error:'Conexão Zenvia Voice não configurada'});
 const from=String(req.query.from||''),to=String(req.query.to||'');
 if(!validDate(from)||!validDate(to)||from>to||days(from,to)>7)
  return send(res,400,{ok:false,error:'Informe um período válido de até 7 dias'});
 const limit=Number(req.query.limit||50),page=Number(req.query.page||1);
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(page)||page<1||page>20)
  return send(res,400,{ok:false,error:'Paginação inválida'});
 const result=[];
 for(const [kind,path] of [['outbound','/chamada/relatorio'],['inbound','/did/relatorio']]){
  const u=new URL(VOICE+path);
  for(const [k,v] of [['data_inicio',from],['data_fim',to],['posicao',String((page-1)*limit)],['limite',String(limit)]])u.searchParams.set(k,v);
  const r=await provider(u,token);
  if(!r.ok)return send(res,502,{ok:false,error:'Não foi possível consultar a lista de chamadas da Zenvia'});
  const data=await r.json().catch(()=>null);
  if(data?.sucesso===false||!Array.isArray(data?.dados?.relatorio))
    return send(res,502,{ok:false,error:'Formato do relatório de chamadas não reconhecido'});
  result.push(...data.dados.relatorio.map(x=>normalizeCall(x,kind)).filter(Boolean));
 }
 return send(res,200,{ok:true,from,to,page,limit,calls:result.sort((a,b)=>b.started.localeCompare(a.started))});
}
async function audio(req,res){
 const token=process.env.ZENVIA_VOICE_ACCESS_TOKEN;
 if(!token)return send(res,503,{ok:false,error:'Zenvia Voice não configurada'});
 const id=String(req.query.id||''),kind=String(req.query.kind||'outbound');
 if(!idOK(id)||!['outbound','inbound'].includes(kind))return send(res,400,{ok:false,error:'Chamada inválida'});
 let result;
 if(kind==='inbound'){
  // A URL da gravação vem da resposta autenticada por ID, nunca de parâmetro do usuário.
  const detail=await provider(VOICE+'/did/chamada/'+id,token);
  if(!detail.ok)return send(res,502,{ok:false,error:'Detalhes da chamada recebida indisponíveis'});
  const body=await detail.json().catch(()=>null);
  const record=body?.dados;
  if(body?.sucesso===false||String(record?.id||'')!==id)
   return send(res,502,{ok:false,error:'Chamada não confirmada pela Zenvia'});
  const recording=String(record.url_gravacao||'');
  if(!recording)return send(res,404,{ok:false,error:'Esta ligação não possui gravação disponível'});
  let u;
  try{u=new URL(recording)}catch{return send(res,502,{ok:false,error:'Endereço da gravação inválido'})}
  // Allow only documented recording hosts; block arbitrary hosts, ports and redirects.
  if(u.protocol!=='https:'||u.port!==''||
     !['api.evoline.com.br','voice-api.zenvia.com'].includes(u.hostname)||
     u.username||u.password)
   return send(res,409,{ok:false,error:'Hospedagem da gravação ainda não homologada'});
  result=await fetch(u,{method:'GET',headers:{Accept:'audio/*'},redirect:'error',
    signal:AbortSignal.timeout(25000)});
 }else{
  result=await provider(VOICE+'/chamada/'+id+'/gravacao',token,'audio/mpeg');
 }
 if(!result.ok)return send(res,result.status===404?404:502,{ok:false,error:'Gravação não disponível para esta chamada'});
 const type=(result.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(!['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','application/octet-stream'].includes(type))
  return send(res,502,{ok:false,error:'A Zenvia não retornou um áudio reconhecido'});
 const length=Number(result.headers.get('content-length')||'0');
 if(length>MAX_AUDIO)return send(res,413,{ok:false,error:'Gravação acima do limite de 16 MB'});
 // Read at most MAX_AUDIO+1; never blindly buffer unbounded remote content.
 const reader=result.body?.getReader();if(!reader)return send(res,502,{ok:false,error:'Áudio indisponível'});
 const chunks=[];let size=0;
 try{
  for(;;){
   const part=await reader.read();if(part.done)break;
   size+=part.value.byteLength;
   if(size>MAX_AUDIO){await reader.cancel();return send(res,413,{ok:false,error:'Gravação excede 16 MB'});}
   chunks.push(part.value);
  }
 }finally{reader.releaseLock();}
 res.setHeader('Content-Type',type==='application/octet-stream'?'audio/mpeg':type);
 res.setHeader('Content-Disposition',`attachment; filename="ligacao-${id}.mp3"`);
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 return res.status(200).send(Buffer.concat(chunks.map(x=>Buffer.from(x)),size));
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return send(res,405,{ok:false,error:'Método não permitido'});
 try{
  const granted=await authorize(req);
  if(!granted.ok)return send(res,granted.status,{ok:false,error:granted.error});
  const action=String(req.query.action||'');
  if(action==='calls')return await calls(req,res);
  if(action==='audio')return await audio(req,res);
  return send(res,400,{ok:false,error:'Consulta desconhecida'});
 }catch{return send(res,502,{ok:false,error:'Não foi possível consultar a Zenvia'});}
}
