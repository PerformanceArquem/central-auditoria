import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('lib/zenvia-voice.js','utf8')
 .replace('export default async function handler(req,res){','async function handler(req,res){');
const outbound=[
 {id:1,data_criacao:'2026-11-10T10:00:00-03:00',ramal_id_origem:2000,
  destino:{status:'atendida',duracao_segundos:120,duracao_falada_segundos:115}},
 {id:2,data_criacao:'2026-11-10T11:00:00-03:00',ramal_id_origem:2001,
  destino:{status:'ocupado',duracao_segundos:0}}
];
const inbound=[
 {id:5,data_inicio:'2026-11-10T12:00:00-03:00',ramal_id:2000,status:'atendida',duracao_segundos:60,duracao_falada_segundos:55},
 {id:6,data_inicio:'2026-11-11T12:00:00-03:00',ramal_id:2001,status:'nao_atendida',duracao_segundos:0},
 {id:7,data_inicio:'2026-11-11T12:15:00-03:00',ramal_id:2001,status:'chamando',ativa:true,duracao_segundos:0},
 {id:8,data_inicio:'2026-11-11T13:00:00-03:00',ramal_id:2001,status:'estado_novo',ativa:false,duracao_segundos:0}
];
let calls=[];
const json=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
let allowed=true,token=true,broken=false,waitMissing=false;
const queueCalls=[
 {id:41,data_inicio:'2026-11-10T14:00:00-03:00',tempo_espera:40},
 {id:42,data_inicio:'2026-11-11T15:00:00-03:00',tempo_espera:80}
];
const fetch=async(input,opts={})=>{
 const url=new URL(String(input));
 calls.push({url,opts});
 if(url.pathname.endsWith('/auth/v1/user'))return json({id:'user-123'});
 if(url.pathname.endsWith('/rest/v1/audit_users'))return json([{role:allowed?'admin':'operator',is_active:true}]);
 if(url.hostname==='voice-api.zenvia.com'){
  assert.equal(opts.method,'GET');
  assert.equal(opts.headers['Access-Token'],'fixture-token');
  if(broken)return json({message:'rejected'},502);
  assert.equal(url.searchParams.get('data_inicio'),'2026-11-10');
  assert.equal(url.searchParams.get('data_fim'),'2026-11-11');
  const rows=url.pathname==='/chamada/relatorio'?outbound:url.pathname==='/fila/430/relatorio'?
   queueCalls.map((x,i)=>i===1&&waitMissing?{...x,tempo_espera:null}:x):inbound;
  return json({sucesso:true,dados:{relatorio:rows,total:rows.length}});
 }
 throw Error('Unexpected request '+url);
};
const scope=vm.createContext({
 fetch,URL,AbortController,setTimeout,clearTimeout,Date,Number,String,Array,Math,Error,
 process:{env:{SUPABASE_URL:'https://fake.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',ZENVIA_VOICE_ACCESS_TOKEN:'fixture-token'}}
});
vm.runInContext(source+'\nthis.handler=handler;',scope);
async function invoke(query={start:'2026-11-10',end:'2026-11-11'},authorization='Bearer fixture-user'){
 calls=[];
 const res={code:200,status(code){this.code=code;return this},setHeader(){},json(body){this.body=body;return this}};
 await scope.handler({method:'GET',headers:{authorization},query},res);
 return res;
}
test('requires session and admin role before requesting voice data',async()=>{
 assert.equal((await invoke({},'')).code,401);
 assert.equal(calls.some(x=>x.url.hostname==='voice-api.zenvia.com'),false);
 allowed=false;
 try{assert.equal((await invoke()).code,403);
 assert.equal(calls.some(x=>x.url.hostname==='voice-api.zenvia.com'),false);}
 finally{allowed=true;}
});
test('rejects date errors before any Zenvia request',async()=>{
 for(const query of [{start:'2026-11-30',end:'2026-11-01'},{start:'bad',end:'2026-11-10'},{start:'2026-02-30',end:'2026-11-10'},
 {start:'2026-01-01',end:'2026-11-11'}]){
  const r=await invoke(query);assert.equal(r.code,400);
  assert.equal(calls.some(x=>x.url.hostname==='voice-api.zenvia.com'),false);
 }
});
test('reports inbound/outbound KPIs and never exposes personal information or credentials',async()=>{
 const r=await invoke();
 assert.equal(r.code,200);
 assert.equal(r.body.summary.total,6);
 assert.equal(r.body.summary.inbound,4);
 assert.equal(r.body.summary.outbound,2);
 assert.equal(r.body.summary.answered,2);
 assert.equal(r.body.summary.unanswered,2);
 assert.equal(r.body.summary.inProgress,1);
 assert.equal(r.body.summary.unclassified,1);
 assert.equal(r.body.summary.answered+r.body.summary.unanswered+r.body.summary.inProgress+r.body.summary.unclassified,r.body.summary.total);
 assert.equal(r.body.summary.tmaSeconds,85);
 assert.equal(r.body.summary.durationSeconds,180);
 assert.equal(r.body.summary.talkSeconds,170);
 assert.equal(r.body.summary.tmeSeconds,null);
 assert.equal(r.body.queue.configured,false);
 assert.equal(calls.some(x=>x.url.pathname==='/fila/430/relatorio'),false);
 assert.equal(r.body.byDay.length,2);
 assert.equal(r.body.byExtension.length,2);
 const serial=JSON.stringify(r.body);
 for(const prohibited of ['numero','gravacao','fixture-token','fixture-service','+551'])assert.equal(serial.includes(prohibited),false,prohibited);
 assert.ok(calls.some(x=>x.url.pathname==='/did/relatorio'));
 assert.ok(calls.some(x=>x.url.pathname==='/chamada/relatorio'));
});
test('fails closed on external provider failure without fabricated counts',async()=>{
 broken=true;
 try{const r=await invoke();assert.equal(r.code,502);assert.equal(r.body.ok,false);
 assert.equal(r.body.summary,undefined);}
 finally{broken=false;}
});
test('missing Zenvia token reports configuration pending and does not call external API',async()=>{
 scope.process.env.ZENVIA_VOICE_ACCESS_TOKEN='';
 try{const r=await invoke();assert.equal(r.code,503);assert.equal(calls.some(x=>x.url.hostname==='voice-api.zenvia.com'),false);}
 finally{scope.process.env.ZENVIA_VOICE_ACCESS_TOKEN='fixture-token';}
});
test('voice UI shows TME unavailable, uses authenticated request, and has no secret in HTML',()=>{
 const html=readFileSync('index.html','utf8');
 assert.ok(html.includes('data-t="zenvia-voice"'));
 assert.ok(html.includes('id="t-zenvia-voice"'));
 assert.ok(html.includes("window.tmAuth?.getSession?.()"));
 assert.ok(html.includes("fetch('/api/audit-production-metrics?mode=zenvia&'"));
 assert.ok(html.includes("['TME da fila',fmtSeconds(x.tmeSeconds)]"));
 assert.ok(html.includes("['Em andamento',x.inProgress]"));
 assert.ok(html.includes("['Não classificadas',x.unclassified]"));
 assert.ok(!html.includes('ZENVIA_VOICE_ACCESS_TOKEN'));
});

