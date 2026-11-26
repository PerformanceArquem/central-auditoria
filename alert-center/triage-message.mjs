const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const br=value=>value.split('-').reverse().join('/');
export function composeTriageDraft({rows,threshold,referenceTime,now}){
 const clock=Date.parse(now),reference=Date.parse(referenceTime);
 if(!Array.isArray(rows)||!Number.isInteger(threshold)||threshold<1||threshold>365||!Number.isFinite(clock)||!Number.isFinite(reference)||clock<reference||clock-reference>3600000)throw Error('Consulte a triagem novamente antes de preparar a prévia.');
 const ids=new Set(),eligible=[],review=[];let waiting=0,outside=0;
 for(const row of rows){
 if(typeof row.ticketId!=='string'||!/^\d+$/.test(row.ticketId)||ids.has(row.ticketId))throw Error('Seleção inválida ou duplicada.');
 ids.add(row.ticketId);
 const sync=Date.parse(row.syncedAt);
 const fresh=Number.isFinite(sync)&&sync<=clock&&clock-sync<=24*3600000;
 if(row.reason==='outside-triage'){outside++;continue;}
 if(row.reason==='below-threshold'&&fresh){waiting++;continue;}
 if(row.eligible===true&&row.reason==='threshold-reached'&&fresh&&validDay(row.enteredDate)&&Number.isInteger(row.businessDays)&&row.businessDays>=threshold){
 eligible.push(row);
 }else review.push(row.ticketId);
 }
 eligible.sort((a,b)=>b.businessDays-a.businessDays||a.ticketId.localeCompare(b.ticketId));
 const displayTime=new Date(reference).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
 const subject='Ticket Manager | Verificação de chamados na triagem da Inteligência';
 const lines=['ARQUEM SISTEMAS · CENTRAL DE AUDITORIA','TICKET MANAGER','PRÉVIA · NENHUM ENVIO','Destinatário previsto: gestão da Produção','',subject,
 'Referência da consulta: '+displayTime,'Regra: Inteligência + Em Análise · limite de '+threshold+' dias úteis.','',
 'Olá! Por gentileza, avalie o encaminhamento dos chamados abaixo, considerando as prioridades e as informações disponíveis. Se necessário, atualize o responsável e a previsão de tratamento.',''];
 if(eligible.length)for(const row of eligible){
 const subject=String(row.subject||'Assunto não informado').replace(/[\r\n\t]+/g,' ').slice(0,240);
 const owner=String(row.ownerName||(row.ownerId?'ID '+row.ownerId:'Não identificado')).replace(/[\r\n\t]+/g,' ').slice(0,160);
 const sector=String(row.sector||'Inteligência').replace(/[\r\n\t]+/g,' ').slice(0,160);
 lines.push('#'+row.ticketId+' | '+subject+' | Setor: '+sector+' | Responsável: '+owner+' | Desde '+br(row.enteredDate)+' | '+row.businessDays+' dias úteis');
 }else lines.push('Nenhum chamado com histórico validado atingiu o limite nesta consulta.');
 lines.push('','Total para avaliação: '+eligible.length+'.');
 if(review.length)lines.push('Revisão de dados, fora da relação para encaminhamento: '+review.map(id=>'#'+id).join(', ')+'.');
 lines.push('','A ausência de registros não comprova ausência de trabalho.','Central de Auditoria · Gestão da Qualidade','Prévia local; destinatário e envio real não foram autorizados por esta operação.');
 return {subject,text:lines.join('\n'),eligibleCount:eligible.length,reviewCount:review.length,waitingCount:waiting,outsideCount:outside};
}
