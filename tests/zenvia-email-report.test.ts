import {assertEquals,assertThrows,assertRejects} from "jsr:@std/assert@1";
import {calculateChannelNotes,prepareVoiceEmail} from "../supabase/functions/audit-email-dispatch/zenvia-email-section.ts";
import {readZenviaEmailMetrics} from "../supabase/functions/audit-email-dispatch/zenvia-email-source.ts";
const quality=[
 {service_date:'2026-11-10',channel:'chat',ticket_id:'101',score:8,source:'movidesk',collaborator_name:'Operador'},
 {service_date:'2026-11-10',channel:'chat',ticket_id:'101',score:2,source:'manual',collaborator_name:'Operador'},
 {service_date:'2026-11-10',channel:'chat',ticket_id:'102',score:7,source:'manual',collaborator_name:'Operador'},
 {service_date:'2026-11-10',channel:'voz',ticket_id:'201',score:10,source:'movidesk',collaborator_name:'Operador'},
 {service_date:'2026-11-11',channel:'voz',ticket_id:'202',score:1,source:'manual',collaborator_name:'Operador'}
];
const metrics={total:4,inbound:2,outbound:2,answered:2,unanswered:1,inProgress:1,unclassified:0,tmaSeconds:86,tmeSeconds:null,talkSeconds:172};
Deno.test('CSAT 8-10 positive, 1-7 negative, priority Movidesk per ticket/channel',()=>{
 const d=calculateChannelNotes(quality);
 assertEquals(d.chat.total,2);assertEquals(d.chat.positive,1);assertEquals(d.chat.csatPercent,50);
 assertEquals(d.voz.total,2);assertEquals(d.voz.positive,1);assertEquals(d.voz.csatPercent,50);
 assertEquals(d.chat.movidesk,1);assertEquals(d.chat.manual,1);
});
Deno.test('multiple real Movidesk surveys on one ticket are preserved, manual overlap is excluded',()=>{
 const rows=[
  {service_date:'2026-11-10',channel:'voz',ticket_id:'701',score:8,source:'movidesk',collaborator_name:'Atendente'},
  {service_date:'2026-11-10',channel:'voz',ticket_id:'701',score:10,source:'movidesk',collaborator_name:'Atendente'},
  {service_date:'2026-11-10',channel:'voz',ticket_id:'701',score:1,source:'manual',collaborator_name:'Atendente'},
  {service_date:'2026-11-10',channel:'chat',ticket_id:'701',score:7,source:'manual',collaborator_name:'Atendente'},
  {service_date:'2026-11-10',channel:'voz',ticket_id:'702',score:0,source:'movidesk',collaborator_name:'Atendente'}
 ];
 const d=calculateChannelNotes(rows);
 assertEquals(d.voz.total,2);
 assertEquals(d.voz.positive,2);
 assertEquals(d.voz.csatPercent,100);
 assertEquals(d.voz.movidesk,2);
 assertEquals(d.voz.manual,0);
 assertEquals(d.chat.total,1);
 assertEquals(d.chat.csatPercent,0);
});
Deno.test('absence of voice ratings produces unavailable CSAT, not fabricated zero',()=>{
 const d=calculateChannelNotes(quality.filter(x=>x.channel==='chat'));
 assertEquals(d.voz.total,0);assertEquals(d.voz.csatPercent,null);
});
Deno.test('mail sections contain voice and chat with transparent sources, no credentials or customer phones',()=>{
 const d=prepareVoiceEmail({verified:true,ratings:quality,metrics,from:'2026-11-10',to:'2026-11-11',
  byDay:[{date:'2026-11-10',total:4}],byHour:[{hour:'11',count:4}],
  byExtension:[{extension:'430',total:4,answered:2,talkSeconds:172}],
  chatMetrics:{tickets:3,tmaSeconds:45,tmeSeconds:12,tmaSamples:3,tmeSamples:3}});
 assertEquals(d.kpis.quality.chat.csatPercent,50);
 assertEquals(d.kpis.quality.voz.csatPercent,50);
 assertEquals(d.kpis.tmeSeconds,null);
 assertEquals(d.kpis.chatMetrics?.tmaSeconds,45);
 assertEquals(d.kpis.chatMetrics?.tmeSeconds,12);
 if(!d.html.includes('45s')&&!d.html.includes('0min 45s'))throw Error('Chat TMA omitted');
 for(const text of ['Voz × Chat','CSAT','Zenvia','Movidesk'])if(!d.html.includes(text))throw Error('Missing '+text);
 for(const leaked of ['secret_token','+5541999999999','url_gravacao'])if(d.html.includes(leaked)||d.text.includes(leaked))throw Error('Leaked '+leaked);
});
Deno.test('unverified or incomplete Zenvia response prevents official report',()=>{
 assertThrows(()=>prepareVoiceEmail({verified:false,ratings:[],metrics,from:'2026-11-10',to:'2026-11-11'}));
 assertThrows(()=>prepareVoiceEmail({verified:true,ratings:[],metrics:{...metrics,total:19},from:'2026-11-10',to:'2026-11-11'}));
});
Deno.test('read-only API rejects missing token before making a request',async()=>{
 let count=0;
 await assertRejects(()=>readZenviaEmailMetrics('2026-11-10','2026-11-11','','',async()=>{count++;throw Error('Should not call');}));
 assertEquals(count,0);
});
Deno.test('Zenvia inbound/outbound metrics and TMA require complete provider pages',async()=>{
 const outgoing=[{id:1,data_criacao:'2026-11-10T10:00:00-03:00',ativa:false,ramal_id_origem:430,
  destino:{status:'atendida',duracao_falada_segundos:90,duracao_segundos:110}}];
 const incoming=[{id:2,data_inicio:'2026-11-10T11:00:00-03:00',ramal_id:430,status:'nao_atendida'}];
 const mock=async(input:string|URL|Request,opts?:RequestInit):Promise<Response>=>{
   if(opts?.method!=='GET')throw Error('write request');
   const parsed=new URL(String(input));
   const rows=parsed.pathname==='/chamada/relatorio'?outgoing:incoming;
   return new Response(JSON.stringify({sucesso:true,dados:{relatorio:rows,total:rows.length}}),{status:200});
 };
 const x=await readZenviaEmailMetrics('2026-11-10','2026-11-11','fixture-token','',mock);
 assertEquals(x.metrics.total,2);assertEquals(x.metrics.answered,1);assertEquals(x.metrics.unanswered,1);
 assertEquals(x.metrics.tmaSeconds,90);assertEquals(x.metrics.tmeSeconds,null);
 assertEquals(x.byExtension[0].extension,'430');
});
