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
  const ordered=raw.map((h,i)=>({...h,ownerTeam:h.ownerTeam,owner:h.owner,changedBy:h.changedBy,at:iso(h.changedDate),order:i}))
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
/**
 * Email da Keila: somente duas métricas de fluxo.
 * A rastreabilidade completa permanece na fonte de dados do sistema,
 * nunca no e-mail ou nos anexos deste relatório.
 */
export function keilaProductionReport(
  data:ReturnType<typeof buildKeilaProductionFlow>,
  kind:'daily'|'weekly'|'monthly'
) {
  const title='Rastreabilidade dos chamados da Produção — '+({daily:'Diário',weekly:'Semanal',monthly:'Mensal'}[kind]);
  const period=data.from.split('-').reverse().join('/')+' a '+data.to.split('-').reverse().join('/');
  const entered=data.entered,exited=data.exited;
  const scale=Math.max(entered,exited,1);
  const width=(n:number)=>Math.round(n/scale*100);
  const text=[
    'ARQUEM SISTEMAS · CENTRAL DE AUDITORIA',
    title,'Período: '+period,
    'ENTRADAS: '+entered,
    'SAÍDAS: '+exited
  ].join('\n');
  const html='<!doctype html><html lang="pt-BR"><body style="margin:0;background:#edf3fa;font-family:Arial,sans-serif;color:#173453">'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">'+
    '<table width="100%" style="max-width:640px;background:#fff;border-collapse:collapse">'+
    '<tr><td style="background:#142f50;color:#fff;padding:24px"><small>ARQUEM SISTEMAS · CENTRAL DE AUDITORIA</small>'+
    '<h1 style="font-size:22px;margin:8px 0 0">Rastreabilidade dos chamados da Produção</h1>'+
    '<p style="font-size:13px;margin-bottom:0">Período: '+esc(period)+'</p></td></tr>'+
    '<tr><td style="padding:28px">'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'+
    '<td style="width:50%;background:#edf4ff;padding:18px"><b>ENTRADAS</b><h2 style="font-size:36px;margin:10px 0">'+entered+'</h2></td>'+
    '<td style="width:50%;background:#e9f8f1;padding:18px"><b>SAÍDAS</b><h2 style="font-size:36px;margin:10px 0">'+exited+'</h2></td>'+
    '</tr></table>'+
    '<h3 style="margin:24px 0 14px;font-size:16px">Comparativo</h3>'+
    '<table role="presentation" width="100%" cellpadding="6" cellspacing="0">'+
    '<tr><td width="82">Entradas</td><td><div style="height:22px;background:#e5ebf2">'+
    '<div style="height:22px;width:'+width(entered)+'%;background:#2b64b6"></div></div></td><td width="48" align="right"><b>'+entered+'</b></td></tr>'+
    '<tr><td>Saídas</td><td><div style="height:22px;background:#e5ebf2">'+
    '<div style="height:22px;width:'+width(exited)+'%;background:#21886b"></div></div></td><td align="right"><b>'+exited+'</b></td></tr>'+
    '</table></td></tr></table></td></tr></table></body></html>';
  const packet={
    schema:'arquem-mail-v1',
    title,from:data.from,to:data.to,partial:false,historicalIncomplete:false,
    metrics:{entered,exited},
    productionFlow:{entered,exited,movements:data.movements.map(m=>({
      id:m.id,direction:m.direction,at:m.at,subject:m.subject,client:m.client,
      fromTeam:m.fromTeam,toTeam:m.toTeam,responsible:m.responsible,actor:m.actor
    }))},
    collaborators:[],customers:[],activities:[],daily:[],tickets:[],forecastVariances:[]
  };
  return {title,text,html,packet,limited:false};
}
