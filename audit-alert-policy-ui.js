/* Etapa 2: prévia manual de alertas, sem qualquer operação de escrita. */
(function(){
  'use strict';
  let running=false;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
  const label={
    PREVENTIVO_24H:'Preventivo — vence em até 24h',
    SLA_VENCIDO:'Prazo de solução vencido',
    ESCALONAMENTO_GESTOR:'Candidato a escalonamento (revisão)',
    SEM_MOVIMENTACAO_7D:'Sem ação registrada há 7 dias'
  };
  const time=x=>x&&Number.isFinite(Date.parse(x))
    ?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',
      timeZone:'America/Sao_Paulo'}).format(new Date(x))
    :'Não informado';
  const fmt=x=>Number.isFinite(Number(x))?
    Number(x).toLocaleString('pt-BR',{maximumFractionDigits:1})+' h':'—';
  async function runPolicyPreview(){
    const button=$('policyPreviewRun'),status=$('policyPreviewStatus'),metrics=$('policyPreviewMetrics'),
      rows=$('policyPreviewRows'),teamSelect=$('policyPreviewTeam');
    if(running||!button||!status||!metrics||!rows||!teamSelect)return;
    const requestedTeam=teamSelect.value;
    button.disabled=true;running=true;
    status.textContent='Consultando a base sincronizada; nenhuma mensagem será enviada...';
    metrics.textContent='';
    rows.replaceChildren();
    try{
      const session=await window.tmAuth?.getSession?.();
      if(!session?.access_token)throw Error('Entre na Central novamente.');
      const response=await fetch('/api/audit-alert-policy-preview?'+
        new URLSearchParams({team:requestedTeam}),{
          method:'GET',cache:'no-store',
          headers:{Authorization:'Bearer '+session.access_token,Accept:'application/json'}
        });
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Não foi possível consultar os alertas.');
      if(data.mode!=='dry-run'||data.notificationsSent!==0||data.changesWritten!==0)
        throw Error('A resposta não confirmou a simulação segura.');
      metrics.textContent=[
        data.scanned+' registros consultados',
        data.qualified+' situações identificadas',
        (data.byType?.PREVENTIVO_24H||0)+' preventivos',
        (data.byType?.SLA_VENCIDO||0)+' vencidos',
        (data.byType?.ESCALONAMENTO_GESTOR||0)+' para revisão do gestor',
        '0 enviados'
      ].join(' · ');
      status.textContent='Simulação concluída para '+data.team+'. '+
        (data.coverage?.partial?'Amostra parcial (paginação limitada). ':'')+
        (data.previewTruncated?'A tabela mostra somente os primeiros 50. ':'')+
        'Sem integração com histórico de notificações anteriores ou cadastro de gestores. '+
        'Não foram enviados e-mails ou mensagens, e não houve atualizações no Movidesk.';
      const preview=Array.isArray(data.preview)?data.preview:[];
      rows.innerHTML=preview.map(x=>'<tr>'+
        '<td>#'+esc(x.ticketId)+'</td>'+
        '<td>'+esc(x.ownerName)+'</td>'+
        '<td>'+esc(x.team)+'</td>'+
        '<td>'+esc(label[x.type]||x.type)+'</td>'+
        '<td>'+esc(time(x.dueAt))+'</td>'+
        '<td>'+esc(time(x.lastRealActionAt))+'</td>'+
        '<td>'+esc(x.recipient)+'</td>'+
        '<td><details><summary>Visualizar</summary><pre style="white-space:pre-wrap;font:inherit;max-width:450px">'+
          esc(x.messagePreview)+'</pre></details></td>'+
        '</tr>').join('')||
        '<tr><td colspan="8">Nenhuma situação elegível com dados suficientemente atualizados.</td></tr>';
    }catch(e){
      status.textContent='Não foi possível concluir a prévia: '+(e.message||'erro desconhecido')+
        '. Nenhuma mensagem enviada.';
    }finally{button.disabled=false;running=false;}
  }
  window.runPolicyPreview=runPolicyPreview;
})();
