export const OVERVIEW_SCOPES=Object.freeze({
  all:['Inteligência','Qualidade','Testes (QA)','Sucesso do Cliente','Implantação','Treinamento','Produção','Suporte'],
  intelligence:['Inteligência','Qualidade','Testes (QA)','Sucesso do Cliente','Implantação','Treinamento'],
  production:['Produção'],support:['Suporte']
});
const normalized=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const closed=new Set(['fechado','resolvido','cancelado','concluido','concluido (sem confirmacao)','encerrado','finalizado']);
export function buildRobotOverview(records,{now,scope='all'}={}) {
  const clock=Date.parse(now),sectors=OVERVIEW_SCOPES[scope];
  if(!Number.isFinite(clock)||!Object.hasOwn(OVERVIEW_SCOPES,scope)||!Array.isArray(records)||records.length>1000)throw Error('Consulta incompleta ou critérios inválidos.');
  const alerts=[],review=[],tickets=[],seen=new Set();let excluded=0,unflagged=0;
  for(const row of records) {
    const id=String(row.ticket_id??''),p=row.payload||{};
    if(!/^\d{1,12}$/.test(id)||seen.has(id))throw Error('Seleção inválida ou duplicada.');
    seen.add(id);
    if(!sectors.includes(p.ownerTeam))throw Error('Chamado fora do escopo solicitado.');
    if(row.closed_at_source||p.closedIn||p.canceledIn||String(p.isDeleted)==='true'||closed.has(normalized(p.status))||['closed','resolved','canceled','cancelled'].includes(normalized(p.baseStatus))) {excluded++;continue;}
    const rawOwner=p.owner,name=typeof rawOwner==='string'?rawOwner:rawOwner?.businessName||rawOwner?.name;
    const ticket={id,sector:p.ownerTeam,subject:String(p.subject||'').slice(0,240),ownerName:typeof name==='string'?name.trim().slice(0,160):null,ownerId:rawOwner&&typeof rawOwner==='object'&&rawOwner.id!=null?String(rawOwner.id).slice(0,80):null};
    tickets.push(ticket);
    const synced=Date.parse(row.source_synced_at);
    if(!Number.isFinite(synced)||synced>clock||clock-synced>86400000) {review.push({ticketId:id,reason:Number.isFinite(synced)?'stale-history':'invalid-sync-time'});continue;}
    let count=0;
    const add=rule=>{alerts.push({ticketId:id,rule});count++;};
    const rawDue=p.slaSolutionDate;
    if(!rawDue)add('no-forecast');
    else if(p.slaSolutionDateIsPaused===false||p.slaSolutionDateIsPaused==='false') {
      const due=typeof rawDue==='string'?Date.parse(/(Z|[+-]\d{2}:\d{2})$/i.test(rawDue)?rawDue:rawDue+'Z'):NaN;
      if(!Number.isFinite(due)) {review.push({ticketId:id,reason:'invalid-forecast'});continue;}
      const hours=(due-clock)/3600000;
      if(hours<0){add('overdue');if(hours<=-48)add('escalation');}
      else if(hours<=24)add('preventive');
    }
    if(!ticket.ownerName&&!ticket.ownerId)add('owner-not-informed');
    if(!count)unflagged++;
  }
  return {source:'overview-read-only',referenceTime:new Date(clock).toISOString(),scope,alerts,review,tickets,recordsRead:records.length,excluded,unflagged,complete:true,deliveryEnabled:false,writeEnabled:false,suspendedRules:['idle','queue']};
}
