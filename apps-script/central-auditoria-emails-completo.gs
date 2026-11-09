/**
 * Central de Auditoria — arquivo completo para instalação manual no Apps Script.
 * Este arquivo NÃO é uma implantação. Não colar junto a outro doPost sem
 * remover/substituir a função antiga; preservar MAIL_SECRET no Script Properties.
 * Anexos só serão enviados após ativação da flag no backend e confirmação
 * da propriedade ARQUEM_ATTACHMENTS_VALIDATED=true após teste visual.
 */
function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const segredo = props.getProperty('MAIL_SECRET');
    if (!segredo) throw new Error('Segredo não configurado');
    const dados = JSON.parse(e && e.postData && e.postData.contents || '{}');
    if (dados.token !== segredo) throw new Error('Acesso não autorizado');

    if (dados.action === 'capabilities') {
      const generatorPresent = typeof arquemCreateReportAttachments_ === 'function';
      const templateId = props.getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID');
      const approved = props.getProperty('ARQUEM_ATTACHMENTS_VALIDATED') === 'true';
      let templateAvailable = false;
      if (templateId && generatorPresent) {
        try {
          templateAvailable = DriveApp.getFileById(templateId).getMimeType() === MimeType.GOOGLE_DOCS;
        } catch (ex) {
          console.error('Modelo não acessível: ' + ex.message);
        }
      }
      return resposta({
        sucesso: true, attachmentsVersion: 'arquem-1',
        formats: generatorPresent ? ['pdf','xlsx'] : [],
        paperTemplateConfigured: templateAvailable && approved
      });
    }

    const email = String(dados.email || '').trim();
    const assunto = String(dados.assunto || '').trim();
    const texto = String(dados.texto || '').trim();
    const html = String(dados.html || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Destinatário inválido');
    if (!assunto || !texto) throw new Error('Relatório incompleto');
    if (texto.length > 50000 || html.length > 200000) throw new Error('Relatório muito extenso');
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Limite diário de envio atingido');

    let anexos = [];
    if (dados.reportData !== undefined) {
      if (props.getProperty('ARQUEM_ATTACHMENTS_VALIDATED') !== 'true') {
        throw new Error('Anexos ainda não validados no Apps Script');
      }
      if (!props.getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID')) {
        throw new Error('Modelo timbrado não configurado');
      }
      if (typeof arquemCreateReportAttachments_ !== 'function' ||
          !dados.reportData || dados.reportData.schema !== 'arquem-mail-v1') {
        throw new Error('Dados ou gerador de anexos inválidos');
      }
      anexos = arquemCreateReportAttachments_(dados.reportData);
      if (!Array.isArray(anexos) || anexos.length !== 2) {
        throw new Error('É necessário gerar PDF e Excel');
      }
    }
    MailApp.sendEmail({
      to: email, subject: assunto, body: texto, name:'Central de Auditoria',
      ...(html ? {htmlBody: html} : {}),
      ...(anexos.length ? {attachments: anexos} : {})
    });
    return resposta({sucesso:true,anexos:anexos.length});
  } catch (erro) {
    console.error('Falha no processamento: '+erro.message);
    return resposta({sucesso:false,erro:'Não foi possível processar a solicitação.'});
  }
}
function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function testarCapacidadesSemEnvio() {
  const secret=PropertiesService.getScriptProperties().getProperty('MAIL_SECRET');
  if(!secret) throw new Error('MAIL_SECRET ausente');
  const e={postData:{contents:JSON.stringify({token:secret,action:'capabilities'})}};
  const r=JSON.parse(doPost(e).getContent());
  console.log(JSON.stringify(r));
  return r;
}

// A extensão abaixo contém arquemCreateReportAttachments_ e teste sem envio.