test('configured support queue supplies real TME from all queue wait samples',async()=>{
 scope.process.env.ZENVIA_VOICE_QUEUE_ID='430';
 try{
   const r=await invoke();
   assert.equal(r.code,200);
   assert.equal(r.body.queue.configured,true);
   assert.equal(r.body.queue.queueId,'430');
   assert.equal(r.body.queue.calls,2);
   assert.equal(r.body.queue.waitSampleCount,2);
   assert.equal(r.body.queue.waitTotalSeconds,120);
   assert.equal(r.body.queue.missingWaitSamples,0);
   assert.equal(r.body.summary.tmeSeconds,60);
   assert.equal(calls.some(x=>x.url.pathname==='/fila/430/relatorio'),true);
 }finally{delete scope.process.env.ZENVIA_VOICE_QUEUE_ID;}
});
test('queue wait missing or null means no TME, never treated as zero',async()=>{
 scope.process.env.ZENVIA_VOICE_QUEUE_ID='430';waitMissing=true;
 try{
   const r=await invoke();
   assert.equal(r.code,200);
   assert.equal(r.body.queue.calls,2);
   assert.equal(r.body.queue.waitSampleCount,1);
   assert.equal(r.body.queue.missingWaitSamples,1);
   assert.equal(r.body.queue.tmeSeconds,null);
   assert.equal(r.body.summary.tmeSeconds,null);
 }finally{waitMissing=false;delete scope.process.env.ZENVIA_VOICE_QUEUE_ID;}
});
test('invalid queue ID is not sent to Zenvia external API',async()=>{
 scope.process.env.ZENVIA_VOICE_QUEUE_ID='../private';
 try{
   const r=await invoke();
   assert.equal(r.code,200);
   assert.equal(r.body.queue.configured,false);
   assert.equal(calls.some(x=>x.url.pathname.startsWith('/fila/')),false);
 }finally{delete scope.process.env.ZENVIA_VOICE_QUEUE_ID;}
});
