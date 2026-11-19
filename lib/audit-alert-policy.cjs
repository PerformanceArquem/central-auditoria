'use strict';

// Etapa 2: diagnóstico de cobrança; SOMENTE SIMULAÇÃO.
// Nunca envia mensagens, não grava logs de envio e não deduz gestor nem horas trabalhadas.
const {utc}=require('./audit-readonly-insights.cjs');
const TEAMS=['Implantação','Suporte','Produção','Inteligência'];
const normalize=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const cut=(v,n=180)=>String(v??'').trim().slice(0,n);
const terminal=v=>/^(closed|resolved|canceled|cancelled|fechad|resolvid|concluid|cancelad|encerrad|finalizad)/.test(normalize(v));
const OPEN=new Set(['new','inattendance']);
const HOUR=3600000;
function canonicalTeam(value) {
  return TEAMS.find(x=>normalize(x)===normalize(value))||null;
}
function humanMessage(id,type,name) {
  const intro=name?'Olá, '+name+'! Tudo bem?':'Olá! Tudo bem?';
  const opening=type==='PREVENTIVO_24H'
    ?'O chamado #'+id+' está próximo do vencimento do prazo de solução.'
    :type==='ESCALONAMENTO_GESTOR'
      ?'Identificamos que o chamado #'+id+' está com o prazo de solução vencido e sem uma atualização recente confirmada.'
      :type==='SEM_MOVIMENTACAO_7D'
        ?'O chamado #'+id+' está há vários dias sem uma ação registrada.'
        :'Identificamos que o chamado #'+id+' está com o prazo de solução vencido.';
  return [
    intro,'',opening,'',
    'Poderia, por gentileza, verificar o andamento e registrar a próxima etapa de tratamento?',
    'Caso exista alguma dependência ou dificuldade, solicitamos que seja registrada no chamado para acompanhamento.',
    '', 'Agradecemos pela colaboração!'
  ].join('\n');
}
function evaluateAlertPolicies(records,options={}) {
  if(!Array.isArray(records)) throw new TypeError('Lista de chamados inválida');
  const now=options.now instanceof Date?options.now.getTime():
    options.now===undefined?Date.now():Number(options.now);
  if(!Number.isFinite(now))throw new TypeError('Data de referência inválida');
  const team=canonicalTeam(options.team||'Implantação');
  if(!team)throw new RangeError('Setor não permitido');
  const verifiedKeys=options.verifiedSentKeys instanceof Set?options.verifiedSentKeys:new Set();
  const seenTickets=new Set(),items=[],discarded={};
  let processed=0,duplicatesInBatch=0;
  const reject=why=>{discarded[why]=(discarded[why]||0)+1};
  const maxSyncAgeHours=24;
  for(const row of records){
    const p=row?.payload||row;
    if(!p||typeof p!=='object'){reject('DADO_INVALIDO');continue}
    const id=cut(row.ticket_id||p.id,24);
    if(!/^\d{1,12}$/.test(id)){reject('ID_INVALIDO');continue}
    if(seenTickets.has(id)){duplicatesInBatch++;reject('DUPLICADO_NA_CONSULTA');continue}
    seenTickets.add(id);
    if(canonicalTeam(p.ownerTeam)!==team){reject('OUTRO_SETOR');continue}
    processed++;
    const base=normalize(p.baseStatus);
    if(row.closed_at_source||p.isDeleted===true||terminal(base)||terminal(p.status)
      ||p.resolvedIn||p.closedIn){reject('CONCLUIDO_OU_CANCELADO');continue}
    if(!OPEN.has(base)){reject('STATUS_NAO_CONFIRMADO');continue}
    if(p.slaSolutionDateIsPaused!==false){reject('SLA_PAUSADO_OU_INDEFINIDO');continue}
    const synced=utc(row.source_synced_at);
    if(synced===null||synced>now+5*60*1000||now-synced>maxSyncAgeHours*HOUR){
      reject('SINCRONIZACAO_A_CONFIRMAR');continue;
    }
    const ownerId=cut(p.owner?.id,100);
    const ownerName=cut(p.owner?.businessName||p.owner?.name,100);
    if(!ownerId){reject('SEM_RESPONSAVEL');continue}
    const due=utc(p.slaSolutionDate),lastAction=utc(p.lastActionDate);
    const idleHours=lastAction!==null&&lastAction<=now?(now-lastAction)/HOUR:null;
    const overdueHours=due!==null&&(due<now)?(now-due)/HOUR:0;
    let type=null;
    if(due!==null&&due<now){
      type=overdueHours>=72&&idleHours!==null&&idleHours>=48?'ESCALONAMENTO_GESTOR':'SLA_VENCIDO';
    } else if(due!==null&&due>=now&&due<=now+24*HOUR) {
      type='PREVENTIVO_24H';
    } else if(idleHours!==null&&idleHours>=7*24) {
      type='SEM_MOVIMENTACAO_7D';
    }
    if(!type){reject('SEM_ALERTA_NO_PERIODO');continue}
    // Esse identificador é somente uma *possibilidade* de controle de duplicidade.
    // Nenhum histórico de envios anteriores está vinculado nesta etapa.
    const eventKey=[id,type,due===null?'sem-prazo':new Date(due).toISOString(),ownerId].join('|');
    if(verifiedKeys.has(eventKey)){reject('ALERTA_JA_ENVIADO_COM_EVIDENCIA');continue}
    const needsManager=type==='ESCALONAMENTO_GESTOR';
    const subject=cut(p.subject,240);
    const client=cut(p.clients?.[0]?.organization?.businessName||p.clients?.[0]?.businessName||'Não informado',120);
    const recipient=needsManager?'Gestor do setor — não identificado':'Responsável do chamado (prévia)';
    items.push({
      ticketId:id,team,subject,client,ownerId,ownerName:ownerName||'Responsável identificado por ID',
      type,recipient,managerConfigured:false,managerReviewRequired:needsManager,
      dueAt:due===null?null:new Date(due).toISOString(),
      lastRealActionAt:lastAction===null?null:new Date(lastAction).toISOString(),
      overdueHours:Math.round(overdueHours*10)/10,
      hoursWithoutVerifiedAction:idleHours===null?null:Math.round(idleHours*10)/10,
      messagePreview:humanMessage(id,type,needsManager?'':ownerName),
      alertKey:eventKey,historyCheck:'NÃO_CONECTADO',canSend:false,sent:false
    });
  }
  const priority={ESCALONAMENTO_GESTOR:0,SLA_VENCIDO:1,SEM_MOVIMENTACAO_7D:2,PREVENTIVO_24H:3};
  items.sort((a,b)=>priority[a.type]-priority[b.type]||
    b.overdueHours-a.overdueHours||a.ticketId.localeCompare(b.ticketId));
  const byType={PREVENTIVO_24H:0,SLA_VENCIDO:0,SEM_MOVIMENTACAO_7D:0,ESCALONAMENTO_GESTOR:0};
  for(const item of items)byType[item.type]++;
  return {
    mode:'dry-run',team,ruleVersion:'2.0-dryrun',timestamp:new Date(now).toISOString(),
    thresholds:{preventiveHours:24,escalationOverdueHours:72,
      escalationNoVerifiedActionHours:48,noMovementHours:168,snapshotMaxAgeHours:maxSyncAgeHours},
    scanned:records.length,processed,qualified:items.length,byType,discarded,
    duplicatesInBatch,historyCoverage:'NÃO_CONECTADO',managerDirectory:'NÃO_CONECTADO',
    preview:items.slice(0,50),previewTruncated:items.length>50,
    notices:['Prazos em horas corridas a partir do vencimento informado pelo Movidesk; calendário de SLA é definido no Movidesk.',
      'Não é possível afirmar reincidência nem ausência de envios prévios sem histórico auditado.',
      'Escalonamento é apenas candidato para revisão: o destinatário gestor não foi definido.',
      'Sem ação interna, e-mail, webhooks de saída ou atualizações em chamados.'],
    notificationsSent:0,changesWritten:0
  };
}
module.exports={evaluateAlertPolicies,canonicalTeam,humanMessage,TEAMS};
