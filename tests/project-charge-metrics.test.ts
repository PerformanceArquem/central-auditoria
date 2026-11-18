import {isProjectChargeSubject,projectChargeMetrics} from '../supabase/functions/audit-email-dispatch/project-charge-metrics.ts';
import {chargeTicketLookup} from '../supabase/functions/audit-email-dispatch/ticket-charge-lookup.ts';
import {composeTicketCharge} from '../supabase/functions/audit-email-dispatch/ticket-charge.ts';
const assert=(v:unknown,msg:string)=>{if(!v)throw Error(msg)};

Deno.test('P ** at the beginning identifies projects, not unrelated subjects',()=>{
 assert(isProjectChargeSubject('P ** Migração da loja'),'prefix not found');
 assert(isProjectChargeSubject('P** Integração'),'compact prefix not found');
 assert(isProjectChargeSubject('   p ** Projeto'),'case/whitespace not handled');
 assert(!isProjectChargeSubject('Chamado P ** no meio'),'false project classification');
 assert(!isProjectChargeSubject('Problema de sistema'),'ordinary call classified as project');
});
Deno.test('uses actual workTime appointments, daily goal and forecast without manufacturing values',()=>{
 const rows=[
  {appointment_date:'2026-11-10',duration_minutes:240},
  {appointment_date:'2026-11-10',duration_minutes:30},
  {appointment_date:'2026-11-11',duration_minutes:120},
  {appointment_date:'2026-10-29',duration_minutes:60}
 ];
 const m=projectChargeMetrics(rows,4,'2026-11-01','2026-11-30',7);
 assert(m.totalMinutes===450,'all-time minutes mismatch');
 assert(m.periodMinutes===390&&m.activeDays===2,'filtered days mismatch');
 assert(m.belowDays===1&&m.withinDays===0&&m.aboveDays===1,'daily goal classification mismatch');
 assert(m.averageDailyHours===3.25,'daily average mismatch');
 assert(m.forecastHours===7&&m.differenceHours===-0.5,'forecast balance incorrect');
 assert(m.budgetStatus==='Estourou','forecast status incorrect');
 const missing=projectChargeMetrics([],4,'2026-11-01','2026-11-30');
 assert(missing.averageDailyHours===null&&missing.forecastHours===null,'missing values must remain null');
});
Deno.test('project metrics appear in standardized email, other tickets stay normal',async()=>{
 const result=await chargeTicketLookup(['101','102'],async path=>{
  if(path.startsWith('audit_direct_tickets'))return [
   {ticket_id:'101',payload:{status:'Em andamento',subject:'P ** Integração',createdDate:'2026-09-01T12:00:00Z'}},
   {ticket_id:'102',payload:{status:'Fila',subject:'Ajuste de cadastro'}}];
  if(path.startsWith('audit_direct_appointments')){
   return [{ticket_id:'101',appointment_date:'2026-11-17',duration_minutes:240,
     collaborator_name:'Agente A',activity:'Análise'}];
  }
  if(path.startsWith('audit_forecast_variance_snapshots'))return [{ticket_id:'101',estimated_hours:8,evidence_origin:'previsão registrada'}];
  return [];
 },{dailyGoalHours:4,periodFrom:'2026-11-01',periodTo:'2026-11-30'});
 const mail=composeTicketCharge(result.records,'qualidade@arquem.com.br');
 assert(mail.tickets[0].isProject===true&&!mail.tickets[1].isProject,'project-only classification failed');
 assert(mail.text.includes('MÉTRICAS DE PROJETOS E PRAZOS — P **'),'project section missing');
 assert(mail.text.includes('Projeto #101'),'ticket project identification missing');
 assert(mail.text.includes('Horas previstas: 8h00'),'forecast missing');
 assert(mail.text.includes('Horas apontadas (total): 4h00'),'actual workTime mismatch');
 assert(mail.text.includes('Meta diária: 4h00'),'project target mismatch');
 assert(mail.html.includes('Projetos e Prazos · chamados P **'),'html section missing');
 assert(mail.text.includes('Chamado #102'),'normal ticket lost');
});
