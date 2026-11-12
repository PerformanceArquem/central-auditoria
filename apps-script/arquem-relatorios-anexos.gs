/**
 * ARQUEM · Extensão para o Apps Script atual de envio Gmail.
 * NÃO substituir a função doPost existente nem sua autenticação.
 *
 * Integração manual no Apps Script já implantado:
 *
 * 1) Em seu doPost(e), DEPOIS de validar o token atual, acrescente:
 *    if (dados.action === 'capabilities') {
 *      return ContentService.createTextOutput(
 *        JSON.stringify(arquemCapacidadesAnexos_())
 *      ).setMimeType(ContentService.MimeType.JSON);
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
 * 5) Configure ARQUEM_PAPEL_TIMBRADO_DOC_ID no Script Properties,
 *    rode arquemValidarPublicacaoSemEnvio() no editor (sem disparos);
 *    depois configure doPost conforme exemplo e publique nova versão do Web App.
 * 6) Faça verificação de capabilities antes de habilitar anexos no backend.
 *    Scopes necessários: Drive, Docs, Sheets e UrlFetchApp.
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
/**
 * Executar manualmente no editor Apps Script antes de habilitar anexos.
 * Valida o modelo timbrado, gera PDF/Excel de exemplo e NAO envia e-mails.
 * O registro de aprovacao perde validade se o modelo for editado depois.
 */
