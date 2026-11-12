// Painel de fila da Inteligência. Não deduz que o destino seja Produção apenas por T1–T4.
const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const typeOf=s=>/^\s*(T[1-4])(?=\D|$)/i.exec(String(s||''))?.[1]?.toUpperCase()||null;
const name=x=>String(x?.businessName||x?.name||x?.organization?.businessName||x?.organization?.name||'').trim();
const dateTime=s=>{const v=String(s||'');if(!v)return NaN;return Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(v)?v:v+'Z')};
const days=(from,to)=>Math.floor((to-from)/86400000);
export function triageRows(tickets,now=new Date()){
 const output=[];const instant=now.getTime();
 for(const t of tickets){
  const p=t.payload||{},subject=String(p.subject||'');
  const type=typeOf(subject);
  if(!type || norm(p.ownerTeam)!=='inteligencia'||norm(p.serviceFirstLevel)!=='triagem')continue;
  const state=norm(p.baseStatus),status=norm(p.status);
  if(t.closed_at_source||p.isDeleted===true||/^(closed|resolved|canceled|cancelled)$/.test(state)||
    /fechad|cancelad|concluid|resolvid|encerrad|finalizad/.test(status))continue;
  const histories=Array.isArray(p.ownerHistories)?p.ownerHistories:[];
  // A ultima movimentação de ownerTeam=Inteligência inicia o período atual na fila.
  const last=histories.filter(h=>norm(h?.ownerTeam)==='inteligencia')
   .map(h=>dateTime(h.changedDate)).filter(Number.isFinite).sort((a,b)=>b-a)[0];
  if(!Number.isFinite(last)||last>instant)continue;
  const opened=dateTime(t.created_at_source||p.createdDate),queueDays=days(last,instant);
  if(queueDays<0)continue;
  const forecast=String(p.slaSolutionDate||'').trim();
  const client=Array.isArray(p.clients)?p.clients[0]:null;
  const synced=dateTime(t.source_synced_at);
  output.push({
   id:String(t.ticket_id||p.id||''),type,subject,client:name(client)||'Não identificado',
   status:String(p.status||'—'),queueSince:new Date(last).toISOString(),queueDays,
   opened:Number.isFinite(opened)?new Date(opened).toISOString():null,
   ageDays:Number.isFinite(opened)?days(opened,instant):null,
   forecast:forecast||null,owner:name(p.owner)||'Não atribuído',
   syncedAt:Number.isFinite(synced)?new Date(synced).toISOString():null,
   // status é explicitamente pendente de confirmação, não uma afirmação de destino
   nextStep:'A validar com a Inteligência',
   url:'https://arquem.movidesk.com/Ticket/Edit/'+encodeURIComponent(String(t.ticket_id||p.id||''))
  });
 }
 return output.sort((a,b)=>b.queueDays-a.queueDays||
   Date.parse(a.queueSince)-Date.parse(b.queueSince)||Number(a.id)-Number(b.id));
}
export async function triageReport({base,key,signal,fetchImpl=fetch,now=new Date()}){
 const rows=[];const page=500;
 for(let off=0;off<10000;off+=page){
  const url=new URL(base+'/rest/v1/audit_direct_tickets');
  url.searchParams.set('select','ticket_id,payload,created_at_source,closed_at_source,source_synced_at');
  url.searchParams.set('payload->>ownerTeam','eq.Inteligência');
  url.searchParams.set('payload->>serviceFirstLevel','eq.Triagem');
  url.searchParams.set('closed_at_source','is.null');
  url.searchParams.set('order','ticket_id.asc');
  url.searchParams.set('limit',String(page));
  url.searchParams.set('offset',String(off));
  const response=await fetchImpl(url,{headers:{apikey:key,Authorization:'Bearer '+key},signal});
  if(!response.ok)throw Error('Consulta da triagem indisponível');
  const batch=await response.json();
  if(!Array.isArray(batch))throw Error('Resposta inválida da triagem');
  rows.push(...batch);
  if(batch.length<page){
   const items=triageRows(rows,now);
   return {ok:true,generatedAt:now.toISOString(),source:'Supabase · Movidesk sincronizado',
    criteria:'T1–T4; serviço Triagem; equipe Inteligência; não encerrados',
    caveat:'T1–T4 não confirma transferência para Produção; validar encaminhamento.',
    queueBasis:'Última entrada na equipe Inteligência, via histórico de responsáveis.',
    total:items.length,items};
  }
 }
 throw Error('Consulta excedeu limite seguro de registros');
}