/**
 * ARQUEM · Extensão para o Apps Script atual de envio Gmail.
 * NÃO substituir a função doPost existente nem sua autenticação.
 *
 * Integração manual no Apps Script já implantado:
 *
 * 1) Em seu doPost(e), DEPOIS de validar o token atual, acrescente:
 *    if (dados.action === 'capabilities') {
 *      const templateId=PropertiesService.getScriptProperties()
 *        .getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID');
 *      return ContentService.createTextOutput(JSON.stringify({
 *        sucesso: true, attachmentsVersion: 'arquem-1', formats: ['pdf','xlsx'],
 *        paperTemplateConfigured: Boolean(templateId)
 *      })).setMimeType(ContentService.MimeType.JSON);
 *    }
 *
 * 2) Na mesma rotina, depois de autenticar e antes de enviar:
 *    const anexos = dados.reportData
 *      ? arquemCreateReportAttachments_(dados.reportData) : [];
 *
 * 3) Passe attachments: anexos em GmailApp.sendEmail(..., {htmlBody: ...,attachments: anexos}).
 *    NÃO misturar com outras listas de anexos sem combinar explicitamente.
 *    Responda JSON {sucesso:true, anexos:anexos.length}.
 *
 * 4) Configure opcionalmente propriedade ARQUEM_PAPEL_TIMBRADO_DOC_ID
 *    com ID de um Google Doc de modelo corporativo. Se o documento de
 *    referência possuir logotipo/marca d'água, a cópia preservará a arte.
 *    O modelo deve ser acessível à conta executora do Apps Script.
 *
 * 5) Habilite scopes Drive, Docs, Sheets e UrlFetchApp. Deploy nova versão
 *    do Web App e faça verificação de capabilities antes de ativar a flag
 *    REPORT_ATTACHMENTS_ENABLED=true no Supabase.
 *
 * ATENÇÃO: sem template, o PDF contém cabeçalho estilizado, mas NÃO
 * uma marca d'água gráfica. Nunca afirmar que a marca d'água foi aplicada
 * enquanto ARQUEM_PAPEL_TIMBRADO_DOC_ID não estiver configurado.
 *
 * Segurança: dados vêm do backend já filtrados por setor/destinatário.
 * Não transformar entradas em fórmulas de planilha. Arquivos temporários
 * criados na conta executora são enviados à lixeira no finally.
 */

/**
 * Teste local do Apps Script — não envia e-mail e não usa dados reais.
 * No editor do Apps Script, selecione arquemTesteAnexosSemEnvio e clique Executar.
 * O teste cria/exporta arquivos temporários e os envia à lixeira.
 * Exige permissões Drive, Docs, Sheets e UrlFetch.
 *
 * Só anuncie o recurso "capabilities" depois deste teste passar e depois
 * de validar a opção attachments no fluxo real de envio com um teste autorizado.
 */
function arquemTesteAnexosSemEnvio() {
  const packet={
    schema:'arquem-mail-v1',title:'Relatório de validação — Produção',
    from:'2026-11-02',to:'2026-11-08',partial:true,historicalIncomplete:true,
    metrics:{minutes:5962,appointments:171,tickets:40},
    collaborators:[{name:'Colaborador demonstrativo',sector:'Produção - CPO',
      minutes:480,minimumMinutes:384,targetMinutes:480,minimumGap:0,targetGap:0,
      ruleSource:'Referência padrão'}],
    daily:[{date:'2026-11-06',person:'Colaborador demonstrativo',sector:'Produção - CPO',
      minutes:480,referenceMinutes:480,minimumMinutes:384,status:'Meta atingida'}],
    tickets:[{id:'100769',client:'Empresa demonstrativa',owner:'Responsável demonstrativo',
      status:'Fila',ageDays:45,url:'https://arquem.movidesk.com/Ticket/Edit/100769'}],
    customers:[{name:'Empresa demonstrativa',minutes:5962,tickets:9,appointments:171},
      {name:'Outra empresa demonstrativa',minutes:1820,tickets:3,appointments:22}],
    activities:[{name:'Correção',minutes:3200},{name:'Melhoria',minutes:2762}]
  };
  if(arquemH_(3964)!=='66:04:00' ||
     Math.abs(arquemExcelHora_(3964)*1440-3964)>0.000001)
    throw new Error('Formato de horas incorreto');
  const files=arquemCreateReportAttachments_(packet);
  if(files.length!==2)throw new Error('Esperados 2 anexos');
  const pdf=files.find(b=>b.getContentType()==='application/pdf');
  const xlsx=files.find(b=>b.getName().endsWith('.xlsx'));
  if(!pdf||!xlsx||pdf.getBytes().length<2000||xlsx.getBytes().length<1500)
    throw new Error('Arquivo inválido ou vazio: confira permissões e exportações');
  const result={ok:true,sent:false,files:files.map(b=>({
    name:b.getName(),type:b.getContentType(),bytes:b.getBytes().length
  }))};
  console.log(JSON.stringify(result));
  return result;
}

