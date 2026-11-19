import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import quality from '../lib/audit-quality-review.cjs';

const {evaluateQualityRecords,buildAnonymizedAiPayload,localChecklist,definitions}=quality;
const NOW=Date.parse('2026-11-19T19:00:00Z');
const ticket=(changes={},meta={})=>({
  ticket_id:'1001',source_synced_at:'2026-11-19T18:00:00Z',
  closed_at_source:null,
  payload:{
    id:1001,subject:'Abc',ownerTeam:'Implantação',
    owner:null,baseStatus:'InAttendance',
    slaSolutionDate:null,lastActionDate:'2026-11-01T19:00:00Z',
    ownerHistories:[],clients:[{organization:{businessName:'CLIENTE SECRETO'}}],
    ...changes
  },...meta
});
const analyze=(rows,extra={})=>evaluateQualityRecords(rows,{now:NOW,...extra});
test('quality finding is only orientative and never formal NC',()=>{
  const out=analyze([ticket()]);
  assert.equal(out.mode,'dry-run');
  assert.equal(out.candidates,1);
  assert.equal(out.nonConformitiesCreated,0);
  assert.equal(out.notificationsSent,0);
  assert.equal(out.changesWritten,0);
  assert.equal(out.preview[0].severity,'NÃO_CLASSIFICADA');
  assert.equal(out.preview[0].formalNonConformity,false);
  assert.equal(out.preview[0].officialProcedureVerified,false);
  assert.equal(out.approval.requiresQualityAnalystApproval,true);
  assert.equal(out.approval.policyApprovalStatus,'NOT_VERIFIED');
  assert(out.preview[0].signals.some(x=>x.code==='SEM_RESPONSAVEL'));
  assert(out.preview[0].signals.some(x=>x.code==='ASSUNTO_PARA_REVISAO'));
  assert(out.preview[0].signals.some(x=>x.code==='SEM_ACAO_7D'));
});
test('closed, outdated and duplicate tickets are not classified',()=>{
 const x=analyze([
  ticket({}, {ticket_id:'1001',closed_at_source:'2026-11-18T19:00:00Z'}),
  ticket({}, {ticket_id:'1002',source_synced_at:'2026-11-17T00:00:00Z'}),
  ticket({}, {ticket_id:'1002',source_synced_at:'2026-11-17T00:00:00Z'})
 ]);
 assert.equal(x.candidates,0);
 assert.equal(x.completedSkipped,1);
 assert.equal(x.staleSkipped,1);
 assert.equal(x.discarded.REPETIDO,1);
});
test('unknown last action is not construed as 7 days of inactivity',()=>{
 const d=analyze([ticket({lastActionDate:null})]);
 const codes=d.preview[0].signals.map(x=>x.code);
 assert(codes.includes('ULTIMA_ACAO_INDISPONIVEL'));
 assert(!codes.includes('SEM_ACAO_7D'));
 assert.equal(d.preview[0].lastRealActionAt,null);
});
test('clean fields cause no findings when actual evidence is sufficient',()=>{
 const d=analyze([ticket({
  subject:'Implantação da loja',
  owner:{id:'44',businessName:'Mariana'},
  slaSolutionDate:'2026-11-22T19:00:00Z',
  lastActionDate:'2026-11-19T18:00:00Z',
  ownerHistories:[{ownerTeam:'Implantação',changedDate:'2026-11-10T19:00:00Z'}]
 })]);
 assert.equal(d.candidates,0);
});
test('only allowlisted nonpersonal codes are made available to Gemini',()=>{
 const candidate=analyze([ticket({subject:'cliente secreto:'})]).preview[0];
 const payload=buildAnonymizedAiPayload(candidate);
 const value=JSON.stringify(payload);
 assert.equal(payload.noPersonalData,true);
 assert.equal(payload.noOfficialNC,true);
 assert(value.includes('SEM_RESPONSAVEL'));
 assert(!value.includes('CLIENTE SECRETO'));
 assert(!value.includes('1001'));
 assert(!value.includes('Implantação'));
 assert(!value.includes('cliente secreto'));
 assert(!value.includes('Mariana'));
 const forged=buildAnonymizedAiPayload({signals:[{code:'SEM_RESPONSAVEL'},{code:'CUSTOM_USER_PROMPT'}]});
 assert.deepEqual(forged.evidenceCodes,['SEM_RESPONSAVEL']);
 assert.throws(()=>buildAnonymizedAiPayload({signals:[{code:'DROP_TABLE'}]}));
});
test('checklists are guidance, not severity, official policy or disciplinary finding',()=>{
 const list=localChecklist(['SEM_RESPONSAVEL','ASSUNTO_PARA_REVISAO']);
 assert.equal(list.length,2);
 assert(list.every(x=>x.classification==='ORIENTATIVA_ATÉ_VALIDAÇÃO_DA_QUALIDADE'));
 assert.equal(definitions.SEM_RESPONSAVEL.fields[0],'owner.id');
});

