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
     keila.hasProductionQuality!==true)
    throw new Error('Relatório da Keila não passou na homologação PDF/XLSX');
  props.setProperties({
    ARQUEM_KEILA_QUALITY_VALIDATED_AT:new Date().toISOString(),
    ARQUEM_KEILA_QUALITY_VALIDATED_TEMPLATE_ID:props.getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID') || '',
    ARQUEM_KEILA_QUALITY_VALIDATED_VERSION:'arquem-3-keila-quality'
  },false);
  return {ok:true,sent:false,qualityReady:true,files:keila.files};
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
  const zenviaCheckedAt=Date.parse(props.getProperty('ARQUEM_ZENVIA_VOICE_VALIDATED_AT')||'');
  const zenviaReady=ready &&
    props.getProperty('ARQUEM_ZENVIA_VOICE_VALIDATED_VERSION')==='arquem-voice-chat-v1' &&
    props.getProperty('ARQUEM_ZENVIA_VOICE_VALIDATED_TEMPLATE_ID')===id &&
    props.getProperty('ARQUEM_ZENVIA_VOICE_VISUAL_APPROVED')==='true' &&
    Number.isFinite(zenviaCheckedAt) &&
    zenviaCheckedAt>=DriveApp.getFileById(id).getLastUpdated().getTime();
  return {sucesso:true,attachmentsVersion:'arquem-3-keila-quality',formats:['pdf','xlsx'],
    paperTemplateConfigured:ready,zenviaVoiceReady:zenviaReady,
    zenviaVoiceVersion:'arquem-voice-chat-v1',
    keilaQualityReady:ready &&
      props.getProperty('ARQUEM_KEILA_QUALITY_VALIDATED_VERSION')==='arquem-3-keila-quality' &&
      props.getProperty('ARQUEM_KEILA_QUALITY_VALIDATED_TEMPLATE_ID')===id &&
      Number.isFinite(Date.parse(props.getProperty('ARQUEM_KEILA_QUALITY_VALIDATED_AT')||'')) &&
      Date.parse(props.getProperty('ARQUEM_KEILA_QUALITY_VALIDATED_AT')||'')>=DriveApp.getFileById(id).getLastUpdated().getTime()};
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
    metrics:{tickets:2,appointments:0,minutes:0},
    productionFlow:{entered:2,exited:1,entryMovements:3,exitMovements:1},
    productionQuality:[
      {name:'Colaborador de teste A',hoursMinutes:3964,appointments:20,ratings:5,excellent:4,average:8.8},
      {name:'Colaborador de teste B',hoursMinutes:480,appointments:5,ratings:0,excellent:0,average:null}
    ],
    collaborators:[],daily:[],customers:[],activities:[],forecastVariances:[],
    tickets:[
      {id:'100769',client:'Empresa demonstrativa',owner:'Responsável demonstrativo',
        status:'Entrada · Suporte → Produção',ageDays:0,url:'https://arquem.movidesk.com/Ticket/Edit/100769'},
      {id:'100769',client:'Empresa demonstrativa',owner:'Responsável demonstrativo',
        status:'Saída · Produção → Suporte',ageDays:0,url:'https://arquem.movidesk.com/Ticket/Edit/100769'}
    ]
  };
  const attachments=arquemCreateReportAttachments_(packet);
  if(!Array.isArray(attachments)||attachments.length!==2)throw new Error('O teste Keila deve criar PDF e XLSX.');
  const pdf=attachments.find(b=>b.getContentType()==='application/pdf');
  const xlsx=attachments.find(b=>b.getName().endsWith('.xlsx'));
  if(!pdf||!xlsx||pdf.getBytes().length<2000||xlsx.getBytes().length<1500)
    throw new Error('Homologação Keila: PDF ou Excel ausente/vazio.');
  const outcome={ok:true,sent:false,report:'Keila - qualidade e movimentações',
    hasProductionFlow:true,hasProductionQuality:true,
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
// Mesmo bloco de Voz x Chat no corpo, PDF e XLSX. Sem telefones e gravações.
// Segurança: recusar métricas inconciliáveis; null significa indisponível, nunca zero.
function arquemVozChatDados_(raw) {
  if(!raw || typeof raw!=='object')throw new Error('Pacote de Voz x Chat inválido');
  const count={};
  ['total','inbound','outbound','answered','unanswered','inProgress','unclassified'].forEach(k=>{
    const n=Number(raw[k]);
    if(raw[k]==null || !Number.isInteger(n) || n<0)
      throw new Error('Indicador Zenvia inválido: '+k);
    count[k]=n;
  });
  if(count.total!==count.inbound+count.outbound ||
     count.total!==count.answered+count.unanswered+count.inProgress+count.unclassified)
    throw new Error('Totais do canal de voz sem conciliação');
  const duration=x=>{
    if(x==null||x==='')return 'Indisponível';
    const n=Number(x);
    if(!Number.isFinite(n)||n<0)throw new Error('Duração de canal inválida');
    const rounded=Math.round(n);
    return String(Math.floor(rounded/60)).padStart(2,'0')+':'+String(rounded%60).padStart(2,'0');
  };
  const quality=(raw.quality||{});
  const scores={};
  ['voz','chat'].forEach(channel=>{
    const q=quality[channel]||{};
    const total=Number(q.total),positive=Number(q.positive);
    if(q.total==null||q.positive==null||!Number.isInteger(total)||
       !Number.isInteger(positive)||total<0||positive<0||positive>total)
      throw new Error('Avaliações '+channel+' inválidas');
    scores[channel]={
      total,positive,negative:total-positive,
      csat:total?(positive/total*100).toFixed(2)+'%':'Sem avaliações'
    };
  });
  const ch=raw.chatMetrics||{};
  const daily=Array.isArray(raw.byDay)?raw.byDay:[];
  const byExtension=Array.isArray(raw.byExtension)?raw.byExtension:[];
  if(daily.length>370||byExtension.length>30)
    throw new Error('Detalhamento de voz excede limites seguros');
  const days=daily.map(x=>{
    const date=String(x.date||'');
    const total=Number(x.total),answered=Number(x.answered);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isInteger(total)||
      !Number.isInteger(answered)||total<0||answered<0||answered>total)
      throw new Error('Registro diário de Voz inválido');
    return [date,total,answered];
  });
  const ramais=byExtension.map(x=>{
    const id=String(x.extension||'');
    const total=Number(x.total),answered=Number(x.answered);
    if(!/^\d{1,12}$/.test(id)||!Number.isInteger(total)||!Number.isInteger(answered)||
       total<0||answered<0||answered>total)throw new Error('Registro de ramal inválido');
    return [id,total,answered,duration(x.talkSeconds)];
  });
  const support=raw.supportMetrics;
  if(support!=null){
    if(typeof support!=='object'||!Number.isInteger(Number(support.total))||
      Number(support.total)<0||Number(support.total)>count.total||
      !Number.isInteger(Number(support.answered))||
      Number(support.answered)<0||Number(support.answered)>Number(support.total))
      throw new Error('Recorte Suporte inválido');
  }
  const overview=[
    ['Suporte · ligações nos ramais homologados',support==null?'Não homologado':Number(support.total),'—'],
    ['Suporte · atendidas',support==null?'Não homologado':Number(support.answered),'—'],
    ['Suporte · TMA',support==null?'Não homologado':duration(support.tmaSeconds),'—'],
    ['Recebidas',count.inbound,'—'],['Efetuadas',count.outbound,'—'],
    ['Total de atendimentos',count.total,ch.tickets==null?'Indisponível':Number(ch.tickets)],
    ['Atendidas',count.answered,'—'],['Não atendidas',count.unanswered,'—'],
    ['Em andamento',count.inProgress,'—'],['Sem classificação',count.unclassified,'—'],
    ['TMA',duration(raw.tmaSeconds),duration(ch.tmaSeconds)],
    ['TME',duration(raw.tmeSeconds),duration(ch.tmeSeconds)],
    ['Tempo falado',duration(raw.talkSeconds),'—'],
    ['Notas 1–7',scores.voz.negative,scores.chat.negative],
    ['Notas 8–10',scores.voz.positive,scores.chat.positive],
    ['Avaliações válidas',scores.voz.total,scores.chat.total],
    ['CSAT',scores.voz.csat,scores.chat.csat]
  ];
  return {overview,days,ramais,
    note:'Escopos distintos: voz representa toda a conta Zenvia (todos os setores); chat representa o Suporte. TME de voz é específico da fila apenas quando validada. CSAT: notas 8–10 / notas válidas (1–10); sem avaliações não equivale a zero.'};
}

