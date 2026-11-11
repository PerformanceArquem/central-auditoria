// Composição segura de cobranças de chamados abertos, sem envio automático.
type TicketRow=Record<string,any>;
export function composeTicketCharge(rows:TicketRow[],recipient:string,body?:string,options:{includeGuidance?:boolean}={}){
 if(!Array.isArray(rows)||rows.length<1||rows.length>20)throw Error('Selecione de 1 a 20 chamados.');
 if(!/^[^@\s]+@arquem\.com\.br$/i.test(recipient))throw Error('Informe um destinatário corporativo @arquem.com.br.');
 const clean=(v:unknown,max=230)=>String(v??'').replace(/[\x00-\x1f\x7f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
 const esc=(v:unknown)=>clean(v,500).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
 const escBody=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
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
 // Orientacoes operacionais: criterios verificaveis. Nunca avaliam personalidade,
 // esforco ou desempenho individual e nao inferem que falta de acao = falta de horas.
 const guidance:{evidence:string;action:string}[]=[];
 const now=Date.now(),daysSince=(value:string)=>{
   const ms=Date.parse(value);
   return Number.isFinite(ms)?Math.max(0,Math.floor((now-ms)/86400000)):null;
 };
 const idle=normalized.map(t=>({t,days:daysSince(t.last)}))
   .filter(x=>x.days!==null&&x.days>=7).sort((a,b)=>(b.days||0)-(a.days||0));
 if(idle.length){
   const examples=idle.slice(0,3).map(x=>'#'+x.t.id+' ('+x.days+' dias)').join(', ');
   guidance.push({evidence:idle.length+' chamado(s) sem atualizacao registrada ha 7 dias ou mais: '+examples+'.',
     action:'Revisar o andamento com a equipe, registrar o proximo passo, quem depende da resposta e uma data realista para nova atualizacao.'});
 }
 const withoutOwner=normalized.filter(t=>/^nao atribuido|^sem responsavel|^nao informado/i.test(t.owner.normalize('NFD').replace(/[\u0300-\u036f]/g,'')));
 if(withoutOwner.length)guidance.push({evidence:withoutOwner.length+' chamado(s) sem responsavel identificado na consulta.',
   action:'Conferir o responsavel atual no Movidesk e alinhar a distribuicao antes de definir prazos.'});
 const missingDate=normalized.filter(t=>!t.last||daysSince(t.last)===null);
 if(missingDate.length)guidance.push({evidence:missingDate.length+' chamado(s) com data de atualizacao indisponivel ou invalida.',
   action:'Verificar a sincronizacao e os registros do chamado antes de tirar conclusoes sobre inatividade.'});
 const sectors=new Set(normalized.map(t=>t.sector).filter(t=>t!=='Sem setor'));
 if(sectors.size>1)guidance.push({evidence:'A selecao inclui '+sectors.size+' setores diferentes.',
   action:'Organizar o acompanhamento por setor, confirmar prioridades e dependencias entre as equipes.'});
 // Toda orientacao e provisoria, limitada aos chamados selecionados e nao a
 // qualquer suposto perfil psicologico ou rendimento do colaborador.
 if(!guidance.length)guidance.push({evidence:'Os chamados selecionados nao apresentaram esses alertas objetivos na consulta.',
   action:'Confirmar prioridades, eventuais dependencias e previsoes com as pessoas envolvidas.'});
 const includeGuidance=options.includeGuidance===true;
 const guidanceText=includeGuidance?'DICAS DO MANAGER — APOIO AO ACOMPANHAMENTO\n'+
   guidance.map((g,i)=>(i+1)+'. Observacao: '+g.evidence+'\n   Sugestao: '+g.action).join('\n\n')+
   '\n\nAnalise limitada aos chamados selecionados e aos registros sincronizados. Ausencia de atualizacao nao significa ausencia de trabalho. Valide com a equipe antes de adotar medidas.':'';
 const guidanceHtml=includeGuidance?
   '<div style="padding:20px 26px;border-top:1px solid #dce5f2;background:#f4f8ff">'+
   '<h2 style="font-size:14px;color:#173454;margin:0 0 8px">Dicas do Manager · Orientacoes para organizar o acompanhamento</h2>'+
   '<p style="font-size:11px;line-height:1.6;color:#5b6d86;margin:0 0 12px">Sugestoes baseadas apenas nos chamados selecionados e na informacao sincronizada.</p>'+
   guidance.map((g,i)=>'<div style="padding:10px 0;border-bottom:1px solid #dae5f2;font-size:12px;line-height:1.6">'+
     '<strong style="color:#173454">Ponto '+(i+1)+'</strong><div><b>Observacao:</b> '+esc(g.evidence)+'</div>'+
     '<div><b>Sugestao pratica:</b> '+esc(g.action)+'</div></div>').join('')+
   '<p style="font-size:10px;color:#60738b;margin:12px 0 0">Orientacoes para apoio, nao avaliacao individual. Ausencia de atualizacao nao comprova ausencia de trabalho.</p></div>':'';
 const lines=normalized.map((t,i)=>(i+1)+'. Chamado #'+t.id+' — '+t.subject+'\n   Cliente: '+t.client+' | Setor: '+t.sector+' | Responsável: '+t.owner+'\n   Status: '+t.status+' | Última atualização: '+(t.last||'Não informada')+'\n   '+t.url);
 const text=message+'\n\nCHAMADOS PARA ACOMPANHAMENTO\n'+lines.join('\n\n')+
 (includeGuidance?'\n\n'+guidanceText:'')+'\n\nFonte: Central de Auditoria / Movidesk. Os status refletem a consulta atual.';

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
 '<div style="padding:18px 0 12px;font-size:13px;line-height:1.75;color:#34475d;white-space:pre-line">'+escBody(message)+'</div>'+
 '<h2 style="font-size:15px;color:#173454;margin:15px 0 10px;border-left:4px solid #2388c8;padding-left:10px">Chamados selecionados</h2>'+
 '</div>'+
 '<div style="padding:0 18px 22px;overflow-x:auto">'+
 '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;min-width:620px">'+
 '<thead style="background:#eaf2fa"><tr>'+header('Chamado')+header('Cliente / setor')+header('Assunto')+header('Responsável / status')+'</tr></thead>'+
 '<tbody>'+table+'</tbody></table></div>'+
 guidanceHtml+
 '<div style="padding:18px 28px;background:#f6f9fc;border-top:1px solid #e2eaf3">'+
 '<p style="font-size:12px;line-height:1.6;color:#354e6a;margin:0 0 7px"><strong>Próximo encaminhamento solicitado:</strong> informar andamento, responsável e previsão realista de retorno quando aplicável.</p>'+
 '<p style="font-size:11px;line-height:1.6;color:#708198;margin:0">Informações obtidas na Central de Auditoria a partir dos chamados sincronizados do Movidesk. Os registros refletem a situação no momento da consulta.</p>'+
 '</div></div>'+
 '<p style="max-width:780px;margin:13px auto 0;text-align:center;font-size:10px;color:#7b8ea6">ARQUEM SISTEMAS · Gestão de Qualidade · Acompanhamento de demandas</p>'+
 '</body></html>';

 return {subject,text,html,tickets:normalized,guidance:includeGuidance?guidance:[]};
}
