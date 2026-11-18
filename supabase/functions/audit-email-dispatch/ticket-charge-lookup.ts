import {isProjectChargeSubject,projectChargeMetrics} from './project-charge-metrics.ts';
// Busca consistente com as diferentes bases utilizadas no ranking e na importação.
type TicketRecord=Record<string,unknown>;
type LookupDB=(path:string)=>Promise<unknown>;
export type ChargeLookup={records:TicketRecord[],missingIds:string[],sources:Record<string,string>};
export type ChargeProjectOptions={dailyGoalHours?:number;periodFrom?:string;periodTo?:string};
export async function chargeTicketLookup(ids:string[],db:LookupDB,opts:ChargeProjectOptions={}):Promise<ChargeLookup>{
 if(!Array.isArray(ids)||!ids.length||ids.length>20||
  ids.some(x=>!/^\d{1,12}$/.test(x))||new Set(ids).size!==ids.length)
  throw Error('Selecione de 1 a 20 chamados distintos.');
 const found=new Map<string,TicketRecord>(),sources:Record<string,string>={};
 const merge=(rows:unknown,origin:string,convert:(row:Record<string,unknown>)=>TicketRecord)=>{
  if(!Array.isArray(rows))throw Error('Resposta inválida ao consultar '+origin+'.');
  for(const item of rows){
   if(!item||typeof item!=='object')continue;
   const raw=item as Record<string,unknown>;
   const converted=convert(raw);
   const id=String(converted.ticket_id||'');
   if(!ids.includes(id)||found.has(id)||!converted.payload||typeof converted.payload!=='object')continue;
   found.set(id,converted);sources[id]=origin;
  }
 };
 const query=(field:string,missing:string[])=>field+'=in.('+missing.join(',')+')';
 const direct=await db('audit_direct_tickets?select=ticket_id,payload,created_at_source,last_update_source&'+query('ticket_id',ids)+'&limit=20');
 merge(direct,'audit_direct_tickets',row=>row);
 let missing=ids.filter(id=>!found.has(id));
 if(missing.length){
  const snapshot=await db('audit_email_open_ticket_snapshot?select=ticket_id,payload,created_at_source,last_update_source&'+query('ticket_id',missing)+'&limit=20');
  merge(snapshot,'audit_email_open_ticket_snapshot',row=>row);
  missing=ids.filter(id=>!found.has(id));
 }
 if(missing.length){
  const old=await db('tm_tickets?select=id,data&'+query('id',missing)+'&limit=20');
  merge(old,'tm_tickets',row=>({
   ticket_id:String(row.id||''),
   payload:row.data,
   created_at_source:(row.data as Record<string,unknown>|null)?.createdDate,
   last_update_source:(row.data as Record<string,unknown>|null)?.lastUpdate
  }));
 }
 missing=ids.filter(id=>!found.has(id));
 // O último apontamento é um registro real de horas do Movidesk, e não
 // 'lastUpdate' ou uma anotação interna de cobrança. Nunca inventar horas.
 const appointments=await db('audit_direct_appointments?select=ticket_id,appointment_date,duration_minutes,collaborator_name,activity&ticket_id=in.('+ids.join(',')+')&duration_minutes=gt.0&order=appointment_date.desc&limit=1000');
 if(!Array.isArray(appointments))throw Error('Não foi possível consultar os apontamentos reais.');
 const latest=new Map<string,Record<string,unknown>>();
 for(const raw of appointments){
   if(!raw||typeof raw!=='object')continue;
   const row=raw as Record<string,unknown>,id=String(row.ticket_id||'');
   if(!ids.includes(id)||latest.has(id))continue;
   latest.set(id,{date:String(row.appointment_date||''),minutes:Number(row.duration_minutes)||0,
     collaborator:String(row.collaborator_name||''),activity:String(row.activity||'')});
 }
 for(const [id,row] of found){
   found.set(id,{...row,last_real_appointment:latest.get(id)||null});
 }
 // Apenas chamados P ** recebem o cálculo de Projetos e Prazos.
 // O total usa apontamentos reais de todo o histórico, enquanto a média e
 // a classificação diária usam o período selecionado no painel.
 const projectIds=ids.filter(id=>{
   const t=found.get(id),p=(t?.payload||{}) as Record<string,unknown>;
   return t&&isProjectChargeSubject(p.subject);
 });
 if(projectIds.length){
   const grouped=new Map<string,Record<string,unknown>[]>();
   for(const id of projectIds)grouped.set(id,[]);
   const pageSize=1000,maxPages=50;
   let finished=false;
   for(let page=0;page<maxPages;page++){
     const query='audit_direct_appointments?select=ticket_id,appointment_date,duration_minutes'+
       '&ticket_id=in.('+projectIds.join(',')+')&order=appointment_date.desc&limit='+pageSize+'&offset='+(page*pageSize);
     const batch=await db(query);
     if(!Array.isArray(batch))throw Error('Consulta de apontamentos do projeto indisponível.');
     for(const item of batch){
       if(!item||typeof item!=='object')continue;
       const record=item as Record<string,unknown>,id=String(record.ticket_id||'');
       if(grouped.has(id))grouped.get(id)!.push(record);
     }
     if(batch.length<pageSize){finished=true;break}
   }
   if(!finished)throw Error('Histórico de apontamentos excedeu o limite seguro; não é possível calcular as métricas do projeto.');
   const snapshots=await db('audit_forecast_variance_snapshots?select=ticket_id,estimated_hours,evidence_origin,confidence,updated_at'+
      '&ticket_id=in.('+projectIds.join(',')+')&limit=100') as Record<string,unknown>[];
   if(!Array.isArray(snapshots))throw Error('Previsões de projetos indisponíveis.');
   const forecasts=new Map(snapshots.map(r=>[String(r.ticket_id),r]));
   for(const id of projectIds){
     const source=found.get(id)!, forecast=forecasts.get(id);
     const forecastNum=forecast?.estimated_hours===null||forecast?.estimated_hours===undefined?
       null:Number(forecast.estimated_hours);
     const metrics=projectChargeMetrics(grouped.get(id)||[],opts.dailyGoalHours||4,
       opts.periodFrom,opts.periodTo,forecastNum);
     found.set(id,{...source,project_metrics:{...metrics,
       forecastOrigin:forecast?String(forecast.evidence_origin||'Base de previsão'):null,
       forecastUpdatedAt:forecast?String(forecast.updated_at||''):null}});
   }
 }
 return {records:ids.filter(id=>found.has(id)).map(id=>found.get(id)!),missingIds:missing,sources};
}
