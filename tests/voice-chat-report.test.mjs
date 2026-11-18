import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const code=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/audit-email-dispatch/voice-chat-report.ts',import.meta.url),'utf8'));
const {collectVoiceReport,composeVoiceChat,voiceReportEligible}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('team and direction reports retain eligibility; individual and unauthorized reports do not gain global data',()=>{
 const allow=r=>r.allowed===true;
 assert.equal(voiceReportEligible({allowed:true,scope:'sector',sectors:['Suporte'],collaborator_names:['Bruno','Cesar']},allow),true);
 assert.equal(voiceReportEligible({allowed:true,scope:'management',sectors:['Suporte'],collaborator_names:['Bruno']},allow),true);
 for(const rec of [{scope:'sector',sectors:['Suporte'],collaborator_names:['Bruno'],allowed:true},{scope:'sector',sectors:['Produção'],allowed:true},{scope:'management',sectors:['Suporte'],allowed:false}])assert.equal(voiceReportEligible(rec,allow),false);
});
test('long report periods use bounded authenticated read-only windows and weighted measured durations',async()=>{
 const calls=[];
 const http=async(input,options)=>{const url=new URL(input);calls.push(url);assert.equal(url.origin,'https://centralauditoria.ddns.net');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer synthetic-service');assert.equal(options.redirect,'error');
 const stats={total:3,inbound:2,outbound:1,answered:2,unanswered:1,inProgress:0,unclassified:0,talkSeconds:180,tmaSamples:2,tmaMissingSamples:0};
 return {ok:true,json:async()=>({ok:true,from:url.searchParams.get('start'),to:url.searchParams.get('end'),summary:stats,support:{metrics:stats},queue:{configured:true,calls:2,waitSampleCount:2,waitTotalSeconds:100,tmeSeconds:50},byDay:[],byExtension:[{extension:'123',name:'Bruno',total:3,answered:2,unanswered:1,talkSeconds:180}]})};};
 const result=await collectVoiceReport('2026-10-01','2026-11-16','synthetic-service',http);
 assert.equal(calls.length,2);assert.equal(calls[0].searchParams.get('end'),'2026-10-31');assert.equal(calls[1].searchParams.get('start'),'2026-11-01');
 assert.equal(result.total,6);assert.equal(result.tmaSeconds,90);assert.equal(result.tmeSeconds,50);assert.equal(result.byExtension[0].name,'Bruno');
});
test('unavailable provider data blocks an official combined report instead of inventing zero',async()=>{await assert.rejects(()=>collectVoiceReport('2026-11-13','2026-11-13','key',async()=>({ok:false})));});
test('combined report packet and HTML contain voice and chat metrics and escaped person names',()=>{
 const voice={total:3,inbound:2,outbound:1,answered:2,unanswered:1,tmaSeconds:90,tmeSeconds:null,byExtension:[{extension:'123',name:'Bruno <Oliveira>',total:3,answered:2}]};
 const result=composeVoiceChat(voice,{metrics:{tickets:4},measuredChat:{tmaSeconds:30,tmeSeconds:5},quality:[{channel:'voz',total:2,csatPositive:1},{channel:'chat',total:3,csatPositive:2}]},['Bruno O.']);
 assert.equal(result.packet.chatMetrics.tickets,4);assert.equal(result.packet.quality.chat.positive,2);assert.ok(result.html.includes('Bruno &lt;Oliveira&gt;'));assert.ok(!result.html.includes('<Oliveira>'));assert.ok(result.text.includes('Indisponível'));assert.ok(result.text.includes('30s'));
});


test('report TMA preserves measured calls across windows and labels missing coverage',async()=>{
 let index=0;
 const http=async(input,options)=>{
  const url=new URL(input);index++;
  assert.equal(options.method,'GET');
  const first=index===1;
  const summary=first
   ?{total:3,inbound:2,outbound:1,answered:2,unanswered:1,inProgress:0,unclassified:0,talkSeconds:120,tmaSamples:1,tmaMissingSamples:1}
   :{total:2,inbound:1,outbound:1,answered:1,unanswered:1,inProgress:0,unclassified:0,talkSeconds:60,tmaSamples:1,tmaMissingSamples:0};
  return {ok:true,json:async()=>({ok:true,from:url.searchParams.get('start'),to:url.searchParams.get('end'),summary,
   support:{metrics:summary},queue:{configured:false},byDay:[],byExtension:[{extension:'123',name:'Agente',total:summary.total,answered:summary.answered,unanswered:summary.unanswered,talkSeconds:summary.talkSeconds,missingTalkSamples:summary.tmaMissingSamples}]})};
 };
 const result=await collectVoiceReport('2026-10-01','2026-11-16','synthetic-service',http);
 assert.equal(index,2);
 assert.equal(result.answered,3);
 assert.equal(result.tmaSamples,2);
 assert.equal(result.tmaMissingSamples,1);
 assert.equal(result.tmaSeconds,90); // 180s / 2 measured calls, not /3 answered
 assert.equal(result.talkSeconds,180); // observed subtotal
 assert.equal(result.talkCoverageComplete,false);
 assert.equal(result.supportMetrics.tmaSeconds,90);
 assert.equal(result.byExtension[0].missingTalkSamples,1);
 assert.equal(result.byExtension[0].talkSeconds,180);
 assert.equal(result.byExtension[0].talkCoverageComplete,false);
 const report=composeVoiceChat(result,{metrics:{tickets:3},measuredChat:{},quality:[]});
 assert.ok(report.html.includes('parcial: 2/3 chamadas'));
 assert.ok(report.text.includes('subtotal'));
});

