/* Pacotes corporativos da Mini Central — preparação local, sem qualquer envio. */
(()=>{
 const $=id=>document.getElementById(id);
 const host=location.origin;
 const fmt=(d)=>String(d||'').slice(0,10);
 const safe=(x)=>String(x||'').replace(/[\\/:*?"<>|]+/g,'_').slice(0,85);
 const escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const iso=d=>{const x=new Date(d+'T12:00:00Z');return Number.isNaN(x.getTime())?null:x};
 const dateString=d=>d.toISOString().slice(0,10);
 const addDays=(d,offset)=>{const x=new Date(d.getTime());x.setUTCDate(x.getUTCDate()+offset);return dateString(x)};
 function periods(period,anchor){
   const value=iso(anchor);if(!value)throw Error('Selecione uma data válida');
   const year=value.getUTCFullYear(),month=String(value.getUTCMonth()+1).padStart(2,'0');
   if(period==='weekly'){
     const monday=addDays(value,-((value.getUTCDay()+6)%7));
     return {from:monday,to:addDays(iso(monday),6),label:'Semanal'};
   }
   if(period==='monthly')return {from:year+'-'+month+'-01',to:dateString(new Date(Date.UTC(year,value.getUTCMonth()+1,0))),label:'Mensal'};
   if(period==='annual')return {from:year+'-01-01',to:year+'-12-31',label:'Anual'};
   throw Error('Tipo de período inválido');
 }
 async function fetchJson(path,opts={}){
   const session=await window.tmAuth?.getSession?.();
   if(!session?.access_token)throw Error('Faça login na Central de Auditoria');
   const response=await fetch(path,{...opts,headers:{
    ...(opts.headers||{}),Authorization:'Bearer '+session.access_token
   },cache:'no-store',credentials:'same-origin'});
   const data=await response.json().catch(()=>({}));
   if(!response.ok||data.ok!==true)throw Error(data.error||'Consulta indisponível');
   return data;
 }
 const audioLink=r=>
   r.channel==='voice'&&['inbound','outbound'].includes(r.recording_kind)&&/^\d{1,14}$/.test(String(r.source_id))&&
   /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(String(r.id||''))?
     host+'/?monitoria_voice='+encodeURIComponent(r.source_id)+'&kind='+r.recording_kind+'&review='+encodeURIComponent(r.id):null;
 function emailHtml(rows,period){
   const approved=rows.filter(x=>x.review_status==='approved'&&typeof x.score_approved==='number');
   const average=approved.length?(approved.reduce((n,r)=>n+Number(r.score_approved),0)/approved.length).toFixed(2):'—';
   const collaborator=escapeHtml(approved[0]?.collaborator_name||'');
   const line=approved.map(r=>{
    const href=audioLink(r);
    const ref=r.channel==='chat'?
      '<span>Extrato das interações do Movidesk: confira se o PDF está no pacote e se o diálogo está completo</span>':
      href?'<a href="'+escapeHtml(href)+'" style="color:#1d4ed8">Abrir gravação (login obrigatório)</a>':'<span>Gravação não homologada</span>';
    return '<tr><td>'+escapeHtml(fmt(r.monitored_at))+'</td><td>'+escapeHtml(r.channel==='chat'?'Chat Movidesk':'Ligação Zenvia')+'</td><td>#'+escapeHtml(r.source_id)+'</td><td>'+escapeHtml(r.reviewer_name)+'</td><td style="font-weight:700">'+Number(r.score_approved).toFixed(2)+'</td><td>'+(r.critical_confirmed?'Crítica confirmada':'—')+'</td><td>'+ref+'</td></tr>';
   }).join('');
   return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body style="font:14px Arial,sans-serif;color:#14213d;background:#f5f7fc;padding:20px"><table role="presentation" style="max-width:920px;width:100%;background:white;border-collapse:collapse;margin:auto"><tr><td style="background:#14213d;color:white;padding:24px"><strong style="font-size:21px">ARQUEM · MONITORIA DE QUALIDADE</strong><div style="color:#cbd5e1;margin-top:7px">Relatório corporativo — '+escapeHtml(period.label)+' · '+period.from+' a '+period.to+'</div></td></tr><tr><td style="padding:25px"><h2 style="margin:0 0 8px">'+collaborator+'</h2><p>Monitorias aprovadas: <b>'+approved.length+'</b> · Média: <b>'+average+'</b> / 100</p><p>Gestor: confira as notas, critérios e evidências no Excel. Nenhuma avaliação provisória foi incluída neste pacote.</p><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#eaf0fa"><th>Data</th><th>Canal</th><th>Registro</th><th>Monitor(a)</th><th>Nota</th><th>Crítico</th><th>Evidência</th></tr></thead><tbody>'+line+'</tbody></table><p style="color:#53657f;font-size:12px">Os links de áudio exigem login e autorização na Central. Não compartilhe arquivos anexos fora dos destinatários habilitados. A origem Movidesk pode conter apenas interações registradas no chamado.</p></td></tr><tr><td style="background:#edf2fa;padding:14px 24px;color:#586c87;font-size:12px">ARQUEM · Gestão de Qualidade | Prévia sem envio automático</td></tr></table></body></html>';
 }
 function workbook(rows){
   const XLSX=window.XLSX;if(!XLSX)throw Error('Biblioteca Excel indisponível');
   const book=XLSX.utils.book_new();
   const add=(name,data)=>XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(data),name);
   const approved=rows.filter(r=>r.review_status==='approved');
   add('Notas',[['Data','Colaborador','Setor','Canal','Chamado ou ligação','Monitor responsável','Nota IA','Nota aprovada','Crítica confirmada','Parecer'],
      ...approved.map(r=>[r.monitored_at,r.collaborator_name,r.sector,r.channel,r.source_id,r.reviewer_name,r.score_suggested,r.score_approved,r.critical_confirmed?'Sim':'Não',r.reviewer_notes||''])]);
   add('Critérios',[['Data','ID atendimento','Colaborador','Monitor responsável','Código','Decisão','Desconto','Evidência'],
      ...approved.flatMap(r=>(r.criteria||[]).map(c=>[r.monitored_at,r.source_id,r.collaborator_name,r.reviewer_name,c.id,c.decision,c.deducted,c.evidence]))]);
   add('Não Conformidades',[['Data','Colaborador','ID atendimento','Monitor responsável','Código','Evidência','Confirmada','Gestor notificado','Data ciência'],
      ...approved.flatMap(r=>(r.critical_findings||[]).filter(c=>c.suspected).map(c=>[r.monitored_at,r.collaborator_name,r.source_id,r.reviewer_name,c.code,c.evidence,r.critical_confirmed?'Sim':'Não',r.audit_monitoria_alerts?.status||'Não registrado',r.audit_monitoria_alerts?.acknowledged_at||'']))]);
   return XLSX.write(book,{type:'array',bookType:'xlsx',compression:true});
 }
 function finalReportPDF(rows,period){
   const ctor=window.jspdf?.jsPDF;if(!ctor)throw Error('Biblioteca de PDF indisponível');
   const approved=rows.filter(r=>r.review_status==='approved'&&Number.isFinite(Number(r.score_approved)));
   if(!approved.length)throw Error('Relatório sem monitorias aprovadas');
   const pdf=new ctor({unit:'mm',format:'a4'});const width=210;
   let y=39,page=1;
   const baseHeader=()=>{
    pdf.setFillColor(20,33,61);pdf.rect(0,0,width,30,'F');
    pdf.setTextColor(255,255,255);pdf.setFontSize(15);pdf.setFont('helvetica','bold');
    pdf.text('ARQUEM | RELATORIO DE MONITORIA',12,14);
    pdf.setFontSize(9);pdf.setFont('helvetica','normal');
    pdf.text(period.label.toUpperCase()+' | '+period.from+' a '+period.to,12,23);
    pdf.setTextColor(22,40,68);
   };
   const newPage=()=>{pdf.addPage();page++;baseHeader();y=39};
   const block=(str,weight='normal')=>{
    const lines=pdf.splitTextToSize(String(str||''),184);
    pdf.setFont('helvetica',weight);pdf.setFontSize(9);
    for(const line of lines){
      if(y>274)newPage();
      pdf.text(line,13,y);y+=5;
    }
   };
   baseHeader();
   const sum=approved.reduce((n,r)=>n+Number(r.score_approved),0);
   block('Colaborador: '+approved[0].collaborator_name,'bold');
   block('Monitorias aprovadas: '+approved.length+' | Nota media: '+(sum/approved.length).toFixed(2)+' / 100');
   block('Ocorrencias criticas confirmadas: '+approved.filter(r=>r.critical_confirmed).length);
   block('Relatorio de evidencias e notas. Os extratos de chat acompanham o pacote quando disponiveis.');
   y+=4;
   for(const r of approved){
     if(y>235)newPage();
     pdf.setDrawColor(190,202,222);pdf.line(12,y,198,y);y+=7;
     block('Data: '+r.monitored_at+' | Canal: '+(r.channel==='voice'?'Ligacao':'Chat')+' | Atendimento: '+r.source_id,'bold');
     block('Monitor responsavel: '+r.reviewer_name+' | Setor: '+r.sector);
     block('Nota sugerida: '+r.score_suggested+' / 100 | Nota aprovada: '+r.score_approved+' / 100'+(r.critical_confirmed?' | CRITICO CONFIRMADO':''));
     if(r.reviewer_notes)block('Parecer da Qualidade: '+r.reviewer_notes);
     if(r.channel==='voice'){
       const link=audioLink(r);
       if(link){
         block('Gravacao: link privado exige login na Central de Auditoria');
         if(y>272)newPage();
         pdf.setTextColor(30,70,165);pdf.textWithLink('Abrir gravacao autorizada',13,y,{url:link});
         pdf.setTextColor(22,40,68);y+=7;
       }else block('Gravacao: origem/numero nao confirmados');
     }
     const critical=(r.critical_findings||[]).filter(x=>x.suspected);
     for(const c of critical)block('Falha '+c.code+': '+(r.critical_confirmed?'confirmada':'nao confirmada')+' | '+String(c.evidence||'').slice(0,400));
     y+=6;
   }
   pdf.setProperties({title:'Relatorio de Monitoria Arquem '+period.label,subject:'Monitoria aprovada e evidencias'});
   return pdf.output('arraybuffer');
 }
 function chatPDF(review,messages){
   const ctor=window.jspdf?.jsPDF;if(!ctor)throw Error('Biblioteca de PDF indisponível');
   const pdf=new ctor({format:'a4',unit:'mm'});let y=21;
   pdf.setFillColor(20,33,61);pdf.rect(0,0,210,20,'F');pdf.setTextColor(255,255,255);pdf.setFontSize(13);
   pdf.text('ARQUEM | EXTRATO DAS INTERACOES MOVIDESK',13,12);pdf.setTextColor(25,38,59);pdf.setFontSize(10);
   const header=['Chamado Movidesk: #'+review.source_id,'Colaborador: '+review.collaborator_name,
     'Monitor responsável: '+review.reviewer_name,'Data da monitoria: '+review.monitored_at,
     'Nota aprovada: '+review.score_approved+'/100',
     'ATENCAO: extrato das acoes do chamado; nao certifica chat completo.'];
   for(const row of header){pdf.text(pdf.splitTextToSize(row,183),12,y);y+=7}
   y+=3;pdf.setFontSize(9);
   for(const m of messages){
     const label='['+(m.at||'sem hora')+'] '+(m.sender||'Participante')+': '+m.text;
     const lines=pdf.splitTextToSize(label,181);
     for(const line of lines){if(y>280){pdf.addPage();y=18}pdf.text(line,12,y);y+=4.6}
     y+=2;
   }
   return pdf.output('arraybuffer');
 }
 let previewRows=[],previewPeriod=null;
 async function load(){
   const kind=$('monPackagePeriod').value,anchor=$('monPackageAnchor').value,collaborator=$('monPackageCollaborator').value.trim();
   if(!collaborator)throw Error('Informe o colaborador para gerar o pacote');
   const range=periods(kind,anchor);
   const data=await fetchJson('/api/monitoria-reviews?'+new URLSearchParams({
    kind:'reviews',from:range.from,to:range.to,collaborator
   }));
   if(data.partial)throw Error('Relatório parcial acima de 1.000 registros. Divida o período para não omitir notas.');
   const rows=(data.reviews||[]).filter(r=>r.review_status==='approved'&&r.collaborator_name===collaborator);
   if(!rows.length)throw Error('Nenhuma monitoria aprovada deste colaborador no período');
   previewRows=rows;previewPeriod=range;
   const html=emailHtml(rows,range);
   $('monPackagePreview').srcdoc=html;
   $('monPackageDownload').disabled=false;
   $('monPackageSummary').textContent=rows.length+' avaliações aprovadas · '+range.label+' · '+range.from+' a '+range.to+'. Prévia somente, nenhum e-mail enviado.';
 }
 async function downloadPackage(){
   if(!previewRows.length||!previewPeriod)throw Error('Gere uma prévia antes de preparar o pacote');
   const chats=previewRows.filter(r=>r.channel==='chat'&&/^\d{1,12}$/.test(r.source_id));
   if(chats.length>60)throw Error('Mais de 60 chats neste pacote. Divida o período para anexar todos os PDFs.');
   if(!window.JSZip)throw Error('Biblioteca de compactação indisponível');
   const zip=new window.JSZip();
   zip.file('Email_Corporativo_Previa.html',emailHtml(previewRows,previewPeriod));
   zip.file('Notas_Monitoria.xlsx',workbook(previewRows));
   zip.file('Relatorio_Final_Monitoria.pdf',finalReportPDF(previewRows,previewPeriod));
   const missing=[];
   const included=[];
   for(const r of chats){
    try{
     const result=await fetchJson('/api/monitoria-movidesk?'+new URLSearchParams({ticketId:r.source_id}));
     if(result.partial||!result.messages?.length){missing.push(r.source_id);continue}
     zip.file('Interacoes_Movidesk/Extrato_'+safe(r.source_id)+'_'+safe(r.id)+'.pdf',chatPDF(r,result.messages));
     included.push({reviewId:r.id,sourceId:r.source_id,interactions:result.messages.length,fullChatVerified:false});
    }catch{missing.push(r.source_id);}
   }
   const manifest={
     generatedAt:new Date().toISOString(),period:previewPeriod,collaborator:previewRows[0].collaborator_name,
     approvedReviews:previewRows.length,pdfReportIncluded:true,excelIncluded:true,
     chatExtractsIncluded:included,chatExtractsMissing:missing,
     chatFullHistoryValidated:false,
     emailsSent:false,recordingsEmbedded:false,
     recordingLinksRequireExistingCentralLogin:true
   };
   zip.file('MANIFESTO_MONITORIA.json',JSON.stringify(manifest,null,2));
   if(missing.length)zip.file('PENDENCIAS_CHAT.txt','Os seguintes extratos Movidesk NÃO foram anexados devido a histórico insuficiente ou falha de consulta:\n'+missing.join('\n'));
   zip.file('LEIA_ANTES_DE_ENVIAR.txt','PACOTE GERADO SEM ENVIO DE EMAIL.\nOs links para gravações exigem login e permissões da Central de Auditoria.\nApenas notas aprovadas foram incluídas.\nOs PDFs são EXTRATOS de interações retornadas pelo Movidesk; NÃO garantem o chat integral.\nNão envie este pacote a destinatários sem autorização de acesso.\n');
   const blob=await zip.generateAsync({type:'blob'});
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
   a.download='Pacote_Monitoria_'+safe(previewRows[0].collaborator_name)+'_'+previewPeriod.from+'_a_'+previewPeriod.to+'.zip';
   a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
   $('monPackageSummary').textContent='Pacote preparado, sem e-mail enviado. Extratos Movidesk pendentes: '+missing.length+'. NÃO considerar o chat completo apenas com base no extrato.';
 }
 function bind(){
  if(!$('monPackagePeriod'))return;
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());$('monPackageAnchor').value=today;
  $('monPackagePreviewButton').onclick=async()=>{try{await load()}catch(e){$('monPackageSummary').textContent=e.message}};
  $('monPackageDownload').onclick=async()=>{try{await downloadPackage()}catch(e){$('monPackageSummary').textContent=e.message}};
  $('monPackagePeriod').onchange=()=>{$('monPackageDownload').disabled=true;previewRows=[]};
  $('monPackageCollaborator').oninput=()=>{$('monPackageDownload').disabled=true;previewRows=[]};
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
