import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeySession, acceptLaunchKey, chipLabel, NOTICES, messageFor } from '../../src/core/key.js';

const mem = () => { const d = {}; return { d, getItem: (k) => d[k] ?? null, setItem: (k, v) => { d[k] = v; }, removeItem: (k) => { delete d[k]; } }; };
const FAR = '2099-01-01T00:00:00.000Z';
const adapter = (reply) => ({ calls: [], async checkKey(k) { this.calls.push(k); return typeof reply === 'function' ? reply(k) : reply; } });
const fakeTimers = () => { const q = []; return { q, set: (f, ms) => { q.push({ f, ms }); return q.length; }, clear: () => {} }; };

test('the key is taken from the URL fragment, stored for the tab only, and the fragment is stripped from the address bar', () => {
  const storage = mem(); const replaced = [];
  const key = acceptLaunchKey({ loc: { hash: '#key=ergk_abc-_123', pathname: '/', search: '?demo=empty' }, hist: { replaceState: (...a) => replaced.push(a) }, storage });
  assert.equal(key, 'ergk_abc-_123');
  assert.deepEqual(storage.d, { 'rhl.key': 'ergk_abc-_123' });
  assert.deepEqual(replaced, [[null, '', '/?demo=empty']], 'the address bar keeps the path and query, not the key');
  assert.equal(acceptLaunchKey({ loc: { hash: '', pathname: '/', search: '' }, hist: { replaceState: () => assert.fail('nothing to strip') }, storage }), '');
  assert.equal(acceptLaunchKey({ loc: { hash: '#other=1', pathname: '/', search: '' }, hist: { replaceState: () => assert.fail('nothing to strip') }, storage }), '');
});

test('the rest of the fragment is kept when the key is taken out', () => {
  const replaced = [];
  acceptLaunchKey({ loc: { hash: '#a=1&key=ergk_x&b=2', pathname: '/p', search: '' }, hist: { replaceState: (...a) => replaced.push(a) }, storage: mem() });
  assert.deepEqual(replaced, [[null, '', '/p#a=1&b=2']]);
});

test('states: none without a key; valid with subject and expiry after check_key; expired; invalid', async () => {
  const none = createKeySession({ storage: mem(), adapter: adapter({}) });
  assert.equal(none.getState().state, 'none');
  assert.equal(none.canWrite(), false);
  for (const [reply, want] of [[{ ok: true, subject: 'Ana', expires_at: FAR }, 'valid'], [{ ok: false, error: 'key_expired' }, 'expired'], [{ ok: false, error: 'key_invalid' }, 'invalid']]) {
    const s = createKeySession({ storage: mem(), adapter: adapter(reply), timers: fakeTimers() });
    await s.setKey('ergk_x');
    assert.equal(s.getState().state, want);
    assert.equal(s.canWrite(), want === 'valid');
  }
  const v = createKeySession({ storage: mem(), adapter: adapter({ ok: true, subject: 'Ana', expires_at: FAR }), timers: fakeTimers() });
  await v.setKey('ergk_x');
  assert.deepEqual([v.getState().subject, v.getState().expiresAt], ['Ana', FAR]);
});

test('a key already in the tab storage is checked on load; a network failure keeps what was known', async () => {
  const storage = mem(); storage.setItem('rhl.key', 'ergk_x');
  const a = adapter({ ok: true, subject: 'Ana', expires_at: FAR });
  const s = createKeySession({ storage, adapter: a, timers: fakeTimers() });
  assert.equal(s.getState().state, 'checking');
  await s.check();
  assert.equal(s.getState().state, 'valid');
  a.checkKey = async () => ({ ok: false, error: 'network' });
  await s.check();
  assert.equal(s.getState().state, 'valid', 'a dropped connection does not unlock or lock anything');
});

test('an expiry timer flips valid to expired at expires_at', async () => {
  const t = fakeTimers();
  const soon = new Date(Date.now() + 5000).toISOString();
  const s = createKeySession({ storage: mem(), adapter: adapter({ ok: true, subject: 'Ana', expires_at: soon }), timers: t });
  await s.setKey('ergk_x');
  assert.equal(s.getState().state, 'valid');
  assert.ok(t.q[0].ms > 3000 && t.q[0].ms <= 5000);
  t.q[0].f();
  assert.equal(s.getState().state, 'expired');
  assert.equal(s.getState().subject, 'Ana');
});

test('run sends the key as the write argument; a refusal for the key moves the state; other results do not', async () => {
  const s = createKeySession({ storage: mem(), adapter: adapter({ ok: true, subject: 'Ana', expires_at: FAR }), timers: fakeTimers() });
  assert.deepEqual(await s.run(async () => ({ ok: true })), { ok: false, error: 'key_none' }, 'no key, no write');
  await s.setKey('ergk_x');
  assert.deepEqual(await s.run(async (k) => ({ ok: true, k })), { ok: true, k: 'ergk_x' });
  assert.equal((await s.run(async () => ({ ok: false, error: 'network' }))).error, 'network');
  assert.equal(s.getState().state, 'valid');
  await s.run(async () => ({ ok: false, error: 'key_expired' }));
  assert.equal(s.getState().state, 'expired');
  await s.run(async () => ({ ok: false, error: 'key_invalid' }));
  assert.equal(s.getState().state, 'invalid');
});

test('the key never reaches localStorage or the console, and clear forgets it', async () => {
  const logged = []; const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => logged.push(a.join(' '));
  const storage = mem();
  try {
    const s = createKeySession({ storage, adapter: adapter({ ok: false, error: 'key_invalid' }), timers: fakeTimers() });
    await s.setKey('ergk_secretvalue');
    await s.run(async () => ({ ok: false, error: 'key_invalid' }));
    s.clear();
  } finally { Object.assign(console, orig); }
  assert.equal(logged.filter((l) => l.includes('ergk_secretvalue')).length, 0);
  assert.deepEqual(storage.d, {});
});

test('plain-language notices and chip labels', () => {
  assert.equal(NOTICES.none, 'Viewing only. Your agent turns on editing when you open this board through it.');
  assert.equal(NOTICES.expired, 'Editing has ended. Ask your agent to open this board again.');
  assert.equal(NOTICES.invalid, 'Editing is not available here. Ask your agent to open this board again.');
  assert.equal(chipLabel('valid', 'Ana'), 'Editing as Ana');
  assert.equal(chipLabel('none'), 'View only');
  assert.equal(chipLabel('expired'), 'Editing ended');
  assert.equal(chipLabel('invalid'), 'Editing unavailable');
  assert.match(messageFor('whatever'), /Something went wrong/);
  for (const n of Object.values(NOTICES)) assert.doesNotMatch(n, /passcode|password/i);
});
