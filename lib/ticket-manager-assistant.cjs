'use strict';
const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const clean=v=>String(v??'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,120);
function intent(prompt){const q=fold(prompt);if(/relatorio|e-?mail|09h|09:00/.test(q)&&/falh|erro|timeout/.test(q))return 'delivery';if(/cobranca|cobre|humaniz/.test(q))return 'draft';if(/vip/.test(q))return 'vip';if(/jornada|capacidade/.test(q))return 'journey';if(/parad|movimenta|inativ/.test(q))return 'stalled';return null;}
function parse(input,now=new Date()){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['prompt','from','to','sector','collaborator','client','externalAiConsent'].includes(k)))throw Error('Parâmetros inválidos');
 if(typeof input.prompt!=='string'||input.prompt.length<3||input.prompt.length>600)throw Error('Escreva uma pergunta de até 600 caracteres');
 const valid=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(!valid(input.from)||!valid(input.to)||input.from>input.to||input.to>today||Date.parse(input.to)-Date.parse(input.from)>92*86400000)throw Error('Escolha um período válido de até 93 dias');
 const sector=clean(input.sector)||(/producao/.test(fold(input.prompt))?'Produção':/suporte/.test(fold(input.prompt))?'Suporte':/implantacao/.test(fold(input.prompt))?'Implantação':/inteligencia/.test(fold(input.prompt))?'Inteligência':'');
 const match=/(\d{1,3})\s*dias?/.exec(fold(input.prompt));const days=match?Number(match[1]):15;if(days<1||days>365)throw Error('Informe entre 1 e 365 dias');
 return {...input,sector,collaborator:clean(input.collaborator),client:clean(input.client),days,operation:intent(input.prompt)};
}
const ms=v=>{if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT/.test(v))return NaN;return Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(v)?v:v+'Z');};
function tickets(rows,query,now=Date.now(),vipIds=new Set()){
 const result=[];let excluded=0;const seen=new Set();
 for(const row of rows){const p=row.payload||{},id=String(row.ticket_id);if(!/^\d{1,12}$/.test(id)||seen.has(id))continue;seen.add(id);
  const stamp=ms(row.source_synced_at);if(!Number.isFinite(stamp)||stamp>now||now-stamp>86400000){excluded++;continue;}
  if(/^(fechad|resolvid|cancelad|concluid|encerrad|finalizad)/.test(fold(p.status))||p.closedIn||p.canceledIn||p.isDeleted||p.slaSolutionDateIsPaused===true)continue;
  const sector=clean(p.ownerTeam),owner=clean(p.owner?.businessName||p.owner?.name),customer=clean(p.clients?.[0]?.organization?.businessName||p.clients?.[0]?.businessName);
  if(query.sector&&fold(sector)!==fold(query.sector))continue;
  if(query.collaborator&&fold(owner)!==fold(query.collaborator)||query.client&&fold(customer)!==fold(query.client))continue;
  const actions=(Array.isArray(p.actions)?p.actions:[]).map(a=>ms(a.lastUpdate||a.createdDate));
  const last=actions.length&&actions.every(t=>Number.isFinite(t)&&t<=now)?Math.max(...actions):NaN;
  const due=ms(p.slaSolutionDate),overdue=Number.isFinite(due)&&due<now;
  const stalled=Number.isFinite(last)&&now-last>query.days*86400000;
  const vip=(Array.isArray(p.clients)?p.clients:[]).some(c=>vipIds.has(String(c.organization?.id||c.id)));
  if(query.operation==='stalled'&&!stalled||query.operation==='draft'&&!overdue||query.operation==='vip'&&(!vip||!overdue&&!stalled))continue;
  result.push({id,sector,owner:owner||'Não informado',customer:customer||'Não informado',overdue,stalled,lastAction:last?new Date(last).toISOString():null,due:Number.isFinite(due)?new Date(due).toISOString():null,url:'https://arquem.movidesk.com/Ticket/Edit/'+id});
 }
 return {rows:result.sort((a,b)=>Number(b.overdue)-Number(a.overdue)||(a.lastAction||'z').localeCompare(b.lastAction||'z')).slice(0,30),matched:result.length,excludedStale:excluded};
}
function failureReason(message){const s=String(message||'');if(/57014|statement timeout/i.test(s))return 'Consulta ao banco excedeu o tempo limite';if(/timed out|timeout|abort/i.test(s))return 'Tempo limite excedido; etapa não comprovada';if(/anex|PDF|XLSX|homologad/i.test(s))return 'Validação dos anexos pendente ou recusada';return 'Falha registrada; causa exige conferência interna';}
function delivery(rows){return rows.map(r=>({recipientId:String(r.recipient_id),kind:clean(r.report_kind),from:r.period_from,to:r.period_to,status:r.status,reason:failureReason(r.error_message)}));}
module.exports={intent,parse,tickets,delivery};
