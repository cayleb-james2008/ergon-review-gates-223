import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoAdapter, DEMO_KEYS } from '../../src/data/demo.js';

const mem = () => { const d = {}; return { d, getItem: (k) => d[k] ?? null, setItem: (k, v) => { d[k] = v; } }; };
const mk = (flag) => createDemoAdapter({ storage: mem(), channel: null, flag, flagMemo: null });

test('seeds 19 TEST lines and about 14 synthetic TEST jobs', async () => {
  const { lines, entries } = await mk(null).load();
  assert.equal(lines.length, 19);
  assert.ok(lines.every((l) => l.is_test));
  assert.ok(entries.length >= 12 && entries.length <= 16);
  assert.ok(entries.every((e) => e.title.startsWith('TEST ') && e.is_test));
});

test('URL flags: empty, nolines, lines=N', async () => {
  assert.equal((await mk('empty').load()).entries.length, 0);
  assert.equal((await mk('nolines').load()).lines.length, 0);
  assert.equal((await mk('lines=5').load()).lines.length, 5);
});

test('writes need a demo key: the valid key saves, the expired key is key_expired, anything else is key_invalid; check_key says who and until when', async () => {
  const a = mk('empty');
  const e = { line_code: 'A', title: 'TEST a', status: 'open' };
  assert.equal((await a.saveEntry('wrong', e)).error, 'key_invalid');
  assert.equal((await a.saveEntry(DEMO_KEYS.revoked, e)).error, 'key_invalid');
  assert.equal((await a.saveEntry(DEMO_KEYS.expired, e)).error, 'key_expired');
  assert.equal((await a.load()).entries.length, 0, 'nothing was written by a refused key');
  assert.equal((await a.saveEntry(DEMO_KEYS.valid, e)).ok, true);
  const c = await a.checkKey(DEMO_KEYS.valid);
  assert.deepEqual([c.ok, c.subject], [true, 'Demo employee']);
  assert.ok(Date.parse(c.expires_at) > Date.now() + 86400000 * 300, 'far expiry');
  assert.equal((await a.checkKey(DEMO_KEYS.expired)).error, 'key_expired');
  assert.equal((await a.checkKey(DEMO_KEYS.revoked)).error, 'key_invalid');
  assert.equal((await a.removeEntry('nope', 'x')).error, 'key_invalid');
});

test('same id twice is an upsert; invalid status is rejected; remove twice gives not_found', async () => {
  const a = mk('empty');
  const id = crypto.randomUUID();
  await a.saveEntry(DEMO_KEYS.valid, { id, line_code: 'A', title: 'TEST one', status: 'open' });
  await a.saveEntry(DEMO_KEYS.valid, { id, line_code: 'A', title: 'TEST one', status: 'ready' });
  const { entries } = await a.load();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'ready');
  assert.equal(entries[0].revision, 2, 'revision bumps on update');
  assert.equal((await a.saveEntry(DEMO_KEYS.valid, { line_code: 'A', title: 'x', status: 'shipped' })).error, 'invalid');
  assert.equal((await a.removeEntry(DEMO_KEYS.valid, id)).ok, true);
  assert.equal((await a.removeEntry(DEMO_KEYS.valid, id)).error, 'not_found');
});

test('the offline hook makes load fail and writes report network', async () => {
  const a = mk(null);
  a.hook.offline = true;
  await assert.rejects(() => a.load());
  assert.equal((await a.checkKey(DEMO_KEYS.valid)).error, 'network');
});
