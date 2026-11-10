import {composeTicketCharge} from '../supabase/functions/audit-email-dispatch/ticket-charge.ts';
const assert=(c:unknown,msg:string)=>{if(!c)throw Error(msg)};
const base=[{ticket_id:'77533',payload:{subject:'Tarefa A',status:'Fila',ownerTeam:'Inteligência',
 owner:{businessName:'Equipe A'},clients:[{organization:{businessName:'Cliente A'}}],lastUpdate:'2026-11-09T17:02:00'}},
 {ticket_id:'77901',payload:{subject:'Tarefa B',status:'Em Análise',ownerTeam:'Produção - CPO',
  owner:{businessName:'Equipe B'},clients:[{businessName:'Cliente B'}]}}];
Deno.test('creates corporate email with links and real ticket details',()=>{
 const a=composeTicketCharge(base,'direcao@arquem.com.br');
 assert(a.tickets.length===2,'wrong size');
 assert(a.text.includes('https://arquem.movidesk.com/Ticket/Edit/77533'),'ticket link missing');
 assert(a.html.includes('ARQUEM SISTEMAS'),'corporate header missing');
 assert(a.text.includes('Cliente A')&&a.text.includes('Equipe B'),'ticket fields missing');
});
Deno.test('rejects external recipient',()=>{
 let fail=false;try{composeTicketCharge(base,'outside@example.org')}catch{fail=true}
 assert(fail,'external address accepted');
});
Deno.test('rejects closed tickets before rendering',()=>{
 let fail=false;try{composeTicketCharge([{ticket_id:'123',payload:{status:'Fechado'}}],'direcao@arquem.com.br')}catch{fail=true}
 assert(fail,'closed ticket accepted');
});
Deno.test('rejects duplicate ticket ids',()=>{
 let fail=false;try{composeTicketCharge([base[0],base[0]],'direcao@arquem.com.br')}catch{fail=true}
 assert(fail,'duplicate accepted');
});
Deno.test('rejects more than 20 tickets',()=>{
 let fail=false;try{composeTicketCharge(Array.from({length:21},(_,i)=>({ticket_id:String(10000+i),payload:{status:'Fila'}})),'direcao@arquem.com.br')}catch{fail=true}
 assert(fail,'limit ignored');
});
Deno.test('escapes untrusted client and subject text',()=>{
 const a=composeTicketCharge([{ticket_id:'1212',payload:{status:'Fila',subject:'<script>alert(1)</script>',clients:[{businessName:'<img src=x>'}]}}],'direcao@arquem.com.br');
 assert(!a.html.includes('<script>')&&!a.html.includes('<img src=x>'),'unsafe html');
 assert(a.html.includes('&lt;script&gt;'),'missing escaping');
});
Deno.test('uses edited introduction but preserves canonical ticket table',()=>{
 const a=composeTicketCharge(base,'direcao@arquem.com.br','Mensagem revisada');
 assert(a.text.startsWith('Mensagem revisada'),'editing ignored');
 assert(a.text.includes('Chamado #77533'),'canonical ticket details missing');
});
