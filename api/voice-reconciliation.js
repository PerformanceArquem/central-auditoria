// Reconciliação de voz somente leitura. Nenhuma gravação/telefone completo é enviado ao navegador.
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const normalized = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const digits=value=>String(value||'').replace(/\D/g,'');
const phone=value=>{let n=digits(value);if(n.startsWith('55')&&n.length>11)n=n.slice(2);return n.length>=10&&n.length<=11?n:'';};
const mask=n=>n?'••••'+n.slice(-4):'Indisponível';
const parsedAt=value=>{const t=Date.parse(String(value||''));return Number.isFinite(t)?t:null;};
const originDate=x=>x.data_inicio||x.data_criacao||x.destino?.data_inicio;
const callPhone=x=>phone(x.numero_origem||x.origem_numero||x.telefone_origem||x.origem?.numero||x.caller_id||x.numero||x.telefone);
const callStatus=x=>normalized(x.status||x.destino?.status);
const callKind=x=>{
 const s=callStatus(x);
 if(x.ativa===true||x.ativa===1||['em andamento','chamando','ringing'].includes(s))return 'em_andamento';
 if(['atendida','atendido','answered','completada'].includes(s))return 'atendida';
 if(['cancelada','cancelado','abandonada','abandonado'].includes(s))return 'abandonada_ou_cancelada';
 if(['nao atendida','nao_atendida','sem resposta','no answer','busy','ocupado','ocupada','falha','failed'].includes(s))return 'nao_atendida';
 return 'indeterminada';
};
const ticketPhone=t=>{
 const p=t.payload||{}, clients=Array.isArray(p.clients)?p.clients:[];
 const possibilities=[p.phone,p.phoneNumber,p.telephone,p.callerPhone,p.contactPhone,
  ...clients.flatMap(c=>[c.phone,c.phoneNumber,c.telephone,c.cellPhone,c.mobilePhone,
   ...(Array.isArray(c.contacts)?c.contacts.map(z=>z.value||z.contact):[])])];
 return [...new Set(possibilities.map(phone).filter(Boolean))];
};
const telephonyActionCodes=new Set(['13','14','15','16','21']);
const telephonyActions=t=>{
 const raw=t.payload?.actions;
 return Array.isArray(raw)?raw.filter(a=>telephonyActionCodes.has(String(a?.origin??''))):[];
};
const linkedCallId=t=>{
 const p=t.payload||{};
 const direct=p.zenviaCallId||p.zenvia_call_id||p.voiceCallId||p.callId||p.telephonyCallId;
 if(direct!==undefined&&direct!==null&&String(direct).trim())return String(direct).trim();
 // Nunca extrair IDs a partir de texto livre ou números semelhantes a protocolos.
 // Um ID só é confiável quando está em um campo explicitamente identificado.
 for(const action of telephonyActions(t)){
  const value=action.zenviaCallId||action.voiceCallId||action.callId||action.telephonyCallId;
  if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim();
 }
 return '';
};
// A referência de gravação é uma pista independente: só comparar IDs contra
// url_gravacao da própria Zenvia; nunca expor URLs ou tokens de acesso.
const recordingIdFromTicket=t=>{
 for(const action of telephonyActions(t)){
  const html=String(action.htmlDescription||'').replace(/&amp;/g,'&');
  const matches=html.match(/https:\/\/voice-app\.zenvia\.com\/rec\?[^"'<>\s]+/g)||[];
  for(const link of matches){
   try{
    const url=new URL(link);
    if(url.hostname==='voice-app.zenvia.com'&&url.pathname==='/rec'){
     const id=url.searchParams.get('id');
     if(/^\d{6,15}$/.test(id||''))return id;
    }
   }catch(_){/* ignorar URLs inválidas */}
  }
 }
 return '';
};
const recordingIdFromCall=c=>{
 const raw=String(c.url_gravacao||'');
 try{
  const url=new URL(raw);
  // Formatos documentados: /rec/?id=... e /rec/{id}.
  // Só hosts oficiais conhecidos; sem seguir links nem revelar seus parâmetros.
  const hosts=new Set(['voice-api.zenvia.com','voice-app.zenvia.com','api.evoline.com.br']);
  if(url.protocol!=='https:'||!hosts.has(url.hostname))return '';
  const path=/^\/rec\/(\d{6,15})\/?$/.exec(url.pathname);
  if(path)return path[1];
  if(url.pathname!=='/rec/'&&url.pathname!=='/rec')return '';
  const id=url.searchParams.get('id');
  return /^\d{6,15}$/.test(id||'')?id:'';
 }catch(_){return '';}
};
export function reconcile(calls,tickets,{maxGapMinutes=20}={}){
 const prepared=tickets.map(t=>({...t,phones:ticketPhone(t),callId:linkedCallId(t),
  actions:telephonyActions(t),recordingId:recordingIdFromTicket(t),time:parsedAt(t.created_at_source||t.payload?.createdDate)}));
 const unique=new Set(),entries=[];
 for(const call of calls){
  const id=String(call.id??'').trim();
  const key=id?'id:'+id:JSON.stringify([originDate(call),callPhone(call),callStatus(call)]);
  if(unique.has(key))continue;unique.add(key);
  const at=parsedAt(originDate(call)),number=callPhone(call);
  let choices=prepared.filter(t=>id&&t.callId===id).map(t=>({ticket:t,method:'id',delta:0}));
  const recordingId=recordingIdFromCall(call);
  if(!choices.length&&recordingId)choices=prepared.filter(t=>t.recordingId===recordingId)
    .map(t=>({ticket:t,method:'gravacao',delta:0}));
  if(!choices.length&&number&&at!==null){
   // Movidesk pode criar o ticket muito antes/depois do evento de telefonia.
   // O instante da ação de telefonia é a única referência para aproximação.
   choices=prepared.filter(t=>t.actions.length&&t.phones.includes(number))
    .map(t=>{
      const deltas=t.actions.map(a=>parsedAt(a.createdDate)).filter(time=>time!==null)
       .map(time=>Math.abs(time-at));
      return deltas.length?{ticket:t,method:'telefone_horario_evento',
        delta:Math.min(...deltas)}:null;
    }).filter(c=>c&&c.delta<=maxGapMinutes*60000)
    .sort((x,y)=>x.delta-y.delta);
  }
  entries.push({call,id,number,choices});
 }
 // Não decidir pelo primeiro registro quando duas chamadas concorrem
 // pelo mesmo ticket. Ambas permanecem ambíguas para revisão.
 const contenders=new Map();
 for(const entry of entries){
  for(const choice of entry.choices){
   const key=String(choice.ticket.ticket_id);
   contenders.set(key,(contenders.get(key)||0)+1);
  }
 }
 const records=[];
 for(const entry of entries){
  const {call,id,number,choices}=entry;
  const single=choices.length===1&&contenders.get(String(choices[0].ticket.ticket_id))===1;
  const match=single?choices[0]:null;
  const collision=choices.length>1||(choices.length===1&&!single);
  records.push({callId:id||null,startedAt:originDate(call)||null,
   phoneMasked:mask(number),status:callKind(call),
   providerStatus:String(call.status||call.destino?.status||'').slice(0,60),
   ticketId:match?.ticket.ticket_id||null,matchMethod:match?.method||null,
   deltaSeconds:match?Math.round(match.delta/1000):null,
   movideskTelephonyOrigins:match?[...new Set(match.ticket.actions.map(a=>String(a.origin)))]:[],
   reconciliation:match?(match.method==='id'?'vinculado':match.method==='gravacao'?'vinculado_gravacao':'possivel_vinculo'):
      collision?'ambiguo':number?'sem_vinculo_identificado':'dados_insuficientes'});
 }
 const stats={total:records.length,vinculado:0,vinculado_gravacao:0,possivel_vinculo:0,sem_vinculo_identificado:0,
  ambiguo:0,dados_insuficientes:0,ticket_ja_utilizado:0,atendida:0,
  nao_atendida:0,abandonada_ou_cancelada:0,em_andamento:0,indeterminada:0};
 for(const r of records){stats[r.reconciliation]++;stats[r.status]++;}
 const ticketsWithPhone=prepared.filter(t=>t.phones.length>0).length;
 const ticketsWithCallId=prepared.filter(t=>t.callId.length>0).length;
 const ticketsWithRecordingReference=prepared.filter(t=>t.recordingId.length>0).length;
 const ticketsWithTelephonyAction=prepared.filter(t=>t.actions.length>0).length;
 const telephonyActionsWithoutCallId=prepared.reduce((n,t)=>n+t.actions.filter(a=>
  ![a.zenviaCallId,a.voiceCallId,a.callId,a.telephonyCallId].some(v=>
   v!==undefined&&v!==null&&String(v).trim())).length,0);
 const withPhone=records.filter(r=>r.phoneMasked!=='Indisponível').length;
 return {stats,records,coverage:{callsWithPhone:withPhone,
  callsWithoutPhone:records.length-withPhone,ticketsWithPhone,ticketsWithCallId,
  ticketsWithTelephonyAction,ticketsWithRecordingReference,telephonyActionsWithoutCallId,
  ticketsWithoutPhone:prepared.length-ticketsWithPhone}};
}
async function auth(req,base,key,signal){
 const bearer=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'');
 if(!bearer)return {code:401,error:'Faça login na Central'};
 const u=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+bearer[1]},signal});
 if(!u.ok)return {code:401,error:'Sessão inválida'};
 const user=await u.json();
 const url=new URL(base+'/rest/v1/audit_users');url.searchParams.set('select','role,is_active');
 url.searchParams.set('user_id','eq.'+user.id);url.searchParams.set('limit','1');
 const p=await fetch(url,{headers:{apikey:key,Authorization:'Bearer '+key},signal});
 if(!p.ok)return {code:503,error:'Permissões indisponíveis'};
 const rows=await p.json();
 return Array.isArray(rows)&&rows.some(x=>String(x.role).toLowerCase()==='admin'&&x.is_active!==false)
  ?{code:200}:{code:403,error:'Apenas administradores podem conciliar chamadas'};
}
// Retorna apenas entradas em DIDs explicitamente confirmados como encaminhados à URA.
// A API DID demonstra chegada ao número; a passagem efetiva pelo menu depende do fluxo/ webhook.
const didNumber=value=>digits(value).replace(/^55(?=\d{10,11}$)/,'');
const uraDidFilter=()=>{
 const raw=String(process.env.ZENVIA_URA_DID_NUMBERS||'').trim();
 const numbers=raw.split(',').map(didNumber).filter(Boolean);
 if(!raw||!numbers.length||numbers.length>30||numbers.some(x=>x.length<10||x.length>11)||new Set(numbers).size!==numbers.length)
  throw new Error('Informe os números DID ligados à URA no servidor');
 return new Set(numbers);
};
async function zenviaCalls(start,end,token,signal){
 const approvedDids=uraDidFilter();
 // IDs consultados a partir do cadastro da própria conta, apenas para DIDs
 // previamente homologados como ligados à URA. Outros DIDs ficam fora.
 const catalogResponse=await fetch('https://voice-api.zenvia.com/did',{
  method:'GET',headers:{'Access-Token':token,Accept:'application/json'},signal
 });
 if(!catalogResponse.ok)throw new Error('Cadastro DID indisponível');
 const catalog=await catalogResponse.json();
 const rows=catalog?.dados?.dids;
 if(catalog?.sucesso===false||!Array.isArray(rows)||rows.length>1000)
  throw new Error('Cadastro DID inválido');
 const matched=rows.filter(row=>approvedDids.has(didNumber(row.numero)));
 if(matched.length!==approvedDids.size||
  matched.some(row=>!/^\d+$/.test(String(row.id||'')))||
  new Set(matched.map(row=>didNumber(row.numero))).size!==approvedDids.size)
  throw new Error('DID da URA não encontrado de forma única no cadastro');
 // GET /did documenta apenas id, cidade, estado e número, sem ura_id.
 // É obrigatório o operador confirmar a lista de números exclusivos da URA
 // e registrar essa confirmação no ambiente de homologação.
 // Não tratar ausência de ura_id na API como falha do DID, nem inferir URA.
 if(process.env.ZENVIA_URA_SCOPE_CONFIRMED!=='true')
  throw new Error('Escopo dos números DID da URA ainda não homologado');
 // Se a API vier a informar roteamento, respeitá-lo e falhar fechado.
 if(matched.some(row=>row.ura_id!==undefined&&row.ura_id!==null&&row.ura_id!==''&&
    (row.ramal_id!==undefined&&row.ramal_id!==null&&row.ramal_id!=='')))
  throw new Error('DID com roteamento incompatível');
 const all=[];
 for(const did of matched){
  let offset=0,done=false;
  for(let page=0;page<20;page++){
   const url=new URL('https://voice-api.zenvia.com/did/'+encodeURIComponent(String(did.id))+'/relatorio');
   Object.entries({data_inicio:start,data_fim:end,posicao:String(offset),limite:'200'})
    .forEach(([k,v])=>url.searchParams.set(k,v));
   const response=await fetch(url,{method:'GET',headers:{'Access-Token':token,Accept:'application/json'},signal});
   if(!response.ok)throw new Error('Relatório de DID da URA indisponível');
   const body=await response.json(),calls=body?.dados?.relatorio,total=Number(body?.dados?.total);
   if(body?.sucesso===false||!Array.isArray(calls)||!Number.isInteger(total)||total<0||total>4000)
    throw new Error('Relatório DID incompleto');
   // Falha fechada caso o relatório do DID inclua chamadas de outro número.
   if(calls.some(call=>didNumber(call.numero_destino)!==didNumber(did.numero)))
    throw new Error('O relatório do DID contém chamadas fora do escopo');
   all.push(...calls);offset+=calls.length;
   if(offset>=total){done=true;break;}
   if(!calls.length)throw new Error('Paginação Zenvia incompleta');
  }
  if(!done)throw new Error('Relatório DID excedeu paginação; reduza o período');
 }
 return all;
}
async function movideskTickets(start,end,base,key,signal){
 const all=[],begin=new Date(new Date(start+'T00:00:00-03:00').getTime()-20*60000).toISOString(),
 until=new Date(new Date(end+'T00:00:00-03:00').getTime()+86400000+20*60000).toISOString();
 for(let offset=0;offset<10000;offset+=500){
  const url=new URL(base+'/rest/v1/audit_direct_tickets');
  url.searchParams.set('select','ticket_id,payload,created_at_source');
  url.searchParams.set('created_at_source','gte.'+begin);
  url.searchParams.set('created_at_source','lt.'+until);
  url.searchParams.set('order','created_at_source.asc');url.searchParams.set('limit','500');
  url.searchParams.set('offset',String(offset));
  const response=await fetch(url,{headers:{apikey:key,Authorization:'Bearer '+key},signal});
  if(!response.ok)throw new Error('Não foi possível ler os chamados sincronizados');
  const page=await response.json();if(!Array.isArray(page))throw new Error('Resposta Movidesk inválida');
  all.push(...page);if(page.length<500)return all;
 }
 throw new Error('Muitos chamados; reduza o intervalo');
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método não permitido'});
 const start=String(req.query?.start||''),end=String(req.query?.end||'');
 const valid=x=>DATE.test(x)&&!Number.isNaN(Date.parse(x+'T12:00:00Z'))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
 if(!valid(start)||!valid(end)||end<start||(Date.parse(end)-Date.parse(start))/86400000>7)
  return res.status(400).json({ok:false,error:'Selecione até 7 dias válidos'});
 const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY,token=process.env.ZENVIA_VOICE_ACCESS_TOKEN;
 if(!/^https:\/\//.test(base)||!key||!token)return res.status(503).json({ok:false,error:'Integrações não configuradas no servidor'});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
 try{
  const access=await auth(req,base,key,controller.signal);
  if(access.code!==200)return res.status(access.code).json({ok:false,error:access.error});
  try{uraDidFilter();}catch(_){return res.status(503).json({ok:false,error:'Configure e valide os números DID de entrada da URA no servidor para habilitar a conciliação.'});}
  const [calls,tickets]=await Promise.all([zenviaCalls(start,end,token,controller.signal),movideskTickets(start,end,base,key,controller.signal)]);
  const result=reconcile(calls,tickets);
  return res.status(200).json({ok:true,from:start,to:end,source:'Zenvia Voice × Movidesk sincronizado',
   ...result,metadata:{ticketsExamined:tickets.length,scope:'Chamadas recebidas nos DIDs confirmados como entrada da URA',
    uraEntryVerified:false,
    caveat:'A chegada ao DID não confirma que o menu da URA foi executado. Apenas ID compartilhado confirma um vínculo; telefone e horário indicam hipótese. Sem vínculo não comprova falha de criação. Para afirmar 100% das entradas efetivas, validar evento de URA e regra de abertura do Movidesk.'}});
 }catch(error){
  return res.status(error?.name==='AbortError'?504:502).json({ok:false,error:'Falha ao conciliar as fontes. Confira integração e registros.'});
 }finally{clearTimeout(timer);}
}