function arquemValidarPublicacaoSemEnvio() {
  const props=PropertiesService.getScriptProperties();
  const id=String(props.getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID')||'').trim();
  if(!id)throw new Error('Configure ARQUEM_PAPEL_TIMBRADO_DOC_ID antes de validar o papel timbrado.');
  const file=DriveApp.getFileById(id);
  if(file.getMimeType()!==MimeType.GOOGLE_DOCS)
    throw new Error('O modelo de papel timbrado precisa ser um Google Docs acessivel.');
  const doc=DocumentApp.openById(id);
  if(!doc.getBody())throw new Error('Nao foi possivel ler o corpo do modelo de papel timbrado.');
  const result=arquemTesteAnexosSemEnvio();
  if(result.ok!==true || result.sent!==false || result.files.length!==2)
    throw new Error('Os anexos nao passaram na validacao sem envio.');
  props.setProperties({
    ARQUEM_ATTACHMENTS_VALIDATED:'true',
    ARQUEM_ATTACHMENTS_VALIDATED_AT:new Date().toISOString(),
    ARQUEM_ATTACHMENTS_VALIDATED_TEMPLATE_ID:id
  },false);
  return {ok:true,sent:false,template:'Modelo corporativo validado',files:result.files};
}
/**
 * Homologação completa e independente para o relatório da Keila.
 * Deve ser executada manualmente no editor Apps Script com a conta autorizada.
 * Não chama qualquer serviço de envio de e-mail.
 * Só grava confirmação após PDF e XLSX reais terem sido gerados.
 */
function arquemHomologarKeilaSemEnvio() {
  const props=PropertiesService.getScriptProperties();
  const base=arquemValidarPublicacaoSemEnvio();
  if(base.ok!==true || base.sent!==false)throw new Error('Validação corporativa não confirmada');
  const keila=arquemTesteKeilaSemEnvio();
  if(keila.ok!==true || keila.sent!==false || !Array.isArray(keila.files) ||
     keila.files.length!==2 || keila.hasProductionFlow!==true ||
     keila.entradasSaidasOnly!==true)
    throw new Error('Relatório da Keila não passou na homologação PDF/XLSX');
  props.setProperties({
    ARQUEM_KEILA_FLOW_VALIDATED_AT:new Date().toISOString(),
    ARQUEM_KEILA_FLOW_VALIDATED_TEMPLATE_ID:props.getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID') || '',
    ARQUEM_KEILA_FLOW_VALIDATED_VERSION:'arquem-6-keila-flow-only'
  },false);
  return {ok:true,sent:false,productionReady:true,files:keila.files};
}
/**
 * Homologacao das permissoes individuais SEM envio de e-mail.
 * Execute uma vez depois de instalar a versao 4 e de validar o modelo timbrado.
 * O gerador recusa abas vedadas e verifica PDF/XLSX antes de liberar o recurso.
 */
function arquemHomologarSecoesSemEnvio() {
  const props=PropertiesService.getScriptProperties();
  const template=String(props.getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID')||'').trim();
  if(!template)throw new Error('Modelo timbrado obrigatorio para homologar as secoes.');
  const approved=arquemValidarPublicacaoSemEnvio();
  if(approved.ok!==true || approved.sent!==false)
    throw new Error('Anexos corporativos ainda nao homologados.');
  const packet={
    schema:'arquem-mail-v1',title:'TESTE SEM ENVIO - Permissoes individuais',
    from:'2026-11-02',to:'2026-11-08',
    partial:false,historicalIncomplete:false,
    metrics:{minutes:480,appointments:1,tickets:1},
    reportSections:{daily_detail:false,customers:false,activities:false},
    collaborators:[],
    daily:[{date:'2026-11-05',person:'Colaborador demonstrativo',sector:'Suporte',minutes:480}],
    customers:[{name:'Empresa demonstrativa',minutes:480,tickets:1}],
    activities:[{name:'Atividade demonstrativa',minutes:480}],
    tickets:[]
  };
  const files=arquemCreateReportAttachments_(packet);
  if(!Array.isArray(files)||files.length!==2)throw new Error('Anexos personalizados incompletos.');
  const pdf=files.find(x=>x.getContentType()==='application/pdf');
  const excel=files.find(x=>String(x.getName()).endsWith('.xlsx'));
  if(!pdf||!excel||pdf.getBytes().length<2000||excel.getBytes().length<1500)
    throw new Error('PDF ou Excel personalizado invalido.');
  props.setProperties({
    ARQUEM_SECTIONS_VALIDATED_AT:new Date().toISOString(),
    ARQUEM_SECTIONS_VALIDATED_TEMPLATE_ID:template,
    ARQUEM_SECTIONS_VALIDATED_VERSION:'arquem-4-report-sections'
  },false);
  return {ok:true,sent:false,sectionPermissionsSupported:true,
    files:files.map(x=>({name:x.getName(),bytes:x.getBytes().length}))};
}
/**
 * Retornado pelo doPost apos a validacao do segredo existente.
 * Nao anuncia anexos como prontos so porque o ID do modelo existe.
 */
function arquemCapacidadesAnexos_() {
  const props=PropertiesService.getScriptProperties();
  const id=String(props.getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID')||'').trim();
  const checkedId=props.getProperty('ARQUEM_ATTACHMENTS_VALIDATED_TEMPLATE_ID');
  const checkedAt=Date.parse(props.getProperty('ARQUEM_ATTACHMENTS_VALIDATED_AT')||'');
  let ready=false;
  if(id && checkedId===id && Number.isFinite(checkedAt)){
    try{
      const file=DriveApp.getFileById(id);
      ready=file.getMimeType()===MimeType.GOOGLE_DOCS &&
        checkedAt>=file.getLastUpdated().getTime();
    }catch(_){ready=false;}
  }
  const sectionsAt=Date.parse(props.getProperty('ARQUEM_SECTIONS_VALIDATED_AT')||'');
  const sectionPermissionsSupported=ready &&
    props.getProperty('ARQUEM_SECTIONS_VALIDATED_VERSION')==='arquem-4-report-sections' &&
    props.getProperty('ARQUEM_SECTIONS_VALIDATED_TEMPLATE_ID')===id &&
    Number.isFinite(sectionsAt) &&
    sectionsAt>=DriveApp.getFileById(id).getLastUpdated().getTime();
  return {sucesso:true,attachmentsVersion:'arquem-6-keila-flow-only',formats:['pdf','xlsx'],
    sectionPermissionsSupported,
    paperTemplateConfigured:ready,
    keilaProductionReady:ready &&
      props.getProperty('ARQUEM_KEILA_FLOW_VALIDATED_VERSION')==='arquem-6-keila-flow-only' &&
      props.getProperty('ARQUEM_KEILA_FLOW_VALIDATED_TEMPLATE_ID')===id &&
      Number.isFinite(Date.parse(props.getProperty('ARQUEM_KEILA_FLOW_VALIDATED_AT')||'')) &&
      Date.parse(props.getProperty('ARQUEM_KEILA_FLOW_VALIDATED_AT')||'')>=DriveApp.getFileById(id).getLastUpdated().getTime()};
}

/**
 * Homologação específica do relatório da Keila.
 * Usa dados fictícios e nunca chama doPost, MailApp ou GmailApp.
 * Gera PDF e XLSX temporários, confere os arquivos e os descarta.
 */
function arquemTesteKeilaSemEnvio() {
  const packet={
    schema:'arquem-mail-v1',
    title:'Homologação — Entradas e Saídas da Produção — Keila',
    from:'2026-11-02',to:'2026-11-08',
    partial:false,historicalIncomplete:false,
    metrics:{entered:2,exited:1},
    productionFlow:{entered:2,exited:1},
    collaborators:[],daily:[],customers:[],activities:[],forecastVariances:[],tickets:[]
  };
  const attachments=arquemCreateReportAttachments_(packet);
  if(!Array.isArray(attachments)||attachments.length!==2)throw new Error('O teste Keila deve criar PDF e XLSX.');
  const pdf=attachments.find(b=>b.getContentType()==='application/pdf');
  const xlsx=attachments.find(b=>b.getName().endsWith('.xlsx'));
  if(!pdf||!xlsx||pdf.getBytes().length<2000||xlsx.getBytes().length<1500)
    throw new Error('Homologação Keila: PDF ou Excel ausente/vazio.');
  const outcome={ok:true,sent:false,report:'Keila - Rastreabilidade da Produção',
    hasProductionFlow:true,entradasSaidasOnly:true,
    files:attachments.map(b=>({name:b.getName(),type:b.getContentType(),bytes:b.getBytes().length}))};
  console.log(JSON.stringify(outcome));
  return outcome;
}

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
 *   JSON.stringify(arquemCapacidadesAnexos_())
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
// Politica corporativa: retirar identificadores tecnicos antes de criar anexos.
function arquemSanearPacote_(value) {
  if(typeof value==='string')
    return value.replace(/\b(?:supabase|vercel|google\s+apps\s+script|postgresql|postgres)\b/gi,'plataforma interna');
  if(Array.isArray(value))return value.map(arquemSanearPacote_);
  if(value && typeof value==='object'){
    const safe={};
    Object.keys(value).forEach(k=>safe[k]=arquemSanearPacote_(value[k]));
    return safe;
  }
  return value;
}
function arquemCreateReportAttachments_(packet) {
  if (!packet || packet.schema !== 'arquem-mail-v1') throw new Error('Pacote de relatório inválido');
  packet=arquemSanearPacote_(packet);
  // Defense in depth: even a stale or malformed sender must not leak revoked
  // sections in PDF tables, Excel tabs, charts, or serialized attachments.
  const permissions=packet.reportSections||{};
  if(permissions && typeof permissions==='object'){
    if(permissions.daily_detail===false)packet.daily=[];
    if(permissions.customers===false)packet.customers=[];
    if(permissions.activities===false)packet.activities=[];
  }
  if(packet.productionFlow){
    // A Rastreabilidade agora exige todas as movimentações nos anexos, nunca somente os totais.
    const flow=packet.productionFlow;
    const movements=flow.movements;
    if(!Array.isArray(movements) || movements.length>500)
      throw new Error('Rastreabilidade: movimentações ausentes ou acima do limite de 500 por anexo');
    const clean=movements.map(m=>{
      const id=String(m.id||'');
      if(!/^\d{1,12}$/.test(id) || !['entry','exit'].includes(m.direction))
        throw new Error('Movimentação com chamado ou direção inválida');
      const date=String(m.at||'');
      if(!/^\d{4}-\d\d-\d\dT/.test(date)||!Number.isFinite(Date.parse(date)))
        throw new Error('Movimentação com data/hora inválida');
      const value=(x,n)=>String(x||'Não informado').slice(0,n);
      return {id,direction:m.direction,at:date,subject:value(m.subject,240),
        client:value(m.client,150),fromTeam:value(m.fromTeam,100),toTeam:value(m.toTeam,100),
        responsible:value(m.responsible,120),actor:value(m.actor,120)};
    });
    const entries=new Set(clean.filter(m=>m.direction==='entry').map(m=>m.id)).size;
    const exits=new Set(clean.filter(m=>m.direction==='exit').map(m=>m.id)).size;
    if(entries!==(Number(flow.entered)||0)||exits!==(Number(flow.exited)||0))
      throw new Error('Totais de rastreabilidade não conferem com o detalhamento');
    packet.productionFlow={entered:entries,exited:exits,movements:clean};
    packet.metrics={entered:entries,exited:exits};
    ['productionWorkload','productionQuality','collaborators','daily','tickets',
     'customers','activities','forecastVariances'].forEach(key=>{packet[key]=[];});
  }
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
// Papel timbrado: tabelas legiveis em impressao e na tela.
function arquemEstilizarTabelaPdf_(table) {
  const rows=table.getNumRows();
  for(let i=0;i<rows;i++){
    const row=table.getRow(i);
    for(let j=0;j<row.getNumCells();j++){
      const cell=row.getCell(j);
      cell.setBackgroundColor(i===0?'#173b65':(i%2===0?'#f3f7fc':'#ffffff'));
      const text=cell.editAsText();
      text.setFontSize(9);
      if(i===0)text.setForegroundColor('#ffffff').setBold(true);
      else text.setForegroundColor('#263d59');
    }
  }
  return table;
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
  if(p.productionFlow){
    const flow=p.productionFlow;
    arquemEstilizarTabelaPdf_(body.appendTable([
      ['ENTRADAS','SAÍDAS'],
      [String(Number(flow.entered)||0),String(Number(flow.exited)||0)]
    ]));
    const movements=flow.movements||[];
    const dateBR=(s)=>Utilities.formatDate(new Date(s),'America/Sao_Paulo','dd/MM/yyyy HH:mm');
    const addSection=(direction,title)=>{
      const items=movements.filter(m=>m.direction===direction);
      arquemAddHeading_(body,title);
      body.appendParagraph(items.length+' movimentações · '+
        new Set(items.map(m=>m.id)).size+' chamados distintos.');
      const rows=[['Chamado / data','Assunto / cliente','Setores e responsáveis']];
      items.forEach(m=>rows.push([
        '#'+m.id+'\n'+dateBR(m.at),
        m.subject+'\nCliente: '+m.client,
        'Origem: '+m.fromTeam+'\nDestino: '+m.toTeam+
        '\nResponsável: '+m.responsible+'\nMovimentado por: '+m.actor
      ]));
      if(!items.length)rows.push(['—','Nenhuma movimentação','—']);
      const table=body.appendTable(rows);
      arquemEstilizarTabelaPdf_(table);
      items.forEach((m,i)=>table.getCell(i+1,0).editAsText()
        .setLinkUrl(0,m.id.length+1,'https://arquem.movidesk.com/Ticket/Edit/'+m.id));
    };
    addSection('entry','Entradas na Produção — chamados detalhados');
    addSection('exit','Saídas da Produção — chamados detalhados');
    body.appendParagraph('Entradas e saídas são transferências identificadas no histórico do Movidesk. Encerramentos não contam como saídas.');
    doc.saveAndClose();
    return DriveApp.getFileById(file.getId()).getAs(MimeType.PDF);
  }else{
    body.appendParagraph('Horas apontadas: '+arquemH_(m.minutes)+'  |  Apontamentos: '+
      (m.appointments||0)+'  |  Chamados trabalhados: '+(m.tickets||0));
  }
  if(p.historicalIncomplete){
    const warning=body.appendParagraph('ATENÇÃO: histórico do Movidesk em importação. Comparativos anuais são preliminares.');
    warning.editAsText().setForegroundColor('#a36618').setBold(true);
  }
  if(p.productionFlow && Array.isArray(p.productionWorkload)){
    arquemAddHeading_(body,'Equipe · horas e apontamentos');
    const lines=[['Colaborador','Horas','Apontamentos']];
    p.productionWorkload.slice(0,100).forEach(x=>lines.push([
      String(x.name||''),arquemH_(x.hoursMinutes),String(x.appointments||0)]));
    arquemEstilizarTabelaPdf_(body.appendTable(lines));
  } else if(p.productionQuality){
    arquemAddHeading_(body,'Qualidade dos colaboradores');
    const qs=p.productionQuality;
    const ratings=qs.reduce((sum,x)=>sum+Number(x.ratings||0),0);
    const excellent=qs.reduce((sum,x)=>sum+Number(x.excellent||0),0);
    body.appendParagraph('Avaliações: '+ratings+' | Notas excelentes (8–10): '+excellent+
      ' | Índice de qualidade: '+(ratings?(excellent/ratings*100).toFixed(2)+'%':'Sem avaliações'));
    body.appendParagraph('Notas 1–7: abaixo do padrão; 8–10: excelente. Sem avaliações não representa nota zero.');
    const lines=[['Colaborador','Horas','Apontamentos','Avaliações','Excelentes','Média']];
    qs.slice(0,100).forEach(x=>lines.push([
      String(x.name||''),arquemH_(x.hoursMinutes),String(x.appointments||0),
      String(x.ratings||0),String(x.excellent||0),
      x.average==null?'Sem avaliações':Number(x.average).toFixed(2)
    ]));
    arquemEstilizarTabelaPdf_(body.appendTable(lines));
  } else if ((p.collaborators||[]).length) {
    arquemAddHeading_(body,'Colaboradores · horas e jornada');
    const lines=[['Colaborador','Setor','Horas','Meta mínima','Jornada','Falta mínimo','Falta jornada']];
    p.collaborators.slice(0,70).forEach(x=>lines.push([
      String(x.name||''),String(x.sector||''),arquemH_(x.minutes),arquemH_(x.minimumMinutes),
      arquemH_(x.targetMinutes),arquemH_(x.minimumGap),arquemH_(x.targetGap)]));
    arquemEstilizarTabelaPdf_(body.appendTable(lines));
  }
  if ((p.daily||[]).length) {
    arquemAddHeading_(body,'Horas por colaborador · dia a dia');
    const rows=[['Data','Colaborador','Setor','Horas','Jornada ref.','Meta mínima ref.']];
    p.daily.slice(0,90).forEach(x=>rows.push([
      String(x.date||''),String(x.person||''),String(x.sector||''),
      arquemH_(x.minutes),arquemH_(x.referenceMinutes),arquemH_(x.minimumMinutes)
    ]));
    arquemEstilizarTabelaPdf_(body.appendTable(rows));
    if(p.daily.length>90)body.appendParagraph('Exibindo os primeiros 90 de '+p.daily.length+' registros diários agrupados.');
  }
  if ((p.customers||[]).length){
    arquemAddHeading_(body,'Empresas que mais consomem tempo');
    arquemEstilizarTabelaPdf_(body.appendTable([['Empresa','Horas','Chamados']].concat(
      p.customers.slice(0,30).map(x=>[String(x.name||''),arquemH_(x.minutes),String(x.tickets||0)]))));
  }
  if ((p.tickets||[]).length){
    arquemAddHeading_(body,p.productionFlow?'Chamados movimentados na Produção':'Chamados que exigem atenção');
    const ticketRows=p.tickets.slice(0,65);
    if(p.productionFlow && p.tickets.length>65)body.appendParagraph('PDF: os primeiros 65 eventos aparecem abaixo. O Excel contém até 450 movimentações; os totais consolidados consideram todo o período.');
    const ticketTable=body.appendTable([['Chamado','Cliente','Responsável','Status','Tempo']].concat(
      ticketRows.map(x=>[
        '#'+String(x.id||''),String(x.client||''),String(x.owner||''),
        String(x.status||''),String(x.ageDays==null?'—':x.ageDays+' dias')
      ])));
    arquemEstilizarTabelaPdf_(ticketTable);
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
  body.appendParagraph(p.productionFlow?
    'Contagens de chamados distintos por direção; um chamado pode entrar e sair no mesmo período. Finalizações não são transferências. Verifique a cobertura da sincronização.':
    'Dados da Central de Auditoria/Movidesk sincronizados. Horas apontadas não são controle de ponto. A ausência de registros não comprova ausência de trabalho. Categorias de risco podem se sobrepor.');
  doc.saveAndClose();
  return DriveApp.getFileById(file.getId()).getAs(MimeType.PDF);
}
function arquemXlsx_(p, keep) {
  const ss=SpreadsheetApp.create('ARQUEM_planilha_temporaria_'+Date.now());
  keep.push(ss.getId());
  const first=ss.getSheets()[0]; first.setName('Resumo');
  arquemSheet_(first,
    ['Indicador','Resultado'],
    (p.productionFlow?[
      ['Relatório',p.title],['Início',p.from],['Fim',p.to],
      ['Entradas',Number(p.productionFlow.entered)||0],
      ['Saídas',Number(p.productionFlow.exited)||0]
    ]:[['Relatório',p.title],['Início',p.from],['Fim',p.to],
     ['Horas apontadas',arquemExcelHora_(p.metrics&&p.metrics.minutes)],
     ['Apontamentos',Number(p.metrics&&p.metrics.appointments)||0],
     ['Chamados trabalhados',Number(p.metrics&&p.metrics.tickets)||0],
     ['Conciliação',p.partial?'Dados parciais':'Dados disponíveis'],
     ['Histórico',p.historicalIncomplete?'Comparativo anual PRELIMINAR':'Verificar cobertura']]));
  if(!p.productionFlow)first.getRange('B4').setNumberFormat('[h]:mm:ss');
  if(p.productionFlow){
    const chart=first.newChart().setChartType(Charts.ChartType.BAR)
      .addRange(first.getRange(5,1,2,2)).setPosition(9,4,0,0)
      .setOption('title','Entradas x Saídas da Produção')
      .setOption('legend',{position:'none'}).build();
    first.insertChart(chart);
  }
  if(p.productionFlow){
    const flow=p.productionFlow;
    const moves=flow.movements||[];
    const headers=['Chamado','Assunto','Cliente','Data/hora Brasília','Movimentação','Origem','Destino','Responsável','Movimentado por','Link Movidesk'];
    const toRow=m=>['#'+m.id,m.subject,m.client,
      Utilities.formatDate(new Date(m.at),'America/Sao_Paulo','dd/MM/yyyy HH:mm'),
      m.direction==='entry'?'Entrada':'Saída',m.fromTeam,m.toTeam,m.responsible,m.actor,
      'https://arquem.movidesk.com/Ticket/Edit/'+m.id];
    const sections=[['Entradas',moves.filter(m=>m.direction==='entry')],
      ['Saídas',moves.filter(m=>m.direction==='exit')],['Movimentações',moves]];
    sections.forEach(pair=>{
      const rows=pair[1],sheet=arquemCreateSheet_(ss,pair[0],headers,rows.map(toRow));
      if(rows.length){
        const refs=rows.map(m=>[SpreadsheetApp.newRichTextValue().setText('#'+m.id)
          .setLinkUrl('https://arquem.movidesk.com/Ticket/Edit/'+m.id).build()]);
        sheet.getRange(2,1,refs.length,1).setRichTextValues(refs).setFontColor('#2467a8');
        sheet.getRange(2,10,refs.length,1).setFontColor('#2467a8');
      }
    });
  }
  if(!p.productionFlow){
  if(p.productionFlow && Array.isArray(p.productionWorkload)){
    const work=arquemCreateSheet_(ss,'Equipe Produção',
      ['Colaborador','Horas apontadas','Apontamentos'],
      p.productionWorkload.map(x=>[x.name,arquemExcelHora_(x.hoursMinutes),Number(x.appointments)||0]));
    arquemFormatarHoras_(work,[2],p.productionWorkload.length);
  }
  if(p.productionQuality){
    const qs=p.productionQuality;
    const quality=arquemCreateSheet_(ss,'Qualidade',
      ['Colaborador','Horas apontadas','Apontamentos','Avaliações','Notas excelentes (8–10)','Média','Índice qualidade'],
      qs.map(x=>[x.name,arquemExcelHora_(x.hoursMinutes),Number(x.appointments)||0,
        Number(x.ratings)||0,Number(x.excellent)||0,
        x.average==null?'Sem avaliações':Number(x.average),
        Number(x.ratings)>0?Number(x.excellent)/Number(x.ratings):'Sem avaliações']));
    if(qs.length){
      quality.getRange(2,2,qs.length,1).setNumberFormat('[h]:mm:ss');
      quality.getRange(2,7,qs.length,1).setNumberFormat('0.00%');
    }
  }
  const people=arquemCreateSheet_(ss,'Colaboradores',
    ['Colaborador','Setor','Horas','Mínimo','Jornada','Falta mínimo','Falta jornada','Origem'],
    (p.productionQuality?[]:(p.collaborators||[])).map(x=>[x.name,x.sector,arquemExcelHora_(x.minutes),arquemExcelHora_(x.minimumMinutes),
     arquemExcelHora_(x.targetMinutes),arquemExcelHora_(x.minimumGap),arquemExcelHora_(x.targetGap),x.ruleSource||'Padrão']));
  arquemFormatarHoras_(people,[3,4,5,6,7],p.productionQuality?0:(p.collaborators||[]).length);
  const authorizedSections=p.reportSections||{};
  if(authorizedSections.daily_detail!==false){
  const daySheet=arquemCreateSheet_(ss,'Dia a dia',
    ['Data','Colaborador','Setor','Horas','Jornada','Mínimo','Situação'],
    (p.daily||[]).map(x=>[x.date,x.person,x.sector,arquemExcelHora_(x.minutes),
      arquemExcelHora_(x.referenceMinutes),arquemExcelHora_(x.minimumMinutes),x.status]));
  arquemFormatarHoras_(daySheet,[4,5,6],(p.daily||[]).length);
  }
  const ticketSheet=arquemCreateSheet_(ss,'Chamados',
    ['Chamado','Cliente','Responsável','Status','Idade (dias)','Link Movidesk'],
    (p.tickets||[]).map(x=>['#'+String(x.id||''),x.client,x.owner,x.status,x.ageDays,x.url]));
  if ((p.tickets||[]).length) {
    const rows=(p.tickets||[]).slice(0,500);
    // Número do chamado clicável, com destino Movidesk validado por ID numérico.
    const linked=rows.map(x=>{
      const id=String(x.id||'');
      const cell=SpreadsheetApp.newRichTextValue().setText('#'+id);
      if(/^[0-9]+$/.test(id))cell.setLinkUrl('https://arquem.movidesk.com/Ticket/Edit/'+id);
      return [cell.build()];
    });
    ticketSheet.getRange(2,1,linked.length,1).setRichTextValues(linked).setFontColor('#2467a8');
    ticketSheet.getRange(2,6,rows.length,1).setFontColor('#2467a8');
  }
  if(authorizedSections.customers!==false){
  const cust=arquemCreateSheet_(ss,'Empresas',
    ['Empresa','Horas','Chamados','Apontamentos'],
    (p.customers||[]).map(x=>[x.name,arquemExcelHora_(x.minutes),x.tickets,x.appointments]));
  arquemFormatarHoras_(cust,[2],(p.customers||[]).length);
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
  }
  if(authorizedSections.activities!==false){
    const acts=arquemCreateSheet_(ss,'Atividades',
      ['Atividade','Horas'],
      (p.activities||[]).map(x=>[x.name,arquemExcelHora_(x.minutes)]));
    arquemFormatarHoras_(acts,[2],(p.activities||[]).length);
  }
  // Defesa adicional: um relatório personalizado nunca pode exportar uma aba
  // cuja autorização foi revogada, mesmo se a montagem da planilha mudar.
  if(p.reportSections && typeof p.reportSections==='object'){
    const restricted=[
      ['daily_detail','Dia a dia'],
      ['customers','Empresas'],
      ['activities','Atividades']
    ];
    restricted.forEach(entry=>{
      const key=entry[0],sheet=entry[1];
      if(p.reportSections[key]===false && ss.getSheetByName(sheet))
        throw new Error('Exportação bloqueada: aba não autorizada '+sheet);
    });
  }
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
    .setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  sh.setRowHeight(1,34);
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(1);
  if(rows.length){
    const data=rows.map(r=>headers.map((_,i)=>typeof r[i]==='number'?r[i]:arquemCell_(r[i])));
    sh.getRange(2,1,data.length,headers.length).setValues(data);
    sh.getRange(2,1,data.length,headers.length)
      .setBackgrounds(data.map((_,i)=>Array(headers.length).fill(i%2===0?'#f2f6fc':'#ffffff')))
      .setVerticalAlignment('middle').setFontSize(10);
    // Filtros para localizar chamados, setores, colaboradores e atividades rapidamente.
    sh.getRange(1,1,data.length+1,headers.length).createFilter();
  }
  sh.autoResizeColumns(1,Math.min(headers.length,8));
  for(let i=1;i<=Math.min(headers.length,12);i++){
    if(sh.getColumnWidth(i)>360)sh.setColumnWidth(i,360);
  }
  return sh;
}
