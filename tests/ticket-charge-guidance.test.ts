import {composeTicketCharge} from '../supabase/functions/audit-email-dispatch/ticket-charge.ts';

function assert(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason);
}
const row = (id:string,extras:Record<string,unknown>={})=>({
  ticket_id:id, payload:{
    subject:'Aguardando definição de prioridade',status:'Em Análise',
    owner:{businessName:'Equipe Produção'},ownerTeam:'Produção - CPO',
    clients:[{businessName:'Cliente exemplo'}],
    createdDate:'2025-01-20T15:00:00Z',
    lastUpdate:'2025-02-02T09:00:00Z',
    ...extras
  }
});
const recipient='teste@arquem.com.br';
Deno.test('sem opt-in nao acrescenta diagnostico nem texto de IA',()=>{
 const mail=composeTicketCharge([row('77901')],recipient,'Prezados, favor atualizar.');
 assert(mail.guidance.length===0,'diagnostico deve ficar oculto por padrao');
 assert(!mail.html.includes('Dicas do Manager'), 'rodape nao autorizado');
 assert(!mail.text.includes('DICAS DO MANAGER'), 'texto sem rodape');
});
Deno.test('opt-in inclui orientacao coerente em texto e HTML',()=>{
 const mail=composeTicketCharge([row('77901')],recipient,'Prezados.',{includeGuidance:true});
 assert(mail.guidance.length>=1,'faltou evidencia');
 assert(mail.html.includes('Dicas do Manager'),'rodape nao renderizado');
 assert(mail.text.includes('DICAS DO MANAGER'),'texto nao renderizado');
 assert(mail.html.includes('https://arquem.movidesk.com/Ticket/Edit/77901'),'link do chamado removido');
 assert(mail.guidance.some(x=>x.action.includes('Revisar')),'acao pratica ausente');
});
Deno.test('dados do Movidesk devem ser escapados no HTML',()=>{
 const mail=composeTicketCharge([row('77901',{subject:'<img src=x onerror=alert(1)>',owner:{name:'<script>danger</script>'}})],recipient,'Teste.',{includeGuidance:true});
 assert(!mail.html.includes('<img src=x'),'HTML de terceiros nao foi escapado');
 assert(!mail.html.includes('<script>danger</script>'),'script de terceiros nao foi escapado');
 assert(mail.html.includes('&lt;img'),'escape deveria preservar descricao como texto');
});
Deno.test('nao autoriza mensagem de cobranca a chamados encerrados',()=>{
 let failed=false;
 try{composeTicketCharge([row('77901',{status:'Resolvido'})],recipient,'Teste.',{includeGuidance:true});}catch{failed=true;}
 assert(failed,'chamado encerrado deveria bloquear preparo do e-mail');
});
Deno.test('nao cria evidencias de apontamentos sem os dados de horas',()=>{
 const mail=composeTicketCharge([row('77901')],recipient,'Teste.',{includeGuidance:true});
 assert(!mail.text.toLowerCase().includes('sem apontamento'),'nao se pode supor falta de horas');
});
