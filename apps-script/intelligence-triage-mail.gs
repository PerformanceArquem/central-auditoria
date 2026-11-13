/* Extensão isolada. Chamado somente após autenticação pelo doPost existente. */
function arquemTriageAction_(d) {
  try{return arquemTriageActionInner_(d);}catch(e){
    console.error('Triagem: '+String(e.message));
    return {sucesso:false,erro:'Triagem: '+String(e.message).slice(0,240)};
  }
}
function arquemTriageActionInner_(d) {
  if(!d.report||d.report.schema!=='arquem-triage-v1'||!Array.isArray(d.report.items))throw Error('Relatório de triagem inválido');
  const p=d.report;
  if(p.items.length>500||p.metrics.total!==p.items.length)throw Error('Lista integral inconsistente');
  const expected=['zanona@arquem.com.br','inteligencia.gerencia@arquem.com.br','canestraro@arquem.com.br'];
  if(d.action==='triage_validate') {
    if(MailApp.getRemainingDailyQuota()<3)throw Error('Cota corporativa insuficiente para os três destinatários');
    const files=arquemTriageAttachments_(p);
    return {sucesso:true,sent:false,mailReady:true,rows:p.items.length,pdfBytes:files[0].getBytes().length,xlsxBytes:files[1].getBytes().length,
      files:files.map(x=>({name:x.getName(),mime:x.getContentType(),base64:Utilities.base64Encode(x.getBytes())}))};
  }
  if(d.action!=='triage_send'||expected.indexOf(d.email)<0||d.dispatchKey!=='intelligence-triage:'+p.date+':'+d.email)throw Error('Destinatário/chave inválido');
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {
    const digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,d.dispatchKey)).replace(/=/g,'').slice(0,20);
    const marker='ARQTRIAGE'+digest,prop='TRIAGE_'+digest;
    const props=PropertiesService.getScriptProperties();
    const previous=props.getProperty(prop);
    if(previous&&previous.indexOf('sent:')===0)return {sucesso:true,anexos:2,providerId:previous.slice(5),accepted:true,deduplicated:true};
    if(props.getProperty(prop))throw Error('Disparo já iniciado: conferir Gmail antes de repetir');
    if(!Array.isArray(d.files)||d.files.length!==2)throw Error('Anexos previamente validados ausentes');
    const attachments=d.files.map(x=>Utilities.newBlob(Utilities.base64Decode(x.base64),x.mime,x.name));
    arquemTriageCheckBlobs_(attachments);
    props.setProperty(prop,new Date().toISOString());
    MailApp.sendEmail({to:d.email,subject:d.assunto,body:d.texto+'\n\nRegistro: '+marker,name:'Central de Auditoria',htmlBody:d.html+'<p style="color:#777;font-size:10px">Registro: '+marker+'</p>',attachments:attachments});
    const providerId='mailapp:'+digest;
    props.setProperty(prop,'sent:'+providerId);
    return {sucesso:true,anexos:2,providerId:providerId,accepted:true};
  }finally{lock.releaseLock();}
}
function arquemTriageCheckBlobs_(files){
  if(files.length!==2||files[0].getBytes().length<1000||files[1].getBytes().length<1000)throw Error('Anexos incompletos');
  if(files[0].getDataAsString().slice(0,4)!=='%PDF'||files[1].getBytes()[0]!==80||files[1].getBytes()[1]!==75)throw Error('Assinatura PDF/XLSX inválida');
  if(files.reduce((n,x)=>n+x.getBytes().length,0)>18*1024*1024)throw Error('Anexos excedem limite');
}
function arquemTriageAttachments_(p){
 const ids=[];
 try{
  const template=PropertiesService.getScriptProperties().getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID');
  if(!template)throw Error('Modelo corporativo ausente');
  const copy=DriveApp.getFileById(template).makeCopy('ARQUEM_Triagem_temporario');ids.push(copy.getId());
  const doc=DocumentApp.openById(copy.getId()),body=doc.getBody();body.clear();body.setAttributes({[DocumentApp.Attribute.FONT_FAMILY]:'Arial',[DocumentApp.Attribute.FONT_SIZE]:10});
  body.appendParagraph('ARQUEM | Central de Auditoria').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(p.title).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Referência: '+p.reference+'\nSincronização: '+p.syncedAt+'\n'+p.criteria);
  body.appendParagraph('Chamados: '+p.metrics.total+' | Sem previsão: '+p.metrics.withoutForecast+' | Maior espera: '+p.metrics.maxQueueDays+' dias | Média: '+p.metrics.averageQueueDays+' dias');
  body.appendParagraph('Tipos: '+Object.keys(p.metrics.types).map(k=>k+': '+p.metrics.types[k]).join(' | '));
  p.items.forEach((x,i)=>{
    if(i>0)body.appendHorizontalRule();
    const title=body.appendParagraph('#'+x.id+' · '+x.type+' · '+x.queueDays+' dias na fila');title.editAsText().setBold(true);title.editAsText().setLinkUrl(0,String(x.id).length,x.url);
    body.appendParagraph(x.subject);
    body.appendParagraph('Cliente: '+x.client+'\nResponsável: '+x.owner+' | Status: '+x.status+'\nEntrada na equipe: '+x.queueSince+'\nAbertura: '+x.opened+' | Previsão: '+(x.forecast||'Sem previsão')+'\nÚltima atualização: '+x.lastUpdate);
    body.appendParagraph(x.url).editAsText().setLinkUrl(x.url);
  });
  if(!p.items.length)body.appendParagraph('Nenhum chamado atende aos critérios nesta referência.');
  doc.saveAndClose();
  const pdf=copy.getAs(MimeType.PDF).setName('ARQUEM_Triagem_Inteligencia_'+p.date+'.pdf');
  const ss=SpreadsheetApp.create('ARQUEM_Triagem_temporario');ids.push(ss.getId());
  const summary=ss.getSheets()[0];summary.setName('Resumo');
  arquemSheet_(summary,['Indicador','Resultado'],[['Relatório',p.title],['Referência',p.reference],['Sincronização',p.syncedAt],['Critério',p.criteria],['Fonte',p.source],['Chamados',p.metrics.total],['Sem previsão',p.metrics.withoutForecast],['Maior espera (dias)',p.metrics.maxQueueDays],['Média (dias)',p.metrics.averageQueueDays]].concat(Object.keys(p.metrics.types).map(k=>[k,p.metrics.types[k]])));
  summary.setColumnWidth(1,210);summary.setColumnWidth(2,620);summary.getDataRange().setWrap(true);
  const rows=p.items.map(x=>[x.id,x.type,x.client,x.subject,x.owner,x.status,x.queueDays,x.elapsedDays,x.queueSince,x.opened,x.forecast||'Sem previsão',x.lastUpdate,x.url]);
  const sheet=arquemCreateSheet_(ss,'Chamados',['Chamado','Tipo','Cliente','Assunto','Responsável','Status','Dias inteiros','Dias decorridos','Entrada na equipe','Abertura','Previsão','Última atualização','Link Movidesk'],rows);
  sheet.setFrozenRows(1);sheet.setColumnWidth(3,220);sheet.setColumnWidth(4,460);sheet.getDataRange().setWrap(true);
  if(rows.length){sheet.getRange(2,1,rows.length,1).setRichTextValues(p.items.map(x=>[SpreadsheetApp.newRichTextValue().setText('#'+x.id).setLinkUrl(x.url).build()]));sheet.getRange(1,1,rows.length+1,13).createFilter();}
  const history=[];p.items.forEach(x=>x.history.forEach(h=>history.push([x.id,h.changedDate,h.team||'Sem equipe',h.owner])));
  arquemCreateSheet_(ss,'Histórico de equipes',['Chamado','Alteração UTC','Equipe','Responsável'],history);
  SpreadsheetApp.flush();
  const r=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+ss.getId()+'/export?mimeType='+encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
  if(r.getResponseCode()!==200)throw Error('Exportação Excel HTTP '+r.getResponseCode());
  const xlsx=r.getBlob().setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').setName('ARQUEM_Triagem_Inteligencia_'+p.date+'.xlsx');
  const files=[pdf,xlsx];arquemTriageCheckBlobs_(files);return files;
 }finally{ids.forEach(id=>{try{DriveApp.getFileById(id).setTrashed(true);}catch(_){}});}
}

