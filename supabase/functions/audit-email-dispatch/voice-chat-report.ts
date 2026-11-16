type Row=Record<string,any>;
const next=(day:string,n:number)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const duration=(n:unknown)=>n==null?'Indisponível':Math.floor(Number(n)/60)+'m '+String(Math.round(Number(n))%60).padStart(2,'0')+'s';
export function voiceReportEligible(rec:Row,canReceiveCsat:(rec:Row)=>boolean){
 const sectors=(Array.isArray(rec.sectors)&&rec.sectors.length?rec.sectors:[rec.sector]).map((s:unknown)=>String(s||'').toLowerCase());
 const individual=rec.scope!=='management'&&(!!rec.collaborator_name||(Array.isArray(rec.collaborator_names)&&rec.collaborator_names.length===1));
 return !individual&&canReceiveCsat(rec)&&sectors.includes('suporte');
}
export async function collectVoiceReport(from:string,to:string,serviceKey:string,http:typeof fetch=fetch){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||next(from,370)<to||!serviceKey)throw Error('Período ou conexão de voz inválidos');
 const sum:Row={total:0,inbound:0,outbound:0,answered:0,unanswered:0,inProgress:0,unclassified:0,talkSeconds:0,tmaSamples:0,tmaMissingSamples:0};
 const support:Row={...sum};const days:Row[]=[],people=new Map<string,Row>();let queueCalls=0,waitSamples=0,weightedWait=0,queueReady=true,supportReady=true;
 for(let start=from;start<=to;start=next(start,31)){
  const end=next(start,30)<to?next(start,30):to;
  const url='https://centralauditoria.ddns.net/api/audit-production-metrics?'+new URLSearchParams({mode:'zenvia',start,end});
  const response=await http(url,{method:'GET',headers:{Authorization:'Bearer '+serviceKey,Accept:'application/json'},signal:AbortSignal.timeout(50000),redirect:'error'});
  if(!response.ok){const reason=await response.json().catch(()=>({}));throw Error('Métricas de voz indisponíveis (HTTP '+response.status+': '+String(reason.error||'conexão recusada').slice(0,120)+'); relatório completo não liberado');}
  const body=await response.json();if(body.ok!==true||body.from!==start||body.to!==end)throw Error('Período de voz divergente');
  for(const [target,source]of [[sum,body.summary],[support,body.support?.metrics]]){
   if(!source){if(target===support){supportReady=false;continue;}throw Error('Resumo de voz ausente');}
   for(const key of ['total','inbound','outbound','answered','unanswered','inProgress','unclassified','tmaSamples','tmaMissingSamples']){
    const n=Number(source[key]);if(!Number.isInteger(n)||n<0)throw Error('Indicador de voz inválido');target[key]+=n;
   }
   if(source.talkSeconds!=null)target.talkSeconds+=Number(source.talkSeconds);
  }
  if(!body.queue?.configured||body.queue.tmeSeconds==null)queueReady=false;
  queueCalls+=Number(body.queue?.calls||0);waitSamples+=Number(body.queue?.waitSampleCount||0);
  weightedWait+=Number(body.queue?.waitTotalSeconds||0);
  days.push(...(body.byDay||[]));
  for(const item of body.byExtension||[]){
   if(!/^\d{1,12}$/.test(String(item.extension)))throw Error('Pessoa de voz inválida');
   const previous=people.get(item.extension)||{extension:String(item.extension),name:String(item.name||'Nome não cadastrado'),total:0,answered:0,unanswered:0,talkSeconds:0,missingTalkSamples:0};
   for(const k of ['total','answered','unanswered'])previous[k]+=Number(item[k]||0);
   if(item.talkSeconds==null)previous.missingTalkSamples++;else previous.talkSeconds+=Number(item.talkSeconds);
   people.set(item.extension,previous);
  }
 }
 for(const value of [sum,support]){
  if(value.total!==value.inbound+value.outbound||value.total!==value.answered+value.unanswered+value.inProgress+value.unclassified)throw Error('Totais de voz sem conciliação');
  value.tmaSeconds=value.answered>0&&!value.tmaMissingSamples?Math.round(value.talkSeconds/value.answered):null;
  if(value.tmaMissingSamples)value.talkSeconds=null;
 }
 sum.tmeSeconds=queueReady&&queueCalls>0&&waitSamples===queueCalls?Math.round(weightedWait/queueCalls):null;
 return {...sum,supportMetrics:supportReady?support:null,byDay:days,byExtension:[...people.values()].map(p=>({...p,talkSeconds:p.missingTalkSamples?null:p.talkSeconds})).sort((a,b)=>b.total-a.total).slice(0,30),source:'Zenvia Voice',coverageVerified:true};
}
export function composeVoiceChat(voice:Row,chat:Row){
 const ratings:Record<string,{total:number;positive:number}>=Object.fromEntries(['voz','chat'].map(channel=>{const q=(chat.quality||[]).find((r:Row)=>r.channel===channel)||{};return [channel,{total:Number(q.total||0),positive:Number(q.csatPositive||0)}]}));
 const packet={...voice,chatSummary:chat.metrics,chatMetrics:{tickets:Number(chat.metrics?.tickets||0),...chat.measuredChat},quality:ratings};
 const rows=[['Ligações recebidas · conta Zenvia',voice.inbound,'—'],['Ligações efetuadas · conta Zenvia',voice.outbound,'—'],['Atendimentos',voice.total,packet.chatMetrics.tickets],['Atendidas',voice.answered,'—'],['Não atendidas',voice.unanswered,'—'],['TMA',duration(voice.tmaSeconds),duration(chat.measuredChat?.tmaSeconds)],['TME da fila',duration(voice.tmeSeconds),duration(chat.measuredChat?.tmeSeconds)],...['voz','chat'].map(channel=>{const q=ratings[channel];return ['CSAT · '+channel,q.total?(q.positive/q.total*100).toFixed(2)+'%':'Sem avaliações',q.total+' avaliações válidas']})];
 const note='Voz: toda a conta Zenvia. Chat: Suporte no mesmo período. A distribuição usa a identificação atual do cadastro Zenvia. Sem medição significa indisponível, nunca zero.';
 const heading='Voz × Chat · indicadores reais';
 const text='\n\n'+heading+'\n'+rows.map(r=>r.join(' | ')).join('\n')+'\n'+note;
 const html='<section data-voice-chat-report="v1"><h2>'+heading+'</h2><table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:12px"><tr style="background:#173b65;color:white"><th>Indicador</th><th>Voz / resultado</th><th>Chat / referência</th></tr>'+rows.map(r=>'<tr>'+r.map(c=>'<td style="border:1px solid #d8e1ec">'+escape(c)+'</td>').join('')+'</tr>').join('')+'</table><p>'+escape(note)+'</p><h3>Distribuição por pessoa</h3><table cellpadding="5"><tr><th>Nome</th><th>Ligações</th><th>Atendidas</th></tr>'+voice.byExtension.map((p:Row)=>'<tr><td>'+escape(p.name)+'</td><td>'+p.total+'</td><td>'+p.answered+'</td></tr>').join('')+'</table></section>';
 return {packet,text,html};
}
