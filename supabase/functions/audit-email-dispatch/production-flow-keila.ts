/**
 * Relatório exclusivo de entradas e saídas da Produção para Keila.
 * Não confundir encerramento com transferência; cada chamado é contado uma vez por tipo.
 * As datas dos históricos Movidesk são UTC mesmo quando vêm sem "Z".
 */
type Row = Record<string,unknown>;
export const KEILA_PRODUCTION_FLOW_RECIPIENT_ID='a5329710-dd63-4bfd-bbd3-dc23e0efc8f0';
const TZ='America/Sao_Paulo';
const norm=(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const production=(v:unknown)=>/\bproducao\b|\bcpo\b/.test(norm(v));
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));
const iso=(value:unknown)=>{
  let s=String(value||'');
  if(!/^\d{4}-\d\d-\d\dT/.test(s))return null;
  s=s.replace(/(\.\d{3})\d+/, '$1');
  if(!/(Z|[+-]\d\d:\d\d)$/i.test(s))s+='Z';
  const ms=Date.parse(s);return Number.isFinite(ms)?new Date(ms).toISOString():null;
};
const day=(v:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const fmt=(v:string)=>new Date(v).toLocaleString('pt-BR',{timeZone:TZ});
const name=(v:unknown)=>String((v as Row)?.businessName||(v as Row)?.name||'Não identificado').slice(0,150);
export type FlowMovement={id:string;subject:string;client:string;direction:'entry'|'exit';at:string;fromTeam:string;toTeam:string;responsible:string;actor:string;url:string};
export function buildKeilaProductionFlow(rows:Row[],from:string,to:string){
 const movements:FlowMovement[]=[];
 for(const r of rows){
  const id=String(r.ticket_id||'');
  if(!/^\d{1,12}$/.test(id))continue;
  const raw=(Array.isArray(r.ownerHistories)?r.ownerHistories:[]) as Row[];
  const ordered=raw.map((h,i)=>({...h,at:iso(h.changedDate),order:i}))
   .filter(h=>h.at).sort((a,b)=>String(a.at).localeCompare(String(b.at))||a.order-b.order);
  let previous:Row|null=null;
  for(const h of ordered){
   const currentProduction=production(h.ownerTeam),previousProduction=production(previous?.ownerTeam);
   let direction:'entry'|'exit'|null=null;
   if(currentProduction&&!previousProduction)direction='entry';
   else if(previous&&previousProduction&&!currentProduction)direction='exit';
   if(direction&&day(String(h.at))>=from&&day(String(h.at))<=to){
    const client=(Array.isArray(r.clients)?r.clients[0]:null) as Row|null;
    const org=client?.organization as Row|null;
    movements.push({
     id,subject:String(r.subject||'Sem assunto').slice(0,240),
     client:String(org?.businessName||client?.businessName||'Não informado').slice(0,120),
     direction,at:String(h.at),
     fromTeam:String(previous?.ownerTeam||'Abertura / origem não registrada').slice(0,100),
     toTeam:String(h.ownerTeam||'Sem equipe').slice(0,100),
     responsible:name(h.owner),actor:name(h.changedBy),
     url:'https://arquem.movidesk.com/Ticket/Edit/'+id
    });
   }
   previous=h;
  }
 }
 movements.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
 const entries=movements.filter(m=>m.direction==='entry');
 const exits=movements.filter(m=>m.direction==='exit');
 const unique=(items:FlowMovement[])=>new Set(items.map(m=>m.id)).size;
 return {from,to,entered:unique(entries),exited:unique(exits),
  entryMovements:entries.length,exitMovements:exits.length,movements};
}
export type KeilaQualityRow={name:string;hoursMinutes:number;appointments:number;ratings:number;excellent:number;average:number|null};
export function keilaProductionReport(
 data:ReturnType<typeof buildKeilaProductionFlow>,
 kind:'daily'|'weekly'|'monthly',
 quality:KeilaQualityRow[]=[]
){
 const title='Entradas e Saídas da Produção — '+({daily:'Diário',weekly:'Semanal',monthly:'Mensal'}[kind]);
 const period=data.from.split('-').reverse().join('/')+' a '+data.to.split('-').reverse().join('/');
 const totalRatings=quality.reduce((n,r)=>n+r.ratings,0),excellent=quality.reduce((n,r)=>n+r.excellent,0);
 const qualityPercent=totalRatings?Math.round(excellent/totalRatings*10000)/100:null;
 const hh=(minutes:number)=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
 const qualityLines=['','QUALIDADE E COLABORADORES',
  'Avaliações: '+totalRatings+' | Notas de 8 a 10: '+excellent+' | Índice de qualidade: '+(qualityPercent===null?'Sem avaliações':qualityPercent.toFixed(2)+'%'),
  'Critério: notas 1 a 7 = abaixo do padrão; 8 a 10 = excelentes. Sem avaliação não equivale a nota zero.',
  ...quality.map(q=>q.name+' | Horas: '+hh(q.hoursMinutes)+' | Apontamentos: '+q.appointments+
   ' | Avaliações: '+q.ratings+' | Excelentes: '+q.excellent+' | Média: '+(q.average===null?'Sem avaliações':q.average.toFixed(2)))];
 const qualityHtml='<h3 style="margin-top:24px">Qualidade e colaboradores selecionados</h3>'+
   '<p style="font-size:12px">Avaliações: '+totalRatings+' · Excelentes (8–10): '+excellent+
   ' · Índice: '+(qualityPercent===null?'Sem avaliações':qualityPercent.toFixed(2)+'%')+'</p>'+
   '<p style="font-size:11px;color:#60748c">Sem avaliações não equivale a desempenho ruim. Critério: 1–7 abaixo do padrão e 8–10 excelente.</p>'+
   '<table width="100%" style="font-size:12px;border-collapse:collapse"><tr style="background:#edf3fb"><th>Colaborador</th><th>Horas</th><th>Apontamentos</th><th>Avaliações</th><th>Excelentes</th><th>Média</th></tr>'+
   quality.map(q=>'<tr><td>'+esc(q.name)+'</td><td>'+hh(q.hoursMinutes)+'</td><td>'+q.appointments+'</td><td>'+q.ratings+'</td><td>'+q.excellent+'</td><td>'+(q.average===null?'Sem avaliações':q.average.toFixed(2))+'</td></tr>').join('')+'</table>';

 const detail=data.movements.slice(0,450);
 const limited=count>450;
 const lines=[
  'ARQUEM SISTEMAS · CENTRAL DE AUDITORIA',title,'Período: '+period,
  'Entraram na Produção: '+data.entered+' chamados distintos',
  'Saíram da Produção: '+data.exited+' chamados distintos por transferência',
  'Movimentações registradas: '+data.entryMovements+' entradas / '+data.exitMovements+' saídas.',
  'Finalizações não são contabilizadas como saídas.',
  'Um chamado pode aparecer nos dois indicadores ou ser movimentado mais de uma vez.',
  limited?'Atenção: detalhes limitados aos 450 primeiros eventos; totais completos.':'',
  ...qualityLines,
  'DETALHAMENTO',
  ...detail.map(m=>['#'+m.id,m.direction==='entry'?'Entrada':'Saída',fmt(m.at),m.fromTeam+' → '+m.toTeam,'Responsável: '+m.responsible,'Movimentado por: '+m.actor,m.url].join(' | '))
 ].filter(Boolean);
 const table=detail.map(m=>'<tr><td style="padding:8px;border-bottom:1px solid #e5edf5"><a href="'+m.url+'">#'+esc(m.id)+'</a></td>'+
   '<td style="padding:8px;border-bottom:1px solid #e5edf5">'+(m.direction==='entry'?'Entrada':'Saída')+'</td>'+
   '<td style="padding:8px;border-bottom:1px solid #e5edf5">'+esc(fmt(m.at))+'</td>'+
   '<td style="padding:8px;border-bottom:1px solid #e5edf5">'+esc(m.fromTeam)+' → '+esc(m.toTeam)+'</td>'+
   '<td style="padding:8px;border-bottom:1px solid #e5edf5">'+esc(m.responsible)+'</td></tr>').join('');
 const html='<!doctype html><html lang="pt-BR"><body style="margin:0;background:#edf3fa;font-family:Arial,sans-serif;color:#173453">'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table width="100%" style="max-width:760px;background:#fff;border-collapse:collapse">'+
 '<tr><td style="background:#142f50;color:#fff;padding:25px"><small>ARQUEM SISTEMAS · CENTRAL DE AUDITORIA</small><h1 style="font-size:22px;margin:10px 0 0">'+esc(title)+'</h1><p>Período: '+esc(period)+'</p></td></tr>'+
 '<tr><td style="padding:24px"><table role="presentation" width="100%"><tr><td style="background:#eef5ff;padding:20px"><b>ENTRARAM</b><h2>'+data.entered+'</h2></td><td style="background:#e8f7ef;padding:20px"><b>SAÍRAM POR TRANSFERÊNCIA</b><h2>'+data.exited+'</h2></td></tr></table>'+
 '<p style="font-size:12px;color:#53647c">Contagens de chamados distintos. Encerramentos não entram nas saídas. '+data.entryMovements+' movimentações de entrada e '+data.exitMovements+' de saída.</p>'+
 (limited?'<p><b>Detalhamento limitado a 450 eventos; totais completos.</b></p>':'')+
 qualityHtml+
 '<h3>Chamados e movimentações</h3><table width="100%" style="font-size:12px;border-collapse:collapse"><tr style="background:#edf3fb"><th>Chamado</th><th>Movimento</th><th>Data</th><th>Origem / destino</th><th>Responsável</th></tr>'+table+'</table>'+
 '</td></tr><tr><td style="background:#f5f8fc;padding:18px;color:#60748c;font-size:11px">ARQUEM SISTEMAS · Gestão de Qualidade</td></tr></table></td></tr></table></body></html>';
 // O gerador existente cria PDF e Excel a partir deste pacote corporativo.
 const packet={schema:'arquem-mail-v1',title,from:data.from,to:data.to,partial:false,historicalIncomplete:false,
  metrics:{tickets:new Set(data.movements.map(m=>m.id)).size,appointments:0,minutes:0,entered:data.entered,exited:data.exited,entryMovements:data.entryMovements,exitMovements:data.exitMovements},
  collaborators:quality.map(q=>({name:q.name,sector:'Setores selecionados',minutes:q.hoursMinutes,minimumMinutes:0,targetMinutes:0,minimumGap:0,targetGap:0,ruleSource:'Apontamentos importados'})),customers:[],activities:[],daily:[],
  productionQuality:quality.map(q=>({name:q.name,hoursMinutes:q.hoursMinutes,appointments:q.appointments,ratings:q.ratings,excellent:q.excellent,average:q.average})),
  productionFlow:{entered:data.entered,exited:data.exited,entryMovements:data.entryMovements,exitMovements:data.exitMovements},
  tickets:detail.map(m=>({id:m.id,client:m.client,owner:m.responsible,status:(m.direction==='entry'?'Entrada':'Saída')+' · '+fmt(m.at)+' · '+m.fromTeam+' → '+m.toTeam,ageDays:0,url:m.url})),
  forecastVariances:[]};
 return {title,text:lines.join('\n'),html,packet,limited};
}
