import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import policy from '../lib/audit-alert-policy.cjs';

const {evaluateAlertPolicies,canonicalTeam}=policy;
const NOW=Date.parse('2026-11-19T19:00:00Z');
const ticket=(changes={},rowChanges={})=>({
  ticket_id:'20001',
  source_synced_at:'2026-11-19T18:30:00Z',
  closed_at_source:null,
  payload:{
    id:20001,ownerTeam:'Implantação',baseStatus:'InAttendance',
    status:'Em andamento',subject:'Implantação da filial 01',
    slaSolutionDate:'2026-11-19T18:00:00Z',
    slaSolutionDateIsPaused:false,
    lastActionDate:'2026-11-18T19:00:00Z',
    owner:{id:'agent-1',businessName:'Mariana'},
    clients:[{organization:{businessName:'Cliente de teste'}}],
    ...changes
  },...rowChanges
});
const run=(records,options={})=>evaluateAlertPolicies(records,{now:NOW,team:'Implantação',...options});

test('classifies overdue SLA as humanized corrective preview; no delivery is possible',()=>{
 const result=run([ticket()]);
 assert.equal(result.mode,'dry-run');
 assert.equal(result.byType.SLA_VENCIDO,1);
 assert.equal(result.notificationsSent,0);
 assert.equal(result.changesWritten,0);
 assert.equal(result.preview[0].recipient,'Responsável do chamado (prévia)');
 assert.equal(result.preview[0].sent,false);
 assert.equal(result.preview[0].canSend,false);
 assert.match(result.preview[0].messagePreview,/por gentileza/i);
 assert.equal(result.historyCoverage,'NÃO_CONECTADO');
});
test('classifies preventive, escalation and no-movement with explicit time thresholds',()=>{
 const preventive=ticket({slaSolutionDate:'2026-11-20T10:00:00Z',lastActionDate:'2026-11-19T17:00:00Z'},{ticket_id:'20002'});
 const escalated=ticket({slaSolutionDate:'2026-11-15T19:00:00Z',lastActionDate:'2026-11-16T19:00:00Z'},{ticket_id:'20003'});
 const idle=ticket({slaSolutionDate:'2026-12-01T19:00:00Z',lastActionDate:'2026-11-10T19:00:00Z'},{ticket_id:'20004'});
 const out=run([preventive,escalated,idle]);
 assert.equal(out.byType.PREVENTIVO_24H,1);
 assert.equal(out.byType.ESCALONAMENTO_GESTOR,1);
 assert.equal(out.byType.SEM_MOVIMENTACAO_7D,1);
 const candidate=out.preview.find(t=>t.ticketId==='20003');
 assert.equal(candidate.managerReviewRequired,true);
 assert.equal(candidate.managerConfigured,false);
 assert.match(candidate.recipient,/não identificado/i);
 assert.equal(out.managerDirectory,'NÃO_CONECTADO');
});
test('paused, resolved, closed, stopped and unknown status are excluded',()=>{
 const o=run([
  ticket({slaSolutionDateIsPaused:true}),
  ticket({baseStatus:'Resolved'},{ticket_id:'20002'}),
  ticket({baseStatus:'Closed'},{ticket_id:'20003'}),
  ticket({baseStatus:'Stopped'},{ticket_id:'20004'}),
  ticket({baseStatus:'Unknown'},{ticket_id:'20005'}),
  ticket({}, {ticket_id:'20006',closed_at_source:'2026-11-19T15:00:00Z'})
 ]);
 assert.equal(o.qualified,0);
 assert.equal(o.discarded.SLA_PAUSADO_OU_INDEFINIDO,1);
 assert.equal(o.discarded.CONCLUIDO_OU_CANCELADO,3);
 assert.equal(o.discarded.STATUS_NAO_CONFIRMADO,2);
});
test('stale, missing or future sync data blocks recommendations',()=>{
 const x=run([
  ticket({}, {source_synced_at:'2026-11-18T17:00:00Z'}),
  ticket({}, {ticket_id:'20002',source_synced_at:null}),
  ticket({}, {ticket_id:'20003',source_synced_at:'2026-11-20T19:00:00Z'})
 ]);
 assert.equal(x.qualified,0);
 assert.equal(x.discarded.SINCRONIZACAO_A_CONFIRMAR,3);
});
test('missing owner is excluded; missing last real action never triggers escalation',()=>{
 const x=run([
  ticket({owner:null}),
  ticket({slaSolutionDate:'2026-11-15T19:00:00Z',lastActionDate:null},{ticket_id:'20002'})
 ]);
 assert.equal(x.discarded.SEM_RESPONSAVEL,1);
 assert.equal(x.byType.ESCALONAMENTO_GESTOR,0);
 assert.equal(x.byType.SLA_VENCIDO,1);
 assert.equal(x.preview[0].hoursWithoutVerifiedAction,null);
});
test('one finding per ticket; evidence-based deduplication is optional, never inferred',()=>{
 const t=ticket();
 const first=run([t,t]);
 assert.equal(first.qualified,1);
 assert.equal(first.duplicatesInBatch,1);
 assert.equal(first.discarded.DUPLICADO_NA_CONSULTA,1);
 const again=run([t],{verifiedSentKeys:new Set([first.preview[0].alertKey])});
 assert.equal(again.qualified,0);
 assert.equal(again.discarded.ALERTA_JA_ENVIADO_COM_EVIDENCIA,1);
 assert.equal(run([t]).qualified,1,'A simulação anterior não equivale a um alerta enviado');
});
test('sector scoping normalizes accents and rejects unknown teams',()=>{
 assert.equal(canonicalTeam('implantacao'),'Implantação');
 assert.equal(canonicalTeam('PRODUCAO'),'Produção');
 assert.equal(canonicalTeam('financeiro'),null);
 assert.equal(run([ticket({ownerTeam:'Suporte'})]).qualified,0);
 assert.throws(()=>run([],{team:'Financeiro'}),/Setor não permitido/);
});
test('current SLA deadline is never recalculated using arbitrary holiday rules',()=>{
 const x=run([ticket({slaSolutionDate:'2026-11-20T19:00:00Z',
   lastActionDate:'2026-11-19T18:00:00Z'})]);
 assert.equal(x.byType.PREVENTIVO_24H,1);
 assert.equal(x.thresholds.preventiveHours,24);
 assert.equal(x.notices.some(t=>t.includes('calendário de SLA')),true);
});

