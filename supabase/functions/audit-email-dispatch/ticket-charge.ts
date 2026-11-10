// Composição segura de cobranças de chamados abertos, sem envio automático.
type TicketRow=Record<string,any>;
export function composeTicketCharge(rows:TicketRow[],recipient:string,body?:string){
 if(!Array.isArray(rows)||rows.length<1||rows.length>20)throw Error('Selecione de 1 a 20 chamados.');
 if(!/^[^@\s]+@arquem\.com\.br$/i.test(recipient))throw Error('Informe um destinatário corporativo @arquem.com.br.');
 const clean=(v:unknown,max=230)=>String(v??'').replace(/[\x00-\x1f\x7f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
 const esc=(v:unknown)=>clean(v,500).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
 const normalized=rows.map(t=>{
   const id=String(t.ticket_id||t.id||'');
   if(!/^\d{1,12}$/.test(id))throw Error('Identificador de chamado inválido.');
   const p=t.payload||t;
   const status=clean(p.status,80);
   if(/^(fechad|conclu|resolvid|encerrad|finalizad|cancelad)/i.test(status.normalize('NFD').replace(/[\u0300-\u036f]/g,'')))
     throw Error('O chamado #'+id+' foi encerrado. Atualize a seleção antes de cobrar.');
   const owner=clean(p.owner?.businessName||p.owner?.name||p.owner||'Não atribuído',80);
   const c=p.clients?.[0]||{},client=clean(c.organization?.businessName||c.businessName||c.organization?.name||c.name||'Não informado',150);
   const last=clean(p.lastUpdate||t.last_update_source||'',50),opened=clean(p.createdDate||t.created_at_source||'',50);
   return {id,subject:clean(p.subject||'Sem assunto'),sector:clean(p.ownerTeam||'Sem setor',90),
      client,owner,status:status||'Sem status',last,opened,url:'https://arquem.movidesk.com/Ticket/Edit/'+id};
 });
 if(new Set(normalized.map(x=>x.id)).size!==normalized.length)throw Error('Há chamados repetidos.');
 const subject='Solicitação de andamento | '+normalized.length+' chamado(s) pendente(s)';
 const requested=body===undefined?'':String(body).trim();
 if(requested.length>8500)throw Error('O texto ultrapassa 8.500 caracteres.');
 const message=requested||'Prezados,\n\nSolicito, por gentileza, uma atualização sobre os chamados abaixo, que permanecem em aberto e necessitam de acompanhamento.\n\nPeço informar o andamento de cada demanda, o próximo encaminhamento e, quando aplicável, a previsão de conclusão.\n\nAgradeço o retorno.';
 const lines=normalized.map((t,i)=>(i+1)+'. Chamado #'+t.id+' — '+t.subject+'\n   Cliente: '+t.client+' | Setor: '+t.sector+' | Responsável: '+t.owner+'\n   Status: '+t.status+' | Última atualização: '+(t.last||'Não informada')+'\n   '+t.url);
 const text=message+'\n\nCHAMADOS PARA ACOMPANHAMENTO\n'+lines.join('\n\n')+'\n\nFonte: Central de Auditoria / Movidesk. Os status refletem a consulta atual.';
 const table=normalized.map((t,i)=>'<tr style="background:'+(i%2?'#f5f8fc':'#fff')+'"><td style="padding:10px;border-bottom:1px solid #e5edf7"><a href="'+t.url+'" style="color:#1357a8;font-weight:bold">#'+esc(t.id)+'</a></td>'+
 '<td style="padding:10px;border-bottom:1px solid #e5edf7">'+esc(t.client)+'<div style="font-size:11px;color:#64748b">'+esc(t.sector)+'</div></td>'+
 '<td style="padding:10px;border-bottom:1px solid #e5edf7">'+esc(t.subject)+'</td>'+
 '<td style="padding:10px;border-bottom:1px solid #e5edf7">'+esc(t.owner)+'<div style="font-size:11px">'+esc(t.status)+'</div></td></tr>').join('');
 const html='<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body style="background:#edf2f9;margin:0;padding:24px;font-family:Arial,sans-serif;color:#19334d">'+
 '<div style="max-width:760px;margin:auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #d8e4f1">'+
 '<div style="background:#142f50;color:white;padding:23px 26px"><div style="color:#92d8ea;font-size:12px;letter-spacing:2px">ARQUEM SISTEMAS</div><h2 style="margin:10px 0 0">Solicitação de andamento de chamados</h2></div>'+
 '<div style="padding:24px"><p style="white-space:pre-line;line-height:1.6">'+esc(message)+'</p>'+
 '<h3 style="font-size:15px;margin-top:24px">Chamados selecionados ('+normalized.length+')</h3>'+
 '<table style="border-collapse:collapse;width:100%;font-size:12px"><thead style="background:#eaf1fa"><tr><th align="left" style="padding:10px">Chamado</th><th align="left">Cliente / setor</th><th align="left">Assunto</th><th align="left">Responsável</th></tr></thead><tbody>'+table+'</tbody></table>'+
 '<p style="color:#64748b;font-size:11px;margin-top:18px">Dados extraídos do Movidesk no momento da consulta. Confira o status antes de enviar.</p></div></div></body></html>';
 return {subject,text,html,tickets:normalized};
}
