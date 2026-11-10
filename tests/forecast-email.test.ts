import {forecastSection} from '../supabase/functions/audit-email-dispatch/forecast-variance.ts';
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message)};
const now=new Date().toISOString();
const sample=[
 {ticket_id:'100893',subject:'Bloqueio',client_name:'Empresa A',sector:'Produção - CPO',
  status:'Fechado',estimated_hours:'12',actual_minutes:26,variance_percent:'96.39',
  confidence:'baixa',evidence:'estimativa inicial seria de 12 horas',updated_at:now},
 {ticket_id:'94646',subject:'Recebimento',client_name:'Empresa B',sector:'Qualidade',
  status:'Fechado',estimated_hours:'40',actual_minutes:161,variance_percent:'93.29',
  confidence:'alta',evidence:'estimativa de 40 horas',updated_at:now},
 {ticket_id:'101716',subject:'Melhorias NC',client_name:'Empresa C',sector:'Qualidade',
  status:'Resolvido',estimated_hours:'10',actual_minutes:89,variance_percent:'85.17',
  confidence:'baixa',evidence:'estimado 5 a 10 horas',updated_at:now},
 {ticket_id:'97286',subject:'Treinamento',client_name:'Empresa D',sector:'Treinamento',
  status:'Fechado',estimated_hours:'18',actual_minutes:662,variance_percent:'38.7',
  confidence:'baixa',evidence:'estimativa de 18 horas',updated_at:now},
 {ticket_id:'90000',subject:'Ainda aberto',client_name:'Empresa X',sector:'Produção - CPO',
  status:'Fila',estimated_hours:'100',actual_minutes:10,variance_percent:'99.8',
  confidence:'alta',evidence:'estimado 100 horas',updated_at:now}
];
function deps(rows=sample){
 const requested:string[]=[];
 return {requested,db:async (path:string)=>{
  requested.push(path);
  if(path.startsWith('audit_forecast_variance_snapshots?'))return rows;
  if(path.startsWith('audit_direct_tickets?'))return [
   {ticket_id:'100893',owner:{businessName:'Guilherme Bonato'}},
   {ticket_id:'94646',owner:{businessName:'Alan Reis'}},
   {ticket_id:'101716',owner:{businessName:'Alan Reis'}},
   {ticket_id:'97286',owner:{businessName:'Laís Lot'}}
  ];
  throw Error('unexpected route '+path);
 },norm:(v:unknown)=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(),
  duration:(m:number)=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')+':00',
  emailEsc:(v:unknown)=>String(v||'').replace(/[&<>"]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]||x))};
}
Deno.test('management includes qualifying closed tickets across sectors, excludes open and minor gaps',async()=>{
 const {requested,...d}=deps();
 const result=await forecastSection({scope:'management',sectors:[]},d);
 assert(result.rows.length===3,'expected three qualifying cases');
 assert(!result.rows.some(x=>x.id==='90000'||x.id==='97286'),'open/minor gap must be excluded');
 assert(result.html.includes('https://arquem.movidesk.com/Ticket/Edit/94646'),'ticket link missing');
 assert(result.text.includes('Confiança: alta'),'confidence missing');
 assert(result.html.includes('não limitada ao período'),'current snapshot caveat missing');
 assert(!result.html.includes('GEMINI_API_KEY'),'secrets must never appear');
 assert(requested.length===2,'expected snapshot and owners only');
});
Deno.test('sector recipient sees only matching sector, including accents',async()=>{
 const {requested,...d}=deps();
 const result=await forecastSection({scope:'sector',sector:'Producao - CPO'},d);
 assert(result.rows.length===1&&result.rows[0].id==='100893','wrong production filter');
 assert(!result.html.includes('94646'),'leaked another sector');
});
Deno.test('individual report only includes tickets owned by the selected collaborator',async()=>{
 const {requested,...d}=deps();
 const result=await forecastSection({scope:'sector',sector:'Qualidade',collaborator_name:'Alan Reis'},d);
 assert(result.rows.length===2,'expected two tickets for selected collaborator');
 assert(result.rows.every(x=>x.owner==='Alan Reis'),'owner scoping failed');
});
Deno.test('stale snapshots are hidden, without disguising old data as current',async()=>{
 const old=sample.map(x=>({...x,updated_at:'2020-01-01T00:00:00Z'}));
 const {requested,...d}=deps(old);
 const result=await forecastSection({scope:'management'},d);
 assert(result.rows.length===0&&!result.text&&!result.html,'stale snapshot incorrectly displayed');
});
Deno.test('escape untrusted client names in corporate HTML',async()=>{
 const unsafe=sample.map((x,i)=>i===0?{...x,client_name:'<img src=x onerror=alert(1)>'}:x);
 const {requested,...d}=deps(unsafe);
 const result=await forecastSection({scope:'management'},d);
 assert(!result.html.includes('<img'),'unsafe HTML was not escaped');
 assert(result.html.includes('&lt;img'),'escaped text missing');
});
