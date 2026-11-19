'use strict';
// Pré-auditoria de Qualidade: sinais de verificação, NÃO são NC.
// Nenhuma norma confidencial é inserida neste repositório público.
// A classificação formal exige procedimento intranet publicado, evidência e validação humana.
const fold=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const safe=(x,max=180)=>String(x??'').trim().slice(0,max);
const {parseMovideskUtc}=require('./audit-movidesk-datetime.cjs');
const utc=parseMovideskUtc;
const finalStatus=x=>/^(closed|resolved|canceled|cancelled|fechad|resolvid|concluid|encerrad|finalizad|cancelad)/.test(fold(x));
const definitions=Object.freeze({
  SEM_RESPONSAVEL:{
    title:'Responsável não identificado',
    fields:['owner.id'],guidance:'Verificar atribuição e cadastro do responsável atual.'
  },
  ASSUNTO_PARA_REVISAO:{
    title:'Assunto possivelmente pouco descritivo',
    fields:['subject'],guidance:'Conferir se o assunto identifica a situação de forma suficiente.'
  },
  PRAZO_NAO_DISPONIVEL:{
    title:'Prazo de solução não localizado',
    fields:['slaSolutionDate'],guidance:'Verificar se este tipo de chamado exige prazo registrado.'
  },
  HISTORICO_INCOMPLETO:{
    title:'Histórico de responsáveis indisponível',
    fields:['ownerHistories'],guidance:'Conferir sincronização e trilha de movimentação do chamado.'
  },
  ULTIMA_ACAO_INDISPONIVEL:{
    title:'Última ação real não identificada',
    fields:['lastActionDate'],guidance:'Consultar ações no Movidesk antes de afirmar ausência de tratamento.'
  },
  SEM_ACAO_7D:{
    title:'Possível ausência de ação por sete dias',
    fields:['lastActionDate'],guidance:'Verificar o histórico de ações e justificativas de tratamento.'
  }
});
const keys=Object.keys(definitions);

