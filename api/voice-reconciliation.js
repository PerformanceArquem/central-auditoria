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
const linkedCallId=t=>{
 const p=t.payload||{};
 return String(p.zenviaCallId||p.zenvia_call_id||p.voiceCallId||p.callId||p.telephonyCallId||'').trim();
};
export function reconcile(calls,tickets,{maxGapMinutes=20}={}){
 const records=[],matchedTickets=new Set();
 const prepared=tickets.map(t=>({...t,phones:ticketPhone(t),callId:linkedCallId(t),
  time:parsedAt(t.created_at_source||t.payload?.createdDate)}));
 const unique=new Set();
 for(const call of calls){
  const id=String(call.id??'').trim();
  const key=id?'id:'+id:JSON.stringify([originDate(call),callPhone(call),callStatus(call)]);
  if(unique.has(key))continue;
  unique.add(key);
  const at=parsedAt(originDate(call)),number=callPhone(call);
  let choices=prepared.filter(t=>id&&t.callId===id).map(t=>({ticket:t,method:'id',delta:0}));
  if(!choices.length&&number&&at!==null){
   choices=prepared.filter(t=>t.time!==null&&t.phones.includes(number)&&
     Math.abs(t.time-at)<=maxGapMinutes*60000)
     .map(t=>({ticket:t,method:'telefone_horario',delta:Math.abs(t.time-at)}))
     .sort((a,b)=>a.delta-b.delta);
  }
  const available=choices.filter(c=>!matchedTickets.has(c.ticket.ticket_id));
  const match=available.length===1?available[0]:null;
  if(match)matchedTickets.add(match.ticket.ticket_id);
  records.push({callId:id||null,startedAt:originDate(call)||null,phoneMasked:mask(number),
   status:callKind(call),providerStatus:String(call.status||call.destino?.status||'').slice(0,60),
   ticketId:match?.ticket.ticket_id||null,matchMethod:match?.method||null,
   reconciliation:match?'vinculado':choices.length>1?'ambiguo':number?'sem_vinculo_identificado':'dados_insuficientes'});
 }
 const stats={total:records.length,vinculado:0,sem_vinculo_identificado:0,ambiguo:0,dados_insuficientes:0,
  atendida:0,nao_atendida:0,abandonada_ou_cancelada:0,em_andamento:0,indeterminada:0};
 for(const x of records){stats[x.reconciliation]++;stats[x.status]++;}
 return {stats,records};
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
async function zenviaCalls(start,end,token,signal){
 const calls=[];
 for(let offset=0;offset<4000;){
  const url=new URL('https://voice-api.zenvia.com/did/relatorio');
  Object.entries({data_inicio:start,data_fim:end,posicao:String(offset),limite:'200'})
   .forEach(([k,v])=>url.searchParams.set(k,v));
  const response=await fetch(url,{headers:{'Access-Token':token,Accept:'application/json'},signal});
  if(!response.ok)throw new Error('Falha na API Zenvia');
  const data=await response.json(),rows=data?.dados?.relatorio,total=Number(data?.dados?.total);
  if(data?.sucesso===false||!Array.isArray(rows)||!Number.isInteger(total)||total<0||total>4000)
   throw new Error('Relatório Zenvia incompleto');
  calls.push(...rows);
  offset+=rows.length;
  if(offset>=total)return calls;
  if(!rows.length)throw new Error('Paginação Zenvia incompleta');
 }
 throw new Error('Reduza o intervalo de datas');
}
async function movideskTickets(start,end,base,key,signal){
 const all=[],begin=new Date(start+'T00:00:00-03:00').toISOString(),
 until=new Date(new Date(end+'T00:00:00-03:00').getTime()+86400000).toISOString();
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
  const [calls,tickets]=await Promise.all([zenviaCalls(start,end,token,controller.signal),movideskTickets(start,end,base,key,controller.signal)]);
  const result=reconcile(calls,tickets);
  return res.status(200).json({ok:true,from:start,to:end,source:'Zenvia Voice × Movidesk sincronizado',
   ...result,metadata:{ticketsExamined:tickets.length,scope:'Ligações recebidas (DID)',
    caveat:'Sem vínculo identificado NÃO prova que a criação de chamado falhou. Valide integração, campos e regras; registros sem telefone não são vinculados por suposição.'}});
 }catch(error){
  return res.status(error?.name==='AbortError'?504:502).json({ok:false,error:'Falha ao conciliar as fontes. Confira integração e registros.'});
 }finally{clearTimeout(timer);}
}