/**
 * Integração no doPost existente: depois de validar o segredo atual,
 * faça a checagem de capacidade antes da rotina que envia e-mails.
 * NÃO ative o anúncio de capacidades se o teste local não passou.
 *
 * const data=JSON.parse(e.postData.contents);
 * if(!validarTokenDoProjeto_(data.token)) return respostaDeErroExistente_();
 * if(data.action==='capabilities') return ContentService.createTextOutput(
 *   JSON.stringify({sucesso:true,attachmentsVersion:'arquem-1',formats:['pdf','xlsx'],
 *     paperTemplateConfigured:Boolean(PropertiesService.getScriptProperties().getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID'))})
 * ).setMimeType(ContentService.MimeType.JSON);
 *
 * // Depois, no bloco de envio já autorizado:
 * const anexos=data.reportData?arquemCreateReportAttachments_(data.reportData):[];
 * GmailApp.sendEmail(data.email,data.assunto,data.texto,{
 *   htmlBody:data.html||undefined,attachments:anexos
 * });
 * return ContentService.createTextOutput(JSON.stringify({
 *   sucesso:true,anexos:anexos.length
 * })).setMimeType(ContentService.MimeType.JSON);
 *
 * Reutilize a validação de token e o tratamento de erros do seu doPost atual.
 * Não copie funções de autenticação fictícias deste comentário.
 */