// Homologação real de PDF e XLSX, com dados artificiais e sem disparo.
function arquemHomologarVozChatSemEnvio() {
  const props=PropertiesService.getScriptProperties();
  const templateId=String(props.getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID')||'').trim();
  if(!templateId)throw new Error('Modelo corporativo timbrado nao configurado');
  const template=DriveApp.getFileById(templateId);
  if(template.getMimeType()!==MimeType.GOOGLE_DOCS)
    throw new Error('O modelo de papel timbrado nao e um Google Docs');
  const packet={
    schema:'arquem-mail-v1',title:'Homologação Voz e Chat — sem envio',
    from:'2026-11-10',to:'2026-11-11',metrics:{minutes:300,appointments:5,tickets:3},
    collaborators:[],daily:[],tickets:[],customers:[],activities:[],
    zenviaVoice:{
      total:4,inbound:2,outbound:2,answered:2,unanswered:1,inProgress:1,unclassified:0,
      tmaSeconds:85,tmeSeconds:null,talkSeconds:170,
      chatMetrics:{tickets:3,tmaSeconds:45,tmeSeconds:12},
      quality:{voz:{total:2,positive:1},chat:{total:3,positive:2}},
      byDay:[{date:'2026-11-10',total:4,answered:2}],
      byExtension:[{extension:'430',total:4,answered:2,talkSeconds:170}]
    }
  };
  const attachments=arquemCreateReportAttachments_(packet);
  const evidence=arquemValidarAnexosVozChat_(attachments);
  // Guardar apenas amostras sintéticas para inspeção visual, nunca enviar e-mails.
  const samples=attachments.map(blob=>{
    const file=DriveApp.createFile(blob.copyBlob().setName('HOMOLOGACAO_ZENVIA_'+blob.getName()));
    return {id:file.getId(),name:file.getName(),url:file.getUrl(),size:file.getSize(),mimeType:file.getMimeType()};
  });
  props.setProperties({
    ARQUEM_ZENVIA_VOICE_VISUAL_APPROVED:'false',
    ARQUEM_ZENVIA_VOICE_PENDING_TEMPLATE_ID:templateId,
    ARQUEM_ZENVIA_VOICE_PENDING_SAMPLE_IDS:samples.map(x=>x.id).join(','),
    ARQUEM_ZENVIA_VOICE_PENDING_AT:new Date().toISOString()
  },false);
  return {ok:true,sent:false,ready:false,pendingVisualReview:true,validation:evidence,files:samples};
}

// Etapa manual separada: executar somente DEPOIS de inspecionar os dois
// arquivos de homologação. Nenhuma mensagem é enviada nesta função.
function arquemAprovarHomologacaoVozChatSemEnvio() {
  const props=PropertiesService.getScriptProperties();
  const templateId=String(props.getProperty('ARQUEM_PAPEL_TIMBRADO_DOC_ID')||'').trim();
  if(!templateId || props.getProperty('ARQUEM_ZENVIA_VOICE_PENDING_TEMPLATE_ID')!==templateId)
    throw new Error('Modelo diferente do que gerou os arquivos de homologação');
  const ids=String(props.getProperty('ARQUEM_ZENVIA_VOICE_PENDING_SAMPLE_IDS')||'').split(',').filter(Boolean);
  if(ids.length!==2)throw new Error('Amostras PDF e XLSX não foram geradas');
  const files=ids.map(id=>DriveApp.getFileById(id));
  if(!files.some(f=>f.getMimeType()==='application/pdf') ||
     !files.some(f=>/\.xlsx$/i.test(f.getName())) ||
     files.some(f=>f.isTrashed() || f.getSize()<100))
    throw new Error('Amostras de homologação ausentes, vazias ou removidas');
  const staged=Date.parse(props.getProperty('ARQUEM_ZENVIA_VOICE_PENDING_AT')||'');
  if(!Number.isFinite(staged) || staged<DriveApp.getFileById(templateId).getLastUpdated().getTime())
    throw new Error('Modelo editado após a geração: execute nova homologação');
  props.setProperties({
    ARQUEM_ZENVIA_VOICE_VISUAL_APPROVED:'true',
    ARQUEM_ZENVIA_VOICE_VALIDATED_VERSION:'arquem-voice-chat-v1',
    ARQUEM_ZENVIA_VOICE_VALIDATED_AT:new Date().toISOString(),
    ARQUEM_ZENVIA_VOICE_VALIDATED_TEMPLATE_ID:templateId
  },false);
  return {ok:true,sent:false,visualReviewApproved:true,files:files.map(f=>({name:f.getName(),url:f.getUrl()}))};
}
// Validação das exportações reais antes de confirmar Voz × Chat no gerador.
function arquemValidarAnexosVozChat_(attachments) {
  if(!Array.isArray(attachments)||attachments.length!==2)
    throw new Error('Homologação exige exatamente PDF e Excel');
  const pdf=attachments.find(x=>/\.pdf$/i.test(x.getName())&&x.getContentType()==='application/pdf');
  const xlsx=attachments.find(x=>/\.xlsx$/i.test(x.getName()));
  if(!pdf||!xlsx||attachments.some(x=>x.getBytes().length<100))
    throw new Error('PDF ou XLSX ausente/incompleto');
  const header=pdf.getBytes().slice(0,5).map(b=>String.fromCharCode(b&255)).join('');
  if(header!=='%PDF-')throw new Error('Arquivo PDF inválido');
  let files;
  try{files=Utilities.unzip(xlsx);}catch(_){throw new Error('XLSX exportado não é ZIP válido');}
  const parts={};
  files.forEach(f=>{parts[f.getName()]=f.getDataAsString('UTF-8');});
  const workbook=parts['xl/workbook.xml']||'';
  const texts=Object.keys(parts).filter(n=>/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(n))
    .map(n=>parts[n]).join(' ');
  const requiredSheets=['Voz e Chat','Voz por dia','Voz por ramal','Metodologia canais'];
  if(requiredSheets.some(name=>!workbook.includes('name="'+name+'"')))
    throw new Error('XLSX sem abas de Voz × Chat');
  if(['CSAT','TMA','TME','Avaliações válidas','Notas 8'].some(label=>!texts.includes(label)))
    throw new Error('XLSX sem indicadores obrigatórios de Voz × Chat');
  return {pdfBytes:pdf.getBytes().length,xlsxBytes:xlsx.getBytes().length,
    sheets:requiredSheets,validated:true};
}

function arquemCreateReportAttachments_(packet) {
  if (!packet || packet.schema !== 'arquem-mail-v1') throw new Error('Pacote de relatório inválido');
  packet=arquemSanearPacote_(packet);
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
  if(packet.zenviaVoice)arquemVozChatDados_(packet.zenviaVoice);
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
    body.appendParagraph('Entraram na Produção: '+Number(flow.entered||0)+' chamados  |  Saíram por transferência: '+Number(flow.exited||0)+' chamados');
    body.appendParagraph('Movimentações: '+Number(flow.entryMovements||0)+' entradas e '+Number(flow.exitMovements||0)+' saídas. Encerramentos não são contabilizados como saídas.');
  }else{
    body.appendParagraph('Horas apontadas: '+arquemH_(m.minutes)+'  |  Apontamentos: '+
      (m.appointments||0)+'  |  Chamados trabalhados: '+(m.tickets||0));
  }
  if(p.historicalIncomplete){
    const warning=body.appendParagraph('ATENÇÃO: histórico do Movidesk em importação. Comparativos anuais são preliminares.');
    warning.editAsText().setForegroundColor('#a36618').setBold(true);
  }
  if(p.productionQuality){
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
  if(p.zenviaVoice){
    const v=arquemVozChatDados_(p.zenviaVoice);
    arquemAddHeading_(body,'Voz (conta Zenvia) × Chat (Suporte)');
    arquemEstilizarTabelaPdf_(body.appendTable(
      [['Indicador','Voz · conta Zenvia','Chat · Suporte']].concat(v.overview.map(x=>x.map(String)))));
    if(v.days.length){
      arquemAddHeading_(body,'Volume de chamadas por dia');
      arquemEstilizarTabelaPdf_(body.appendTable(
        [['Data','Ligações','Atendidas']].concat(v.days.map(x=>x.map(String)))));
    }
    if(v.ramais.length){
      arquemAddHeading_(body,'Chamadas por ramal');
      arquemEstilizarTabelaPdf_(body.appendTable(
        [['Ramal','Ligações','Atendidas','Tempo falado (mm:ss)']].concat(v.ramais.map(x=>x.map(String)))));
    }
    body.appendParagraph(v.note);
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
      ['Entraram na Produção',Number(p.productionFlow.entered)||0],
      ['Saíram por transferência',Number(p.productionFlow.exited)||0],
      ['Movimentações de entrada',Number(p.productionFlow.entryMovements)||0],
      ['Movimentações de saída',Number(p.productionFlow.exitMovements)||0],
      ['Critério','Chamados distintos; finalizações excluídas das saídas']
    ]:[['Relatório',p.title],['Início',p.from],['Fim',p.to],
     ['Horas apontadas',arquemExcelHora_(p.metrics&&p.metrics.minutes)],
     ['Apontamentos',Number(p.metrics&&p.metrics.appointments)||0],
     ['Chamados trabalhados',Number(p.metrics&&p.metrics.tickets)||0],
     ['Conciliação',p.partial?'Dados parciais':'Dados disponíveis'],
     ['Histórico',p.historicalIncomplete?'Comparativo anual PRELIMINAR':'Verificar cobertura']]));
  if(!p.productionFlow)first.getRange('B4').setNumberFormat('[h]:mm:ss');
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
  const daySheet=arquemCreateSheet_(ss,'Dia a dia',
    ['Data','Colaborador','Setor','Horas','Jornada','Mínimo','Situação'],
    (p.daily||[]).map(x=>[x.date,x.person,x.sector,arquemExcelHora_(x.minutes),
      arquemExcelHora_(x.referenceMinutes),arquemExcelHora_(x.minimumMinutes),x.status]));
  arquemFormatarHoras_(daySheet,[4,5,6],(p.daily||[]).length);
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
  if(p.zenviaVoice){
    const v=arquemVozChatDados_(p.zenviaVoice);
    arquemVozChatPlanilhas_(ss,v);
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
// Durações numéricas em frações de dia: evita que Sheets leia mm:ss como hh:mm.
function arquemVozChatPlanilhas_(ss,v){
  const durationLabels=new Set(['Suporte · TMA','TMA','TME','Tempo falado']);
  const numericDuration=value=>{
    const match=/^(\d+):(\d{2})$/.exec(String(value));
    return match?(Number(match[1])*60+Number(match[2]))/86400:value;
  };
  const overview=v.overview.map(row=>durationLabels.has(row[0])?
    row.map((value,i)=>i?numericDuration(value):value):row);
  const summary=arquemCreateSheet_(ss,'Voz e Chat',['Indicador','Voz','Chat'],overview);
  v.overview.forEach((row,i)=>{
    if(durationLabels.has(row[0]))summary.getRange(i+2,2,1,2).setNumberFormat('[m]:ss');
  });
  arquemCreateSheet_(ss,'Voz por dia',['Data','Chamadas','Atendidas'],v.days);
  const extensions=arquemCreateSheet_(ss,'Voz por ramal',
    ['Ramal','Chamadas','Atendidas','Tempo falado (mm:ss)'],
    v.ramais.map(row=>row.map((value,i)=>i===3?numericDuration(value):value)));
  if(v.ramais.length)extensions.getRange(2,4,v.ramais.length,1).setNumberFormat('[m]:ss');
  const notes=arquemCreateSheet_(ss,'Metodologia canais',
    ['Regra','Descrição'],[['CSAT e qualidade',v.note]]);
  notes.getRange(2,2).setWrap(true);
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
