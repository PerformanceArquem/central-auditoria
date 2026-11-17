/* Exportação do formulário de monitoria — modelo oficial fornecido pela Qualidade.
 * Preserve critérios/pesos da planilha e jamais declare aprovação automática.
 * Nenhum e-mail e nenhum envio externo são realizados por esta rotina.
 */
(()=>{
 const RUBRIC=[{"id":"R01","code":"1.1","block":1,"name":"SLA de Primeira Resposta","description":"O agente enviou a primeira saudação humana dentro de 1 minuto após a resposta do Chatbot?","chat":{"points":5,"partial":null},"voice":{"points":null,"partial":null}},{"id":"R02","code":"1.2","block":1,"name":"Confirmação de dados (Nome e CNPJ)","description":"O agente questionou o nome da pessoa em contato e o CNPJ quando necessário?","chat":{"points":5,"partial":null},"voice":{"points":7.5,"partial":null}},{"id":"R03","code":"1.3","block":1,"name":"Atualização Cadastral","description":"Coletou os dados atualizados da empresa em caso de identificação de divergências? Alterou corretamente os dados, mantendo como solicitante o cadastro completo do cliente? (Ref: SUP 002)","chat":{"points":5,"partial":2.5},"voice":{"points":7.5,"partial":4}},{"id":"R04","code":"2.1","block":2,"name":"Sondagem e Investigação","description":"O agente fez as perguntas corretas (módulo, rotina, mensagem de erro) para tirar a generalização da fala do cliente antes de supor o problema? (Ref: SUP 003)","chat":{"points":12.5,"partial":7.5},"voice":{"points":12.5,"partial":7.5}},{"id":"R05","code":"2.2","block":2,"name":"Passo a passo de resolução","description":"O agente foi assertivo e seguro nas soluções propostas, demonstrando ter seguido instruções da Intranet ou da liderança?","chat":{"points":12.5,"partial":7.5},"voice":{"points":12.5,"partial":7.5}},{"id":"R06","code":"2.3","block":2,"name":"Uso Correto de Ferramentas de Contorno","description":"O agente tomou a decisão correta ao usar Acesso Remoto ou Ligação Ativa? Critério: se o cliente era leigo/complexo, ele ligou ou acessou? Se acessou, usou o ArqDesk/RustDesk corretamente e deixou o atalho na área de trabalho? (Ref: SUP 004 e SUP 005)","chat":{"points":10,"partial":5},"voice":{"points":10,"partial":5}},{"id":"R07","code":"2.3","block":2,"name":"Regra de Tempo / Pausas","description":"O agente manteve o cliente informado durante as pausas de pesquisa? Respeitou o limite de 10 minutos (chat) /  5 minutos (telefone) e atualizou o cliente a cada 5 minutos (chat) / 2 minutos (telefone)? (Ref: SUP 001)","chat":{"points":5,"partial":null},"voice":{"points":5,"partial":null}},{"id":"R08","code":"3.1","block":3,"name":"Solução integral","description":"O atendimento foi finalizado após resolver, esclarecer e encaminhar tudo que foi proposto pelo cliente?","chat":{"points":10,"partial":7},"voice":{"points":10,"partial":7}},{"id":"R09","code":"3.2","block":3,"name":"Despedida/Encerramento da conversa","description":"Questionou se há algo mais em que possa ajudar? Ao receber a resposta de que não há mais nada, se despediu de forma cordial e mantendo a Arquem à disposição? Em caso de inatividade, utilizou corretamente os scripts de 5 e 15 minutos dentro das regras?","chat":{"points":5,"partial":3},"voice":{"points":5,"partial":null}},{"id":"R10","code":"4.1","block":4,"name":"Título do chamado","description":"O agente utilizou o padrão [RB/ACO] - [DESCRIÇÃO] - [ID/NOME LOJA] corretamente?","chat":{"points":5,"partial":null},"voice":{"points":5,"partial":null}},{"id":"R11","code":"4.2","block":4,"name":"Coleta de evidências","description":"Se era um erro novo ou material desatualizado, o agente coletou prints e/ou vídeos para a criação de Documentação Intranet? (Ref: SUP 006) OU Se houve escalação, o agente reuniu todas as evidências necessárias para abertura de chamado?","chat":{"points":10,"partial":null},"voice":{"points":10,"partial":null}},{"id":"R12","code":"4.3","block":4,"name":"Ação Pública e Macro","description":"O agente preencheu o resumo claro e utilizando a macro correta? Caso não tenha utilizado macro, há todas as informações pertinentes ao atendimento e/ou escalação?","chat":{"points":5,"partial":null},"voice":{"points":5,"partial":null}},{"id":"R13","code":"4.2","block":4,"name":"Tabulação e Destino do Ticket","description":"Os campos obrigatórios (Motivo, Serviço, Categoria, Produto, Módulo) foram preenchidos corretamente? O status final está correto?","chat":{"points":10,"partial":7},"voice":{"points":10,"partial":7}}];
 const CRITICAL=[{"code":"Z1","name":"Desrespeito","description":"Faltou com respeito, empatia ou cordialidade com o cliente."},{"code":"Z2","name":"Encerramento Indevido","description":"Encerrou o chat sem a confirmação do cliente ou sem respeitar a regra de inatividade (15 min totais). (Ref: SUP 001)"},{"code":"Z3","name":"Informação Prejudicial","description":"Informou ou executou ações indevidas que prejudicaram o cliente ou a Arquem (ex: alterou regras fiscais sem aval contábil)."},{"code":"Z4","name":"Negligência na Escalação","description":"Negligenciou uma escalação ou não abriu o chamado necessário, travando a operação do cliente."}];
 const ROWS=[22,23,24,31,32,33,34,41,42,49,50,51,52];
 const safe=v=>typeof v==='string'&&/^[\s]*[=+@\-\t\r]/.test(v)?"'"+v:v;
 const num=v=>typeof v==='number'?v:'N/A';

 // Keep the original corporate visual hierarchy in the exported XLSX.
 // SheetJS Community Edition does not retain custom cell formatting on write;
 // patch the generated OOXML styles in memory with the JSZip already used by Central.
 const visualStyles = () => {
   const colors=['FF203B68','FF63738E','FFCC0000','FFFDE6E6','FF315A95','FF69A957','FFDCE6F5','FFFFEAC1','FFFFFFFF','FFF5F8FD','FFE9F5E8','FFFFF0F0'];
   const fills=['<fill><patternFill patternType="none"/></fill>','<fill><patternFill patternType="gray125"/></fill>',
     ...colors.map(color=>'<fill><patternFill patternType="solid"><fgColor rgb="'+color+'"/><bgColor indexed="64"/></patternFill></fill>')];
   const font=(size,bold,color)=>'<font>'+(bold?'<b/>':'')+'<sz val="'+size+'"/><color rgb="'+color+'"/><name val="Arial"/></font>';
   const fonts=[
     font(10,false,'FF26364A'),font(15,true,'FFFFFFFF'),font(12,true,'FF565C67'),
     font(12,true,'FFFFFFFF'),font(10,true,'FFFFFFFF'),font(10,true,'FF203B68'),
     font(10,false,'FFB80000'),font(11,true,'FF203B68'),font(10,true,'FFB91C1C')
   ];
   const border='<border><left style="thin"><color rgb="FFD7DFE8"/></left><right style="thin"><color rgb="FFD7DFE8"/></right><top style="thin"><color rgb="FFD7DFE8"/></top><bottom style="thin"><color rgb="FFD7DFE8"/></bottom><diagonal/></border>';
   // 0 plain; 1 navy title; 2 subtitle; 3 critical banner; 4 critical description;
   // 5 headers; 6 green header; 7 blue header; 8 block title; 9 block subtitle;
   // 10 body; 11 alternate; 12 chat; 13 telephone; 14 observations; 15 critical row;
   // 16 summary; 17 label; 18 input; 19 red finding.
   const xfs=[
     [0,0,0,false],[1,2,0,false],[2,9,0,true],[3,4,0,false],[6,5,0,true],
     [4,6,1,true],[4,7,1,true],[4,6,1,true],[3,2,0,false],[5,8,0,true],
     [0,10,1,true],[0,11,1,true],[0,12,1,true],[0,8,1,true],[0,9,1,true],
     [0,13,1,true],[1,2,0,false],[7,7,1,true],[0,8,1,true],[8,13,1,true]
   ];
   const xfXml=xfs.map(([fontId,fillId,borderId,wrap])=>
     '<xf numFmtId="0" fontId="'+fontId+'" fillId="'+fillId+'" borderId="'+borderId+
     '" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" '+
     (wrap?'wrapText="1" ':'')+'horizontal="left"/></xf>').join('');
   return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
     '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
     '<fonts count="'+fonts.length+'">'+fonts.join('')+'</fonts>'+
     '<fills count="'+fills.length+'">'+fills.join('')+'</fills>'+
     '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'+border+'</borders>'+
     '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
     '<cellXfs count="'+xfs.length+'">'+xfXml+'</cellXfs>'+
     '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
 };
 function colNumber(ref){
   const match=/^[A-Z]+/.exec(ref);
   if(!match)return 0;
   return [...match[0]].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0);
 }
 async function polishWorkbook(wb){
   if(!window.JSZip)throw Error('Biblioteca de formatação Excel indisponível');
   const zip=await JSZip.loadAsync(XLSX.write(wb,{bookType:'xlsx',type:'array',compression:true}));
   zip.file('xl/styles.xml',visualStyles());
   const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
   for(const [index,contentMax] of [[1,12],[2,7],[3,2]]){
     const path='xl/worksheets/sheet'+index+'.xml';
     const xml=await zip.file(path)?.async('string');
     if(!xml)throw Error('Aba '+index+' não encontrada na exportação');
     const doc=new DOMParser().parseFromString(xml,'application/xml');
     if(doc.getElementsByTagName('parsererror').length)throw Error('Não foi possível formatar a planilha');
     const sheetData=doc.getElementsByTagNameNS(ns,'sheetData')[0];
     for(const row of Array.from(sheetData.getElementsByTagNameNS(ns,'row'))){
       const rowNo=Number(row.getAttribute('r')||0);
       let styleFor=(col)=>{
         if(index===1){
           if(rowNo===1)return 1;
           if(rowNo===2)return 2;
           if(rowNo===9)return 3;
           if(rowNo===10)return 4;
           if([18,27,37,45].includes(rowNo))return 8;
           if([19,28,38,46].includes(rowNo))return 9;
           if([11,20,29,39,47].includes(rowNo))return col>=4&&col<=5?6:col>=6&&col<=7?7:5;
           if(rowNo>=13&&rowNo<=16)return col===8?14:col>=4&&col<=5?12:col>=6&&col<=7?13:15;
           if([25,35,43,53,55].includes(rowNo))return 16;
           if([56,57,58].includes(rowNo))return col===1?17:18;
           if(rowNo>=4&&rowNo<=7)return col===1?17:18;
           if([22,23,24,31,32,33,34,41,42,49,50,51,52].includes(rowNo))
             return col===8?14:col>=4&&col<=5?12:col>=6&&col<=7?13:rowNo%2?10:11;
           return 0;
         }
         if(index===2){
           if(rowNo===1)return 1;
           if([5,21].includes(rowNo))return 5;
           if(rowNo===20)return 3;
           if(rowNo===2||rowNo===3)return col%2?17:18;
           if(rowNo>=22&&rowNo<=25)return 15;
           if(rowNo>=6&&rowNo<=18)return rowNo%2?11:10;
           return 0;
         }
         if(rowNo===1)return 1;
         if(rowNo===2)return 4;
         if(rowNo===3)return 5;
         return rowNo%2?11:10;
       };
       // Materialize blank cells too: color bars span the full table width in Excel.
       const cells=new Map(Array.from(row.getElementsByTagNameNS(ns,'c')).map(c=>[colNumber(c.getAttribute('r')||''),c]));
       for(let col=1;col<=contentMax;col++){
         const style=styleFor(col);
         if(!style)continue;
         let c=cells.get(col);
         if(!c){
           c=doc.createElementNS(ns,'c');
           const letters=XLSX.utils.encode_col(col-1);
           c.setAttribute('r',letters+rowNo);
           const next=Array.from(row.getElementsByTagNameNS(ns,'c')).find(node=>colNumber(node.getAttribute('r')||'')>col);
           if(next)row.insertBefore(c,next);else row.appendChild(c);
         }
         c.setAttribute('s',String(style));
       }
       if(index===1){
         const h=[1,9,18,27,37,45].includes(rowNo)?31:
           [11,20,29,39,47].includes(rowNo)?27:
           [13,14,15,16,22,23,24,31,32,33,34,41,42,49,50,51,52].includes(rowNo)?55:24;
         row.setAttribute('ht',String(h));row.setAttribute('customHeight','1');
       } else if(index===2 && rowNo>=6){row.setAttribute('ht',rowNo>=22?44:60);row.setAttribute('customHeight','1');}
     }
     zip.file(path,new XMLSerializer().serializeToString(doc));
   }
   return zip.generateAsync({type:'blob',compression:'DEFLATE'});
 }
 function downloadFormatted(blob,name){
   const url=URL.createObjectURL(blob);
   const anchor=document.createElement('a');
   anchor.href=url;anchor.download=name;
   document.body.append(anchor);anchor.click();anchor.remove();
   setTimeout(()=>URL.revokeObjectURL(url),60000);
 }

 async function makeExcel({analysis,channel,collaborator,reviewer,sourceId,monitoredAt,transcript}){
  if(!window.XLSX)throw Error('Biblioteca Excel não carregada');
  if(!analysis||!Array.isArray(analysis.criteria))throw Error('Faça a avaliação com Gemini antes de exportar');
  const wb=XLSX.utils.book_new();
  const rows=Array.from({length:58},()=>Array(12).fill(''));
  const at=(r,c,v)=>rows[r-1][c-1]=safe(v??'');
  at(1,1,'FORMULÁRIO DE MONITORIA DE ATENDIMENTO – SUPORTE');
  at(2,1,'Todos os atendimentos iniciam com nota 100. Descontos dependem de evidências; esta avaliação da IA é provisória.');
  at(4,1,'Agente Avaliado:');at(4,2,collaborator||'');
  at(5,1,'Avaliador:');at(5,2,reviewer||'');
  at(6,1,'Número do Ticket:');at(6,2,sourceId||'');
  at(7,1,'Data do Atendimento:');at(7,2,monitoredAt||'');
  at(9,1,'🚨 FATORES ZERADORES (FALHAS CRÍTICAS)');
  at(10,1,'Suspeitas não são faltas confirmadas. Qualidade valida evidência e decide zeramento.');
  const headers=['Código','Critério','Descrição / O que avaliar','Chat','Parcial','Telefonia','Parcial','Observações','Situação IA','Desconto IA','Evidência','Justificativa / verificação'];
  const head=r=>headers.forEach((x,i)=>at(r,i+1,x));
  head(11);head(20);head(29);head(39);head(47);
  const byCritical=new Map((analysis.critical||[]).map(x=>[x.code,x]));
  CRITICAL.forEach((rule,i)=>{
   const row=13+i,found=byCritical.get(rule.code);
   at(row,1,rule.code);at(row,2,rule.name);at(row,3,rule.description);
   at(row,4,100);at(row,5,'N/A');at(row,6,100);at(row,7,'N/A');
   at(row,9,found?.suspected?'Suspeita crítica — conferir':'Não comprovada');
   at(row,11,found?.evidence||'Não comprovada');
   at(row,12,'Requer revisão da Qualidade; sem aplicação automática de penalidade definitiva');
  });
  const blocks=[
   [18,19,'BLOCO 1: Recepção e Identificação (Peso: 15%)','Foco: cliente atendido e identificado corretamente (SUP 001 e SUP 002)'],
   [27,28,'BLOCO 2: Condução, Troubleshooting e CX (Peso: 40%)','Foco: investigação, resolução e tempo do cliente (SUP 001, 003, 004, 005)'],
   [37,38,'BLOCO 3: Finalização do atendimento (Peso: 15%)','Foco: resolução, encaminhamento e encerramento cordial (SUP 001)'],
   [45,46,'BLOCO 4: Registro, Tabulação, Escalação e Conhecimento (Peso: 30%)','Foco: backoffice, registro e dados confiáveis (SUP 001)']
  ];
  for(const [header,subtitle,title,desc] of blocks){at(header,1,title);at(subtitle,1,desc);}
  const decisions=new Map(analysis.criteria.map(x=>[x.id,x]));
  RUBRIC.forEach((rule,i)=>{
   const r=ROWS[i],decision=decisions.get(rule.id);
   at(r,1,rule.code);at(r,2,rule.name);at(r,3,rule.description);
   at(r,4,num(rule.chat.points));at(r,5,num(rule.chat.partial));
   at(r,6,num(rule.voice.points));at(r,7,num(rule.voice.partial));
   at(r,9,decision?.decision||'não verificado');at(r,10,Number(decision?.deducted||0));
   at(r,11,decision?.evidence||'Não comprovada');at(r,12,decision?.reason||'Conferência manual necessária');
  });
  for(const [row,block] of [[25,1],[35,2],[43,3],[53,4]]){
   const subset=RUBRIC.filter(r=>r.block===block);
   at(row,2,'Subtotal do bloco');
   at(row,4,subset.reduce((s,x)=>s+(x.chat.points||0),0));
   at(row,6,subset.reduce((s,x)=>s+(x.voice.points||0),0));
   at(row,10,subset.reduce((s,x)=>s+Number(decisions.get(x.id)?.deducted||0),0));
  }
  at(55,1,'NOTA SUGERIDA (NÃO FINAL)');at(55,2,Number(analysis.scoreSuggestion));
  at(56,1,'COBERTURA DAS EVIDÊNCIAS');at(56,2,(analysis.verifiedCriteria||0)+' de '+(analysis.totalCriteria||13)+' critérios verificáveis');
  at(57,1,'SITUAÇÃO');at(57,2,analysis.incomplete?'Avaliação incompleta; não aprovar sem conferência':'Pendente de aprovação humana');
  at(58,1,'MODELO');at(58,2,analysis.version||'');
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:12},{wch:35},{wch:77},{wch:12},{wch:12},{wch:12},{wch:12},{wch:45},{wch:27},{wch:15},{wch:70},{wch:80}];
  ws['!rows']=rows.map((_,i)=>({hpt:[0,8,17,26,36,44].includes(i)?30:22}));
  ws['!merges']=[
   ...[1,2,9,10,18,19,27,28,37,38,45,46].map(r=>({s:{r:r-1,c:0},e:{r:r-1,c:11}}))
  ];
  ws['!freeze']={xSplit:3,ySplit:11,topLeftCell:'D12',activePane:'bottomRight',state:'frozen'};
  XLSX.utils.book_append_sheet(wb,ws,'Monitoria');
  const compare=[
   ['COMPARAÇÃO | ATENDIMENTO × ANÁLISE DA IA'],
   ['Ticket/Ligação',safe(sourceId||''),'Canal',channel,'Agente',safe(collaborator||''),'Avaliador',safe(reviewer||'')],
   ['Nota provisória',Number(analysis.scoreSuggestion),'Cobertura',String(analysis.verifiedCriteria||0)+'/'+String(analysis.totalCriteria||13),'Avaliação incompleta',analysis.incomplete?'Sim':'Não'],
   [],
   ['Código','Critério','Status IA','Desconto','Trecho comprovado no atendimento','Justificativa da IA','Conferência da Qualidade']
  ];
  RUBRIC.forEach(rule=>{const item=decisions.get(rule.id)||{};compare.push([rule.code,rule.name,safe(item.decision||'não verificado'),Number(item.deducted||0),safe(item.evidence||''),safe(item.reason||''),'Pendente'])});
  compare.push([],['FATORES CRÍTICOS Z1–Z4'],['Código','Fator','Suspeita IA','Evidência','Validação da Qualidade']);
  CRITICAL.forEach(rule=>{const item=byCritical.get(rule.code)||{};compare.push([rule.code,rule.name,item.suspected?'Suspeito':'Não confirmado',safe(item.evidence||''),'Pendente'])});
  const ws2=XLSX.utils.aoa_to_sheet(compare);
  ws2['!cols']=[{wch:14},{wch:42},{wch:24},{wch:18},{wch:74},{wch:75},{wch:31}];
  XLSX.utils.book_append_sheet(wb,ws2,'Comparativo IA');
  const evidenceLines=String(transcript||'').split(/\r?\n/);
  const ws3=XLSX.utils.aoa_to_sheet([
   ['ATENDIMENTO ORIGINAL — TEXTO FORNECIDO PARA AVALIAÇÃO'],
   ['Atenção: extrato Movidesk pode não conter toda a conversa. Não utilizar sozinho para validar tabulação, cadastro ou tempo.'],
   ['Linha','Texto do atendimento'],...evidenceLines.map((line,i)=>[i+1,safe(line)])
  ]);
  ws3['!cols']=[{wch:10},{wch:116}];
  XLSX.utils.book_append_sheet(wb,ws3,'Atendimento');
  const filename='Monitoria_Arquem_Formulario_IA_'+String(sourceId||'avaliacao').replace(/[^\w-]+/g,'_').slice(0,50)+'.xlsx';
  const blob=await polishWorkbook(wb);
  downloadFormatted(blob,filename);
  return filename;
 }
 window.monitoriaOfficialExcel=makeExcel;
})();
