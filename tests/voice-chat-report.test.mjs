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
 const voice={total:3,inbound:2,outbound:1,answered:2,unanswered:1,tmaSeconds:90,tmeSeconds:null,byExtension:[{extension:'123',name:'<Bruno>',total:3,answered:2}]};
 const result=composeVoiceChat(voice,{metrics:{tickets:4},measuredChat:{tmaSeconds:30,tmeSeconds:5},quality:[{channel:'voz',total:2,csatPositive:1},{channel:'chat',total:3,csatPositive:2}]});
 assert.equal(result.packet.chatMetrics.tickets,4);assert.equal(result.packet.quality.chat.positive,2);assert.ok(result.html.includes('&lt;Bruno&gt;'));assert.ok(!result.html.includes('<Bruno>'));assert.ok(result.text.includes('Indisponível'));assert.ok(result.text.includes('30s'));
});
