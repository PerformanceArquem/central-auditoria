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
 assert(a.text.includes('Olá, equipe!')&&a.text.includes('Contexto complementar para esta verificação:\nMensagem revisada'),'humanized wrapper or editing ignored');
 assert(a.text.includes('Chamado #77533'),'canonical ticket details missing');
});

Deno.test('corporate HTML uses Arquem report design, accessible links and edited paragraphs',()=>{
 const msg='Prezados,\n\nFavor atualizar os chamados.\n\nAguardo retorno.';
 const result=composeTicketCharge(base,'direcao@arquem.com.br',msg);
 assert(result.html.includes('ARQUEM <span'),'wordmark missing');
 assert(result.html.includes('background:#122d4d'),'corporate header missing');
 assert(result.html.includes('background:#eaf2fa'),'corporate table missing');
 assert(result.html.includes('https://arquem.movidesk.com/Ticket/Edit/77533'),'clickable Movidesk link missing');
 assert(result.html.includes('Chamados selecionados'),'selected tickets header missing');
 assert(result.html.includes('Prezados,\n\nFavor atualizar os chamados.\n\nAguardo retorno.'),'edited paragraph line breaks were not preserved');
 assert(result.html.includes('role="presentation"'),'email-compatible table missing');
});
Deno.test('HTML body escapes injected markup without losing paragraph separators',()=>{
 const result=composeTicketCharge(base,'direcao@arquem.com.br','Olá <script>alert(1)</script>\nAguardo retorno.');
 assert(!result.html.includes('<script>'),'unsafe script persisted');
 assert(result.html.includes('&lt;script&gt;'),'HTML entity escaping missing');
 assert(result.html.includes('\nAguardo retorno.'),'line breaks lost');
});

Deno.test('shows ticket number, opened days and real last appointment without inventing hours',()=>{
 const source=[{ticket_id:'99221',payload:{status:'Em andamento',createdDate:'2026-10-01T12:00:00Z',subject:'Verificar integração'},
  last_real_appointment:{date:'2026-11-17',minutes:45}}];
 const output=composeTicketCharge(source,'direcao@arquem.com.br');
 assert(output.tickets[0].daysOpen!==null&&output.tickets[0].daysOpen>=0,'missing real open days');
 assert(output.text.includes('Chamado #99221'),'missing ticket number');
 assert(output.text.includes('2026-11-17 · 45 min'),'real last appointment not displayed');
 assert(output.html.includes('Último apontamento real'),'html appointment column absent');
 const noLog=composeTicketCharge([{ticket_id:'99222',payload:{status:'Em andamento'}}],'direcao@arquem.com.br');
 assert(noLog.text.includes('Não localizado na base sincronizada'),'missing-record fallback incorrect');
});

Deno.test('custom subject and main message appear in the corporate preview',()=>{
 const draft=composeTicketCharge(base,'direcao@arquem.com.br','Olá! Podemos ajudar com <prioridade>?',{subject:'Revisão dos chamados',customBody:true});
 assert(draft.subject==='Revisão dos chamados','custom subject missing');
 assert(draft.text.startsWith('Olá! Podemos ajudar com <prioridade>?'),'custom message missing');
 assert(!draft.text.includes('Contexto complementar'),'default introduction was prepended');
 assert(draft.html.includes('&lt;prioridade&gt;'),'custom HTML was not escaped');
 assert(draft.html.includes('77533'),'ticket table missing');
 assert(composeTicketCharge(base,'direcao@arquem.com.br','Observação').text.includes('Contexto complementar'),'default mode changed');
});
