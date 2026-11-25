/* Relatório de Triagem da Inteligência. Exportação e envio manual de relatório. */
(()=>{
 const el=id=>document.getElementById(id),safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=x=>x?new Date(x).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—';
 const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 let loaded=false,loading=false,items=[],current=[];
 const selectedIds=new Set();
 const visibleSelected=()=>current.filter(x=>selectedIds.has(String(x.id)));
 const exportItems=()=>el('itExportSelected').checked?visibleSelected():current;
 const syncSelection=()=>{
  const count=visibleSelected().length;
  el('itSelectedCount').textContent=count+' de '+current.length+' chamados filtrados selecionados';
  el('itSelectVisible').checked=current.length>0&&count===current.length;
  el('itSelectVisible').indeterminate=count>0&&count<current.length;
 };
 let emailVersion=0,emailBusy=false,emailSnapshot=null;
 function invalidateEmail(){
  emailVersion++;emailSnapshot=null;
  el('itEmailSend').disabled=true;
  el('itEmailFrame').hidden=true;
  el('itEmailFrame').removeAttribute('srcdoc');
  el('itEmailStatus').textContent='';
 }
 async function emailAction(action,data={}){
  const client=window.tmEmailAdminClient;
  if(!client)throw Error('Faça login novamente.');
  const {data:result,error}=await client.functions.invoke('audit-email-dispatch',{body:{action,...data}});
  if(error){
   const details=await error.context?.json?.().catch(()=>null);
   throw Error(details?.error||'Não foi possível concluir a operação de e-mail.');
  }
  if(!result?.ok)throw Error(result?.error||'Operação de e-mail indisponível.');
  return result;
 }
 async function runEmail(task){
  if(emailBusy)return;
  emailBusy=true;
  el('itEmailPreview').disabled=true;el('itEmailSend').disabled=true;
  try{await task()}
  catch(e){el('itEmailStatus').textContent=e.message}
  finally{emailBusy=false;el('itEmailPreview').disabled=false;el('itEmailSend').disabled=!emailSnapshot}
 }
 let copyContacts=[];
 const copySelected=new Set();
 const copyEmails=()=>[...copySelected].sort();
 function renderCopies(){
  const list=el('itEmailCcChoices'),recipient=el('itEmailTo').value.toLowerCase();
  copySelected.delete(recipient);
  el('itEmailCcSummary').textContent=copySelected.size
   ?copySelected.size+' selecionado(s) em cópia':'Selecionar e-mails cadastrados';
  list.replaceChildren();
  for(const {name,email} of copyContacts){
   if(email===recipient)continue;
   const label=document.createElement('label'),box=document.createElement('input');
   label.style.cssText='display:flex;align-items:center;gap:8px;padding:5px 2px;overflow-wrap:anywhere';
   box.type='checkbox';box.value=email;box.checked=copySelected.has(email);
   box.addEventListener('change',()=>{
    if(box.checked&&copySelected.size>=10){
     box.checked=false;el('itEmailCcHint').textContent='Selecione até 10 endereços em cópia.';return;
    }
    if(box.checked)copySelected.add(email);else copySelected.delete(email);
    el('itEmailCcSummary').textContent=copySelected.size
     ?copySelected.size+' selecionado(s) em cópia':'Selecionar e-mails cadastrados';
    el('itEmailCcHint').textContent='';
    invalidateEmail();
   });
   label.append(box,document.createTextNode(name+' · '+email));
   list.append(label);
  }
  if(!list.childElementCount)list.textContent='Nenhum outro e-mail corporativo ativo.';
 }
 async function loadCopies(){
  const {data,error}=await window.tmEmailAdminClient.from('audit_email_recipients')
   .select('name,email').eq('active',true).order('name',{ascending:true}).limit(250);
  const byEmail=new Map();
  if(!error)for(const item of data||[]){
   const email=String(item.email||'').trim().toLowerCase();
   if(/^[a-z0-9._%+-]+@arquem\.com\.br$/.test(email)&&!byEmail.has(email))
    byEmail.set(email,{email,name:String(item.name||email).trim()});
  }
  copyContacts=[...byEmail.values()];
  for(const selected of copySelected)if(!byEmail.has(selected))copySelected.delete(selected);
  renderCopies();
  if(error)el('itEmailCcChoices').textContent='Lista indisponível. Feche e reabra o painel para tentar novamente.';
 }
 function initCopies(){
  const input=el('itEmailCc'),details=document.createElement('details');
  details.id=input.id;
  details.style.cssText='min-width:220px;max-width:100%;padding:8px 10px;border:1px solid #61758c;border-radius:8px';
  details.innerHTML='<summary id="itEmailCcSummary" style="cursor:pointer">Selecionar e-mails cadastrados</summary>'+
   '<div id="itEmailCcChoices" style="max-height:180px;overflow:auto"></div><small id="itEmailCcHint" role="status"></small>';
  input.replaceWith(details);
  const label=details.parentElement.querySelector('label');
  const caption=document.createElement('span');
  caption.textContent=label.textContent;
  caption.style.cssText='display:block;margin-bottom:5px';
  label.replaceWith(caption);
 }
 async function openEmail(){
  const panel=el('itEmailPanel');
  if(!panel.classList.contains('hide')){panel.classList.add('hide');invalidateEmail();return;}
  await runEmail(async()=>{
   const result=await emailAction('triage_manual_recipients');
   el('itEmailTo').replaceChildren(...result.recipients.map(({name,email})=>new Option(name+' · '+email,email)));
   await loadCopies().catch(()=>{copyContacts=[];copySelected.clear();renderCopies();el('itEmailCcChoices').textContent='Lista indisponível. Feche e reabra o painel para tentar novamente.';});
   panel.classList.remove('hide');
   el('itEmailStatus').textContent='A prévia usa os chamados da exportação atual.';
  });
  if(panel.classList.contains('hide')&&el('itEmailStatus').textContent)status(el('itEmailStatus').textContent);
 }
 function previewEmail(){
  return runEmail(async()=>{
   invalidateEmail();
   const version=emailVersion;
   const ids=exportItems().map(x=>String(x.id));
   if(!ids.length)throw Error('Nenhum chamado nesta seleção de exportação.');
   el('itEmailStatus').textContent='Gerando prévia e validando PDF e Excel...';
   const preview=await emailAction('triage_manual_preview',{ids,to:el('itEmailTo').value,cc:copyEmails()});
   if(version!==emailVersion)return;
   emailSnapshot=preview.snapshotId;
   el('itEmailFrame').srcdoc=preview.html;
   el('itEmailFrame').hidden=false;
   const size=n=>new Intl.NumberFormat('pt-BR').format(Math.ceil(n/1024))+' KB';
   el('itEmailStatus').textContent=preview.subject+' · '+preview.rows+' chamado(s) · Para: '+preview.to+
    ' · CC: '+(preview.cc.join(', ')||'—')+' · PDF: '+size(preview.pdfBytes)+' · Excel: '+size(preview.xlsxBytes);
  });
 }
 function sendEmail(){
  if(!emailSnapshot||!window.confirm('Enviar o e-mail com os destinatários e anexos desta prévia?'))return;
  const snapshotId=emailSnapshot;
  return runEmail(async()=>{
   emailSnapshot=null;
   el('itEmailStatus').textContent='Confirmando envio...';
   const result=await emailAction('triage_manual_send',{snapshotId});
   el('itEmailStatus').textContent=result.status==='already_sent'?'Este relatório já foi enviado para esse destinatário.':'E-mail enviado com PDF e Excel.';
  });
 }
 const toggleVisible=checked=>{current.forEach(x=>checked?selectedIds.add(String(x.id)):selectedIds.delete(String(x.id)));paint()};
 const status=s=>{if(el('itStatus'))el('itStatus').textContent=s};
 const ageBucket=days=>days>=16&&days<=30?'16-30':
   days>=31&&days<=60?'31-60':days>=61&&days<=90?'61-90':days>90?'91+':null;
 const activeBuckets=()=>new Set([...el('itDays').querySelectorAll('input.itDayBucket:checked')].map(x=>x.value));
 const paintAgeLabel=()=>{
   const bucketCount=activeBuckets().size;
   el('itDaysSummary').textContent=bucketCount===4?'Mais de 15 dias':
     bucketCount===0?'Nenhuma faixa selecionada':bucketCount+' faixa(s) selecionada(s)';
 };
 const selected=()=>{
  const chosen=activeBuckets(),t=el('itType').value,q=norm(el('itSearch').value);
  return items.filter(x=>chosen.has(ageBucket(Number(x.queueDays)))&&(!t||x.type===t)&&
   (!q||norm([x.id,x.subject,x.client,x.status].join(' ')).includes(q)));
 };
 const outputColumns=[
  ['Chamado',x=>x.id],['Tipo',x=>x.type],['Cliente',x=>x.client],['Assunto',x=>x.subject],
  ['Dias na triagem',x=>x.queueDays],['Entrada na triagem',x=>date(x.queueSince)],
  ['Abertura',x=>date(x.opened)],['Idade total (dias)',x=>x.ageDays??''],
  ['Previsão',x=>date(x.forecast)],['Status',x=>x.status],
  ['Próxima etapa',x=>x.nextStep],['Link Movidesk',x=>x.url]];
 function paint(){
  paintAgeLabel();
  current=selected();
  const cards=[['Chamados acima do limite',current.length],['Maior tempo na fila',current.length?Math.max(...current.map(x=>x.queueDays))+' dias':'—'],
   ['Sem previsão',current.filter(x=>!x.forecast).length],['T1 / T2 / T3 / T4',[1,2,3,4].map(n=>current.filter(x=>x.type==='T'+n).length).join(' / ')]];
  el('itCards').innerHTML=cards.map(([k,v])=>'<div class="card" style="margin:0;padding:14px"><div class="subtle">'+safe(k)+'</div><strong style="font-size:23px">'+safe(v)+'</strong></div>').join('');
  el('itTable').querySelector('tbody').innerHTML=current.map(x=>'<tr><td><input type="checkbox" class="itRowSelect" data-id="'+safe(x.id)+'" aria-label="Selecionar chamado '+safe(x.id)+'" '+(selectedIds.has(String(x.id))?'checked':'')+'></td><td><a target="_blank" rel="noopener noreferrer" href="'+safe(x.url)+'">#'+safe(x.id)+'</a></td>'+
   '<td>'+safe(x.type)+'</td><td>'+safe(x.client)+'</td><td>'+safe(x.subject)+'</td>'+
   '<td><b>'+safe(x.queueDays)+' dias</b></td><td>'+safe(date(x.queueSince))+'</td><td>'+safe(date(x.opened))+
   '</td><td>'+safe(x.ageDays??'—')+'</td><td>'+safe(date(x.forecast))+'</td><td>'+safe(x.status)+'</td></tr>').join('')||'<tr><td colspan="10">Nenhum chamado para os filtros selecionados.</td></tr>';
  syncSelection();
  invalidateEmail();
  if(el('itNavCount'))el('itNavCount').textContent=String(items.filter(x=>x.queueDays>15).length);
 }
 async function refresh(){
  if(loading)return;loading=true;el('itRefresh').disabled=true;status('Atualizando Triagem da Inteligência...');
  try{
   const session=await window.tmAuth?.getSession?.();
   if(!session?.access_token)throw Error('Faça login novamente para consultar a triagem.');
   const r=await fetch('/api/audit-production-metrics?mode=triage',{
    cache:'no-store',headers:{Authorization:'Bearer '+session.access_token,Accept:'application/json'}});
   const d=await r.json().catch(()=>({}));
   if(!r.ok||!d.ok||!Array.isArray(d.items))throw Error(d.error||'Não foi possível consultar a triagem.');
   items=d.items;
   const valid=new Set(items.map(x=>String(x.id)));
   [...selectedIds].forEach(id=>{if(!valid.has(id))selectedIds.delete(id)});
   paint();
   const last=d.items.map(x=>x.syncedAt).filter(Boolean).sort().at(-1);
   status('Fonte: Movidesk sincronizado · '+current.length+' chamado(s) após filtros · Última sincronização entre os registros: '+date(last)+'.');
  }catch(e){status('Falha na consulta: '+e.message)}
  finally{loading=false;el('itRefresh').disabled=false}
 }
 const rows=data=>data.map(x=>outputColumns.map(([,f])=>f(x)));
 const exportGuard=()=>{
  const data=exportItems();
  if(!data.length)status(el('itExportSelected').checked?'Selecione ao menos um chamado filtrado para exportar.':'Não há chamados para exportar.');
  return data;
 };
 function excel(){
  const data=exportGuard();if(!data.length)return;
  if(!window.XLSX){status('Exportação Excel indisponível: biblioteca não carregada.');return}
  const sheet=XLSX.utils.aoa_to_sheet([outputColumns.map(x=>x[0]),...rows(data)]);
  sheet['!cols']=[{wch:12},{wch:7},{wch:35},{wch:70},{wch:18},{wch:22},{wch:15},{wch:18},{wch:16},{wch:20},{wch:32},{wch:55}];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'Inteligência - Triagem');
  XLSX.writeFile(wb,'triagem-inteligencia-'+new Date().toISOString().slice(0,10)+'.xlsx');
 }
 function pdf(){
  const data=exportGuard();if(!data.length)return;
  const C=window.jspdf?.jsPDF;
  if(!C){status('Exportação PDF indisponível: biblioteca não carregada.');return}
  const doc=new C({orientation:'landscape'});
  doc.setFontSize(15);doc.text('ARQUEM | Auditoria da Triagem da Inteligência',14,17);
  doc.setFontSize(9);doc.text('Aguardando avaliação da Produção · dias na fila desde última movimentação · '+new Date().toLocaleDateString('pt-BR'),14,24);
  const body=data.map(x=>[x.id,x.type,x.client,x.subject,x.queueDays,date(x.queueSince),date(x.forecast),x.status]);
  if(typeof doc.autoTable!=='function'){status('Exportação PDF indisponível: tabela não carregada.');return}
  doc.autoTable({startY:29,head:[['Chamado','Tipo','Cliente','Assunto','Dias na fila','Entrada','Previsão','Status']],
   body,styles:{fontSize:7,overflow:'linebreak'},headStyles:{fillColor:[23,59,101]},columnStyles:{3:{cellWidth:85}},margin:12});
  doc.save('triagem-inteligencia-'+new Date().toISOString().slice(0,10)+'.pdf');
 }
 window.intelligenceTriageInit=()=>{
  if(!loaded){
   loaded=true;
   el('itRefresh').addEventListener('click',refresh);
   el('itEmailOpen').addEventListener('click',openEmail);
   el('itEmailPreview').addEventListener('click',previewEmail);
   el('itEmailSend').addEventListener('click',sendEmail);
   initCopies();
   el('itEmailTo').addEventListener('change',()=>{renderCopies();invalidateEmail()});
   el('itExportSelected').addEventListener('change',invalidateEmail);
   el('itXlsx').addEventListener('click',excel);
   el('itPdf').addEventListener('click',pdf);
   el('itSelectAll').addEventListener('click',()=>toggleVisible(true));
   el('itClearSelection').addEventListener('click',()=>{selectedIds.clear();paint()});
   el('itSelectVisible').addEventListener('change',e=>toggleVisible(e.target.checked));
   el('itTable').querySelector('tbody').addEventListener('change',e=>{
    const input=e.target.closest('input.itRowSelect');if(!input)return;
    input.checked?selectedIds.add(input.dataset.id):selectedIds.delete(input.dataset.id);
    syncSelection();
    invalidateEmail();
   });
   el('itDays').addEventListener('change',e=>{if(e.target.matches('input.itDayBucket'))paint()});
   el('itDaysAll').addEventListener('click',()=>{el('itDays').querySelectorAll('input.itDayBucket').forEach(x=>x.checked=true);paint()});
   el('itDaysNone').addEventListener('click',()=>{el('itDays').querySelectorAll('input.itDayBucket').forEach(x=>x.checked=false);paint()});
   el('itType').addEventListener('change',paint);
   el('itSearch').addEventListener('input',paint);
  }
  if(!items.length)refresh();else paint();
 };
})();