'use strict';

// Etapa 3: leitura analítica pura. NUNCA envia, grava ou altera chamados.
// Histórico de equipes é a única base para transferências/entrada em fila.
const DAY=86400000;
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const cut=(value,max=160)=>String(value??'').trim().slice(0,max);
const terminal=value=>/^(closed|resolved|canceled|cancelled|fechad|resolvid|concluid|cancelad|encerrad|finalizad)/.test(normalize(value));
function utc(value) {
  if(typeof value!=='string'||! /^\d{4}-\d\d-\d\dT/.test(value))return null;
  const iso=/(Z|[+-]\d\d:\d\d)$/i.test(value)?value:value+'Z';
  const ms=Date.parse(iso);
  return Number.isFinite(ms)?ms:null;
}
const iso=ms=>ms===null?null:new Date(ms).toISOString();
const nDays=ms=>Math.floor(ms/DAY);
function safeHistory(raw,now) {
  if(!Array.isArray(raw)||!raw.length)return {valid:false,reason:'SEM_HISTORICO',items:[]};
  const items=[];
  for(let i=0;i<raw.length;i++){
    const item=raw[i],team=cut(item?.ownerTeam,128),at=utc(item?.changedDate);
    if(!team||at===null||at>now+5*60000)
      return {valid:false,reason:'HISTORICO_INCOMPLETO',items:[]};
    items.push({team,normalized:normalize(team),at,seq:i});
  }
  items.sort((a,b)=>a.at-b.at||a.seq-b.seq);
  for(let i=1;i<items.length;i++){
    if(items[i].at===items[i-1].at&&items[i].normalized!==items[i-1].normalized)
      return {valid:false,reason:'TRANSICAO_AMBIGUA',items:[]};
  }
  return {valid:true,reason:null,items};
}
function analyzeQueueFlow(records,options={}) {
  if(!Array.isArray(records))throw new TypeError('Lista de chamados inválida');
  const now=options.now instanceof Date?options.now.getTime():
    options.now===undefined?Date.now():Number(options.now);
  if(!Number.isFinite(now))throw new RangeError('Horário inválido');
  const windowDays=30,windowStart=now-windowDays*DAY;
  const groups=new Map(),edges=new Map(),transfers=[],details=[],discarded={};
  let stale=0,duplicate=0,completed=0,open=0,historyUnknown=0,unknownOwner=0;
  const seen=new Set();
  const reject=reason=>{discarded[reason]=(discarded[reason]||0)+1};
  function groupFor(team) {
    const key=normalize(team)||'nao informado';
    if(!groups.has(key))groups.set(key,{
      team:team||'Não informado',openTickets:0,verifiedQueueEntries:0,
      queueDaysSum:0,over15Days:0,withoutRealAction7Days:0,
      unverifiableQueueAge:0,oldestTicket:null,maxVerifiedQueueDays:null
    });
    return groups.get(key);
  }
  for(const row of records) {
    const p=row?.payload||row;
    if(!p||typeof p!=='object'){reject('REGISTRO_INVALIDO');continue}
    const id=cut(row?.ticket_id||p.id,24);
    if(!/^\d{1,12}$/.test(id)){reject('ID_INVALIDO');continue}
    if(seen.has(id)){duplicate++;reject('REGISTRO_DUPLICADO');continue}
    seen.add(id);
    const synced=utc(row.source_synced_at);
    if(synced===null||synced>now+5*60000||now-synced>24*3600000) {
      stale++;reject('SINCRONIZACAO_NAO_CONFIRMADA');continue;
    }
    const history=safeHistory(p.ownerHistories,now);
    const team=cut(p.ownerTeam,128);
    const current=normalize(team);
    const isClosed=Boolean(row.closed_at_source||p.isDeleted===true||
      terminal(p.baseStatus)||terminal(p.status)||p.resolvedIn||p.closedIn);
    if(!history.valid){historyUnknown++;reject(history.reason)}
    else {
      // A primeira entrada no histórico não é uma transferência:
      // a equipe anterior é desconhecida.
      for(let i=1;i<history.items.length;i++){
        const from=history.items[i-1],to=history.items[i];
        if(from.normalized===to.normalized||to.at<windowStart||to.at>now)continue;
        const event={
          ticketId:id,fromTeam:from.team,toTeam:to.team,
          occurredAt:iso(to.at),
          priorQueueDays:nDays(to.at-from.at),
          evidence:'ownerHistories'
        };
        transfers.push(event);
        const key=from.normalized+'|'+to.normalized;
        const edge=edges.get(key)||{fromTeam:from.team,toTeam:to.team,count:0,tickets:new Set()};
        edge.count++;edge.tickets.add(id);
        edges.set(key,edge);
      }
    }
    if(isClosed){completed++;continue}
    open++;
    const g=groupFor(team);
    g.openTickets++;
    const owner=cut(p.owner?.businessName||p.owner?.name,120);
    if(!p.owner?.id)unknownOwner++;
    const lastAction=utc(p.lastActionDate);
    const idleDays=lastAction!==null&&lastAction<=now?nDays(now-lastAction):null;
    const matchesLast=history.valid&&history.items.length>0&&
      history.items.at(-1).normalized===current;
    // Não inferir entrada com base na data de abertura ou último update.
    let enteredAt=null,queueDays=null;
    if(matchesLast){
      const items=history.items;
      let idx=items.length-1;
      while(idx>0&&items[idx-1].normalized===current)idx--;
      enteredAt=items[idx].at;
      queueDays=nDays(now-enteredAt);
      g.verifiedQueueEntries++;g.queueDaysSum+=queueDays;
      if(queueDays>=15)g.over15Days++;
      if(g.maxVerifiedQueueDays===null||queueDays>g.maxVerifiedQueueDays){
        g.maxVerifiedQueueDays=queueDays;g.oldestTicket=id;
      }
    } else {
      g.unverifiableQueueAge++;
      reject(history.valid?'EQUIPE_ATUAL_DIVERGE_DO_HISTORICO':'ENTRADA_SEM_EVIDENCIA');
    }
    if(idleDays!==null&&idleDays>=7)g.withoutRealAction7Days++;
    details.push({
      ticketId:id,team:team||'Não informado',
      owner:owner||'Não identificado',
      ownerIdentified:Boolean(p.owner?.id),
      subject:cut(p.subject,240),
      currentQueueSince:iso(enteredAt),
      currentQueueDays:queueDays,
      queueEvidence:matchesLast?'ownerHistories':'INCOMPLETA',
      lastRealActionAt:iso(lastAction),daysWithoutRealAction:idleDays,
      over15Days:queueDays!==null&&queueDays>=15,
      managerReviewCandidate:queueDays!==null&&queueDays>=15,
      sent:false
    });
  }
  const teams=[...groups.values()].map(g=>({
    team:g.team,openTickets:g.openTickets,
    verifiedQueueEntries:g.verifiedQueueEntries,
    unverifiableQueueAge:g.unverifiableQueueAge,
    over15Days:g.over15Days,
    withoutRealAction7Days:g.withoutRealAction7Days,
    averageVerifiedQueueDays:g.verifiedQueueEntries?
      Math.round(g.queueDaysSum/g.verifiedQueueEntries*10)/10:null,
    maxVerifiedQueueDays:g.maxVerifiedQueueDays,oldestTicket:g.oldestTicket
  })).sort((a,b)=>b.over15Days-a.over15Days||
    (b.averageVerifiedQueueDays??-1)-(a.averageVerifiedQueueDays??-1)||
    b.openTickets-a.openTickets||a.team.localeCompare(b.team,'pt-BR'));
  transfers.sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||
    a.ticketId.localeCompare(b.ticketId));
  const routes=[...edges.values()].map(e=>({
    fromTeam:e.fromTeam,toTeam:e.toTeam,transfers:e.count,
    uniqueTickets:e.tickets.size
  })).sort((a,b)=>b.transfers-a.transfers||
    a.fromTeam.localeCompare(b.fromTeam,'pt-BR'));
  details.sort((a,b)=>(b.currentQueueDays??-1)-(a.currentQueueDays??-1)||
    (b.daysWithoutRealAction??-1)-(a.daysWithoutRealAction??-1)||
    a.ticketId.localeCompare(b.ticketId));
  return {
    mode:'dry-run',version:'3.0-preview',
    generatedAt:new Date(now).toISOString(),windowDays,
    windowStart:new Date(windowStart).toISOString(),
    coverage:{
      examined:records.length,uniqueTickets:seen.size,
      openTicketsInSnapshot:open,closedTicketsInSnapshot:completed,
      staleRecordsSkipped:stale,duplicateRecordsSkipped:duplicate,
      incompleteHistories:historyUnknown,openTicketsWithoutOwner:unknownOwner,
      caveat:'Amostra sincronizada, não um total histórico completo.'
    },
    queue:{teams,detailsPreview:details.slice(0,50),
      detailsTotal:details.length,previewTruncated:details.length>50},
    movements:{total:transfers.length,routes,
      recentPreview:transfers.slice(0,50),previewTruncated:transfers.length>50},
    discarded,
    warnings:[
      'Transferências são contadas apenas quando a sequência ownerHistories confirma ambas as equipes.',
      'A primeira entrada conhecida não é classificada como transferência.',
      'Duração da fila atual é desconhecida quando a equipe atual diverge do histórico.',
      'Histórico ambíguo, inválido ou sincronização antiga são sinalizados, sem estimativas artificiais.',
      'Métricas representam o recorte disponível. Não inferir produtividade individual pela duração na fila.'
    ],
    notificationsSent:0,changesWritten:0
  };
}
module.exports={analyzeQueueFlow,safeHistory,utc};
