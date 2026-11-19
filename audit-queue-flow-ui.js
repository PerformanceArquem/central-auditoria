/* Fiscalização de filas — prévia manual, exclusivamente leitura. */
(function(){
  'use strict';
  let running=false;
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,character=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[character]);
  const date=value=>{
    if(!value||!Number.isFinite(Date.parse(value)))return 'Não comprovada';
    return new Intl.DateTimeFormat('pt-BR',{
      dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'
    }).format(new Date(value));
  };
  const days=value=>Number.isFinite(value)?value+' dia(s)':'Não comprovado';
  const put=(id,rows,cols=6)=>{const element=$(id);
    if(element)element.innerHTML=rows||'<tr><td colspan="'+cols+'">Nenhum registro comprovado no recorte.</td></tr>';
  };
  async function runQueueFlowPreview(){
    if(running)return;
    const button=$('queueFlowPreviewRun'),status=$('queueFlowPreviewStatus'),
      metrics=$('queueFlowPreviewMetrics');
    if(!button||!status||!metrics)return;
    running=true;button.disabled=true;
    status.textContent='Lendo movimentos registrados na base sincronizada, sem qualquer envio...';
    metrics.textContent='';
    put('queueFlowTeamRows','<tr><td colspan="7">Consultando...</td></tr>',7);
    put('queueFlowRouteRows','<tr><td colspan="4">Consultando...</td></tr>',4);
    put('queueFlowOldestRows','<tr><td colspan="7">Consultando...</td></tr>',7);
    try{
      const session=await window.tmAuth?.getSession?.();
      if(!session?.access_token)throw Error('Faça login novamente na Central.');
      const response=await fetch('/api/audit-queue-flow-preview',{
        method:'GET',cache:'no-store',
        headers:{Authorization:'Bearer '+session.access_token,Accept:'application/json'}
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Não foi possível consultar as filas.');
      if(data.mode!=='dry-run'||data.notificationsSent!==0||data.changesWritten!==0)
        throw Error('Resultado sem confirmação de bloqueio de ações reais.');
      metrics.textContent=[
        data.coverage.openTicketsInSnapshot+' chamados abertos na amostra',
        data.queue.teams.length+' equipes identificadas',
        data.movements.total+' transferências na janela',
        data.queue.teams.reduce((sum,team)=>sum+team.over15Days,0)+' com 15+ dias na fila',
        '0 envios'
      ].join(' · ');
      const teamRows=(data.queue.teams||[]).map(x=>'<tr>'+
        '<td>'+esc(x.team)+'</td><td>'+esc(x.openTickets)+'</td>'+
        '<td>'+esc(x.verifiedQueueEntries)+'</td>'+
        '<td>'+esc(x.unverifiableQueueAge)+'</td>'+
        '<td>'+esc(x.averageVerifiedQueueDays===null?'Sem dados':x.averageVerifiedQueueDays+' dias')+'</td>'+
        '<td>'+esc(x.over15Days)+'</td><td>'+esc(x.withoutRealAction7Days)+'</td>'+
        '</tr>').join('');
      put('queueFlowTeamRows',teamRows,7);
      const routeRows=(data.movements.routes||[]).map(x=>'<tr>'+
        '<td>'+esc(x.fromTeam)+'</td><td>'+esc(x.toTeam)+'</td>'+
        '<td>'+esc(x.transfers)+'</td><td>'+esc(x.uniqueTickets)+'</td></tr>').join('');
      put('queueFlowRouteRows',routeRows,4);
      const oldest=(data.queue.detailsPreview||[]).map(x=>'<tr>'+
        '<td>#'+esc(x.ticketId)+'</td>'+
        '<td>'+esc(x.team)+'</td><td>'+esc(x.owner)+'</td>'+
        '<td>'+esc(days(x.currentQueueDays))+'</td>'+
        '<td>'+esc(date(x.currentQueueSince))+'</td>'+
        '<td>'+esc(date(x.lastRealActionAt))+'</td>'+
        '<td>'+esc(x.queueEvidence==='ownerHistories'?
          (x.over15Days?'Revisar prioridade — 15+ dias':'Entrada comprovada'):
          'Histórico insuficiente')+'</td>'+
        '</tr>').join('');
      put('queueFlowOldestRows',oldest,7);
      const incomplete=data.coverage.incompleteHistories;
      status.textContent='Prévia concluída em modo somente leitura. '+
        (data.coverage.potentiallyTruncated?
          'Limite de registros atingido: resultado parcial. ':'')+
        (incomplete?'Históricos incompletos em '+incomplete+' registro(s). ':'')+
        data.coverage.staleRecordsSkipped+' registros não recentes desconsiderados. '+
        'Transferências dos últimos '+data.windowDays+' dias entre registros disponíveis; '+
        'não representa o histórico total. Nenhuma notificação ou alteração enviada.';
    }catch(error){
      status.textContent='Falha na prévia: '+(error.message||'consulta indisponível')+
        '. Nenhum dado foi alterado.';
    }finally{
      running=false;button.disabled=false;
    }
  }
  window.runQueueFlowPreview=runQueueFlowPreview;
})();
