// Extensao de relatórios: dados normalizados de voz Zenvia e CSAT unificado por canal.
// Não faz envio nem grava no banco. Somente usa métricas verificadas do provedor.
type R=Record<string,any>;
type Rating={service_date:string;channel:string;ticket_id:string;score:number;source:string;collaborator_name:string};
const norm=(s:unknown)=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
const safeNum=(n:unknown)=>{if(n==null||n==='')return null;const v=Number(n);return Number.isFinite(v)&&v>=0?v:null};
const percent=(numerator:number,denominator:number)=>denominator?Math.round(numerator/denominator*10000)/100:null;
const time=(seconds:unknown)=>{const n=safeNum(seconds);return n==null?'Indisponível':Math.floor(n/60)+'min '+String(Math.round(n%60)).padStart(2,'0')+'s'};
export type VoiceEmailInput={metrics:R;byDay?:R[];byHour?:R[];byExtension?:R[];ratings:Rating[];chatMetrics?:R;from:string;to:string;verified:boolean};
export function calculateChannelNotes(rows:Rating[]) {
 const map={} as R;
 for(const channel of ['voz','chat']){
  const valid=rows.filter(r=>norm(r.channel)===channel&&Number.isInteger(Number(r.score))&&Number(r.score)>=1&&Number(r.score)<=10);
  const sourcePriority=new Map<string,Rating>();
  for(const r of valid){
   const ticket=String(r.ticket_id||'').trim();
   const key=ticket?ticket+':'+channel:null;
   if(!key)continue;
   const prev=sourcePriority.get(key);
   if(!prev||norm(r.source)==='movidesk'&&norm(prev.source)!=='movidesk')sourcePriority.set(key,r);
  }
  const dedup=valid.filter(r=>!String(r.ticket_id||'').trim()||sourcePriority.get(String(r.ticket_id).trim()+':'+channel)===r);
  const positive=dedup.filter(r=>Number(r.score)>=8);
  const sum=dedup.reduce((n,r)=>n+Number(r.score),0);
  const pts=positive.reduce((n,r)=>n+Number(r.score),0);
  map[channel]={total:dedup.length,positive:positive.length,negative:dedup.length-positive.length,
   csatPercent:percent(positive.length,dedup.length),
   superadoresPercent:percent(pts,sum),
   movidesk:dedup.filter(r=>norm(r.source)==='movidesk').length,
   manual:dedup.filter(r=>norm(r.source)==='manual').length};
 }
 return map as {voz:R;chat:R};
}
export function prepareVoiceEmail(input:VoiceEmailInput){
 if(!input.verified)throw Error('Integração Zenvia não homologada para envio corporativo');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.from)||!/^\d{4}-\d{2}-\d{2}$/.test(input.to))
  throw Error('Período inválido do relatório de voz');
 const m=input.metrics||{},integerKeys=['total','inbound','outbound','answered','unanswered','inProgress','unclassified'];
 if(integerKeys.some(k=>!Number.isInteger(Number(m[k]))||Number(m[k])<0))
  throw Error('Indicadores Zenvia não disponíveis ou incompletos');
 if(Number(m.total)!==Number(m.inbound)+Number(m.outbound)||
    Number(m.total)!==Number(m.answered)+Number(m.unanswered)+Number(m.inProgress)+Number(m.unclassified))
  throw Error('Contagens Zenvia não conciliadas');
 const quality=calculateChannelNotes(input.ratings);
 const days=(input.byDay||[]).map(x=>({date:String(x.date||''),total:Number(x.total||0),answered:Number(x.answered||0)}));
 const hours=(input.byHour||[]).map(x=>({hour:String(x.hour||''),count:Number(x.count||0)})).sort((a,b)=>b.count-a.count);
 const extensions=(input.byExtension||[]).map(x=>({extension:String(x.extension||''),total:Number(x.total||0),
  answered:Number(x.answered||0),talkSeconds:Number(x.talkSeconds||0)})).filter(x=>/^\d{1,12}$/.test(x.extension));
 const kpis={from:input.from,to:input.to,provider:'Zenvia Voice',total:m.total,inbound:m.inbound,outbound:m.outbound,
  answered:m.answered,unanswered:m.unanswered,inProgress:m.inProgress,unclassified:m.unclassified,
  talkSeconds:safeNum(m.talkSeconds),tmaSeconds:safeNum(m.tmaSeconds),tmeSeconds:safeNum(m.tmeSeconds),
  queueCalls:m.queueCalls??null,quality,chatMetrics:input.chatMetrics||null,byDay:days,byHour:hours,byExtension:extensions.slice(0,30)};
 const csat=(q:R)=>q.total?q.csatPercent+'% ('+q.positive+'/'+q.total+' notas de 8 a 10)':'Sem avaliações no período';
 const text='\n\nVOZ × CHAT · Indicadores reais do Suporte\n'+
  'Período: '+input.from+' a '+input.to+'\n'+
  'Voz recebidas: '+m.inbound+'; efetuadas: '+m.outbound+'; atendidas: '+m.answered+
  '; não atendidas: '+m.unanswered+'; em andamento: '+m.inProgress+'; sem classificação: '+m.unclassified+'\n'+
  'Tempo falado: '+time(m.talkSeconds)+'; TMA: '+time(m.tmaSeconds)+'; TME de fila: '+time(m.tmeSeconds)+'\n'+
  'Pico de inícios: '+(hours[0]?.hour??'Sem dados')+'\n'+
  'Chat TMA medido: '+time(input.chatMetrics?.tmaSeconds)+'; Chat TME medido: '+time(input.chatMetrics?.tmeSeconds)+' ('+(input.chatMetrics?.tickets??0)+' tickets).\n'+
  'CSAT Voz: '+csat(quality.voz)+'; CSAT Chat: '+csat(quality.chat)+'\n'+
  'CSAT = notas de 8 a 10 / todas as notas válidas (1 a 10). Notas 1 a 7 são negativas; ausência de nota não equivale a zero.\n'+
  'Fontes: ligações Zenvia; notas Movidesk e avaliações manuais com deduplicação por ticket e canal.';
 const cells=(values:unknown[])=>'<tr>'+values.map(x=>'<td style="border-bottom:1px solid #e2e8f0;padding:8px 10px">'+esc(x)+'</td>').join('')+'</tr>';
 const html='<section style="border-top:3px solid #2457d6;padding:18px 0;margin-top:24px;font-family:Arial,sans-serif;color:#17345d">'+
  '<h2 style="font-size:18px;margin:0">Voz × Chat · Qualidade do Suporte</h2>'+
  '<p style="font-size:12px;color:#64748b">Ligações: Zenvia · Avaliações: Movidesk e manuais</p>'+
  '<table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr><th>Indicador</th><th>Voz</th><th>Chat</th></tr></thead><tbody>'+
  cells(['Quantidade',m.total,input.chatMetrics?.tickets??'Indisponível'])+
  cells(['Atendidas',m.answered,'—'])+cells(['Não atendidas',m.unanswered,'—'])+
  cells(['TMA',time(m.tmaSeconds),time(input.chatMetrics?.tmaSeconds)])+
  cells(['TME',time(m.tmeSeconds),time(input.chatMetrics?.tmeSeconds)])+
  cells(['CSAT (8–10)',csat(quality.voz),csat(quality.chat)])+
  cells(['Avaliações válidas',quality.voz.total,quality.chat.total])+
  cells(['Notas 1–7',quality.voz.negative,quality.chat.negative])+
  cells(['Notas 8–10',quality.voz.positive,quality.chat.positive])+
  cells(['Superadores',quality.voz.superadoresPercent==null?'Sem avaliações':quality.voz.superadoresPercent+'%',quality.chat.superadoresPercent==null?'Sem avaliações':quality.chat.superadoresPercent+'%'])+'</tbody></table>'+
  '<h3 style="font-size:14px">Chamadas por dia</h3>'+ 
  '<table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr><th>Dia</th><th>Total</th><th>Atendidas</th></tr></thead><tbody>'+ 
  (days.length?days.slice(0,31).map(x=>cells([x.date,x.total,x.answered])).join(''):cells(['Sem dados','—','—']))+'</tbody></table>'+ 
  '<h3 style="font-size:14px">Ramal · chamadas · atendidas · tempo falado</h3>'+
  '<table style="border-collapse:collapse;width:100%;font-size:12px"><tbody>'+
  (extensions.length?extensions.slice(0,10).map(x=>cells([x.extension,x.total,x.answered,time(x.talkSeconds)])).join(''):cells(['Sem ramais','—','—','—']))+
  '</tbody></table><p style="font-size:11px;color:#64748b">TME só é mostrado com espera de fila comprovada. Nenhum número de telefone ou áudio incluído.</p></section>';
 return {text,html,kpis};
}
