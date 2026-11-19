/* Etapa 4 — triagem de qualidade e rascunhos assistidos, sem registrar NCs. */
(function () {
  'use strict';
  let loading=false, current=[];
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
  const time=value=>value&&Number.isFinite(Date.parse(value))
    ?new Intl.DateTimeFormat('pt-BR',{
      timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'
    }).format(new Date(value))
    :'Não comprovada';

  async function fetchPreview(){
    if(loading)return;
    const btn=$('qualityReviewRun'),status=$('qualityReviewStatus'),
      summary=$('qualityReviewMetrics'),rows=$('qualityReviewRows');
    if(!btn||!status||!summary||!rows)return;
    loading=true;btn.disabled=true;current=[];
    rows.innerHTML='<tr><td colspan="6">Consultando evidências disponíveis...</td></tr>';
    summary.textContent='';
    status.textContent='Consultando registros sincronizados, somente leitura...';
    $('qualityAiDraft').textContent='';
    try{
      const session=await window.tmAuth?.getSession?.();
      if(!session?.access_token)throw Error('Faça login novamente na Central.');
      const response=await fetch('/api/audit-quality-review',{
        method:'GET',cache:'no-store',
        headers:{Authorization:'Bearer '+session.access_token,Accept:'application/json'}
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Falha ao consultar evidências.');
      if(data.mode!=='dry-run'||data.notificationsSent!==0||
        data.changesWritten!==0||data.nonConformitiesCreated!==0)
        throw Error('Resposta não reconhecida como simulação segura.');
      current=Array.isArray(data.preview)?data.preview:[];
      summary.textContent=[
        data.evaluated+' registros avaliados',
        data.candidates+' candidatos a revisão',
        data.staleSkipped+' snapshots desatualizados',
        '0 NCs registradas'
      ].join(' · ');
      rows.innerHTML=current.map((item,i)=>'<tr>'+
        '<td>#'+esc(item.ticketId)+'</td>'+
        '<td>'+esc(item.team)+'</td>'+
        '<td>'+esc(item.ownerName)+'</td>'+
        '<td title="'+esc(item.subject)+'">'+esc(item.subject)+'</td>'+
        '<td>'+esc(item.signals.map(s=>s.title).join('; '))+'</td>'+
        '<td><button class="s" type="button" data-quality-index="'+i+
        '" onclick="qualityReviewSelect(this)">Orientações</button></td>'+
        '</tr>').join('')||
        '<tr><td colspan="6">Nenhum sinal técnico para revisão no recorte atual.</td></tr>';
      status.textContent='Prévia concluída. Nenhuma não conformidade registrada. '+
        (data.coverage?.potentiallyTruncated?'Amostra parcial: limite de páginas atingido. ':'')+
        'Sem validação do procedimento vigente, todos os achados são apenas orientativos. '+
        (data.previewTruncated?'Mostrados os primeiros 30 candidatos. ':'')+
        'A Qualidade deve analisar evidência, contexto e causa antes de qualquer decisão.';
    }catch(error){
      status.textContent='Prévia indisponível: '+(error.message||'erro')+'. Nenhum dado foi alterado.';
      rows.innerHTML='<tr><td colspan="6">Consulta não concluída.</td></tr>';
    }finally{loading=false;btn.disabled=false;}
  }
  function select(btn){
    const index=Number(btn?.dataset?.qualityIndex);
    const caseRecord=Number.isInteger(index)?current[index]:null;
    const area=$('qualityAiDraft');
    if(!caseRecord||!area)return;
    const guidance=caseRecord.signals.map(s=>'• '+s.title+': '+s.reviewGuidance).join('\n');
    $('qualityAiCodes').value=caseRecord.signals.map(s=>s.code).join(',');
    area.textContent='Prévia de conferência — chamado #'+caseRecord.ticketId+
      '\n\n'+guidance+
      '\n\nNenhuma conclusão de NC; validar procedimento publicado, evidência e causa com a Qualidade.';
    $('qualityAiPreviewTitle').textContent='Orientações selecionadas · chamado #'+caseRecord.ticketId;
  }
  let aiBusy=false;
  async function generateGuidance(){
    if(aiBusy)return;
    const status=$('qualityAiStatus'),area=$('qualityAiDraft'),codes=$('qualityAiCodes');
    const consent=$('qualityAiConsent');
    if(!codes?.value||!status||!area)return;
    if(!consent?.checked){
      status.textContent='Marque a autorização explícita para solicitar orientações com IA. Sem autorização, use as orientações locais acima.';
      return;
    }
    const session=await window.tmAuth?.getSession?.();
    if(!session?.access_token){
      status.textContent='Sessão expirada. Faça login novamente.';return;
    }
    aiBusy=true;$('qualityAiGenerate').disabled=true;
    status.textContent='Validando a possibilidade de rascunho seguro...';
    try{
      const response=await fetch('/api/audit-quality-ai-draft',{
        method:'POST',cache:'no-store',
        headers:{
          Authorization:'Bearer '+session.access_token,
          'Content-Type':'application/json',Accept:'application/json'
        },
        // Códigos internos apenas: não enviar ticket, pessoa, cliente ou conteúdo.
        body:JSON.stringify({signalCodes:codes.value.split(','),externalAiConsent:true})
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Não foi possível gerar orientações.');
      if(data.mode!=='dry-run'||data.changesWritten!==0||data.nonConformitiesCreated!==0)
        throw Error('A resposta não possui as garantias de segurança exigidas.');
      const advice=(data.checklist||[]).map(x=>'• '+x.suggestion).join('\n');
      area.textContent='RASCUNHO PARA REVISÃO DA QUALIDADE\n\n'+data.draft+
        (advice?'\n\nChecagens técnicas:\n'+advice:'')+
        '\n\nNão é classificação nem registro de NC.';
      status.textContent=data.aiUsed?
        'Rascunho Gemini gerado com códigos genéricos e consentimento explícito; nenhuma ação no Movidesk.':
        'Gemini não utilizado: orientações locais exibidas. A IA está desativada por padrão.';
    }catch(error){
      status.textContent='Não foi possível gerar o rascunho: '+(error.message||'falha de consulta');
    }finally{aiBusy=false;$('qualityAiGenerate').disabled=false;}
  }
  window.runQualityReviewPreview=fetchPreview;
  window.qualityReviewSelect=select;
  window.qualityGenerateGuidance=generateGuidance;
})();
