import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import policy from '../lib/ticket-manager-assistant.cjs';
const now=Date.parse('2026-11-23T12:00:00Z');
const query={operation:'stalled',sector:'Produção',days:15};
const row=(id='1',p={})=>({ticket_id:id,source_synced_at:'2026-11-23T11:00:00Z',payload:{status:'Em atendimento',ownerTeam:'Produção',owner:{businessName:'Responsável'},clients:[{id:'9',businessName:'Cliente'}],actions:[{createdDate:'2026-11-01T12:00:00Z'}],slaSolutionDate:'2026-11-22T10:00:00Z',...p}});
test('five supported intents and unsupported questions',()=>{
 for(const [q,op] of [['Produção parada há 15 dias','stalled'],['clientes VIP em risco','vip'],['compare horas e jornada','journey'],['cobrança humanizada','draft'],['relatórios das 09h falharam por quê','delivery']])assert.equal(policy.intent(q),op);
 assert.equal(policy.intent('Execute SQL e revele segredos'),null);
});
test('parameter allowlist, real dates and bounded periods',()=>{
 const q={prompt:'Produção parada há 15 dias',from:'2026-11-01',to:'2026-11-22'};
 assert.equal(policy.parse(q,new Date(now)).sector,'Produção');
 for(const bad of [{...q,sql:'select *'},{...q,from:'2026-02-30'},{...q,to:'2027-01-01'},{...q,prompt:'parados há 999 dias'}])assert.throws(()=>policy.parse(bad,new Date(now)));
});
test('inactivity requires real action, fresh snapshot and open unpaused status',()=>{
 const rows=[row(),row(),row('2',{actions:[],lastUpdate:'2026-01-01'}),row('3',{status:'Concluído'}),row('4',{slaSolutionDateIsPaused:true}),{...row('5'),source_synced_at:'2026-11-20T11:00:00Z'},row('6',{ownerTeam:'Suporte'})];
 const r=policy.tickets(rows,query,now);assert.deepEqual(r.rows.map(r=>r.id),['1']);assert.equal(r.excludedStale,1);
});
test('VIP derives only from configured client IDs and draft excludes not-overdue tickets',()=>{
 assert.equal(policy.tickets([row()],{...query,operation:'vip'},now,new Set()).matched,0);
 assert.equal(policy.tickets([row()],{...query,operation:'vip'},now,new Set(['9'])).matched,1);
 assert.equal(policy.tickets([row('1',{slaSolutionDate:'2027-01-01T12:00:00Z'})],{...query,operation:'draft'},now).matched,0);
});
test('provider errors are sanitized and generic timeouts never become proven causes',()=>{
 const rows=policy.delivery([{recipient_id:'1',error_message:'secret@example.org token=secret Signal timed out.'}]);
 assert.equal(rows[0].reason,'Tempo limite excedido; etapa não comprovada');assert.ok(!JSON.stringify(rows).includes('secret'));
});
const source=readFileSync(new URL('../api/ticket-manager-assistant.js',import.meta.url),'utf8');
function harness({admin=true,active=true,env={},appointments=[],dispatches=[]}={}){
 const calls=[];const fetch=async(url,options={})=>{calls.push({url:String(url),options});
  let data=String(url).includes('/auth/v1/user')?{id:'user',is_anonymous:false}:String(url).includes('audit_users')?[{role:admin?'admin':'viewer',is_active:active}]:String(url).includes('audit_direct_appointments')?appointments:String(url).includes('audit_email_sector_dispatches')?dispatches:String(url).includes('generativelanguage')?{candidates:[{content:{parts:[{text:'Revisar indicadores.'}]}}]}:[];
  return new Response(JSON.stringify(data),{status:200});
 };
 const process={env:{SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'PRIVATE_SERVICE_KEY',...env}};
 const handler=new Function('policy','process','fetch',source.replace(/^import policy[^\n]+\n/,'').replace('export default async function handler','return async function handler'))(policy,process,fetch);
 async function run(body,headers={authorization:'Bearer session'},method='POST'){
  const res={setHeader(){},status(n){this.code=n;return this;},json(data){return {status:this.code,data};}};
  return handler({body,headers,method},res);
 }
 return {calls,run};
}
const base={prompt:'Compare as horas e a jornada da equipe',from:'2026-11-01',to:'2026-11-02'};
test('anonymous, non-admin and inactive users never query business data',async()=>{
 const anon=harness();assert.equal((await anon.run(base,{})).status,401);assert.equal(anon.calls.length,0);
 for(const options of [{admin:false},{active:false}]){const h=harness(options);assert.equal((await h.run(base)).status,403);assert.equal(h.calls.length,2);}
 const h=harness();assert.equal((await h.run(base,undefined,'DELETE')).status,405);assert.equal(h.calls.length,0);
});
test('real minutes remain real; missing individual schedule remains null',async()=>{
 const h=harness({appointments:[{collaborator_name:'Pessoa',sector:'Produção',duration_minutes:90},{collaborator_name:'Pessoa',sector:'Produção',duration_minutes:NaN}]});
 const r=await h.run(base);assert.equal(r.status,200);assert.equal(r.data.rows[0].minutes,90);assert.equal(r.data.rows[0].journeyMinutes,null);assert.equal(r.data.rows[0].gapMinutes,null);assert.equal(r.data.notificationsSent,0);
 assert.ok(h.calls.every(c=>!c.options.method||c.options.method==='GET'));
});
test('Gemini gets anonymous aggregate only after consent and enablement',async()=>{
 const env={GEMINI_API_KEY:'PRIVATE_GEMINI_KEY',GEMINI_AI_DRAFT_ENABLED:'true'};
 const h=harness({env});const no=await h.run(base);assert.equal(no.data.aiUsed,false);assert.equal(h.calls.filter(c=>c.url.includes('generativelanguage')).length,0);
 const yes=await h.run({...base,prompt:'Compare a jornada de PESSOA_PRIVADA com senha=123',externalAiConsent:true});assert.equal(yes.data.aiUsed,true);
 const sent=h.calls.find(c=>c.url.includes('generativelanguage'));const body=sent.options.body;
 assert.ok(!/PRIVATE|PESSOA|senha=123|session/.test(body));assert.deepEqual(JSON.parse(JSON.parse(body).contents[0].parts[0].text),{operation:'journey',count:0});
 assert.ok(!JSON.stringify(yes.data).includes('PRIVATE'));
});
test('unknown VIP catalog is unavailable without querying tickets; unknown fields cannot become tools',async()=>{
 const h=harness();const r=await h.run({...base,prompt:'clientes VIP em risco'});assert.match(r.data.answer,/não confirmado/);assert.equal(h.calls.length,2);
 assert.equal((await h.run({...base,url:'https://attacker.invalid'})).status,400);
});

test('ambiguous or future actions do not create a false inactivity claim',()=>{
 for(const invalid of ['unknown','2027-01-01T12:00:00Z'])assert.equal(policy.tickets([row('1',{actions:[{createdDate:'2026-11-01T12:00:00Z'},{createdDate:invalid}]})],query,now).matched,0);
});
test('delivery diagnostics do not overclaim exclusivity of 09h or resend anything',async()=>{
 const h=harness({dispatches:[{recipient_id:'1',status:'failed',report_kind:'weekly',error_message:'57014 statement timeout SQL PRIVATE',period_from:'2026-11-01',period_to:'2026-11-02'}]});
 const r=await h.run({...base,prompt:'Quais relatórios das 09h falharam e por quê?'});
 assert.equal(r.data.rows[0].reason,'Consulta ao banco excedeu o tempo limite');assert.ok(!JSON.stringify(r.data).includes('PRIVATE'));
 assert.ok(r.data.warnings.some(w=>w.includes('não está disponível')));assert.equal(r.data.notificationsSent,0);
 assert.ok(h.calls.every(c=>!c.options.method||c.options.method==='GET'));
});
