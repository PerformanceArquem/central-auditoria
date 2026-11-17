// Read-only, bounded selection of support chat candidates from existing synchronized data.
// Never persists media, transcripts or marks a monitoring review as completed.
const json=(res,status,data)=>{res.setHeader('Cache-Control','private, no-store');return res.status(status).json(data)};
export default async function handler(req,res){
 if(req.method!=='GET')return json(res,405,{ok:false,error:'Método não permitido'});
 const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const jwt=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'')?.[1];
 if(!/^https:\/\//.test(base)||!secret)return json(res,503,{ok:false,error:'Serviço não configurado'});
 if(!jwt)return json(res,401,{ok:false,error:'Autenticação obrigatória'});
 const headers={apikey:secret,Authorization:'Bearer '+secret};
 try{
  const verify=await fetch(base+'/auth/v1/user',{headers:{apikey:secret,Authorization:'Bearer '+jwt},signal:AbortSignal.timeout(10000)});
  if(!verify.ok)return json(res,401,{ok:false,error:'Sessão inválida'});
  const user=await verify.json();
  const acl=new URL(base+'/rest/v1/audit_users');
  acl.searchParams.set('select','role,is_active');acl.searchParams.set('user_id','eq.'+user.id);acl.searchParams.set('limit','1');
  const ar=await fetch(acl,{headers,signal:AbortSignal.timeout(10000)});
  if(!ar.ok)return json(res,503,{ok:false,error:'Falha ao validar permissão'});
  const profiles=await ar.json();
  if(!Array.isArray(profiles)||!profiles.some(x=>x.is_active===true&&String(x.role).toLowerCase()==='admin'))
   return json(res,403,{ok:false,error:'Acesso restrito à Qualidade autorizada'});
  const days=Math.min(90,Math.max(7,Number.parseInt(String(req.query.days||30),10)||30));
  const from=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
  const url=new URL(base+'/rest/v1/audit_direct_appointments');
  for(const [k,v] of Object.entries({select:'collaborator_name,ticket_id,appointment_date',sector:'eq.Suporte',appointment_date:'gte.'+from,order:'appointment_date.desc',limit:'1000'}))url.searchParams.set(k,v);
  const r=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});
  if(!r.ok)return json(res,503,{ok:false,error:'Apontamentos indisponíveis'});
  const rows=await r.json();
  if(!Array.isArray(rows))throw Error('Formato inválido');
  const byName=new Map();
  for(const row of rows){
   const name=String(row.collaborator_name||'').trim().slice(0,160),ticket=String(row.ticket_id||'');
   if(!name||!/^\d{1,12}$/.test(ticket))continue;
   if(!byName.has(name))byName.set(name,[]);
   const list=byName.get(name);
   if(list.length<5&&!list.some(item=>item.ticketId===ticket))list.push({ticketId:ticket,date:row.appointment_date});
  }
  const ids=[...new Set([...byName.values()].flat().map(x=>x.ticketId))].slice(0,100);
  const actionCounts=new Map();
  if(ids.length){
   const ticketsUrl=new URL(base+'/rest/v1/audit_direct_tickets');
   ticketsUrl.searchParams.set('select','ticket_id,payload');
   ticketsUrl.searchParams.set('ticket_id','in.('+ids.join(',')+')');
   ticketsUrl.searchParams.set('limit','100');
   const tr=await fetch(ticketsUrl,{headers,signal:AbortSignal.timeout(15000)});
   if(tr.ok){
    const tickets=await tr.json();
    if(Array.isArray(tickets))for(const t of tickets){
     const actions=Array.isArray(t.payload?.actions)?t.payload.actions:[];
     const usable=actions.filter(a=>a&&!a.isDeleted&&String(a.description||a.htmlDescription||'').trim());
     actionCounts.set(String(t.ticket_id),usable.length);
    }
   }
  }
  const people=[...byName.entries()].map(([name,list])=>{
   const candidate=list.find(t=>(actionCounts.get(t.ticketId)||0)>=2)||list[0]||null;
   return {name,chatCandidate:candidate?{...candidate,interactions:actionCounts.get(candidate.ticketId)||0}:null,
    chatStatus:'Conferir diálogo e autoria',voiceStatus:'Localizar gravação e confirmar atendente'};
  }).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  return json(res,200,{ok:true,from,days,people,partial:rows.length===1000,
   note:'Candidatos extraídos de apontamentos do Suporte, não são monitorias nem chats comprovadamente completos. Voz requer correspondência autenticada com a Zenvia.',
   emailsSent:false});
 }catch{return json(res,503,{ok:false,error:'Não foi possível obter candidatos de monitoria'});}
}
