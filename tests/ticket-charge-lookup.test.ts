import {chargeTicketLookup} from '../supabase/functions/audit-email-dispatch/ticket-charge-lookup.ts';
const assert=(v:unknown,msg:string)=>{if(!v)throw Error(msg)};
const record=(id:string)=>({ticket_id:id,payload:{id:Number(id),status:'Agendado',subject:'Assunto '+id}});
Deno.test('todos os chamados na base principal seguem a ordem selecionada',async()=>{
 const calls:string[]=[];
 const result=await chargeTicketLookup(['97513','96484'],async p=>{
  calls.push(p);
  if(p.startsWith('audit_direct_tickets'))return [record('96484'),record('97513')];
  throw Error('Tabela extra não deveria ser consultada');
 });
 assert(result.records.map(x=>x.ticket_id).join(',')==='97513,96484','ordem incorreta');
 assert(result.missingIds.length===0,'faltam chamados existentes');
 assert(calls.length===1,'consulta extra desnecessária');
});
Deno.test('usa snapshot de chamados abertos se faltar na base principal',async()=>{
 const result=await chargeTicketLookup(['97513','96484'],async p=>{
  if(p.startsWith('audit_direct_tickets'))return [record('97513')];
  if(p.startsWith('audit_email_open_ticket_snapshot'))return [record('96484')];
  throw Error('Consulta adicional indevida');
 });
 assert(result.records.length===2,'não recuperou o chamado do snapshot');
 assert(result.sources['96484']==='audit_email_open_ticket_snapshot','origem errada');
});
Deno.test('usa cache legado sincronizado somente para números ainda não encontrados',async()=>{
 const result=await chargeTicketLookup(['97513','98474'],async p=>{
  if(p.startsWith('audit_direct_tickets'))return [record('97513')];
  if(p.startsWith('audit_email_open_ticket_snapshot'))return [];
  if(p.startsWith('tm_tickets'))return [{id:'98474',data:{id:98474,status:'Fila',subject:'Chamado antigo'}}];
  throw Error('unexpected');
 });
 assert(result.records.length===2,'cache não recuperado');
 assert((result.records[1].payload as Record<string,unknown>).subject==='Chamado antigo','payload inválido');
});
Deno.test('retorna exclusivamente números faltantes sem inventar chamados',async()=>{
 const result=await chargeTicketLookup(['97513','9999999'],async p=>{
  if(p.startsWith('audit_direct_tickets'))return [record('97513')];
  return [];
 });
 assert(result.records.length===1,'chamado fictício foi criado');
 assert(result.missingIds.join(',')==='9999999','número faltante não especificado');
});
Deno.test('rejeita identificadores inválidos ou duplicados antes da consulta',async()=>{
 let called=0,failed=0;
 for(const ids of [['97513','97513'],['97513','1);drop table'],[],Array.from({length:21},(_,i)=>String(i+1))]){
  try{await chargeTicketLookup(ids,async()=>{called++;return []})}catch{failed++}
 }
 assert(failed===4&&called===0,'entrada malformada passou');
});
Deno.test('não mistura payload de outra referência solicitada',async()=>{
 const result=await chargeTicketLookup(['97513'],async p=>{
  if(p.startsWith('audit_direct_tickets'))return [record('97513'),record('123456')];
  return [];
 });
 assert(result.records.length===1 && result.records[0].ticket_id==='97513','chamado estranho retornado');
});