function evaluateQualityRecords(records,options={}) {
  if(!Array.isArray(records))throw new TypeError('Registros inválidos');
  const now=options.now instanceof Date?options.now.getTime():
    options.now===undefined?Date.now():Number(options.now);
  if(!Number.isFinite(now))throw new TypeError('Instante inválido');
  const out=[],seen=new Set(),discarded={};let stale=0,completed=0;
  const addReason=key=>{discarded[key]=(discarded[key]||0)+1};
  for(const record of records){
    const p=record?.payload||record;
    if(!p||typeof p!=='object'){addReason('SEM_PAYLOAD');continue}
    const id=safe(record.ticket_id||p.id,20);
    if(!/^\d{1,12}$/.test(id)){addReason('ID_INVALIDO');continue}
    if(seen.has(id)){addReason('REPETIDO');continue}
    seen.add(id);
    const sync=utc(record.source_synced_at);
    if(sync===null||sync>now+300000||now-sync>24*3600000){
      stale++;addReason('SNAPSHOT_DESATUALIZADO');continue;
    }
    if(record.closed_at_source||p.closedIn||p.resolvedIn||p.isDeleted===true||
      finalStatus(p.baseStatus)||finalStatus(p.status)){
      completed++;addReason('CHAMADO_ENCERRADO');continue;
    }
    const findings=[];
    const signal=(code,proof)=>findings.push({
      code,title:definitions[code].title,
      evidenceField:definitions[code].fields[0],
      evidence:proof,reviewGuidance:definitions[code].guidance,
      verificationRequired:true
    });
    if(!safe(p.owner?.id,120))signal('SEM_RESPONSAVEL','ID do responsável não encontrado no snapshot.');
    const subject=safe(p.subject,400);
    if(subject.length<12)signal('ASSUNTO_PARA_REVISAO',
      'Assunto possui menos de 12 caracteres (heurística, não norma oficial).');
    if(utc(p.slaSolutionDate)===null)signal('PRAZO_NAO_DISPONIVEL',
      'Campo slaSolutionDate ausente ou sem data válida.');
    if(!Array.isArray(p.ownerHistories)||!p.ownerHistories.length)
      signal('HISTORICO_INCOMPLETO','Histórico ownerHistories não disponível.');
    const last=utc(p.lastActionDate);
    if(last===null)signal('ULTIMA_ACAO_INDISPONIVEL',
      'Data da última ação real não disponível; não é prova de inatividade.');
    else if(last<=now&&now-last>=7*86400000)
      signal('SEM_ACAO_7D',
        'Última ação indicada no snapshot há '+Math.floor((now-last)/86400000)+' dias corridos.');
    if(!findings.length)continue;
    out.push({
      ticketId:id,
      team:safe(p.ownerTeam,128)||'Não informado',
      ownerName:safe(p.owner?.businessName||p.owner?.name,100)||'Não identificado',
      subject:subject||'Não informado',
      verifiedAt:new Date(now).toISOString(),
      snapshotAt:new Date(sync).toISOString(),
      lastRealActionAt:last===null?null:new Date(last).toISOString(),
      signals:findings,
      severity:'NÃO_CLASSIFICADA',
      formalNonConformity:false,
      officialProcedureVerified:false,
      procedureReference:null,
      cause:'NÃO_DETERMINADA',
      disposition:'REVISÃO_HUMANA_OBRIGATÓRIA',
      nextStep:'Consultar procedimento vigente na intranet, validar evidências e contexto com a Qualidade; sem norma documentada, orientação em vez de cobrança formal.'
    });
  }
  out.sort((a,b)=>b.signals.length-a.signals.length||a.ticketId.localeCompare(b.ticketId));
  return {
    mode:'dry-run',ruleVersion:'quality-4.0-review-only',
    generatedAt:new Date(now).toISOString(),
    evaluated:records.length,uniqueIds:seen.size,
    candidates:out.length,discarded,completedSkipped:completed,staleSkipped:stale,
    preview:out.slice(0,30),previewTruncated:out.length>30,
    checklistDefinitions:keys.map(code=>({code,...definitions[code]})),
    approval:{
      requiresDocumentedPublishedProcedure:true,
      requiresVerifiedEvidence:true,
      requiresQualityAnalystApproval:true,
      processCauseMustBeSeparatedFromIndividualFault:true,
      policyApprovalStatus:'NOT_VERIFIED',
      allowedAction:'ORIENTATIVE_REVIEW_ONLY'
    },
    warnings:[
      'Não são não conformidades registradas nem decisões automáticas; são pistas técnicas de auditoria.',
      'Sem norma aprovada e publicada, a situação não pode gerar cobrança formal como NC.',
      'Qualidade avalia o caso; gestão aplica feedback e plano de ação quando cabíveis, conforme política vigente.',
      'Dados de chamados ou pessoas não devem ser enviados a sistemas externos sem consentimento e avaliação de privacidade.'
    ],
    nonConformitiesCreated:0,notificationsSent:0,changesWritten:0
  };
}

function buildAnonymizedAiPayload(candidate) {
  if(!candidate||!Array.isArray(candidate.signals))throw new TypeError('Candidato inválido');
  // Enviar apenas códigos controlados do próprio sistema, sem ID, nome,
  // cliente, assunto, texto de chamado, URLs ou conteúdo de ações.
  const checked=[...new Set(candidate.signals.map(x=>x.code))]
    .filter(x=>Object.hasOwn(definitions,x)).slice(0,8);
  if(!checked.length)throw new Error('Nenhum sinal auditável');
  return {
    purpose:'generic-review-checklist',
    evidenceCodes:checked,
    ruleDescriptions:checked.map(code=>definitions[code].title),
    policyVerified:false,
    noPersonalData:true,
    noOfficialNC:true
  };
}
function localChecklist(codes) {
  return codes.filter(code=>Object.hasOwn(definitions,code))
    .map(code=>({
      code,
      suggestion:definitions[code].guidance,
      classification:'ORIENTATIVA_ATÉ_VALIDAÇÃO_DA_QUALIDADE'
    }));
}
module.exports={evaluateQualityRecords,buildAnonymizedAiPayload,localChecklist,definitions};
