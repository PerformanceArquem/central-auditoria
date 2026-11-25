(() => {
  'use strict';
  const pagesOrigin = 'https://performancearquem.github.io';
  const onPages = location.origin === pagesOrigin;
  const backend = onPages ? 'https://central-auditoria-iota.vercel.app' : location.origin;
  const endpoints = new Set([
    '/api/auth', '/api/movidesk', '/api/ticket-manager', '/api/public-config',
    '/api/audit-ticket-lookup', '/api/audit-ticket-inspection', '/api/audit-forecast-variances',
    '/api/audit-direct-comparisons', '/api/audit-production-metrics', '/api/audit-production-flow',
    '/api/voice-reconciliation'
  ]);

  window.centralApiFetch = (path, options) => {
    const target = new URL(path, backend);
    if (target.origin !== backend || !endpoints.has(target.pathname)) {
      throw new Error('Destino da API inválido.');
    }
    if (!onPages) return fetch(target.pathname + target.search, options);
    return fetch(target, { ...options, credentials: 'omit', redirect: 'error' });
  };
})();
