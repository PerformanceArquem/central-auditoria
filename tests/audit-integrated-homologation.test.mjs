import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import core from '../lib/audit-readonly-insights.cjs';
import alerts from '../lib/audit-alert-policy.cjs';
import queues from '../lib/audit-queue-flow.cjs';
import quality from '../lib/audit-quality-review.cjs';
import productivity from '../lib/audit-productivity-comparisons.cjs';

const NOW=Date.parse('2026-11-19T19:00:00Z');
const ID='3001';
const rawTicket={
  ticket_id:ID,
  source_synced_at:'2026-11-19T18:00:00Z',
  closed_at_source:null,
  payload:{
    id:3001,subject:'Implantação de unidade fictícia',
    baseStatus:'InAttendance',status:'Em andamento',
    ownerTeam:'Implantação',owner:{id:'user-7',businessName:'Colaborador Exemplo'},
    slaSolutionDate:'2026-11-14T16:00:00Z',
    slaSolutionDateIsPaused:false,
    lastActionDate:'2026-11-10T15:00:00Z',
    ownerHistories:[
      {ownerTeam:'Suporte',changedDate:'2026-11-01T10:00:00Z'},
      {ownerTeam:'Implantação',changedDate:'2026-11-16T10:00:00Z'}
    ],
    clients:[{organization:{businessName:'Empresa Exemplo'}}]
  }
};
const currentRows=[{
  appointment_date:'2026-11-18',ticket_id:ID,
  sector:'Implantação',collaborator_name:'Colaborador Exemplo',
  activity:'Análise',duration_minutes:120
}];
const baselineRows=[{
  appointment_date:'2026-10-18',ticket_id:ID,
  sector:'Implantação',collaborator_name:'Colaborador Exemplo',
  activity:'Análise',duration_minutes:45
}];
const clone=x=>JSON.parse(JSON.stringify(x));

test('five engines reconcile one fictional overdue ticket without changing source records',()=>{
  const t=clone(rawTicket),current=clone(currentRows),baseline=clone(baselineRows);
  const before=JSON.stringify({t,current,baseline});
  const foundation=core.evaluateAuditInsights([t],current,{now:NOW});
  const policy=alerts.evaluateAlertPolicies([t],{now:NOW,team:'Implantação'});
  const flow=queues.analyzeQueueFlow([t],{now:NOW});
  const review=quality.evaluateQualityRecords([t],{now:NOW});
  const hours=productivity.analyzeProductivity(current,baseline,{
    to:'2026-11-18',days:28,comparison:'previous',holidays:new Set()
  });

  assert.equal(foundation.coverage.openTickets,1);
  assert.equal(foundation.alerts.total,2);
  assert.equal(policy.qualified,1);
  assert.equal(policy.byType.ESCALONAMENTO_GESTOR,1);
  assert.equal(policy.preview[0].ticketId,ID);
  assert.equal(policy.preview[0].managerConfigured,false);
  assert.equal(flow.coverage.openTicketsInSnapshot,1);
  assert.equal(flow.movements.total,1);
  assert.equal(flow.movements.routes[0].fromTeam,'Suporte');
  assert.equal(flow.movements.routes[0].toTeam,'Implantação');
  assert.equal(flow.queue.detailsPreview[0].currentQueueDays,3);
  assert.equal(review.candidates,1);
  assert.deepEqual(review.preview[0].signals.map(x=>x.code),['SEM_ACAO_7D']);
  assert.equal(review.preview[0].formalNonConformity,false);
  assert.equal(review.preview[0].severity,'NÃO_CLASSIFICADA');
  assert.equal(hours.totals.current.hours,2);
  assert.equal(hours.totals.baseline.hours,.75);
  assert.equal(hours.totals.varianceHours,1.25);
  assert.equal(hours.byTeam[0].name,'Implantação');
  assert.equal(hours.byCollaborator[0].currentHours,2);
  assert.equal(hours.capacity.plannedHours,null);
  assert.equal(hours.capacity.varianceToCapacityHours,null);
  for(const output of [foundation,policy,flow,review,hours]){
    assert.equal(output.mode,'dry-run');
    assert.equal(output.notificationsSent,0);
    assert.equal(output.changesWritten,0);
  }
  assert.equal(review.nonConformitiesCreated,0);
  assert.equal(JSON.stringify({t,current,baseline}),before);
});

