type R=Record<string,any>;
export function canReceiveCsat(rec:R){
 const targets:Record<string,string>={
  'a4748115-e1d6-42dc-a8d1-706b8129219f':'suportegestao@arquem.com.br',
  '40752b0b-c2a4-4031-9496-733b6f846d76':'financeiro@arquem.com.br',
  '1b8168c6-bec0-4f6d-a3f9-feaec63ed147':'canestraro@arquem.com.br'
 };
 return targets[String(rec.id)]!==undefined&&targets[String(rec.id)]===String(rec.email||'').trim().toLowerCase();
}
export function reportIdentity(rec:R){
 const sectors=(Array.isArray(rec.sectors)&&rec.sectors.length?rec.sectors:[rec.sector]).map((v:unknown)=>String(v||'').trim()).filter(Boolean);
 const people=Array.isArray(rec.collaborator_names)&&rec.collaborator_names.length?rec.collaborator_names:rec.collaborator_name?[rec.collaborator_name]:[];
 const individual=rec.scope!=='management'&&people.length===1;
 if(individual)return {title:String(rec.collaborator_name||people[0]),hierarchy:[] as string[],kind:'Relatório individual'};
 if(sectors.length===1){
  const sector=sectors[0],key=sector.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return {title:'Equipe · '+sector,hierarchy:key==='suporte'?['Supervisão · Cássio','Coordenação · Carla']:key==='financeiro'?['Coordenação · Carla']:[],kind:'Relatório de equipe'};
 }
 return {title:String(rec.name||'Visão gerencial'),hierarchy:[] as string[],kind:'Relatório de gestão'};
}
export function reportSubject(rec:R,kind:string,from:string,to:string,options:{prefix?:string;sector?:string;detail?:string}={}){
 const director=String(rec.id)==='1b8168c6-bec0-4f6d-a3f9-feaec63ed147'&&String(rec.email||'').trim().toLowerCase()==='canestraro@arquem.com.br';
 const sectors=(Array.isArray(rec.sectors)&&rec.sectors.length?rec.sectors:[rec.sector]).map((v:unknown)=>String(v||'').replace(/[\r\n\t]/g,' ').trim()).filter(Boolean);
 const sector=options.sector||(director?'ARQUEM':sectors.join(' / ')||'Gestão');
 const labels:Record<string,string>={daily:'Diário',weekly:'Semanal',monthly:'Mensal',annual:'Anual'};
 const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)?s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4):String(s).replace(/[\r\n]/g,'');
 const period=from===to?date(from):date(from)+' a '+date(to);
 return (options.prefix?options.prefix+' ':'')+'Central de Auditoria · '+sector+' | '+(options.detail||labels[kind]||kind)+' | '+period;
}
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const valid=(n:unknown)=>Number.isFinite(Number(n))&&Number(n)>=0;
const hours=(v:number)=>{v=Math.round(v);return String(Math.floor(v/60)).padStart(2,'0')+'h'+String(v%60).padStart(2,'0');};
const panel=(title:string,subtitle:string,body:string)=>'<div data-arquem-visual="v1" style="margin:24px 0;padding:20px;border:1px solid #dce7f2;border-radius:12px;background:#ffffff"><div style="font-size:10px;letter-spacing:1.5px;font-weight:700;color:#218c89">VISÃO DO PERÍODO</div><h2 style="font-size:17px;line-height:1.4;color:#173b65;margin:7px 0">'+esc(title)+'</h2><p style="margin:0 0 15px;color:#65758a;font-size:12px;line-height:1.6">'+esc(subtitle)+'</p>'+body+'</div>';
function bars(rows:{label:string;value:number;color:string;display?:string}[],maximum:number){
 return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border-collapse:collapse">'+rows.map(r=>{
  const width=maximum>0?Math.min(100,Math.max(0,r.value/maximum*100)):0;
  return '<tr><td style="padding:10px 0 4px;font-size:12px;line-height:1.5;color:#344d67;overflow-wrap:anywhere">'+esc(r.label)+'</td><td width="90" align="right" style="padding:10px 0 4px;font-size:13px;font-weight:700;color:#173b65">'+esc(r.display||hours(r.value))+'</td></tr><tr><td colspan="2" style="padding:0 0 7px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eaf0f6;border-collapse:collapse"><tr>'+(width>0?'<td width="'+width.toFixed(2)+'%" height="10" bgcolor="'+r.color+'" style="height:10px;background:'+r.color+';font-size:1px;line-height:10px">&nbsp;</td>':'')+(width<100?'<td height="10" style="height:10px;font-size:1px;line-height:10px">&nbsp;</td>':'')+'</tr></table></td></tr>';
 }).join('')+'</table>';
}
export function renderHourCharts(input:R){
 const metrics=input.metrics||{},data=input.visual||{},group=input.group==='management';
 if(!valid(metrics.minutes)||!valid(metrics.appointments)||Number(metrics.appointments)===0)return '';
 const minutes=Number(metrics.minutes),target=Number(metrics.referenceTargetMinutes),minimum=Number(metrics.referenceMinimumMinutes);
 let html='';
 if(valid(target)&&target>0){
  const rows=[{label:'Tempo apontado',value:minutes,color:'#218c89'},{label:'Jornada de referência',value:target,color:'#315f95'}];
  if(valid(minimum)&&minimum>0)rows.push({label:'Mínimo de referência',value:minimum,color:'#91abc8'});
  html+=panel('Horas e referências de jornada',group?'Totais dos colaboradores com registros. As diferenças individuais permanecem detalhadas no relatório.':'Comparação do tempo registrado com as referências do período.',bars(rows,Math.max(...rows.map(r=>r.value)))+'<p style="font-size:11px;line-height:1.6;color:#65758a;margin:10px 0 0">Tempo apontado não representa controle de ponto ou avaliação de produtividade.</p>');
 }
 const sectors=Array.isArray(data.sectors)?data.sectors:[];
 if(group&&sectors.length>1&&sectors.every((s:R)=>valid(s.minutes))&&Math.abs(sectors.reduce((n:number,s:R)=>n+Number(s.minutes),0)-minutes)<1){
  const all=[...sectors].sort((a:R,b:R)=>Number(b.minutes)-Number(a.minutes));
  const top=all.slice(0,5);
  html+=panel('Distribuição do tempo por setor',all.length>5?'Cinco setores com mais tempo registrado; os totais incluem todos os setores autorizados.':'Somente os setores incluídos neste relatório.',bars(top.map((s:R,i:number)=>({label:String(s.sector),value:Number(s.minutes),color:i===0?'#218c89':'#315f95'})),Math.max(...top.map((s:R)=>Number(s.minutes)),1)));
 }
 const daily=Array.isArray(data.daily)?data.daily:[];
 if(input.dailyAllowed!==false&&daily.length>1&&daily.every((d:R)=>/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))&&valid(d.minutes))&&Math.abs(daily.reduce((n:number,d:R)=>n+Number(d.minutes),0)-minutes)<1){
  const all=[...daily].sort((a:R,b:R)=>String(a.date).localeCompare(String(b.date))),shown=all.slice(-7);
  html+=panel('Horas por data do trabalho',all.length>7?'Últimas sete datas com registros dentro do período. O detalhamento completo permanece nos anexos.':'As horas são atribuídas à data do trabalho, inclusive quando identificadas em atualização posterior.',bars(shown.map((d:R)=>({label:String(d.date).slice(8,10)+'/'+String(d.date).slice(5,7),value:Number(d.minutes),color:'#218c89'})),Math.max(...shown.map((d:R)=>Number(d.minutes)),1)));
 }
 return html;
}
export function renderCsatChart(metric:R|null,rec:R){
 if(!canReceiveCsat(rec))return '';
 if(!metric)return '';
 const total=Number(metric.total),positive=Number(metric.excelente);
 if(!valid(total)||!valid(positive)||positive>total)return '';
 if(total===0)return panel('Satisfação do Suporte','Sem avaliações disponíveis para este período.','<p style="font-size:12px;color:#65758a">Ausência de avaliações não equivale a nota zero.</p>');
 const percent=positive/total*100;
 return panel('Satisfação do Suporte · CSAT',positive+' de '+total+' avaliações com notas positivas (8 a 10).',bars([{label:'Avaliações positivas',value:positive,color:'#218c89',display:percent.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%'}],total)+'<p style="font-size:11px;color:#65758a;line-height:1.6;margin:9px 0 0">Notas 1 a 7 ficam fora do grupo positivo. Sem avaliação não equivale a nota zero.</p>');
}