const apiGet=readFileSync(new URL('../api/audit-quality-review.js',import.meta.url),'utf8');
const apiAi=readFileSync(new URL('../api/audit-quality-ai-draft.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../audit-quality-review-ui.js',import.meta.url),'utf8');

test('quality panel contains explicit human review and consent control',()=>{
 for(const id of ['qualityReviewPanel','qualityReviewRun','qualityReviewRows',
  'qualityAiConsent','qualityAiGenerate','qualityAiDraft'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/audit-quality-review-ui\.js/);
 assert.match(ui,/method:'GET'/);
 assert.match(ui,/method:'POST'/);
 assert.match(ui,/textContent=/);
 assert.doesNotMatch(ui,/ticket_charge_send|registerInternalNote|sendMail|movideskInternalAction/);
});
test('read-only API is admin-scoped and rejects writing',()=>{
 assert.match(apiGet,/req\.method!=='GET'/);
 assert.match(apiGet,/audit_users/);
 assert.match(apiGet,/is_active!==false/);
 assert.doesNotMatch(apiGet,/method:\s*'(POST|PATCH|PUT|DELETE)'/);
 assert.match(apiGet,/nonConformitiesCreated:0/);
});
test('AI API is gated by consent+flag+key and sends codes only',()=>{
 assert.match(apiAi,/QUALITY_GEMINI_DRAFT_ENABLED==='true'/);
 assert.match(apiAi,/input\.consent/);
 assert.match(apiAi,/process\.env\.GEMINI_API_KEY/);
 assert.match(apiAi,/buildAnonymizedAiPayload/);
 assert.match(apiAi,/Somente códigos internos/);
 assert.doesNotMatch(apiAi,/movidesk\.com\/public\/v1\/tickets|ticket_charge_send|registerInternalNote/);
});

const response=()=>({
 statusCode:200,setHeader(){return this},status(v){this.statusCode=v;return this},
 json(v){this.body=v;return this},end(){return this}
});
test('GET route accepts admin, reads snapshots and denies POST without calls',async()=>{
 const saved=globalThis.fetch;
 const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
 const prev=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 process.env.SUPABASE_URL='https://example.supabase.co';
 process.env.SUPABASE_SERVICE_ROLE_KEY='mock-only-service-key';
 try{
  const {default:handler}=await import('../api/audit-quality-review.js');
  const calls=[];
  globalThis.fetch=async(url,opts)=>{
   calls.push(String(url));
   assert.equal(opts.method,'GET');
   if(String(url).endsWith('/auth/v1/user'))return {ok:true,json:async()=>({id:'fake-admin'})};
   if(String(url).includes('/rest/v1/audit_users'))
     return {ok:true,json:async()=>[{role:'admin',is_active:true}]};
   if(String(url).includes('/rest/v1/audit_direct_tickets'))
     return {ok:true,json:async()=>[ticket()]};
   throw Error('Unexpected fetch');
  };
  const ok=response();
  await handler({method:'GET',headers:{authorization:'Bearer user-test'}},ok);
  assert.equal(ok.statusCode,200);
  assert.equal(ok.body.candidates,1);
  assert.equal(ok.body.nonConformitiesCreated,0);
  assert.equal(ok.body.notificationsSent,0);
  assert.equal(calls.length,3);
  assert.doesNotMatch(JSON.stringify(ok.body),/mock-only-service-key|user-test/);
  calls.length=0;
  const wrong=response();
  await handler({method:'POST',headers:{authorization:'Bearer user-test'}},wrong);
  assert.equal(wrong.statusCode,405);
  assert.equal(calls.length,0);
 }finally{
  globalThis.fetch=saved;
  for(const k of keys)if(prev[k]===undefined)delete process.env[k];else process.env[k]=prev[k];
 }
});
test('AI endpoint requires explicit consent, rejects user text and never sends ticket details',async()=>{
 const oldFetch=globalThis.fetch;
 const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','QUALITY_GEMINI_DRAFT_ENABLED','GEMINI_API_KEY'];
 const prev=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'fake-db-secret',
  QUALITY_GEMINI_DRAFT_ENABLED:'true',
  GEMINI_API_KEY:'fake-gemini-test-key'
 });
 try{
  const {default:handler}=await import('../api/audit-quality-ai-draft.js');
  const calls=[];
  globalThis.fetch=async(url,opts)=>{
   calls.push({url:String(url),opts});
   if(String(url).endsWith('/auth/v1/user')){
    assert.equal(opts.method,'GET');
    return {ok:true,json:async()=>({id:'fake-admin'})};
   }
   if(String(url).includes('/rest/v1/audit_users')){
    assert.equal(opts.method,'GET');
    return {ok:true,json:async()=>[{role:'admin',is_active:true}]};
   }
   if(String(url).includes('generativelanguage.googleapis.com')){
    assert.equal(opts.method,'POST');
    const body=JSON.stringify(JSON.parse(opts.body));
    assert(body.includes('SEM_RESPONSAVEL'));
    assert(!body.includes('1001'));
    assert(!body.includes('CLIENTE SECRETO'));
    assert(!body.includes('Mariana'));
    return {ok:true,json:async()=>({candidates:[{
     content:{parts:[{text:'Conferir atribuição, evidências e norma vigente antes da revisão.'}]}
    }]})};
   }
   throw Error('Unexpected fetch');
  };
  const req=body=>({method:'POST',headers:{authorization:'Bearer fake-session'},body});
  const noConsent=response();
  await handler(req({signalCodes:['SEM_RESPONSAVEL'],externalAiConsent:false}),noConsent);
  assert.equal(noConsent.statusCode,200);
  assert.equal(noConsent.body.aiUsed,false);
  assert.equal(calls.filter(x=>x.url.includes('generativelanguage')).length,0);
  const forbidden=response();
  await handler(req({signalCodes:['SEM_RESPONSAVEL'],externalAiConsent:true,
    description:'PRIVATE CUSTOMER DETAIL'}),forbidden);
  assert.equal(forbidden.statusCode,400);
  assert.equal(calls.filter(x=>x.url.includes('generativelanguage')).length,0);
  const yes=response();
  await handler(req({signalCodes:['SEM_RESPONSAVEL'],externalAiConsent:true}),yes);
  assert.equal(yes.statusCode,200);
  assert.equal(yes.body.aiUsed,true);
  assert.equal(yes.body.nonConformitiesCreated,0);
  assert.equal(yes.body.notificationsSent,0);
  assert.equal(calls.filter(x=>x.url.includes('generativelanguage')).length,1);
  process.env.QUALITY_GEMINI_DRAFT_ENABLED='false';
  const disabled=response();
  await handler(req({signalCodes:['SEM_RESPONSAVEL'],externalAiConsent:true}),disabled);
  assert.equal(disabled.body.aiUsed,false);
  assert.equal(calls.filter(x=>x.url.includes('generativelanguage')).length,1);

  const before=calls.length;
  const wrong=response();
  await handler({method:'GET',headers:{authorization:'Bearer fake-session'}},wrong);
  assert.equal(wrong.statusCode,405);
  assert.equal(calls.length,before);
 }finally{
  globalThis.fetch=oldFetch;
  for(const k of keys)if(prev[k]===undefined)delete process.env[k];else process.env[k]=prev[k];
 }
});