function arquemCreateReportAttachments_(packet) {
  if (!packet || packet.schema !== 'arquem-mail-v1') throw new Error('Pacote de relatório inválido');
  const title = String(packet.title || 'Relatório gerencial').slice(0,120);
  const from = String(packet.from || ''), to = String(packet.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('Datas inválidas');
  const rows = [
    packet.collaborators || [], packet.daily || [], packet.tickets || [],
    packet.customers || [], packet.activities || []
  ];
  if (rows.some(arr => !Array.isArray(arr) || arr.length > 500))
    throw new Error('Limite de dados excedido para anexos');
  if (rows.reduce((sum,arr)=>sum+arr.length,0)>950)
    throw new Error('Quantidade total de linhas excede o limite seguro dos anexos');
  const keep = [];
  try {
    const pdf = arquemPdf_(packet, keep);
    const xlsx = arquemXlsx_(packet, keep);
    const base = 'ARQUEM_' + arquemFilename_(title) + '_' + from + '_a_' + to;
    pdf.setName(base + '.pdf');
    xlsx.setName(base + '.xlsx');
    const bytes=pdf.getBytes().length+xlsx.getBytes().length;
    if(bytes>18*1024*1024)throw new Error('Arquivos maiores que 18 MB: reduzir período do relatório');
    return [pdf, xlsx];
  } finally {
    keep.forEach(id => { try { DriveApp.getFileById(id).setTrashed(true); } catch (_) {} });
  }
}

function arquemFilename_(str) {
  return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,55);
}
function arquemCell_(v) {
  const s = String(v == null ? '' : v);
  // Sheets string cells can contain formula-looking text; neutralize it.
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s.slice(0,600);
}
function arquemH_(minutes) {
  const m = Math.max(0,Math.round(Number(minutes)||0));
  return String(Math.floor(m/60)).padStart(2,'0') +
    ':' + String(m%60).padStart(2,'0') + ':00';
}
// Excel: número em frações de dia, não texto. Permite SOMA e mantém
// horas acumuladas acima de 24h com o formato [h]:mm:ss.
function arquemExcelHora_(minutes) {
  return Math.max(0,Math.round(Number(minutes)||0))/1440;
}
function arquemFormatarHoras_(sheet,columns,totalRows) {
  if(!totalRows)return;
  columns.forEach(col=>sheet.getRange(2,col,totalRows,1).setNumberFormat('[h]:mm:ss'));
}
function arquemAddHeading_(body, str, style) {
  const p = body.appendParagraph(String(str));
  p.setHeading(style || DocumentApp.ParagraphHeading.HEADING2);
  p.editAsText().setForegroundColor('#173b65');
  return p;
}
function arquemPdf_(p, keep) {
  const prop=PropertiesService.getScriptProperties().getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID');
  let file;
  if (prop) file=DriveApp.getFileById(prop).makeCopy('ARQUEM_relatorio_temporario_'+Date.now());
  else file=DriveApp.getFileById(DocumentApp.create('ARQUEM_relatorio_temporario_'+Date.now()).getId());
  keep.push(file.getId());
  const doc=DocumentApp.openById(file.getId()), body=doc.getBody();
  if(!prop){
    const logo=body.appendParagraph('ARQUEM SISTEMAS');
    logo.setHeading(DocumentApp.ParagraphHeading.TITLE);
    logo.editAsText().setForegroundColor('#173b65');
    body.appendParagraph('CENTRAL DE AUDITORIA  |  RELATÓRIO GERENCIAL').editAsText().setForegroundColor('#218c89');
    body.appendHorizontalRule();
  }
  arquemAddHeading_(body,p.title,DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Referência: '+p.from+' a '+p.to+
    (p.partial?'  |  DADOS PARCIAIS — sincronização em andamento':''));
  const m=p.metrics||{};
  arquemAddHeading_(body,'Resumo executivo');
  body.appendParagraph('Horas apontadas: '+arquemH_(m.minutes)+'  |  Apontamentos: '+
    (m.appointments||0)+'  |  Chamados trabalhados: '+(m.tickets||0));
  if(p.historicalIncomplete){
    const warning=body.appendParagraph('ATENÇÃO: histórico do Movidesk em importação. Comparativos anuais são preliminares.');
    warning.editAsText().setForegroundColor('#a36618').setBold(true);
  }
  if ((p.collaborators||[]).length) {
    arquemAddHeading_(body,'Colaboradores · horas e jornada');
    const lines=[['Colaborador','Setor','Horas','Meta mínima','Jornada','Falta mínimo','Falta jornada']];
    p.collaborators.slice(0,70).forEach(x=>lines.push([
      String(x.name||''),String(x.sector||''),arquemH_(x.minutes),arquemH_(x.minimumMinutes),
      arquemH_(x.targetMinutes),arquemH_(x.minimumGap),arquemH_(x.targetGap)]));
    body.appendTable(lines);
  }
  if ((p.daily||[]).length) {
    arquemAddHeading_(body,'Horas por colaborador · dia a dia');
    const rows=[['Data','Colaborador','Setor','Horas','Jornada ref.','Meta mínima ref.']];
    p.daily.slice(0,90).forEach(x=>rows.push([
      String(x.date||''),String(x.person||''),String(x.sector||''),
      arquemH_(x.minutes),arquemH_(x.referenceMinutes),arquemH_(x.minimumMinutes)
    ]));
    body.appendTable(rows);
    if(p.daily.length>90)body.appendParagraph('Exibindo os primeiros 90 de '+p.daily.length+' registros diários agrupados.');
  }
  if ((p.customers||[]).length){
    arquemAddHeading_(body,'Empresas que mais consomem tempo');
    body.appendTable([['Empresa','Horas','Chamados']].concat(
      p.customers.slice(0,30).map(x=>[String(x.name||''),arquemH_(x.minutes),String(x.tickets||0)])));
  }
  if ((p.tickets||[]).length){
    arquemAddHeading_(body,'Chamados que exigem atenção');
    const ticketRows=p.tickets.slice(0,65);
    const ticketTable=body.appendTable([['Chamado','Cliente','Responsável','Status','Tempo']].concat(
      ticketRows.map(x=>[
        '#'+String(x.id||''),String(x.client||''),String(x.owner||''),
        String(x.status||''),String(x.ageDays==null?'—':x.ageDays+' dias')
      ])));
    ticketRows.forEach((x,i)=>{
      const id=String(x.id||'');
      if(/^\d+$/.test(id)){
        ticketTable.getCell(i+1,0).editAsText()
          .setLinkUrl('https://arquem.movidesk.com/Ticket/Edit/'+id)
          .setForegroundColor('#2467a8');
      }
    });
    body.appendParagraph('Clique no número do chamado no PDF para abrir o Movidesk.');
  }
  arquemAddHeading_(body,'Observações metodológicas');
  body.appendParagraph('Dados da Central de Auditoria/Movidesk sincronizados. Horas apontadas não são controle de ponto. '+
    'A ausência de registros não comprova ausência de trabalho. Categorias de risco podem se sobrepor.');
  doc.saveAndClose();
  return DriveApp.getFileById(file.getId()).getAs(MimeType.PDF);
}
function arquemXlsx_(p, keep) {
  const ss=SpreadsheetApp.create('ARQUEM_planilha_temporaria_'+Date.now());
  keep.push(ss.getId());
  const first=ss.getSheets()[0]; first.setName('Resumo');
  arquemSheet_(first,
    ['Indicador','Resultado'],
    [['Relatório',p.title],['Início',p.from],['Fim',p.to],
     ['Horas apontadas',arquemExcelHora_(p.metrics&&p.metrics.minutes)],
     ['Apontamentos',Number(p.metrics&&p.metrics.appointments)||0],
     ['Chamados trabalhados',Number(p.metrics&&p.metrics.tickets)||0],
     ['Conciliação',p.partial?'Dados parciais':'Dados disponíveis'],
     ['Histórico',p.historicalIncomplete?'Comparativo anual PRELIMINAR':'Verificar cobertura']]);
  first.getRange('B4').setNumberFormat('[h]:mm:ss');
  const people=arquemCreateSheet_(ss,'Colaboradores',
    ['Colaborador','Setor','Horas','Mínimo','Jornada','Falta mínimo','Falta jornada','Origem'],
    (p.collaborators||[]).map(x=>[x.name,x.sector,arquemExcelHora_(x.minutes),arquemExcelHora_(x.minimumMinutes),
     arquemExcelHora_(x.targetMinutes),arquemExcelHora_(x.minimumGap),arquemExcelHora_(x.targetGap),x.ruleSource||'Padrão']));
  arquemFormatarHoras_(people,[3,4,5,6,7],(p.collaborators||[]).length);
  const daySheet=arquemCreateSheet_(ss,'Dia a dia',
    ['Data','Colaborador','Setor','Horas','Jornada','Mínimo','Situação'],
    (p.daily||[]).map(x=>[x.date,x.person,x.sector,arquemExcelHora_(x.minutes),
      arquemExcelHora_(x.referenceMinutes),arquemExcelHora_(x.minimumMinutes),x.status]));
  arquemFormatarHoras_(daySheet,[4,5,6],(p.daily||[]).length);
  const ticketSheet=arquemCreateSheet_(ss,'Chamados',
    ['Chamado','Cliente','Responsável','Status','Idade (dias)','Link Movidesk'],
    (p.tickets||[]).map(x=>['#'+String(x.id||''),x.client,x.owner,x.status,x.ageDays,x.url]));
  if ((p.tickets||[]).length) {
    const range=ticketSheet.getRange(2,6,Math.min((p.tickets||[]).length,500),1);
    range.setFontColor('#2467a8');
  }
  const cust=arquemCreateSheet_(ss,'Empresas',
    ['Empresa','Horas','Chamados','Apontamentos'],
    (p.customers||[]).map(x=>[x.name,arquemExcelHora_(x.minutes),x.tickets,x.appointments]));
  arquemFormatarHoras_(cust,[2],(p.customers||[]).length);
  const acts=arquemCreateSheet_(ss,'Atividades',
    ['Atividade','Horas'],
    (p.activities||[]).map(x=>[x.name,arquemExcelHora_(x.minutes)]));
  arquemFormatarHoras_(acts,[2],(p.activities||[]).length);
  if((p.customers||[]).length>1){
    // Chart values use numeric hours to preserve comparability; displayed HHhMM remains in the table.
    cust.getRange(1,5).setValue('Horas (numérico)');
    (p.customers||[]).forEach((x,i)=>cust.getRange(i+2,5).setValue(Number(x.minutes||0)/60));
    const count=Math.min((p.customers||[]).length,12);
    const chart=cust.newChart().setChartType(Charts.ChartType.BAR)
      .addRange(cust.getRange(1,1,count+1,1))
      .addRange(cust.getRange(1,5,count+1,1))
      .setPosition(2,7,0,0)
      .setOption('title','Empresas que mais consomem tempo — horas')
      .setOption('legend',{position:'none'})
      .build();
    cust.insertChart(chart);
  }
  SpreadsheetApp.flush();
  const url='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(ss.getId())+
    '/export?mimeType='+encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const response=UrlFetchApp.fetch(url,{
    headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},
    muteHttpExceptions:true
  });
  if(response.getResponseCode()!==200)
    throw new Error('Exportação XLSX falhou: HTTP '+response.getResponseCode());
  return response.getBlob().setContentType(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
function arquemCreateSheet_(ss,title,headers,rows){
  const sh=ss.insertSheet(title);
  return arquemSheet_(sh,headers,rows);
}
function arquemSheet_(sh,headers,rows){
  const head=headers.map(arquemCell_);
  sh.getRange(1,1,1,head.length).setValues([head]);
  sh.getRange(1,1,1,head.length).setBackground('#173b65')
    .setFontColor('#ffffff').setFontWeight('bold');
  sh.setFrozenRows(1);
  if(rows.length){
    const data=rows.map(r=>headers.map((_,i)=>typeof r[i]==='number'?r[i]:arquemCell_(r[i])));
    sh.getRange(2,1,data.length,headers.length).setValues(data);
    sh.getRange(2,1,data.length,headers.length).setBackground('#f7f9fc');
  }
  sh.autoResizeColumns(1,Math.min(headers.length,8));
  return sh;
}
