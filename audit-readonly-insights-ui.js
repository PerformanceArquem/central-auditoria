/* Diagnostic preview only. No write endpoints, messaging or automatic execution. */
(function () {
  'use strict';
  let busy=false;
  const get=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
  const localTime=value=>{
    if(!value||!Number.isFinite(Date.parse(value)))return 'Não informado';
    return new Intl.DateTimeFormat('pt-BR',{
      timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'
    }).format(new Date(value));
  };
  const place=(target,markup,empty)=>{
    if(!target)return;
    target.innerHTML=markup||'<tr><td colspan="6">'+esc(empty)+'</td></tr>';
  };
  async function runAuditReadonlyInsights() {
    if(busy)return;
    const button=get('auditInsightsRun'),status=get('auditInsightsStatus'),
      metrics=get('auditInsightsMetrics');
    if(!button||!status||!metrics)return;
    busy=true;button.disabled=true;
    status.textContent='Consultando registros sincronizados em modo somente leitura...';
    metrics.textContent='';
    try{
      const session=await window.tmAuth?.getSession?.();
      if(!session?.access_token)throw Error('Entre novamente na Central para consultar.');
      const response=await fetch('/api/audit-readonly-insights',{
        method:'GET',cache:'no-store',
        headers:{Authorization:'Bearer '+session.access_token,Accept:'application/json'}
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Consulta indisponível.');
      if(data.mode!=='dry-run'||data.notificationsSent!==0||data.changesWritten!==0)
        throw Error('A resposta não confirmou bloqueio de envios e gravações.');

      metrics.textContent=[
        data.coverage.openTickets+' chamados abertos na amostra',
        data.alerts.total+' situações de alerta',
        data.quality.totalFlagged+' chamados para revisão',
        data.productivity.collaboratorsTotal+' colaboradores com apontamentos'
      ].join(' · ');

      place(get('auditInsightsAlerts'),(data.alerts.preview||[]).map(x=>`<tr>
        <td>#${esc(x.ticketId)}</td><td>${esc(x.team)}</td>
        <td>${esc(x.owner)}</td><td>${esc(x.kind)}</td>
        <td>${esc(localTime(x.slaDue || x.lastActionAt))}</td>
        <td><details><summary>Prévia</summary><p>${esc(x.messagePreview)}</p></details></td>
      </tr>`).join(''),'Nenhum alerta identificado no recorte.');

      place(get('auditInsightsQueues'),(data.queues.teams||[]).map(x=>`<tr>
        <td>${esc(x.team)}</td><td>${esc(x.open)}</td>
        <td>${esc(x.verifiedEntry)}</td>
        <td>${esc(x.queueDaysAverage===null?'Indisponível':x.queueDaysAverage+' dias')}</td>
        <td>${esc(x.withoutMovementSevenDays)}</td><td>${esc(x.overdue)}</td>
      </tr>`).join(''),'Nenhuma fila identificada.');

      place(get('auditInsightsQuality'),(data.quality.preview||[]).map(x=>`<tr>
        <td>#${esc(x.ticketId)}</td><td>${esc(x.team)}</td>
        <td>${esc(x.owner)}</td><td>${esc(x.subject)}</td>
        <td colspan="2">${(x.signals||[]).map(s=>'<div>'+esc(s.evidence)+'</div>').join('')}</td>
      </tr>`).join(''),'Nenhum sinal encontrado no recorte.');

      place(get('auditInsightsProductivity'),(data.productivity.collaborators||[]).map(x=>`<tr>
        <td>${esc(x.collaborator)}</td>
        <td>${esc(x.hours.toLocaleString('pt-BR',{minimumFractionDigits:2}))} h</td>
        <td>${esc(x.appointmentCount)}</td><td>${esc(x.ticketCount)}</td>
        <td>${esc(x.teams.join(', ')||'Não identificado')}</td>
        <td><details><summary>Atividades</summary>${x.activities.map(a=>
          '<p>'+esc(a.activity)+': '+esc(a.minutes)+' min</p>').join('')}</details></td>
      </tr>`).join(''),'Nenhum apontamento válido no recorte.');

      status.textContent='Prévia gerada sem envios. '+
        'Apontamentos: '+data.period.appointmentsFrom+' a '+data.period.appointmentsTo+
        '. '+(data.coverage.ticketsMayBePartial||data.coverage.appointmentsMayBePartial?
          'Atenção: limite de paginação atingido; indicadores parciais. ':'')+
        (data.warnings||[]).join(' ');
    }catch(error){
      status.textContent='Não foi possível concluir a prévia: '+
        (error.message||'falha na leitura')+'. Nenhuma mensagem enviada.';
    }finally{busy=false;button.disabled=false;}
  }
  window.runAuditReadonlyInsights=runAuditReadonlyInsights;
})();
