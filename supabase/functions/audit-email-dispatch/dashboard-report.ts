// Read-only collaborator preview: no dispatch, no email or write.
import {recipientAllowsCollaborator} from './recipient-collaborators.ts';
type R=Record<string,any>;
type Dependencies={
 source:(from:string,to:string)=>Promise<R[]>;
 recipients:()=>Promise<R[]>;
 holidays:()=>Promise<Set<string>>;
 state:()=>Promise<R>;
 recentCoverage:(from:string,to:string)=>Promise<R>;
 norm:(x:unknown)=>string;
 today:()=>string;
};
const shiftDay=(d:string,n:number)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekDay=(d:string)=>new Date(d+'T12:00:00Z').getUTCDay();
function validDate(d:string){
 return /^\d{4}-\d{2}-\d{2}$/.test(d)&&
  Number.isFinite(Date.parse(d+'T12:00:00Z'))&&shiftDay(d,0)===d;
}
export async function dashboardReport(payload:R,deps:Dependencies):Promise<R>{
 const period=String(payload.period||'');
 const date=String(payload.date||'');
 const today=deps.today();
 if(period!=='day'&&period!=='week')throw new Error('Selecione relatório diário ou semanal.');
 if(!validDate(date)||date>today||date<shiftDay(today,-370))
  throw new Error('Data de referência inválida ou fora do período de 370 dias.');
 const dow=weekDay(date);
 const start=period==='week'?shiftDay(date,-((dow+6)%7)):date;
 const end=period==='week'?shiftDay(start,6):date;
 const recipientId=String(payload.recipientId||'').trim();
 let selected:R|null=null;
 if(recipientId){
  if(!/^[0-9a-f-]{36}$/i.test(recipientId))throw new Error('Identificador de gestor inválido.');
  const registered=await deps.recipients();
  selected=registered.find(r=>String(r.id)===recipientId&&r.active===true&&r.scope==='management')||null;
  if(!selected)throw new Error('Gestor não encontrado ou sem permissão para o relatório.');
 }
 const configured=(Array.isArray(selected?.sectors)&&selected.sectors.length?selected.sectors:[selected?.sector])
  .map(deps.norm).filter(Boolean);
 if(selected&&!configured.length)throw new Error('Gestor sem setores configurados.');
 const labels=(Array.isArray(selected?.sectors)&&selected.sectors.length?selected.sectors:[selected?.sector]).filter(Boolean);
 const [appointments,holidays]=await Promise.all([deps.source(start,end),deps.holidays()]);
 const allowed=new Set(configured);
 const filtered=appointments.filter(a=>(!selected||allowed.has(deps.norm(a.sector)))&&(!selected||recipientAllowsCollaborator(selected,a.collaborator_name)));
 const records=new Map<string,{collaborator:string;sectors:Set<string>;ticketIds:Set<string>;entries:number;minutes:number}>();
 for(const a of filtered){
  const collaborator=String(a.collaborator_name||'').trim(),sector=String(a.sector||'').trim();
  if(!collaborator)continue;
  const minutes=Number(a.duration_minutes);
  if(!Number.isFinite(minutes)||minutes<0)throw new Error('Há apontamentos com duração inválida. Revisar sincronização.');
  const id=deps.norm(collaborator);
  const item=records.get(id)||{collaborator,sectors:new Set<string>(),ticketIds:new Set<string>(),entries:0,minutes:0};
  item.minutes+=minutes;item.entries++;
  if(sector)item.sectors.add(sector);
  if(a.ticket_id)item.ticketIds.add(String(a.ticket_id));
  records.set(id,item);
 }
 let workdays=0;
 for(let d=start;d<=end;d=shiftDay(d,1)){
  const wd=weekDay(d);
  if(wd!==0&&wd!==6&&!holidays.has(d)&&d<=today)workdays++;
 }
 const defaultDaily=Number(selected?.daily_target_minutes);
 const targetDaily=Number.isFinite(defaultDaily)&&defaultDaily>0&&defaultDaily<=1440?defaultDaily:480;
 const defaultMinimum=Number(selected?.minimum_percent);
 const minimumPercent=Number.isFinite(defaultMinimum)&&defaultMinimum>0&&defaultMinimum<=100?defaultMinimum:80;
 const target=Math.round(workdays*targetDaily);
 const minimum=Math.round(target*minimumPercent/100);
 const rows=[...records.values()].map(a=>({
  collaborator:a.collaborator,sectors:[...a.sectors].sort((x,y)=>x.localeCompare(y,'pt-BR')),
  ticketIds:[...a.ticketIds],entries:a.entries,minutes:Math.round(a.minutes),
  minimum,target,
  minimumGap:Math.max(0,minimum-a.minutes),
  targetGap:Math.max(0,target-a.minutes),
  extra:Math.max(0,a.minutes-target),multipleSectors:a.sectors.size>1,
  ruleSource:'Referência de '+targetDaily+' min/dia · mínimo '+minimumPercent+'% · dias úteis; não é controle de ponto'
 })).sort((a,b)=>a.collaborator.localeCompare(b.collaborator,'pt-BR'));
 let sync:R|null=null,partial=end>today,coverage='Cobertura da sincronização não confirmada.';
 try{
  const checkpoint=await deps.recentCoverage(start,end);
  const historical=await deps.state();
  sync={completed:checkpoint.ready===true&&historical.completed===true,lastSuccessAt:checkpoint.lastSuccess||checkpoint.last_success_at||null};
  partial=partial||sync.completed!==true;
  coverage=sync.completed?'Período com conciliação registrada.':'Conciliação parcial ou fora da janela recente.';
 }catch{
  partial=true;
 }
 return {ok:true,period,start,end,rows,recipientLabel:selected?
  String(selected.name||selected.email||'Gestão'):'Consolidado geral (administrador)',
  sectors:labels,workdays,partial,sync,coverageMessage:
  coverage+' Apenas apontamentos importados do Movidesk. Referências de jornada não substituem ponto ou escala. Nenhum e-mail foi enviado.',
  generatedAt:new Date().toISOString()};
}

