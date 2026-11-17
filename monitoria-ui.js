/* Mini Central de Monitoria — fluxo assistido, sem envio automático ou persistência de mídia. */
(()=>{
 const $=id=>document.getElementById(id);
 let localAudioUrl='',selectedAudio=null,lastAnalysis=null,channel='chat',lastSavedReview=null,reviewRequestId=null,reports=[],alerts=[],polling=false;
 let sourceEvidenceKind='manual', evidenceGeneration=0;
 const status=(msg)=>{if($('monStatus'))$('monStatus').textContent=msg};
 const safeName=n=>String(n||'arquivo').replace(/[^\w.-]+/g,'_').slice(0,80);
 function download(name,text,type){
   const url=URL.createObjectURL(new Blob([text],{type}));
   const a=document.createElement('a');a.href=url;a.download=safeName(name);a.click();
   setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 async function api(params,{binary=false}={}){
   const session=await window.tmAuth?.getSession?.();
   if(!session?.access_token)throw Error('Faça login como administrador autorizado.');
   const url='/api/ticket-manager?monitoria=zenvia&'+new URLSearchParams(params);
   const res=await fetch(url,{headers:{Authorization:'Bearer '+session.access_token},
      credentials:'same-origin',cache:'no-store'});
   if(binary){
     if(!res.ok){const d=await res.json().catch(()=>({}));throw Error(d.error||'Áudio indisponível');}
     return await res.blob();
   }
   const body=await res.json().catch(()=>({}));
   if(!res.ok||body.ok!==true)throw Error(body.error||'Consulta indisponível');
   return body;
 }
 async function openProtectedRecording({id,kind,reviewId}){
   if(!/^\d{1,14}$/.test(String(id))||!['outbound','inbound'].includes(kind))
      throw Error('Referência inválida de gravação');
   const media=await api({action:'audio',kind,id,...(reviewId?{reviewId}:{})},{binary:true});
   if(localAudioUrl)URL.revokeObjectURL(localAudioUrl);
   selectedAudio=media;localAudioUrl=URL.createObjectURL(media);
   const player=$('monAudioPlayer');player.src=localAudioUrl;player.hidden=false;
   const link=$('monDownloadAudio');link.href=localAudioUrl;link.download='ligacao-'+id+'.mp3';link.hidden=false;
   $('monChannel').value='voice';channel='voice';
   $('monSourceId').value=id;$('monRecordingKind').value=kind;
   status('Gravação carregada com acesso autenticado. Clique em reproduzir para ouvir. Transcrição com Gemini opcional.');
 }
 window.monitoriaOpenRecording=async(args)=>{
   try{await openProtectedRecording(args)}catch(e){status('Gravação: '+String(e.message||e))}
 };
 function resetSelectedEvidence(){
   evidenceGeneration++;
   if(localAudioUrl){URL.revokeObjectURL(localAudioUrl);localAudioUrl='';}
   selectedAudio=null;
   const player=$('monAudioPlayer');
   if(player){player.pause();player.removeAttribute('src');player.hidden=true;}
   const link=$('monDownloadAudio');if(link){link.hidden=true;link.removeAttribute('href');}
   $('monSourceId').value='';
   $('monTranscript').value='';
   $('monRecordingKind').value='';
   lastAnalysis=null;lastSavedReview=null;reviewRequestId=null;
   $('monSave').disabled=true;
   $('monExportReview').disabled=true;
   resetChatCoverage();
   const results=$('monResults');if(results)results.replaceChildren();
 }
 let supportPeople=[];
 function showSupportPerson(index){
   const list=$('monSupportList'),select=$('monSupportSelect');
   if(!list||!select)return;
   list.replaceChildren();
   const person=supportPeople[index];
   if(!person){list.textContent='Selecione ou sorteie um colaborador.';return}
   select.value=String(index);
   resetSelectedEvidence();
   $('monCollaborator').value=person.name;
   $('monSector').value='Suporte';
   $('monChannel').value='chat';channel='chat';
   $('monTicketId').value=person.chatCandidate?.ticketId||'';
   const card=document.createElement('div');
   card.style.cssText='padding:12px;border:1px solid #dce5f0;border-radius:10px;background:#f8fbff';
   const title=document.createElement('strong');title.textContent=person.name;
   title.style.cssText='display:block;font-size:15px;margin-bottom:10px';
   const slots=document.createElement('div');slots.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px';
   const makeSlot=(heading,detail,buttonText,callback)=>{
     const box=document.createElement('div');
     box.style.cssText='background:#fff;padding:11px;border:1px solid #e2e8f0;border-radius:9px;display:flex;flex-direction:column;align-items:flex-start;gap:7px';
     const h=document.createElement('strong');h.textContent=heading;
     const p=document.createElement('span');p.textContent=detail;p.style.cssText='font-size:12px;color:#52637c;line-height:1.4';
     const button=document.createElement('button');button.type='button';button.className='s';button.textContent=buttonText;
     button.addEventListener('click',callback);
     box.append(h,p,button);return box;
   };
   const candidate=person.chatCandidate;
   slots.appendChild(makeSlot('Chat',candidate?'Chamado #'+candidate.ticketId+' · '+candidate.interactions+' ações; conversa não confirmada':'Sem chamado candidato','Conferir chat',async()=>{
     if(!candidate){status('Nenhum chamado candidato disponível para '+person.name);return}
     resetSelectedEvidence();
     $('monTicketId').value=candidate.ticketId;
     $('monCollaborator').value=person.name;
     $('monSector').value='Suporte';
     $('monChannel').value='chat';channel='chat';
     $('monReviewWorkspace').open=true;
     await loadChat();
     $('monTranscript').scrollIntoView({behavior:'smooth',block:'center'});
   }));
   slots.appendChild(makeSlot('Voz','Gravação ainda não vinculada ao colaborador','Localizar voz',async()=>{
     resetSelectedEvidence();
     $('monCollaborator').value=person.name;$('monSector').value='Suporte';
     $('monChannel').value='voice';channel='voice';
     $('monReviewWorkspace').open=true;
     $('monSearchCalls').scrollIntoView({behavior:'smooth',block:'center'});
     status('Consultando ligações: abra uma gravação da Zenvia para preencher automaticamente o ID. Confirme o atendente.');
     await listCalls();
   }));
   card.append(title,slots);list.appendChild(card);
   const current=evidenceGeneration;
   if(candidate){
     const flag=document.createElement('p');flag.style.cssText='margin:8px 0 0;font-size:12px;color:#52637c';
     flag.textContent='Carregando interações disponíveis do chamado #'+candidate.ticketId+'…';
     card.appendChild(flag);
     loadChat(current).then(ready=>{
       if(current!==evidenceGeneration)return;
       flag.textContent=ready
         ?'Chat consultado. Abra “Conferir atendimento e avaliar com IA” para revisar as evidências. Nota ainda não gerada.'
         :'Chat não disponível para análise automática. Confira o aviso na área de atendimento.';
     });
   }else status('Sem chamado de chat candidato para '+person.name+'. Selecione outro colaborador ou localize um atendimento.');
 }
 async function findSupportCandidates(){
   const button=$('monFindSupport'),list=$('monSupportList'),summary=$('monSupportSummary');
   const select=$('monSupportSelect'),draw=$('monSupportDraw');
   if(!button||!list||!summary||!select||!draw)return;
   button.disabled=true;draw.disabled=true;select.disabled=true;
   summary.textContent='Consultando apontamentos existentes do Suporte…';
   try{
     const session=await window.tmAuth?.getSession?.();
     if(!session?.access_token)throw Error('Faça login como administrador autorizado.');
     const res=await fetch('/api/ticket-manager?monitoria=candidates&days=30',{
       method:'GET',headers:{Authorization:'Bearer '+session.access_token},
       credentials:'same-origin',cache:'no-store'
     });
     const data=await res.json().catch(()=>({}));
     if(!res.ok||!data.ok)throw Error(data.error||'Consulta indisponível');
     supportPeople=Array.isArray(data.people)?data.people:[];
     select.replaceChildren();
     if(!supportPeople.length){
       list.textContent='Nenhum colaborador com apontamentos recentes.';
       const option=document.createElement('option');option.value='';option.textContent='Sem colaboradores';select.appendChild(option);
       summary.textContent='Nenhuma monitoria disponível neste período.';
       return;
     }
     for(const [i,person] of supportPeople.entries()){
       const option=document.createElement('option');option.value=String(i);option.textContent=person.name;
       select.appendChild(option);
     }
     select.disabled=false;draw.disabled=false;
     summary.textContent=supportPeople.length+' colaboradores · até '+(supportPeople.length*2)+
       ' monitorias possíveis (chat + voz). Notas pendentes de evidências.'+
       (data.partial?' Consulta parcial: limite de apontamentos atingido.':'');
     showSupportPerson(0);
   }catch(e){supportPeople=[];list.replaceChildren();list.textContent='Consulta não concluída.';summary.textContent='Consulta: '+String(e.message||e);}
   finally{button.disabled=false;}
 }
 async function listCalls(){
   const start=$('monFrom').value,end=$('monTo').value;
   status('Consultando chamadas na Zenvia…');
   try{
     const data=await api({action:'calls',from:start,to:end,limit:40});
     const list=$('monCalls');list.replaceChildren();
     if(!data.calls.length){list.textContent='Nenhuma chamada localizada para este período.';return}
     for(const call of data.calls){
       const row=document.createElement('div');
       row.style.cssText='border:1px solid #dae2ee;border-radius:8px;padding:10px;margin:6px 0;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap';
       const description=document.createElement('span');
       description.textContent='#'+call.id+' · '+call.direction+' · '+call.started+' · '+call.status+' · '+call.durationSeconds+'s';
       const button=document.createElement('button');button.type='button';button.className='s';
       button.textContent='Ouvir / baixar';
       button.title=call.recordingAvailable?'Carregar gravação da chamada':'Consultar se existe gravação para esta chamada';
       button.addEventListener('click',async()=>{
         button.disabled=true;status('Baixando gravação autenticada da Zenvia…');
         try{
           await openProtectedRecording({id:call.id,kind:call.kind});
         }catch(e){status('Falha ao carregar gravação: '+String(e.message||e));}
         finally{button.disabled=false;}
       });
       row.append(description,button);list.appendChild(row);
     }
     status(data.calls.length+' chamadas consultadas. Nenhuma gravação foi enviada ao Gemini.');
   }catch(e){status('Consulta de ligações: '+String(e.message||e));}
 }
 function resetChatCoverage(){
   sourceEvidenceKind='manual';
   const area=$('monChatEvidenceWarning');
   if(area)area.hidden=true;
   const confirmation=$('monChatCoverageConfirm');if(confirmation)confirmation.hidden=true;
   const acknowledge=$('monChatCoverageAck');
   if(acknowledge)acknowledge.checked=false;
 }
 async function loadChat(expectedGeneration=evidenceGeneration){
   const ticketId=$('monTicketId').value.trim();
   const button=$('monLoadChat'),near=$('monChatLoadStatus');
   if(button){button.disabled=true;button.textContent='Carregando…'}
   if(near){near.textContent='Consultando o Movidesk e, se necessário, o extrato já sincronizado…';near.style.color='#52637c'}
   status('Consultando interações do chamado no Movidesk…');
   try{
     if(!/^\d{1,12}$/.test(ticketId))throw Error('Informe o número do chamado Movidesk.');
     const session=await window.tmAuth?.getSession?.();
     if(!session?.access_token)throw Error('Faça login como administrador autorizado.');
     const res=await fetch('/api/ticket-manager?monitoria=movidesk&'+new URLSearchParams({ticketId}),{
       method:'GET',headers:{Authorization:'Bearer '+session.access_token},credentials:'same-origin',cache:'no-store'
     });
     const data=await res.json().catch(()=>({}));
     if(expectedGeneration!==evidenceGeneration||ticketId!==$('monTicketId').value.trim())return false;
     if(!res.ok||!data?.ok)throw Error(data.error||'Histórico indisponível');
     if(!Array.isArray(data.messages)||!data.messages.length)throw Error('Este chamado não retornou interações textuais. Escolha outro candidato.');
     resetChatCoverage();
     sourceEvidenceKind='movidesk_ticket_actions_unverified';
     $('monChatEvidenceWarning').hidden=false;
     $('monChatCoverageConfirm').hidden=false;
     const coverage=data.coverage||{};
     $('monChatEvidenceDetails').textContent=
       (coverage.activeActions??'?')+' ações ativas; '+(coverage.renderedInteractions??data.messages.length)+
       ' interações extraídas; origens: '+(coverage.actionOrigins||[]).join(', ')+
       '; tipos: '+(coverage.actionTypes||[]).join(', ')+
       '. Início, fim e integridade do chat NÃO foram confirmados.';
     const lines=data.messages.map(m=>'['+(m.at||'sem horário')+'] '+(m.sender||'Participante')+': '+m.text);
     $('monTranscript').value=lines.join('\n');
     $('monChannel').value='chat';channel='chat';
     $('monSourceId').value=ticketId;
     lastAnalysis=null;$('monExportReview').disabled=true;
     if(near){near.textContent=data.messages.length+' interações carregadas do '+(data.syncedFallback?'banco sincronizado':'Movidesk')+'. Confira a cobertura antes de avaliar.';near.style.color='#17603a'}
     status(data.messages.length+' interações do chamado #'+ticketId+' recuperadas do Movidesk. '+data.warning);
     return true;
   }catch(e){if(expectedGeneration===evidenceGeneration){const message=String(e.message||e);status('Consulta Movidesk: '+message);if(near){near.textContent='Falha ao abrir conversa: '+message;near.style.color='#a9231c'}}return false;}
   finally{if(button){button.disabled=false;button.textContent='Abrir conversa'}}
 }
 async function reviewsApi(params,body){
   const session=await window.tmAuth?.getSession?.();
   if(!session?.access_token)throw Error('Entre na Central para consultar monitorias');
   const url='/api/ticket-manager?monitoria=reviews'+(params?'&'+new URLSearchParams(params):'');
   const r=await fetch(url,{
    method:body?'POST':'GET',headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'same-origin'
   });
   const data=await r.json().catch(()=>({}));
   if(!r.ok||!data.ok)throw Error(data.error||'Serviço de monitoria indisponível');
   return data;
 }
 function metadata(){
   const sourceId=$('monSourceId').value.trim();
   const sector=$('monSector').value.trim();
   const collaborator=$('monCollaborator').value.trim();
   const reviewer=$('monReviewer').value.trim();
   const monitoredAt=$('monMonitoredAt').value;
   const recordingKind=channel==='voice'?$('monRecordingKind').value:'';
   if(!reviewer||!monitoredAt)throw Error('Informe quem monitorou e a data da monitoria');
   if(!/^[A-Za-z0-9_-]{1,80}$/.test(sourceId)||!sector||!collaborator)
    throw Error('Preencha o ID da ligação/chamado, o setor e o colaborador antes da análise');
   return {sourceId,sector,collaborator,reviewer,monitoredAt,recordingKind};
 }
 async function saveReview(){
   if(!lastAnalysis)throw Error('Avalie o atendimento primeiro');
   const values=metadata();
   if(!$('monSaveConsent').checked)throw Error('Autorize o registro da monitoria e de possíveis alertas internos');
   reviewRequestId=reviewRequestId||crypto.randomUUID();
   const result=await reviewsApi(null,{
      action:'submit',requestId:reviewRequestId,consent:true,channel,...values,analysis:lastAnalysis,
      evidenceScope:channel==='chat'?sourceEvidenceKind:'voice_transcript',
      evidenceAcknowledged:sourceEvidenceKind==='movidesk_ticket_actions_unverified'?$('monChatCoverageAck').checked:true
   });
   lastSavedReview=result.review?.id;
   $('monSave').disabled=true;
   status(lastAnalysis.criticalFlag?
    'Ocorrência crítica registrada na fila interna. O gestor vinculado ao setor será alertado; se não houver vínculo, ficará para encaminhamento pela Qualidade.':
    'Monitoria provisória registrada. Aguarda validação da Qualidade.');
   await refreshAlerts();
   return result;
 }
 async function refreshAlerts(){
   if(polling)return;
   polling=true;
   try{
    const data=await reviewsApi({kind:'alerts'});
    alerts=data.alerts||[];
    const pending=alerts.filter(a=>a.status==='unread'||a.status==='routing_pending');
    const badge=$('monNavAlertCount');
    if(badge){badge.textContent=String(pending.length);badge.hidden=!pending.length;}
    const banner=$('monGlobalCriticalBanner');
    if(banner){
      banner.hidden=!pending.length;
      banner.textContent=pending.length?'⚠ '+pending.length+' ocorrência(s) crítica(s) aguardando ciência/encaminhamento · Abrir Mini Central de Monitoria':'';
    }
    const list=$('monAlertList');if(!list)return;
    list.replaceChildren();
    for(const a of alerts.slice(0,50)){
      const div=document.createElement('div');div.style.cssText='border-bottom:1px solid #ddd;padding:10px 0';
      const review=a.audit_monitoria_reviews||{};
      const txt=document.createElement('span');
      txt.textContent=(a.status==='routing_pending'?'⚠ GESTOR NÃO VINCULADO':a.status==='unread'?'🚨 NÃO LIDO':'✓ '+a.status.toUpperCase())
       +' · '+a.sector+' · '+(review.collaborator_name||'Colaborador')+' · '+(review.channel||'')+' #'+(review.source_id||'');
      div.appendChild(txt);
      if(a.status==='unread'){
       const button=document.createElement('button');button.className='s';button.type='button';button.style.marginLeft='10px';button.textContent='Registrar ciência';
       button.onclick=async()=>{try{await reviewsApi(null,{action:'ack',alertId:a.id});await refreshAlerts()}catch(e){status(e.message)}};
       div.appendChild(button);
      }
      list.appendChild(div);
    }
   }catch(e){
    const el=$('monAlertCoverage');if(el)el.textContent='Alertas indisponíveis: '+String(e.message||e);
   }finally{polling=false;}
 }
 async function loadRoutes(){
   try{
    const data=await reviewsApi({kind:'routes'});
    const el=$('monRouteList');el.replaceChildren();
    for(const r of data.routes||[]){
     const div=document.createElement('p');
     div.textContent=r.sector+' → '+r.manager_user_id+(r.active?' (ativo)':' (inativo)');
     el.appendChild(div);
    }
    if(!data.routes?.length)el.textContent='Nenhum vínculo cadastrado. Alertas críticos ficam pendentes para a Qualidade.';
   }catch(e){status('Vínculos de gestores: '+String(e.message||e))}
 }
 async function saveRoute(){
   try{
    const sector=$('monRouteSector').value.trim(),managerUserId=$('monRouteUser').value.trim();
    const data=await reviewsApi(null,{action:'route',sector,managerUserId});
    status('Gestor vinculado a '+data.sector+'. '+data.assignedPending+' alerta(s) pendente(s) encaminhados internamente.');
    await loadRoutes();await refreshAlerts();
   }catch(e){status('Configuração do gestor: '+String(e.message||e))}
 }
 async function refreshReports(){
   const from=$('monReportFrom').value,to=$('monReportTo').value;
   status('Consultando monitorias registradas…');
   try{
    const data=await reviewsApi({kind:'reviews',from,to});
    reports=data.reviews||[];
    $('monReportSummary').textContent=reports.length+' monitorias no período'+(data.partial?' · cobertura limitada a 1.000 registros; reduza o período':'');
    $('monExcel').disabled=!reports.length||data.partial;
    const table=$('monReviewList');table.replaceChildren();
    for(const a of reports.slice(0,60)){
     const line=document.createElement('div');line.style.cssText='padding:8px;border-bottom:1px solid #ddd;display:flex;gap:10px;flex-wrap:wrap;align-items:center';
     const label=document.createElement('span');
     label.textContent=(a.collaborator_name||'Colaborador')+' · '+a.channel+' · '+a.source_id+' · nota '+(a.score_approved??a.score_suggested)+' · '+a.review_status;
     line.appendChild(label);
     if(a.review_status==='provisional'){
      const b=document.createElement('button');b.type='button';b.className='s';b.textContent='Validar monitoria';
      b.onclick=async()=>{
       const confirms=a.critical_suspected?window.confirm('A Qualidade confirma a falha crítica? Se confirmar, a nota aprovada será zero.') : false;
       const raw=confirms?'0':window.prompt('Nota final aprovada (0 a 100):',String(a.score_suggested));
       if(raw===null)return;
       const score=Number(raw);if(!Number.isFinite(score)||score<0||score>100){status('Nota inválida');return}
       const notes=window.prompt('Observação da Qualidade:', '')||'';
       try{await reviewsApi(null,{action:'approve',reviewId:a.id,confirmCritical:confirms,score,notes});await refreshReports();await refreshAlerts()}
       catch(e){status('Aprovação: '+String(e.message||e))}
      };line.appendChild(b);
     }
     table.appendChild(line);
    }
    status('Relatórios atualizados. Notas provisórias e aprovadas permanecem identificadas.');
   }catch(e){status('Relatórios: '+String(e.message||e));}
 }
 function exportExcel(){
   if(!window.XLSX){status('Biblioteca Excel indisponível');return}
   const selected=$('monReportStatus').value==='approved'?reports.filter(r=>r.review_status==='approved'):reports;
   if(!selected.length){status('Nenhuma monitoria correspondente ao filtro');return}
   const wb=XLSX.utils.book_new();
   const add=(name,rows)=>{const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=rows[0].map((_,i)=>({wch:i===0?22:Math.min(55,Math.max(16,String(rows[0][i]||'').length+4))}));XLSX.utils.book_append_sheet(wb,ws,name)};
   const approved=selected.filter(r=>r.review_status==='approved');
   const average=approved.length?Math.round(approved.reduce((sum,r)=>sum+Number(r.score_approved||0),0)/approved.length*100)/100:null;
   add('Resumo',[['Indicador','Valor'],['Monitorias exportadas',selected.length],['Aprovadas',approved.length],['Provisórias',selected.length-approved.length],['Média notas aprovadas',average??'Sem avaliações aprovadas'],['Falhas críticas suspeitas',selected.filter(r=>r.critical_suspected).length],['Falhas críticas confirmadas',selected.filter(r=>r.critical_confirmed).length]]);
   add('Notas por Atendimento',[['Data da monitoria','Colaborador','Setor','Canal','ID atendimento','Monitor responsável','Tipo gravação','Fonte evidência','Cobertura reconhecida','Nota IA','Nota aprovada','Status','Crítica suspeita','Crítica confirmada','Versão normas','Observação Qualidade','Alerta interno','Gestor vinculado','Hora alerta','Ciência do gestor','Feedback gestor'],
    ...selected.map(r=>[r.monitored_at,r.collaborator_name,r.sector,r.channel,r.source_id,r.reviewer_name,r.recording_kind||'',r.evidence_scope||'',r.evidence_acknowledged?'Sim':'Não',r.score_suggested,r.score_approved??'',r.review_status,r.critical_suspected?'Sim':'Não',r.critical_confirmed===true?'Sim':r.critical_confirmed===false?'Não':'Pendente',r.ruleset_version,r.reviewer_notes||'',r.audit_monitoria_alerts?.status||'',r.audit_monitoria_alerts?.manager_user_id||'',r.audit_monitoria_alerts?.created_at||'',r.audit_monitoria_alerts?.acknowledged_at||'',r.audit_monitoria_alerts?.manager_feedback||''])]);
   add('Critérios',[['Data da monitoria','ID atendimento','Colaborador','Monitor responsável','Canal','Código','Decisão','Desconto','Evidência','Justificativa'],
    ...selected.flatMap(r=>(r.criteria||[]).map(c=>[r.monitored_at,r.source_id,r.collaborator_name,r.reviewer_name,r.channel,c.id,c.decision,c.deducted,c.evidence,c.reason]))]);
   add('Não Conformidades',[['Data','Colaborador','Setor','Canal','ID atendimento','Código crítico','Evidência','Situação','Alerta','Gestor','Hora alerta','Hora ciência'],
    ...selected.flatMap(r=>(r.critical_findings||[]).filter(c=>c.suspected).map(c=>[r.monitored_at,r.collaborator_name,r.sector,r.channel,r.source_id,c.code,c.evidence,r.critical_confirmed===true?'Confirmada':r.critical_confirmed===false?'Descartada':'Aguardando Qualidade',r.audit_monitoria_alerts?.status||'',r.audit_monitoria_alerts?.manager_user_id||'',r.audit_monitoria_alerts?.created_at||'',r.audit_monitoria_alerts?.acknowledged_at||'']))]);
   const byPerson=new Map();for(const r of approved){const key=r.collaborator_name||'Não identificado';const value=byPerson.get(key)||[];value.push(r);byPerson.set(key,value)}
   add('Colaboradores',[['Colaborador','Monitorias aprovadas','Média aprovada'],
    ...[...byPerson.entries()].map(([person,rows])=>[person,rows.length,Math.round(rows.reduce((n,r)=>n+Number(r.score_approved||0),0)/rows.length*100)/100])]);
   const filename='Monitoria_Arquem_'+$('monReportFrom').value+'_a_'+$('monReportTo').value+'.xlsx';
   XLSX.writeFile(wb,filename,{compression:true});
   status('Excel gerado com notas aprovadas e/ou provisórias identificadas, critérios e falhas críticas.');
 }
 function render(analysis){
   const result=$('monResults');result.replaceChildren();
   const title=document.createElement('h3');
   title.textContent='Nota sugerida: '+analysis.scoreSuggestion+'/100 · '+(analysis.criticalFlag?'Possível falha crítica · revisão obrigatória':analysis.incomplete?'Avaliação incompleta':'Revisão da Qualidade pendente');
   result.appendChild(title);
   const subtitle=document.createElement('p');
   subtitle.textContent='Versão '+analysis.version+' · critérios verificáveis '+analysis.verifiedCriteria+'/'+analysis.totalCriteria+' · nenhuma penalidade definitiva automática';
   result.appendChild(subtitle);
   const table=document.createElement('table');table.style.width='100%';table.style.borderCollapse='collapse';
   const head=document.createElement('tr');
   for(const label of ['Código','Critério','Situação','Desconto','Evidência']){const th=document.createElement('th');th.textContent=label;th.style.textAlign='left';th.style.borderBottom='1px solid #cbd5e1';head.appendChild(th)}
   table.appendChild(head);
   for(const r of analysis.criteria){
    const tr=document.createElement('tr');
    for(const value of [r.code,r.name,r.decision,String(r.deducted),r.evidence||'Não disponível']){
      const td=document.createElement('td');td.textContent=value;td.style.padding='8px';td.style.borderBottom='1px solid #e2e8f0';tr.appendChild(td);
    }
    table.appendChild(tr);
   }
   result.appendChild(table);
   for(const c of analysis.critical.filter(x=>x.suspected)){
    const alert=document.createElement('p');alert.textContent='⚠ '+c.code+' — '+c.name+': análise crítica exige validação humana. '+c.evidence;result.appendChild(alert);
   }
   $('monExportReview').disabled=false;
 }
 async function geminiFailure(error,data){
   let message=typeof data?.error==='string'?data.error:'';
   let httpStatus=error?.context?.status||null;
   if(error?.context&&typeof error.context.json==='function'){
     try{
       const details=await error.context.clone().json();
       if(typeof details?.error==='string')message=details.error;
       httpStatus=httpStatus||details?.status||null;
     }catch{/* Retain non-sensitive fallback message. */}
   }
   if(message)return message+(httpStatus?' (HTTP '+httpStatus+')':'');
   if(httpStatus===503)return 'A função de IA está indisponível (HTTP 503). Verifique se GEMINI_API_KEY está configurada nos segredos do Supabase e se a API Gemini está acessível.';
   if(httpStatus===401||httpStatus===403)return 'Sessão ou autorização da Qualidade inválida. Entre novamente na Central.';
   return String(error?.message||'Não foi possível comunicar com a IA')+
     '. Confirme a configuração e disponibilidade da função monitoria-ai no Supabase.';
 }
 async function transcribe(){
   if(!$('monConsent')?.checked){status('Autorize o processamento do áudio pelo Gemini antes de transcrever.');return}
   if(!selectedAudio){status('Selecione uma gravação para transcrever.');return}
   if(selectedAudio.size>3*1024*1024){status('Transcrição direta limitada a 3 MB. Divida ou compacte o áudio antes de enviar.');return}
   const mimeType=selectedAudio.type||'audio/mpeg';
   if(!['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/webm','audio/mp4','audio/m4a'].includes(mimeType)){
     status('Formato não suportado para transcrição. Converta para MP3, WAV, OGG, M4A ou WebM.');return
   }
   const button=$('monTranscribe');button.disabled=true;
   status('Transcrevendo áudio com Gemini. Revise o texto antes de avaliar.');
   try{
     const client=window.tmEmailAdminClient;
     const session=await window.tmAuth?.getSession?.();
     if(!client?.functions||!session?.access_token)throw Error('Faça login como administrador autorizado.');
     const audioBase64=await new Promise((resolve,reject)=>{
       const r=new FileReader();
       r.onload=()=>resolve(String(r.result||'').split(',')[1]||'');
       r.onerror=()=>reject(Error('Não foi possível ler o áudio'));
       r.readAsDataURL(selectedAudio);
     });
     const {data,error}=await client.functions.invoke('monitoria-ai',{
       body:{action:'transcribe',consent:true,mimeType,audioBase64}
     });
     if(error||!data?.ok)throw Error(error?await geminiFailure(error,data):data?.error||'Transcrição indisponível');
     $('monTranscript').value=data.transcript||'';
     $('monChannel').value='voice';channel='voice';
     lastAnalysis=null;$('monExportReview').disabled=true;
     status('Transcrição sugerida. Confira palavras, falantes e horários antes de solicitar a avaliação.');
   }catch(e){status('Transcrição: '+String(e.message||e));}
   finally{button.disabled=false;}
 }
 async function analyse(){
   if(!($('monConsent')?.checked)){status('Autorize explicitamente o processamento da conversa pelo Gemini.');return}
   if(!($('monSaveConsent')?.checked)){status('Para garantir o alerta imediato ao gestor em caso crítico, autorize o registro da monitoria antes da análise.');return}
   if(!$('monSourceId').value.trim()){
     $('monReviewWorkspace').open=true;
     status(channel==='voice'
       ?'Nenhuma ligação selecionada. Clique em Localizar voz, escolha uma chamada da Zenvia e abra a gravação; o ID será preenchido automaticamente.'
       :'Nenhum chamado selecionado. Clique em Conferir chat ou informe um chamado Movidesk e abra a conversa.');
     return;
   }
   try{metadata()}catch(e){status(e.message);return}
   if(sourceEvidenceKind==='movidesk_ticket_actions_unverified'&&!$('monChatCoverageAck').checked){
     const box=$('monChatCoverageConfirm');
     if(box){box.hidden=false;box.scrollIntoView({behavior:'smooth',block:'center'});}
     $('monChatCoverageAck').focus();
     status('Marque a confirmação de conferência do extrato, logo acima da autorização do Gemini.');
     return;
   }
   const transcript=$('monTranscript').value.trim();
   if(transcript.length<60){status('Informe uma transcrição completa ou consulte as interações do chamado.');return}
   const button=$('monRun');button.disabled=true;status('Conferindo sessão e solicitando avaliação ao Gemini…');
   try{
     const client=window.tmEmailAdminClient;
     const session=await window.tmAuth?.getSession?.();
     if(!client?.functions||!session?.access_token)throw Error('Faça login com um usuário administrador autorizado.');
     const {data,error}=await client.functions.invoke('monitoria-ai',{body:{channel,transcript,consent:true}});
     if(error)throw Error(await geminiFailure(error,data));
     if(!data?.ok||!data.analysis)throw Error(data?.error||'Análise não disponibilizada');
     lastAnalysis=data.analysis;lastSavedReview=null;reviewRequestId=null;render(lastAnalysis);
     $('monSave').disabled=false;
     if(lastAnalysis.criticalFlag){
       try{await saveReview()}
       catch(e){status('URGENTE: possível falha crítica identificada, mas o alerta NÃO foi registrado: '+String(e.message||e));}
     }else status('Avaliação sugerida pronta. Registre-a para entrar nos relatórios e revisão da Qualidade.');
   }catch(e){status('Falha na análise: '+String(e.message||e));}
   finally{button.disabled=false}
 }
 function init(){
   if(!$('monTranscript'))return;
   $('monChannel').addEventListener('change',e=>{
      channel=e.target.value==='voice'?'voice':'chat';
      status(channel==='voice'?'Consulte uma ligação na Zenvia e forneça a transcrição para análise.':'Consulte o chamado Movidesk ou cole o histórico do chat.');
   });
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   $('monFrom').value=today;$('monTo').value=today;
   $('monMonitoredAt').value=today;
   $('monReportTo').value=today;$('monReportFrom').value=today.slice(0,7)+'-01';
   window.monitoriaRefreshAlerts=refreshAlerts;
   setInterval(()=>{if(!document.hidden&&window.tmAuth)refreshAlerts()},15000);
   refreshAlerts();
   $('monFindSupport')?.addEventListener('click',findSupportCandidates);
   $('monSupportSelect')?.addEventListener('change',e=>{
     const i=Number(e.target.value);if(Number.isInteger(i)&&i>=0&&i<supportPeople.length)showSupportPerson(i);
   });
   $('monSupportDraw')?.addEventListener('click',()=>{
     if(!supportPeople.length)return;
     const random=new Uint32Array(1);crypto.getRandomValues(random);
     const selected=Number($('monSupportSelect').value);
     let index=random[0]%supportPeople.length;
     if(supportPeople.length>1&&index===selected)index=(index+1)%supportPeople.length;
     showSupportPerson(index);
     status('Colaborador sorteado: '+supportPeople[index].name+'. Confira chat e voz antes da avaliação.');
   });
   $('monSearchCalls')?.addEventListener('click',listCalls);
   $('monLoadChat')?.addEventListener('click',()=>loadChat());
   $('monTranscribe')?.addEventListener('click',transcribe);
   $('monRun').addEventListener('click',analyse);
   $('monSave').addEventListener('click',async()=>{try{await saveReview()}catch(e){status('Registro: '+String(e.message||e))}});
   $('monReportReload').addEventListener('click',refreshReports);
   $('monExcel').addEventListener('click',exportExcel);
   $('monRefreshAlerts').addEventListener('click',refreshAlerts);
   $('monSaveRoute').addEventListener('click',saveRoute);
   $('monReloadRoutes').addEventListener('click',loadRoutes);
   $('monExportChat').addEventListener('click',()=>download('chat_monitoria.txt',$('monTranscript').value,'text/plain;charset=utf-8'));
   $('monExportReview').addEventListener('click',()=>{if(lastAnalysis)download('avaliacao_monitoria.json',JSON.stringify(lastAnalysis,null,2),'application/json')});
   $('monResults').textContent='Selecione um canal e informe a conversa para iniciar.';
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
 else init();
})();