const source=readFileSync(new URL('../api/audit-alert-policy-preview.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../audit-alert-policy-ui.js',import.meta.url),'utf8');
test('UI contains sector selector and preview; no send operation',()=>{
 for(const id of ['policyPreviewPanel','policyPreviewRun','policyPreviewTeam','policyPreviewStatus','policyPreviewRows'])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/audit-alert-policy-ui\.js/);
 assert.match(ui,/method:'GET'/);
 assert.doesNotMatch(ui,/(ticket_charge_send|registerInternalNote|sendEmail|sendMail)/);
});
test('server route enforces GET, admin ACL and keeps all calls read-only',()=>{
 assert.match(source,/req\.method!=='GET'/);
 assert.match(source,/audit_users/);
 assert.match(source,/is_active!==false/);
 assert.match(source,/payload->>ownerTeam/);
 assert.doesNotMatch(source,/method:\s*'(POST|PUT|PATCH|DELETE)'/);
 assert.match(source,/notificationsSent:0,changesWritten:0/);
});
test('GET route is authenticated and rejects writes without contacting services',async()=>{
 const oldFetch=globalThis.fetch;
 const oldEnv=Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'].map(k=>[k,process.env[k]]));
 process.env.SUPABASE_URL='https://example.supabase.co';
 process.env.SUPABASE_SERVICE_ROLE_KEY='fake-secret';
 const response=()=>({
  statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},
  status(v){this.statusCode=v;return this},json(body){this.body=body;return this},end(){return this}
 });
 try {
  const {default:handler}=await import('../api/audit-alert-policy-preview.js');
  const calls=[];
  globalThis.fetch=async (url,options)=>{
    calls.push({url:String(url),method:options.method});
    assert.equal(options.method,'GET');
    if(String(url).endsWith('/auth/v1/user'))
      return {ok:true,json:async()=>({id:'fake-admin'})};
    if(String(url).includes('audit_users'))
      return {ok:true,json:async()=>[{role:'admin',is_active:true}]};
    if(String(url).includes('audit_direct_tickets')){
      const u=new URL(url);
      assert.equal(u.searchParams.get('payload->>ownerTeam'),'eq.Implantação');
      return {ok:true,json:async()=>[ticket()]};
    }
    throw Error('Unexpected request');
  };
  const res=response();
  await handler({method:'GET',headers:{authorization:'Bearer fake-jwt'},query:{team:'Implantação'}},res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.qualified,1);
  assert.equal(res.body.notificationsSent,0);
  assert.equal(res.body.changesWritten,0);
  assert.equal(calls.length,3);
  assert.doesNotMatch(JSON.stringify(res.body),/fake-secret|fake-jwt/);

  calls.length=0;
  const denied=response();
  await handler({method:'POST',headers:{authorization:'Bearer fake-jwt'},query:{}},denied);
  assert.equal(denied.statusCode,405);
  assert.equal(calls.length,0);
  const invalid=response();
  await handler({method:'GET',headers:{authorization:'Bearer fake-jwt'},query:{team:'Financeiro'}},invalid);
  assert.equal(invalid.statusCode,400);
  assert.equal(calls.length,0);
 } finally {
  globalThis.fetch=oldFetch;
  for(const [k,v] of Object.entries(oldEnv)){
    if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
 }
});
