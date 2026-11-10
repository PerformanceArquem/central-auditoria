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

 // O mesmo HTML é usado na prévia e no envio efetivo. CSS inline para clientes de e-mail.
 const font='font-family:Arial,Helvetica,sans-serif';
 const cell='padding:12px 10px;border-bottom:1px solid #e3ebf5;vertical-align:top;font-size:12px;line-height:1.5;color:#263d59;';
 const safeDate=(value:string)=>{
  if(!value)return 'Não informada';
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?'Não informada':
   new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(parsed);
 };
 const table=normalized.map((t,i)=>{
  const bg=i%2===0?'#ffffff':'#f5f8fc';
  return '<tr style="background:'+bg+'">'+
   '<td style="'+cell+'white-space:nowrap">'+
    '<a href="'+t.url+'" target="_blank" rel="noopener noreferrer" style="font-weight:700;text-decoration:none;color:#1559a4">#'+esc(t.id)+'</a>'+
    '<div style="font-size:10px;color:#65778f;margin-top:5px">Item '+String(i+1).padStart(2,'0')+'</div></td>'+
   '<td style="'+cell+'max-width:190px"><strong style="color:#173454">'+esc(t.client)+'</strong>'+
    '<div style="font-size:11px;color:#65778f;margin-top:5px">'+esc(t.sector)+'</div></td>'+
   '<td style="'+cell+'min-width:170px">'+esc(t.subject)+'</td>'+
   '<td style="'+cell+'min-width:125px">'+esc(t.owner)+
    '<div style="font-size:11px;color:#65778f;margin-top:5px">Situação: '+esc(t.status)+'</div>'+
    '<div style="font-size:10px;color:#8794a4;margin-top:5px">Atualização: '+esc(safeDate(t.last))+'</div></td></tr>';
 }).join('');
 const header=(label:string)=>'<th align="left" style="padding:13px 10px;border-bottom:1px solid #cbdced;color:#1e4972;font-size:11px;letter-spacing:.3px">'+label+'</th>';
 const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
 '<body style="margin:0;padding:24px 12px;background:#edf2f8;'+font+';color:#213b58">'+
 '<div style="max-width:780px;margin:0 auto;border:1px solid #dae5f2;border-radius:14px;overflow:hidden;background:#ffffff">'+
 '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#122d4d"><tr><td style="padding:24px 28px">'+
 '<div style="font-size:12px;letter-spacing:2.5px;font-weight:700;color:#8fd5e8">ARQUEM <span style="color:#ffffff">SISTEMAS</span></div>'+
 '<div style="height:3px;width:54px;background:#55c5db;margin:15px 0"></div>'+
 '<h1 style="font-size:24px;color:#ffffff;line-height:1.25;font-weight:700;margin:0">Solicitação de andamento</h1>'+
 '<p style="font-size:12px;line-height:1.6;color:#c4d7e9;margin:8px 0 0">Acompanhamento de chamados · Comunicação corporativa</p>'+
 '</td></tr></table>'+
 '<div style="padding:24px 28px 8px">'+
 '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse"><tr>'+
 '<td style="padding:14px 16px;background:#f0f6fc;border:1px solid #dce9f5;border-radius:8px">'+
 '<div style="color:#627997;font-size:11px;text-transform:uppercase;letter-spacing:1px">Demandas para acompanhamento</div>'+
 '<div style="color:#153658;font-size:27px;font-weight:700;margin-top:4px">'+normalized.length+' <span style="font-size:13px;font-weight:400">chamado(s) em aberto</span></div>'+
 '</td></tr></table>'+
 '<div style="padding:18px 0 12px;font-size:13px;line-height:1.75;color:#34475d;white-space:pre-line">'+esc(message)+'</div>'+
 '<h2 style="font-size:15px;color:#173454;margin:15px 0 10px;border-left:4px solid #2388c8;padding-left:10px">Chamados selecionados</h2>'+
 '</div>'+
 '<div style="padding:0 18px 22px;overflow-x:auto">'+
 '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;min-width:620px">'+
 '<thead style="background:#eaf2fa"><tr>'+header('Chamado')+header('Cliente / setor')+header('Assunto')+header('Responsável / status')+'</tr></thead>'+
 '<tbody>'+table+'</tbody></table></div>'+
 '<div style="padding:18px 28px;background:#f6f9fc;border-top:1px solid #e2eaf3">'+
 '<p style="font-size:12px;line-height:1.6;color:#354e6a;margin:0 0 7px"><strong>Próximo encaminhamento solicitado:</strong> informar andamento, responsável e previsão realista de retorno quando aplicável.</p>'+
 '<p style="font-size:11px;line-height:1.6;color:#708198;margin:0">Informações obtidas na Central de Auditoria a partir dos chamados sincronizados do Movidesk. Os registros refletem a situação no momento da consulta.</p>'+
 '</div></div>'+
 '<p style="max-width:780px;margin:13px auto 0;text-align:center;font-size:10px;color:#7b8ea6">ARQUEM SISTEMAS · Gestão de Qualidade · Acompanhamento de demandas</p>'+
 '</body></html>';

 return {subject,text,html,tickets:normalized};
}
