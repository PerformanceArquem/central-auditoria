/* SLA simulation UI: read-only, manually invoked, no real Movidesk notifications. */
(function () {
  'use strict';
  let running = false;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const time = value => {
    if (!value || !Number.isFinite(Date.parse(value))) return 'Não informado';
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo'
    }).format(new Date(value));
  };
  const delay = minutes => {
    const days = Math.floor(Number(minutes) / 1440);
    const hours = Math.floor((Number(minutes) % 1440) / 60);
    return days ? `${days} dia(s) e ${hours}h` : `${Math.max(1, hours)}h`;
  };

  async function runSlaSimulation() {
    if (running) return;
    const button = $('slaSimulationRun');
    const status = $('slaSimulationStatus');
    const tbody = $('slaSimulationRows');
    const metrics = $('slaSimulationMetrics');
    if (!button || !status || !tbody || !metrics) return;
    running = true;
    button.disabled = true;
    status.textContent = 'Consultando SLA da Implantação em modo somente leitura...';
    tbody.replaceChildren();
    metrics.textContent = '';
    try {
      const session = await window.tmAuth?.getSession?.();
      if (!session?.access_token) throw new Error('Faça login novamente na Central de Auditoria');
      const response = await fetch('/api/audit-sla-simulation', {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          Accept: 'application/json'
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha na simulação');
      if (data.mode !== 'dry-run' || data.notificationsSent !== 0) {
        throw new Error('Resposta sem garantia de simulação segura');
      }
      metrics.textContent =
        `${data.examined} chamados avaliados · ${data.eligibleCount} elegíveis · ${data.excludedCount} descartados · 0 enviados`;
      const coverage = data.coverage?.potentiallyTruncated
        ? 'Resultado parcial: limite de páginas atingido.'
        : 'Consulta por páginas concluída para o recorte disponível.';
      status.textContent = `Simulação concluída. ${coverage} A API principal não inclui chamados sem atualização há mais de 90 dias; não é um total histórico. Nenhuma mensagem foi enviada.`;

      const candidates = (data.eligible || []).slice(0, 100);
      tbody.innerHTML = candidates.map(item => `<tr>
        <td>#${esc(item.ticketId)}</td>
        <td>${esc(item.ownerName || item.ownerId)}</td>
        <td>${esc(item.subject || 'Não informado')}</td>
        <td>${esc(delay(item.overdueMinutes))}</td>
        <td>${esc(time(item.lastActionDate))}</td>
        <td><details><summary>Ver prévia</summary><pre style="white-space:pre-wrap;font:inherit;max-width:480px">${esc(item.preview)}</pre></details></td>
      </tr>`).join('') || '<tr><td colspan="6">Nenhum chamado elegível neste recorte.</td></tr>';
    } catch (error) {
      status.textContent = 'Simulação não concluída: ' + (error.message || 'erro de consulta') + '. Nenhuma mensagem enviada.';
    } finally {
      running = false;
      button.disabled = false;
    }
  }
  window.runSlaSimulation = runSlaSimulation;
})();
