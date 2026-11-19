import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import simulator from '../lib/sla-alert-simulation.cjs';

const { simulateSlaAlerts } = simulator;
const now = '2026-11-19T19:56:00Z';
const ticket = (overrides = {}) => ({
  id: '102345',
  ownerTeam: 'Implantação',
  baseStatus: 'InAttendance',
  slaSolutionDate: '2026-11-17T19:56:00Z',
  slaSolutionDateIsPaused: false,
  lastActionDate: '2026-11-18T19:56:00Z',
  owner: { id: '204', businessName: 'Mariana' },
  subject: 'Exemplo de implantação',
  ...overrides
});
const run = (tickets, opts = {}) => simulateSlaAlerts(tickets, {
  now: Date.parse(now),
  ...opts
});

test('overdue Implantação ticket produces a preview, not a message delivery', () => {
  const result = run([ticket()]);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.notificationsSent, 0);
  assert.equal(result.eligible[0].ownerId, '204');
  assert.equal(result.eligible[0].overdueMinutes, 2880);
  assert.match(result.eligible[0].preview, /por gentileza/);
  assert.equal(result.eligible[0].sent, false);
});

test('wrong team, stopped/paused, resolved/closed tickets are excluded', () => {
  const result = run([
    ticket({ id: '1', ownerTeam: 'Suporte' }),
    ticket({ id: '2', baseStatus: 'Stopped' }),
    ticket({ id: '3', slaSolutionDateIsPaused: true }),
    ticket({ id: '4', slaSolutionDateIsPaused: null }),
    ticket({ id: '5', baseStatus: 'Resolved' }),
    ticket({ id: '6', baseStatus: 'Closed' }),
    ticket({ id: '7', baseStatus: 'Canceled' })
  ]);
  assert.equal(result.eligibleCount, 0);
  assert.equal(result.excludedCount, 7);
  assert.equal(result.reasons.OUTRO_SETOR, 1);
  assert.equal(result.reasons.CHAMADO_PARADO, 1);
  assert.equal(result.reasons.SLA_PAUSADO_OU_INDEFINIDO, 2);
  assert.equal(result.reasons.CHAMADO_CONCLUIDO, 3);
});

test('invalid due dates, not-yet-expired SLA, missing owner are excluded', () => {
  const result = run([
    ticket({ id: '1', slaSolutionDate: null }),
    ticket({ id: '2', slaSolutionDate: '2026-11-17' }),
    ticket({ id: '3', slaSolutionDate: '2026-11-20T19:56:00Z' }),
    ticket({ id: '4', owner: null })
  ]);
  assert.equal(result.eligibleCount, 0);
  assert.equal(result.reasons.SEM_PRAZO_UTC_VALIDO, 2);
  assert.equal(result.reasons.DENTRO_DO_PRAZO, 1);
  assert.equal(result.reasons.SEM_RESPONSAVEL, 1);
});

test('duplicate records and optionally known alert keys are excluded', () => {
  const base = ticket();
  const sameCall = run([base, base]);
  assert.equal(sameCall.eligibleCount, 1);
  assert.equal(sameCall.reasons.ALERTA_DUPLICADO, 1);
  const historical = run([base], {
    previouslyNotifiedKeys: new Set([sameCall.eligible[0].deduplicationKey])
  });
  assert.equal(historical.eligibleCount, 0);
  assert.equal(historical.reasons.ALERTA_DUPLICADO, 1);
});

test('empty result and unknown status remain safe', () => {
  assert.equal(run([]).eligibleCount, 0);
  assert.equal(run([ticket({ baseStatus: 'Custom' })]).reasons.STATUS_NAO_ELEGIVEL, 1);
});

const route = readFileSync(new URL('../api/audit-sla-simulation.js', import.meta.url), 'utf8');

test('API contract restricts to GET and never writes to Movidesk or Supabase', () => {
  assert.match(route, /req\.method !== 'GET'/);
  assert.match(route, /method: 'GET'/);
  assert.doesNotMatch(route, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  assert.doesNotMatch(route, /sendMail|sendEmail|processChargeInternalNote|movideskInternalAction/);
  assert.match(route, /notificationsSent:\s*0/);
  assert.match(route, /SUPABASE_ALLOWED_EMAILS/);
});

test('API GET uses authenticated, read-only Movidesk query and returns safe preview', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_ALLOWED_EMAILS: process.env.SUPABASE_ALLOWED_EMAILS,
    MOVIDESK_TOKEN: process.env.MOVIDESK_TOKEN
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-public-key';
  process.env.SUPABASE_ALLOWED_EMAILS = 'quality@example.com';
  process.env.MOVIDESK_TOKEN = 'fake-token-for-test-only';

  try {
    const { default: handler } = await import('../api/audit-sla-simulation.js');
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      assert.equal(options.method, 'GET');
      if (String(url).includes('/auth/v1/user')) {
        return { ok: true, json: async () => ({ id: 'user-1', email: 'quality@example.com' }) };
      }
      const reqUrl = new URL(url);
      assert.equal(reqUrl.hostname, 'api.movidesk.com');
      assert.equal(reqUrl.searchParams.get('$filter'), "ownerTeam eq 'Implantação'");
      assert.equal(reqUrl.searchParams.get('token'), 'fake-token-for-test-only');
      return { ok: true, json: async () => [ticket()] };
    };
    const response = {
      statusCode: 200, headers: {},
      setHeader(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
      end() { return this; }
    };
    await handler({ method: 'GET', headers: { authorization: 'Bearer test-session' }, query: {} }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.eligibleCount, 1);
    assert.equal(response.body.notificationsSent, 0);
    assert.equal(response.body.coverage.excludesTicketsNotUpdatedInLast90Days, true);
    assert.equal(calls.length, 2);
    assert.doesNotMatch(JSON.stringify(response.body), /fake-token-for-test-only/);

    calls.length = 0;
    const notAllowed = { ...response, statusCode: 200 };
    await handler({ method: 'POST', headers: { authorization: 'Bearer test-session' }, query: {} }, notAllowed);
    assert.equal(notAllowed.statusCode, 405);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
