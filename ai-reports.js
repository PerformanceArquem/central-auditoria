(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const fmt=n=>Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:2});
 let last=null,lastNarrative='',processing=false;
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const addDays=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 function post(role,message){
  const el=document.createElement('div');el.className='ai-report-message '+(role==='user'?'ai-report-user':'ai-report-assistant');
  const label=document.createElement('strong');label.textContent=role==='user'?'Você':'Ticket Manager · Relatórios';
  const content=document.createElement('div');content.style.whiteSpace='pre-wrap';content.textContent=message;
  el.append(label,content);$('aiReportConversation').append(el);el.scrollIntoView({block:'nearest',behavior:'smooth'});return el;
 }
 const normalized=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const sectorMatchers=[
  ['Treinamento',/\btreinamento\b/],['Qualidade',/\bqualidade\b/],
  ['Implantação',/\bimplantacao\b/],['Sucesso do Cliente',/\bsucesso(?: do cliente)?\b/],
  ['Testes (QA)',/\b(?:qa|testes)\b/]
 ];
 const namedSectors=value=>sectorMatchers.filter(([,pattern])=>pattern.test(normalized(value))).map(([name])=>name);
 const sectorRequest=prompt=>{
  const text=normalized(prompt);
  return /\bchamados?\b/.test(text)&&/\b(?:entrad[ao]s?|entra(?:ram|m|r)|recebid[oa]s?)\b/.test(text)&&
   (/\bsetor(?:es)?\b/.test(text)||namedSectors(prompt).length>0);
 };
 function renderSectorStats(rows){
  $('aiReportStats').replaceChildren();
  const ranking=$('aiReportRanking');ranking.replaceChildren();
  const heading=document.createElement('h4');heading.textContent='Chamados por setor';ranking.append(heading);
  const cap=Math.max(1,...rows.map(row=>row.entries));
  for(const {sector,entries,basis} of rows){
   const line=document.createElement('div'),label=document.createElement('strong'),bar=document.createElement('progress'),criterion=document.createElement('small');
   label.textContent=sector+' · '+fmt(entries);bar.max=cap;bar.value=entries;
   bar.setAttribute('aria-label',sector);bar.style.cssText='display:block;width:100%;margin:3px 0';
   criterion.textContent=basis;line.style.marginBottom='10px';line.append(label,bar,criterion);ranking.append(line);
  }
  $('aiReportExport').disabled=false;$('aiReportPrint').disabled=false;
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
  const out=last.sectorRows
   ? [['Setor','Critério','Chamados'],...last.sectorRows.map(row=>[row.sector,row.basis,row.entries])]
   : [['Grupo','Nome','Horas','Apontamentos','Chamados']];
  if(!last.sectorRows)for(const [title,key] of cols)for(const row of last[key]||[])out.push([title,row.name,String(row.hours).replace('.',','),row.entries,row.tickets]);
  const csv='\uFEFF'+out.map(row=>row.map(csvField).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='relatorio-personalizado-'+last.summary.periodFrom+'_'+last.summary.periodTo+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 }
 const htmlEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function printReport(){
  if(!last)return;
  const w=window.open('','_blank');
  if(!w){$('aiReportStatus').textContent='Permita pop-ups para imprimir o relatório.';return}
  if(last.sectorRows){
   w.document.open();
   w.document.write('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Chamados por setor</title><body style="font:14px/1.55 Arial,sans-serif;color:#173c64;margin:32px"><h1>ARQUEM SISTEMAS · Central de Auditoria</h1><h2>Chamados por setor</h2><p style="white-space:pre-wrap">'+htmlEsc(lastNarrative)+'</p></body></html>');
   w.document.close();w.focus();w.print();return;
  }
  const sections=cols.map(([title,key])=>{
   const rows=(last[key]||[]).map(x=>'<tr><td>'+htmlEsc(x.name)+'</td><td>'+htmlEsc(fmt(x.hours))+'</td><td>'+htmlEsc(x.entries)+'</td><td>'+htmlEsc(x.tickets)+'</td></tr>').join('');
   return '<h2>'+htmlEsc(title)+'</h2><table><thead><tr><th>Nome</th><th>Horas</th><th>Apontamentos</th><th>Chamados</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }).join('');
  const s=last.summary;
  w.document.open();
  w.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório personalizado · Central de Auditoria</title><style>body{font:14px/1.55 Arial,sans-serif;color:#20364f;margin:32px}h1{color:#173c64}h2{margin-top:25px;font-size:17px}table{border-collapse:collapse;width:100%;margin:10px 0 18px}th,td{border:1px solid #b8c8d8;padding:7px;text-align:left}pre{white-space:pre-wrap;font:inherit;background:#f1f5fa;padding:15px}small{color:#536276}@media print{body{margin:16mm}}</style></head><body><h1>Central de Auditoria · Relatório personalizado</h1><p><strong>Período:</strong> '+htmlEsc(s.periodFrom)+' a '+htmlEsc(s.periodTo)+'</p><p><strong>Indicadores:</strong> '+htmlEsc(fmt(s.totalHours))+' horas · '+htmlEsc(s.tickets)+' chamados · '+htmlEsc(s.records)+' apontamentos · '+htmlEsc(fmt(s.hoursOutsideBusinessDays))+' h fora de dias úteis</p><h2>Interpretação</h2><pre>'+htmlEsc(lastNarrative)+'</pre>'+sections+'<small>Fonte: apontamentos sincronizados do Supabase. Em feriados e finais de semana, o registro de horas não representa automaticamente jornada útil. Gerado em '+htmlEsc(s.generatedAt)+'.</small></body></html>');
  w.document.close();w.focus();w.print();
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
   const operational=/parad|movimenta|inativ|vip|capacidade|cobranca|cobre|humaniz/.test(normalized(prompt))||(/jornada/.test(normalized(prompt))&&/compar|equipe/.test(normalized(prompt)))||(/relatorio|e-?mail|09h|09:00/.test(normalized(prompt))&&/falh|erro|timeout/.test(normalized(prompt)));
   if(operational){
    const session=await client.auth.getSession();const token=session.data?.session?.access_token;
    if(!token)throw Error('Faça login novamente na Central.');
    const response=await fetch('/api/ticket-manager-assistant',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({prompt,from,to,sector:$('aiReportSector').value.trim(),collaborator:$('aiReportCollaborator').value.trim(),client:$('aiReportClient').value.trim(),externalAiConsent:$('aiReportConsent').checked}),signal:AbortSignal.timeout(30000)});
    const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'Consulta indisponível');
    last=null;lastNarrative='';$('aiReportStats').replaceChildren();$('aiReportRanking').replaceChildren();$('aiReportExport').disabled=true;$('aiReportPrint').disabled=true;
    const lines=(result.rows||[]).map(row=>row.id?'#'+row.id+' | '+row.sector+' | '+row.owner+' | '+row.customer:row.name?row.name+' | '+row.sector+' | '+fmt(row.minutes/60)+' h | Jornada: indisponível':(row.recipientName||row.recipientId)+' | '+row.kind+' | '+row.status+' | '+row.reason);
    post('assistant',[result.answer,...lines,...(result.warnings||[]),result.aiSuggestion?'Sugestão da IA para revisão humana: '+result.aiSuggestion:'',result.sources?.length?'Fonte: '+result.sources.join(', '):'',result.generatedAt?'Consultado em '+new Date(result.generatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):''].filter(Boolean).join('\n\n'));
    $('aiReportStatus').textContent='Consulta concluída. Nenhuma mensagem enviada ou dado alterado.';
    return;
   }
   const sectorMode=sectorRequest(prompt);
   const sector=$('aiReportSector').value.trim(),collaborator=$('aiReportCollaborator').value.trim(),customer=$('aiReportClient').value.trim();
   const requested=namedSectors(prompt),selected=sector?namedSectors(sector):requested;
   if(sectorMode&&(collaborator||customer))throw Error('Limpe os filtros de colaborador e cliente para consultar os totais por setor.');
   if(sectorMode&&sector&&!selected.length)throw Error('Setor indisponível neste relatório. Escolha Treinamento, Qualidade, Implantação, Sucesso do Cliente ou QA.');
   const {data,error}=sectorMode
    ? await client.functions.invoke('audit-email-dispatch',{body:{action:'sector_entries_report',from,to}})
    : await client.functions.invoke('audit-ai-reports',{body:{prompt,from,to,sector,collaborator,client:customer,externalAiConsent:$('aiReportConsent').checked}});
   if(error){let detail=error.message||'Falha na consulta';try{const body=await error.context?.json();if(body?.error)detail=body.error}catch{}throw Error(detail)}
   if(!data?.ok)throw Error(data?.error||'Não foi possível gerar o relatório');
   if(sectorMode){
    if(!Array.isArray(data.rows))throw Error('O serviço retornou um relatório inválido.');
    const rows=data.rows.filter(row=>!selected.length||selected.includes(row.sector));
    const total=rows.reduce((sum,row)=>sum+row.entries,0);
    const br=value=>value.split('-').reverse().join('/');
    lastNarrative=['Período de '+br(data.from)+' a '+br(data.to),
     ...rows.map(row=>row.sector+' · '+fmt(row.entries)+' · '+row.basis),
     'Soma por setor · '+fmt(total),'Cada chamado conta uma vez por setor.',
     ...(!data.historyComplete?['Histórico de entradas incompleto. Os números podem estar parciais.']:[])].join('\n');
    last={sectorRows:rows,summary:{periodFrom:data.from,periodTo:data.to}};
    renderSectorStats(rows);post('assistant',lastNarrative);
    $('aiReportStatus').textContent='Relatório por setor atualizado com os dados sincronizados.';
    return;
   }
   last=data;lastNarrative=data.answer;renderStats(data);post('assistant',data.answer);
   $('aiReportStatus').textContent='Relatório atualizado a partir dos dados sincronizados. '+(data.aiUsed?'Interpretação feita pelo Gemini.':'Interpretação automática externa não utilizada.');
  }catch(err){post('assistant','Não foi possível gerar este relatório: '+String(err?.message||err));$('aiReportStatus').textContent='Falha na consulta. Os relatórios anteriores foram preservados.'}
  finally{processing=false;$('aiReportSend').disabled=false}
 }
 function init(){
  if(!$('aiReportPanel'))return;
  const end=today();$('aiReportTo').value=end;$('aiReportFrom').value=addDays(end,-6);
  $('aiReportForm').addEventListener('submit',submit);
  $('aiReportExport').addEventListener('click',exportCsv);
  $('aiReportPrint').addEventListener('click',printReport);
  $('aiReportOpen').addEventListener('click',()=>{$('aiReportPanel').scrollIntoView({block:'start',behavior:'smooth'});$('aiReportPrompt').focus()});
  document.querySelectorAll('[data-ai-report-example]').forEach(b=>b.addEventListener('click',()=>{$('aiReportPrompt').value=b.dataset.aiReportExample||'';$('aiReportPrompt').focus()}));
  const examples=[['Chamados parados','Quais chamados da Produção estão parados há mais de 15 dias?'],['Risco VIP','Quais clientes VIPs estão com maior risco?'],['Horas e jornada','Compare as horas apontadas da equipe com a jornada.'],['Rascunho de cobrança','Gere uma cobrança humanizada para os chamados vencidos.'],['Falhas das 09h','Quais relatórios das 09h falharam e por quê?']];
  const box=document.createElement('div');box.className='row';
  for(const [label,prompt] of examples){const button=document.createElement('button');button.type='button';button.className='s';button.textContent=label;button.addEventListener('click',()=>{$('aiReportPrompt').value=prompt;$('aiReportPrompt').focus()});box.append(button)}
  $('aiReportPrompt').before(box);
  post('assistant','Olá! Peça um relatório, por exemplo: “Quais colaboradores apontaram mais horas no período?” ou “Compare horas por setor e destaque os apontamentos em feriados.” Escolha as datas e os filtros antes de enviar.');
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();