import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source = readFileSync(new URL('../ui/api-client.js', import.meta.url), 'utf8');
const routes = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).routes;
const pages = 'https://performancearquem.github.io';
const vercel = 'https://central-auditoria-iota.vercel.app';

function client(origin) {
  const window = {};
  vm.runInNewContext(source, { window, URL, location: { origin }, fetch: (...args) => args });
  return window.centralApiFetch;
}

test('Pages uses the fixed HTTPS backend without cookies or redirects', () => {
  const request = client(pages);
  const [url, options] = request('/api/audit-ticket-inspection?id=7', {
    method: 'POST', headers: { Authorization: 'Bearer fixture' }, credentials: 'same-origin'
  });
  assert.equal(url.href, vercel + '/api/audit-ticket-inspection?id=7');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer fixture');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.throws(() => request('https://other.invalid/api/movidesk'), /inválido/);
  assert.throws(() => request('/api/diagnostico-env'), /inválido/);
});

test('Vercel continues to use the current origin', () => {
  const options = { cache: 'no-store' };
  assert.deepEqual(client(vercel)('/api/public-config', options), ['/api/public-config', options]);
});

test('CORS is scoped to the Pages origin and the browser endpoints', () => {
  for (const route of routes.slice(0, 2)) {
    const regex = new RegExp('^(?:' + route.src + ')$');
    assert.equal(route.headers['Access-Control-Allow-Origin'], pages);
    assert.ok(new RegExp('^(?:' + route.has[0].value + ')$').test(pages));
    assert.ok(!new RegExp('^(?:' + route.has[0].value + ')$').test(pages + '.invalid'));
    for (const match of source.matchAll(/'(\/api\/[a-z-]+)'/g)) assert.ok(regex.test(match[1]), match[1]);
    assert.ok(!regex.test('/api/diagnostico-env'));
  }
  assert.equal(routes[0].status, 204);
  assert.equal(routes[1].continue, true);
});