test('closed ticket never enters open backlogs, alert policy or quality findings',()=>{
  const closed=clone(rawTicket);
  closed.payload.baseStatus='Closed';
  closed.closed_at_source='2026-11-19T18:00:00Z';
  assert.equal(core.evaluateAuditInsights([closed],[],{now:NOW}).coverage.openTickets,0);
  assert.equal(alerts.evaluateAlertPolicies([closed],{now:NOW,team:'Implantação'}).qualified,0);
  assert.equal(queues.analyzeQueueFlow([closed],{now:NOW}).coverage.openTicketsInSnapshot,0);
  assert.equal(quality.evaluateQualityRecords([closed],{now:NOW}).candidates,0);
});

test('paused SLA blocks overdue warnings but preserves independent queue evidence',()=>{
  const paused=clone(rawTicket);
  paused.payload.slaSolutionDateIsPaused=true;
  const first=core.evaluateAuditInsights([paused],[],{now:NOW});
  const second=alerts.evaluateAlertPolicies([paused],{now:NOW,team:'Implantação'});
  const third=queues.analyzeQueueFlow([paused],{now:NOW});
  assert.equal(first.queues.teams[0].overdue,0);
  assert.equal(first.alerts.preview.some(x=>x.kind==='SLA_VENCIDO'),false);
  assert.equal(second.qualified,0);
  assert.equal(second.discarded.SLA_PAUSADO_OU_INDEFINIDO,1);
  assert.equal(third.queue.detailsPreview[0].currentQueueDays,3);
});

test('unconfirmed last action never becomes inactivity or presumed individual fault',()=>{
  const noLast=clone(rawTicket);
  noLast.payload.lastActionDate=null;
  const a=alerts.evaluateAlertPolicies([noLast],{now:NOW,team:'Implantação'});
  const q=quality.evaluateQualityRecords([noLast],{now:NOW});
  const flow=queues.analyzeQueueFlow([noLast],{now:NOW});
  assert.equal(a.byType.ESCALONAMENTO_GESTOR,0);
  assert.equal(a.byType.SLA_VENCIDO,1);
  assert.equal(a.preview[0].hoursWithoutVerifiedAction,null);
  assert.equal(flow.queue.detailsPreview[0].daysWithoutRealAction,null);
  assert.equal(q.preview[0].signals[0].code,'ULTIMA_ACAO_INDISPONIVEL');
  assert.equal(q.preview[0].formalNonConformity,false);
});

test('Gemini receives only permitted generic signals and no user or ticket identifiers',()=>{
  const candidate=quality.evaluateQualityRecords([rawTicket],{now:NOW}).preview[0];
  const data=quality.buildAnonymizedAiPayload(candidate);
  const payload=JSON.stringify(data);
  assert.equal(data.policyVerified,false);
  assert.equal(data.noPersonalData,true);
  assert.deepEqual(data.evidenceCodes,['SEM_ACAO_7D']);
  for(const value of [ID,'Empresa Exemplo','Colaborador Exemplo','Implantação','Implantação de unidade fictícia']){
    assert(!payload.includes(value),'Payload contains disallowed data: '+value);
  }
});

const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const html=source('../index.html');
const uiPaths=[
  '../audit-readonly-insights-ui.js','../audit-alert-policy-ui.js',
  '../audit-queue-flow-ui.js','../audit-quality-review-ui.js',
  '../audit-productivity-preview-ui.js'
];
const readOnlyRoutes=[
  '../api/audit-readonly-insights.js','../api/audit-alert-policy-preview.js',
  '../api/audit-queue-flow-preview.js','../api/audit-quality-review.js',
  '../api/audit-productivity-preview.js'
];

