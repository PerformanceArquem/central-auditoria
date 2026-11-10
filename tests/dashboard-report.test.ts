import {dashboardReport} from '../supabase/functions/audit-email-dispatch/dashboard-report.ts';
const assert=(ok:unknown,m:string)=>{if(!ok)throw Error(m)};
const today='2026-11-10';
function fixtures(){
 const calls:string[]=[];
 const appts=[
  {appointment_date:'2026-11-09',collaborator_name:'Ana',sector:'Produção - CPO',ticket_id:'901',duration_minutes:120},
  {appointment_date:'2026-11-09',collaborator_name:'Ana',sector:'Produção - CPO',ticket_id:'901',duration_minutes:60},
  {appointment_date:'2026-11-09',collaborator_name:'Beto',sector:'Qualidade',ticket_id:'902',duration_minutes:210},
  {appointment_date:'2026-11-10',collaborator_name:'Ana',sector:'Qualidade',ticket_id:'903',duration_minutes:80}
 ];
 const recs=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Gestão Produção',scope:'management',active:true,sectors:['Produção - CPO'],daily_target_minutes:480,minimum_percent:80}];
 return {calls,deps:{
  source:async (a:string,b:string)=>{calls.push('source');return appts.filter(x=>x.appointment_date>=a&&x.appointment_date<=b)},
  recipients:async()=>recs,holidays:async()=>new Set<string>(),
  state:async()=>({completed:true}),
  recentCoverage:async()=>({ready:true,lastSuccess:'2026-11-10T13:00:00Z'}),
  norm:(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(),
  today:()=>today
 }};
}
Deno.test('all sectors daily report includes only selected date, no email',async()=>{
 const {calls,deps}=fixtures();
 const out=await dashboardReport({date:today,period:'day'},deps);
 assert(out.ok===true&&out.period==='day'&&out.start===today,'incorrect period');
 assert(out.rows.length===1&&out.rows[0].collaborator==='Ana','wrong daily set');
 assert(out.rows[0].minutes===80&&out.rows[0].entries===1,'incorrect hours');
 assert(out.rows[0].target===480&&out.rows[0].minimum===384,'incorrect default references');
 assert(out.rows[0].targetGap===400,'incorrect remaining jornada');
 assert(calls.join(',')==='source','unexpected calls');
});
Deno.test('management sees only authorized sectors and matching weekly entries',async()=>{
 const {deps}=fixtures();
 const out=await dashboardReport({date:'2026-11-10',period:'week',recipientId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},deps);
 assert(out.start==='2026-11-09'&&out.end==='2026-11-15','incorrect week boundaries');
 assert(out.rows.length===1&&out.rows[0].collaborator==='Ana','sector leakage');
 assert(out.rows[0].minutes===180&&out.rows[0].ticketIds.length===1,'wrong aggregation');
 assert(out.recipientLabel==='Gestão Produção','incorrect recipient label');
 assert(out.partial===true,'current unfinished week should be partial');
});
Deno.test('invalid date fails before reading appointments',async()=>{
 const {calls,deps}=fixtures();
 let error='';
 try{await dashboardReport({period:'day',date:'2026-02-30'},deps)}catch(e){error=String(e)}
 assert(error.includes('Data de referência inválida'),'date should be rejected');
 assert(calls.length===0,'data read despite invalid date');
});
Deno.test('unknown recipient fails closed',async()=>{
 const {calls,deps}=fixtures();
 let error='';
 try{await dashboardReport({period:'day',date:today,recipientId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'},deps)}catch(e){error=String(e)}
 assert(error.includes('Gestor não encontrado'),'unauthorized recipient accepted');
 assert(calls.length===0,'data read despite invalid recipient');
});
Deno.test('invalid duration does not misstate hours',async()=>{
 const {deps}=fixtures();
 deps.source=async()=>[{appointment_date:today,collaborator_name:'Ana',sector:'Produção - CPO',ticket_id:'901',duration_minutes:-30}];
 let error='';
 try{await dashboardReport({period:'day',date:today},deps)}catch(e){error=String(e)}
 assert(error.includes('duração inválida'),'bad duration not rejected');
});
