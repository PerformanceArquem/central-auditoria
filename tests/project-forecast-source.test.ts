import {readProjectForecast} from '../supabase/functions/audit-email-dispatch/project-forecast-extract.ts';
import {chargeTicketLookup} from '../supabase/functions/audit-email-dispatch/ticket-charge-lookup.ts';
const assert=(v:unknown,msg:string)=>{if(!v)throw Error(msg)};

Deno.test('read estimate from explicit Movidesk work estimate without assuming delivery SLA',()=>{
 const payload={subject:'P ** Integração',actions:[
  {description:'Previsão de 6 horas para análise',createdDate:'2026-11-05T10:00:00Z'}]};
 const x=readProjectForecast(payload);
 assert(x?.hours===6,'explicit estimate missing');
 assert(x?.origin.startsWith('Ação Movidesk'),'forecast origin missing');
 assert(readProjectForecast({subject:'P ** Prazo de entrega 10 dias'})===null,'delivery date treated as work forecast');
 assert(readProjectForecast({subject:'P ** Revisão',actions:[{description:'Sem previsão de 2 horas'}]})===null,'negated estimate treated as actual');
});
Deno.test('registered custom field outranks action text and respects working day length',()=>{
 const r=readProjectForecast({subject:'P ** Novo projeto',customFieldValues:[
  {customFieldId:'55',value:'12'}],actions:[{description:'Estimativa de 2 horas'}]},8,'55');
 assert(r?.hours===12&&r?.origin==='Campo personalizado Movidesk','registered custom field not prioritized');
 const d=readProjectForecast({subject:'P ** Migração',actions:[
  {description:'Esforço previsto de 2 dias',createdDate:'2026-11-17T12:00:00Z'}]},6);
 assert(d?.hours===12,'workday conversion incorrect');
});
Deno.test('charge metrics use textual estimate when no consolidated forecast exists',async()=>{
 const output=await chargeTicketLookup(['123'],async path=>{
  if(path.startsWith('audit_direct_tickets'))return [{
   ticket_id:'123',payload:{subject:'P ** Migração',status:'Em andamento',
    actions:[{description:'Previsão de 10 horas',createdDate:'2026-11-16T10:00:00Z'}]}}];
  if(path.startsWith('audit_direct_appointments'))return [{ticket_id:'123',appointment_date:'2026-11-17',duration_minutes:120}];
  if(path.startsWith('audit_forecast_variance_snapshots'))return [];
  return [];
 });
 const project=output.records[0].project_metrics as Record<string,unknown>;
 assert(project?.forecastHours===10,'fallback estimate missing');
 assert(project?.totalMinutes===120,'real work time missing');
 assert(String(project?.forecastOrigin).startsWith('Ação Movidesk'),'origin not transparent');
});