test('five dashboards and scripts coexist in one HTML, without duplicate panel IDs',()=>{
  const ids=['auditInsightsPanel','policyPreviewPanel','queueFlowPreviewPanel',
    'qualityReviewPanel','productivityPreviewPanel'];
  for(let i=0;i<ids.length;i++){
    const matches=html.match(new RegExp('id="'+ids[i]+'"','g'))||[];
    assert.equal(matches.length,1,'Duplicate or missing panel ID: '+ids[i]);
    assert(html.includes('src="'+uiPaths[i].slice(3)+'"'));
  }
  assert.match(html,/id="qualityAiConsent"/);
  assert.match(html,/id="productivityCapacity"/);
  for(const path of uiPaths){
    const js=source(path);
    assert.match(js,/window\.tmAuth\?\.getSession\?\.\(\)/);
    assert.doesNotMatch(js,/ticket_charge_send|movideskInternalAction|sendMail|sendEmail/);
  }
  const handlers=[
    'runAuditReadonlyInsights','runPolicyPreview','runQueueFlowPreview',
    'runQualityReviewPreview','previewProductivity'
  ];
  for(let i=0;i<handlers.length;i++)
    assert.match(source(uiPaths[i]),new RegExp('window\\.'+handlers[i]+'\\s*='));
});

test('all analytics endpoints are GET-only, admin-gated and side-effect-free',()=>{
  for(const path of readOnlyRoutes){
    const code=source(path);
    assert.match(code,/audit_users/,'Missing role ACL: '+path);
    assert.match(code,/is_active\s*!==\s*false/,'Missing active account check: '+path);
    assert.match(code,/req\.method\s*!==\s*'GET'/,'Missing GET restriction: '+path);
    assert.match(code,/notificationsSent\s*:\s*0/);
    assert.match(code,/changesWritten\s*:\s*0/);
    assert.doesNotMatch(code,/method\s*:\s*'(POST|PATCH|PUT|DELETE)'/);
  }
  const gemini=source('../api/audit-quality-ai-draft.js');
  assert.match(gemini,/QUALITY_GEMINI_DRAFT_ENABLED==='true'/);
  assert.match(gemini,/input\.consent/);
  assert.match(gemini,/buildAnonymizedAiPayload/);
  assert.doesNotMatch(gemini,/method:'PATCH'|method:'PUT'|method:'DELETE'/);
});

test('integrated previews do not call email cron, Movidesk writes or notice actions',()=>{
  for(const path of [...readOnlyRoutes,'../api/audit-quality-ai-draft.js']){
    const content=source(path);
    assert.doesNotMatch(content,/audit-email-dispatch|sendMail\(|sendEmail\(|processChargeInternalNote\(/);
  }
});


test('real-world Resolved status is closed even if closed_at_source was not populated',()=>{
  const resolved=clone(rawTicket);
  resolved.payload.baseStatus='Resolved';
  resolved.payload.resolvedIn='2026-11-18T19:00:00';
  resolved.closed_at_source=null;
  const foundation=core.evaluateAuditInsights([resolved],[],{now:NOW});
  const policy=alerts.evaluateAlertPolicies([resolved],{now:NOW,team:'Implantação'});
  const flow=queues.analyzeQueueFlow([resolved],{now:NOW});
  const review=quality.evaluateQualityRecords([resolved],{now:NOW});
  assert.equal(foundation.coverage.openTickets,0);
  assert.equal(policy.qualified,0);
  assert.equal(flow.coverage.openTicketsInSnapshot,0);
  assert.equal(review.candidates,0);
});

test('missing SLA is not invented; missing prazo is only an orientative quality check',()=>{
  const lackingSla=clone(rawTicket);
  lackingSla.payload.slaSolutionDate=null;
  lackingSla.payload.lastActionDate='2026-11-19T18:00:00';
  const foundation=core.evaluateAuditInsights([lackingSla],[],{now:NOW});
  const policy=alerts.evaluateAlertPolicies([lackingSla],{now:NOW,team:'Implantação'});
  const review=quality.evaluateQualityRecords([lackingSla],{now:NOW});
  assert.equal(foundation.alerts.total,0);
  assert.equal(policy.qualified,0);
  assert.equal(review.candidates,1);
  assert.deepEqual(review.preview[0].signals.map(x=>x.code),['PRAZO_NAO_DISPONIVEL']);
  assert.equal(review.preview[0].formalNonConformity,false);
  assert.equal(review.preview[0].severity,'NÃO_CLASSIFICADA');
});
