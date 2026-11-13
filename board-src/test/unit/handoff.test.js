import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harnessTarget } from '../../src/core/handoff.js';
import { validate, policy, readOrigins } from '../../ops/harness-origins.mjs';
import { apply } from '../../ops/headers.mjs';
import { readFileSync } from 'node:fs';

test('a framed board posts only to an allow-listed parent origin, read from the browser; everyone else is a plain browser', () => {
  const allowed = ['https://shell.ergon.example'];
  assert.equal(harnessTarget({ ancestorOrigins: ['https://shell.ergon.example'], allowed }), 'https://shell.ergon.example');
  assert.equal(harnessTarget({ ancestorOrigins: ['https://evil.example'], allowed }), null, 'an unlisted embedder gets nothing');
  assert.equal(harnessTarget({ ancestorOrigins: ['https://evil.example', 'https://shell.ergon.example'], allowed }), null, 'only the direct parent counts');
  assert.equal(harnessTarget({ ancestorOrigins: undefined, allowed }), null, 'no ancestorOrigins (Firefox): plain browser');
  assert.equal(harnessTarget({ ancestorOrigins: [], allowed }), null);
  assert.equal(harnessTarget({ ancestorOrigins: ['null'], allowed: ['null'] }), null, 'an opaque origin is never a target');
  assert.equal(harnessTarget({ ancestorOrigins: ['https://shell.ergon.example'], allowed: [] }), null, 'the default empty list posts nothing');
});

test('the origin list: exact https origins only; wildcards, paths and plain http are rejected with a clear error', () => {
  assert.deepEqual(validate(['https://a.example', 'https://b.example:8443']), ['https://a.example', 'https://b.example:8443']);
  for (const bad of ['*', 'https://*.example', 'http://a.example', 'https://a.example/path', 'a.example', 'https://a.example;x', "https://a.example'"]) {
    assert.throws(() => validate([bad]), /not an exact https origin|wildcards are not allowed/, bad);
  }
  assert.throws(() => validate('https://a.example'), /array/);
  assert.deepEqual(validate(['http://127.0.0.1:4000'], { loopback: true }), ['http://127.0.0.1:4000'], 'loopback http only for the test harness switch');
  assert.throws(() => validate(['http://evil.example'], { loopback: true }), /not an exact https origin/);
});

test('the committed list is valid and ships empty; vercel.json carries frame-ancestors from that one list, never X-Frame-Options, never *', () => {
  assert.deepEqual(readOrigins(), [], 'no shell domain is invented: the list is empty until the real ones are supplied');
  const cfg = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const all = cfg.headers.find((h) => h.source === '/(.*)').headers;
  assert.equal(all.some((h) => h.key.toLowerCase() === 'x-frame-options'), false);
  const csp = all.find((h) => h.key === 'Content-Security-Policy').value;
  assert.equal(csp, policy(readOrigins()), 'vercel.json is in step with ops/harness-origins.json (run node ops/headers.mjs)');
  assert.match(csp, /^frame-ancestors 'self'/);
  assert.doesNotMatch(csp, /\*|'none'/);
});

test('the generator writes frame-ancestors "self" plus the enumerated origins and replaces any older framing header', () => {
  const cfg = { headers: [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'X-Content-Type-Options', value: 'nosniff' }] }] };
  const out = apply(cfg, ['https://shell.ergon.example', 'https://staging.ergon.example']).headers[0].headers;
  assert.deepEqual(out.map((h) => h.key), ['X-Content-Type-Options', 'Content-Security-Policy']);
  assert.equal(out[1].value, "frame-ancestors 'self' https://shell.ergon.example https://staging.ergon.example");
  assert.equal(policy([]), "frame-ancestors 'self'");
});
