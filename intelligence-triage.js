/* Relatório de Triagem da Inteligência. Sem alteração de tickets ou envio de e-mail. */
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
 const toggleVisible=checked=>{current.forEach(x=>checked?selectedIds.add(String(x.id)):selectedIds.delete(String(x.id)));paint()};
 const status=s=>{if(el('itStatus'))el('itStatus').textContent=s};
 const selected=()=>{
  const threshold=Number(el('itDays').value)||15,t=el('itType').value,q=norm(el('itSearch').value);
  return items.filter(x=>x.queueDays>threshold&&(!t||x.type===t)&&
   (!q||norm([x.id,x.subject,x.client,x.status].join(' ')).includes(q)));
 };
 const outputColumns=[
  ['Chamado',x=>x.id],['Tipo',x=>x.type],['Cliente',x=>x.client],['Assunto',x=>x.subject],
  ['Dias na triagem',x=>x.queueDays],['Entrada na triagem',x=>date(x.queueSince)],
  ['Abertura',x=>date(x.opened)],['Idade total (dias)',x=>x.ageDays??''],
  ['Previsão',x=>date(x.forecast)],['Status',x=>x.status],
  ['Próxima etapa',x=>x.nextStep],['Link Movidesk',x=>x.url]];
 function paint(){
  current=selected();
  const cards=[['Chamados acima do limite',current.length],['Maior tempo na fila',current.length?Math.max(...current.map(x=>x.queueDays))+' dias':'—'],
   ['Sem previsão',current.filter(x=>!x.forecast).length],['T1 / T2 / T3 / T4',[1,2,3,4].map(n=>current.filter(x=>x.type==='T'+n).length).join(' / ')]];
  el('itCards').innerHTML=cards.map(([k,v])=>'<div class="card" style="margin:0;padding:14px"><div class="subtle">'+safe(k)+'</div><strong style="font-size:23px">'+safe(v)+'</strong></div>').join('');
  el('itTable').querySelector('tbody').innerHTML=current.map(x=>'<tr><td><input type="checkbox" class="itRowSelect" data-id="'+safe(x.id)+'" aria-label="Selecionar chamado '+safe(x.id)+'" '+(selectedIds.has(String(x.id))?'checked':'')+'></td><td><a target="_blank" rel="noopener noreferrer" href="'+safe(x.url)+'">#'+safe(x.id)+'</a></td>'+
   '<td>'+safe(x.type)+'</td><td>'+safe(x.client)+'</td><td>'+safe(x.subject)+'</td>'+
   '<td><b>'+safe(x.queueDays)+' dias</b></td><td>'+safe(date(x.queueSince))+'</td><td>'+safe(date(x.opened))+
   '</td><td>'+safe(x.ageDays??'—')+'</td><td>'+safe(date(x.forecast))+'</td><td>'+safe(x.status)+'</td></tr>').join('')||'<tr><td colspan="10">Nenhum chamado para os filtros selecionados.</td></tr>';
  syncSelection();
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
   el('itXlsx').addEventListener('click',excel);
   el('itPdf').addEventListener('click',pdf);
   el('itSelectAll').addEventListener('click',()=>toggleVisible(true));
   el('itClearSelection').addEventListener('click',()=>{selectedIds.clear();paint()});
   el('itSelectVisible').addEventListener('change',e=>toggleVisible(e.target.checked));
   el('itTable').querySelector('tbody').addEventListener('change',e=>{
    const input=e.target.closest('input.itRowSelect');if(!input)return;
    input.checked?selectedIds.add(input.dataset.id):selectedIds.delete(input.dataset.id);
    syncSelection();
   });
   ['itDays','itType'].forEach(id=>el(id).addEventListener('change',paint));
   el('itSearch').addEventListener('input',paint);
  }
  if(!items.length)refresh();else paint();
 };
})();