test('voice distribution shows only authorized Support staff, excluding Kassio and other departments',()=>{
 const people=[
  {extension:'1',name:'Rhyan Massayoshi',total:19,answered:15},
  {extension:'2',name:'Bruno Oliveira',total:16,answered:13},
  {extension:'3',name:'Vitor Nascimento',total:10,answered:7},
  {extension:'4',name:'Guilherme Henrique',total:8,answered:3},
  {extension:'5',name:'Cleverson Teixeira',total:5,answered:5},
  {extension:'6',name:'Kassio Rodrigues',total:4,answered:3},
  {extension:'7',name:'Alan Reis',total:9,answered:6},
  {extension:'8',name:'Davi Vinicius',total:6,answered:6},
  {extension:'9',name:'Guilherme Bonato',total:3,answered:3},
  {extension:'10',name:'Laís Lot',total:3,answered:0}
 ];
 const roster=['Bruno O.','Cesar A.','Cleverson T.','Guilherme H.','Rhyan M.','Venicio D.','Vitor N.','Kassio Nascimento'];
 const voice={total:83,inbound:83,outbound:0,answered:61,unanswered:22,tmaSeconds:120,tmeSeconds:null,byExtension:people};
 const result=composeVoiceChat(voice,{metrics:{tickets:1},measuredChat:{},quality:[]},roster);
 assert.deepEqual(result.packet.byExtension.map(x=>x.name),['Rhyan Massayoshi','Bruno Oliveira','Vitor Nascimento','Guilherme Henrique','Cleverson Teixeira']);
 for(const other of ['Kassio Rodrigues','Alan Reis','Davi Vinicius','Guilherme Bonato','Laís Lot'])
  assert.ok(!result.html.includes(other),other+' incorrectly included');
 assert.ok(result.html.includes('Bruno Oliveira'));
 assert.equal(result.packet.total,83); // account totals remain unchanged
 assert.equal(result.packet.personScope,'Somente colaboradores do Suporte, excluindo Kassio');
});
test('voice distribution fails closed when approved Support roster is missing',()=>{
 const voice={total:2,inbound:2,outbound:0,answered:2,unanswered:0,tmaSeconds:60,byExtension:[{extension:'1',name:'Kassio Rodrigues',total:2,answered:2}]};
 const result=composeVoiceChat(voice,{metrics:{},measuredChat:{},quality:[]});
 assert.deepEqual(result.packet.byExtension,[]);
 assert.ok(!result.html.includes('Kassio Rodrigues'));
});

test('TME weighted by measured queue waits, with partial coverage in official report',async()=>{
 let idx=0;
 const http=async(input)=>{
  idx++;
  const queue=idx===1?{configured:true,calls:4,waitSampleCount:3,waitTotalSeconds:90,tmeSeconds:30,missingWaitSamples:1}:
    {configured:true,calls:2,waitSampleCount:2,waitTotalSeconds:120,tmeSeconds:60,missingWaitSamples:0};
  const summary={total:4,inbound:4,outbound:0,answered:3,unanswered:1,inProgress:0,unclassified:0,talkSeconds:180,tmaSamples:3,tmaMissingSamples:0};
  const u=new URL(input);
  return {ok:true,json:async()=>({ok:true,from:u.searchParams.get('start'),to:u.searchParams.get('end'),summary,queue,
   support:{metrics:summary},byDay:[],byExtension:[]})};
 };
 const result=await collectVoiceReport('2026-10-01','2026-11-16','synthetic-service',http);
 assert.equal(idx,2);
 assert.equal(result.tmeSeconds,42); // (90+120)/(3+2), never /6
 assert.equal(result.queueWaitSamples,5);
 assert.equal(result.queueCalls,6);
 assert.equal(result.queueWaitMissingSamples,1);
 assert.equal(result.queueWaitCoverageComplete,false);
 const output=composeVoiceChat(result,{metrics:{tickets:1},measuredChat:{},quality:[]});
 assert.ok(output.html.includes('parcial: 5/6 chamadas'));
 assert.ok(output.text.includes('TME da fila é PARCIAL'));
});
test('no queue wait measurements stays unavailable and never becomes zero',async()=>{
 const http=async(input)=>{
  const u=new URL(input);
  return {ok:true,json:async()=>({ok:true,from:u.searchParams.get('start'),to:u.searchParams.get('end'),
   summary:{total:2,inbound:2,outbound:0,answered:1,unanswered:1,inProgress:0,unclassified:0,talkSeconds:0,tmaSamples:0,tmaMissingSamples:1},support:{metrics:{total:2,inbound:2,outbound:0,answered:1,unanswered:1,inProgress:0,unclassified:0,talkSeconds:0,tmaSamples:0,tmaMissingSamples:1}},
   queue:{configured:true,calls:2,waitSampleCount:0,waitTotalSeconds:0,tmeSeconds:null,missingWaitSamples:2},
   byDay:[],byExtension:[]})};
 };
 const result=await collectVoiceReport('2026-11-17','2026-11-17','synthetic-service',http);
 assert.equal(result.tmeSeconds,null);
 assert.equal(result.queueWaitSamples,0);
});
