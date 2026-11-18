(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const fmt=n=>Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:2});
 let last=null,processing=false;
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const addDays=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 function post(role,message){
  const el=document.createElement('div');el.className='ai-report-message '+(role==='user'?'ai-report-user':'ai-report-assistant');
  const label=document.createElement('strong');label.textContent=role==='user'?'Você':'Ticket Manager · Relatórios';
  const content=document.createElement('div');content.style.whiteSpace='pre-wrap';content.textContent=message;
  el.append(label,content);$('aiReportConversation').append(el);el.scrollIntoView({block:'nearest',behavior:'smooth'});return el;
 }
 const cols=[['Setores','bySector'],['Colaboradores','byCollaborator'],['Clientes','byClient'],['Atividades','byActivity']];
 function renderStats(data){
  const stats=$('aiReportStats');stats.replaceChildren();
  const {summary}=data;
  for(const [label,value] of [['Horas apontadas',fmt(summary.totalHours)+' h'],['Chamados',String(summary.tickets)],['Apontamentos',String(summary.records)],['Fora de dias úteis',fmt(summary.hoursOutsideBusinessDays)+' h']]){
   const box=document.createElement('div');box.className='card';box.style.padding='10px 14px';
   const caption=document.createElement('small');caption.textContent=label;const number=document.createElement('h3');number.style.margin='4px 0';number.textContent=value;box.append(caption,number);stats.append(box);
  }
  const table=$('aiReportRanking');table.replaceChildren();
  for(const [title,key] of cols){
   const rows=data[key]||[];if(!rows.length)continue;
   const section=document.createElement('section');section.style.marginTop='12px';
   const heading=document.createElement('h4');heading.textContent=title;section.append(heading);
   const list=document.createElement('ol');
   for(const r of rows.slice(0,6)){const li=document.createElement('li');li.textContent=r.name+' — '+fmt(r.hours)+' h / '+r.entries+' apontamentos';list.append(li)}
   section.append(list);table.append(section);
  }
  $('aiReportExport').disabled=false;$('aiReportPrint').disabled=false;
 }
 function csvField(v){const s=String(v??'');return '"'+s.replace(/"/g,'""')+'"'}
 function exportCsv(){
  if(!last)return;
  const out=[['Grupo','Nome','Horas','Apontamentos','Chamados']];
  for(const [title,key] of cols)for(const row of last[key]||[])out.push([title,row.name,String(row.hours).replace('.',','),row.entries,row.tickets]);
  const csv='\uFEFF'+out.map(row=>row.map(csvField).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='relatorio-personalizado-'+last.summary.periodFrom+'_'+last.summary.periodTo+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 }
 async function submit(e){
  e?.preventDefault();if(processing)return;
  const input=$('aiReportPrompt'),prompt=input.value.trim();
  if(!prompt){$('aiReportStatus').textContent='Descreva o relatório que deseja gerar.';input.focus();return}
  const from=$('aiReportFrom').value,to=$('aiReportTo').value;
  if(!from||!to||from>to){$('aiReportStatus').textContent='Confira as datas inicial e final.';return}
  const client=window.tmEmailAdminClient;
  if(!client){$('aiReportStatus').textContent='Faça login na Central para consultar os relatórios.';return}
  processing=true;$('aiReportSend').disabled=true;
  $('aiReportStatus').textContent='Calculando indicadores e preparando a resposta...';
  post('user',prompt);input.value='';
  try{
   const {data,error}=await client.functions.invoke('audit-ai-reports',{body:{prompt,from,to,sector:$('aiReportSector').value.trim(),collaborator:$('aiReportCollaborator').value.trim(),client:$('aiReportClient').value.trim(),externalAiConsent:$('aiReportConsent').checked}});
   if(error){let detail=error.message||'Falha na consulta';try{const body=await error.context?.json();if(body?.error)detail=body.error}catch{}throw Error(detail)}
   if(!data?.ok)throw Error(data?.error||'Não foi possível gerar o relatório');
   last=data;renderStats(data);post('assistant',data.answer+(data.aiUsed?'\n\n✓ Análise Gemini com indicadores do sistema.':'\n\nℹ Resumo calculado sem IA externa. '+(data.reason||'')));
   $('aiReportStatus').textContent='Relatório atualizado a partir dos dados sincronizados. '+(data.aiUsed?'Interpretação feita pelo Gemini.':'Interpretação automática externa não utilizada.');
  }catch(err){post('assistant','Não foi possível gerar este relatório: '+String(err?.message||err));$('aiReportStatus').textContent='Falha na consulta. Os relatórios anteriores foram preservados.'}
  finally{processing=false;$('aiReportSend').disabled=false}
 }
 function init(){
  if(!$('aiReportPanel'))return;
  const end=today();$('aiReportTo').value=end;$('aiReportFrom').value=addDays(end,-6);
  $('aiReportForm').addEventListener('submit',submit);
  $('aiReportExport').addEventListener('click',exportCsv);
  $('aiReportPrint').addEventListener('click',()=>window.print());
  $('aiReportOpen').addEventListener('click',()=>{$('aiReportPanel').scrollIntoView({block:'start',behavior:'smooth'});$('aiReportPrompt').focus()});
  document.querySelectorAll('[data-ai-report-example]').forEach(b=>b.addEventListener('click',()=>{$('aiReportPrompt').value=b.dataset.aiReportExample||'';$('aiReportPrompt').focus()}));
  post('assistant','Olá! Peça um relatório, por exemplo: “Quais colaboradores apontaram mais horas no período?” ou “Compare horas por setor e destaque os apontamentos em feriados.” Escolha as datas e os filtros antes de enviar.');
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();