import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/core/store.js';
import { fakeEnv, fakeAdapter, tick } from './helpers.js';
import { createDemoAdapter } from '../../src/data/demo.js';
import { LINE_LABELS, POLL_MS } from '../../src/config.js';

const L = LINE_LABELS.map((label, i) => ({ id: `L${label}`, code: label, sort_order: i + 1, is_test: false }));
const setup = (opts = {}) => {
  const env = fakeEnv(opts.env);
  const adapter = fakeAdapter({ lines: L, entries: [] });
  const store = createStore({ adapter, env, retryDelayMs: 0 });
  return { env, adapter, store };
};

const near = (ms, base = 15000) => ms >= base * 0.85 && ms <= base * 1.15; // the reconcile read is jittered by +-15%

test('loading -> ready; a join alone is not Live; the confirmed bindings make it Live and relax polling to the slow reconcile read', async () => {
  const { env, adapter, store } = setup();
  assert.equal(store.getState().loading, true);
  await store.start();
  assert.equal(store.getState().loading, false);
  assert.equal(store.getState().rows.length, 19);
  assert.equal(store.getState().conn, 'polling');
  assert.deepEqual(env.pending(), [POLL_MS]); // the fast poll (a token probe) until the feed is confirmed
  adapter.statusCb('SUBSCRIBED'); // joined, bindings not yet active: events can still be lost
  assert.equal(store.getState().conn, 'polling', 'a join is not Live');
  assert.deepEqual(env.pending(), [POLL_MS], 'and polling continues');
  adapter.statusCb('CONFIRMED');
  await tick();
  assert.equal(store.getState().conn, 'live');
  const p = env.pending();
  assert.equal(p.length, 2);
  assert.equal(p[0], 4000, 'the second catch-up read, 4 s after confirmation');
  assert.ok(near(p[1]), `a reconcile read about every 15 s, not the 4 s poll: ${p[1]}`);
  await env.fire(); // the catch-up
  assert.equal(env.pending().length, 1);
  adapter.statusCb('CLOSED');
  assert.equal(store.getState().conn, 'polling');
  assert.deepEqual(env.pending(), [POLL_MS]);
});

test('a feed that reports Live but never delivers an event: the board still converges, within one reconcile read', async () => {
  const { env, adapter, store } = setup();
  await store.start();
  adapter.statusCb('SUBSCRIBED');
  adapter.statusCb('CONFIRMED');
  await tick();
  await env.fire(); // catch-up
  // a write the feed silently misses
  adapter.data = { lines: L, entries: [{ id: 'missed', line_id: 'LA', title: 'TEST missed', status: 'open', created_at: '2026-01-01T00:00:00Z' }] };
  assert.equal(store.getState().totalJobs, 0, 'stale, and reading Live');
  assert.equal(store.getState().conn, 'live');
  const ms = await env.fire(); // the reconcile read
  assert.ok(near(ms), `converged on the reconcile cadence (${ms} ms)`);
  assert.equal(store.getState().totalJobs, 1, 'healed');
});

test('while confirmed Live nothing polls faster than the reconcile cadence, there is only ever one read scheduled, and an unchanged board costs a token probe, never a full read', async () => {
  const { env, adapter, store } = setup();
  await store.start();
  adapter.statusCb('SUBSCRIBED');
  adapter.statusCb('CONFIRMED');
  await tick();
  await env.fire(); // catch-up
  const loads = adapter.loadCalls;
  const probes = adapter.tokenCalls;
  const delays = [];
  for (let i = 0; i < 12; i++) {
    assert.equal(env.pending().length, 1, 'one timer at a time');
    delays.push(await env.fire());
  }
  assert.ok(delays.every((d) => near(d)), `every scheduled read is a reconcile probe (about 15 s): ${delays}`);
  assert.equal(adapter.loadCalls, loads, 'the board did not move: no full read');
  assert.equal(adapter.tokenCalls, probes + 12, 'twelve tiny probes');
  assert.equal(loads, 3, 'first load, confirmation read, catch-up: the only full reads');
});

test('the probe path: an unchanged token is no full read; a changed token is exactly one; a lines-only change reads the lines, an entries-only change does not', async () => {
  const { env, adapter, store } = setup();
  await store.start();
  adapter.statusCb('SUBSCRIBED');
  adapter.statusCb('CONFIRMED');
  await tick();
  await env.fire(); // catch-up (a full read that records the token)
  let loads = adapter.loadCalls;
  await env.fire(); // reconcile, nothing moved
  assert.equal(adapter.loadCalls, loads);
  adapter.data = { lines: L, entries: [{ id: 'n1', line_id: 'LA', title: 'TEST moved', status: 'open', revision: 1, updated_at: '2026-01-01T00:00:00Z' }] };
  await env.fire(); // reconcile: the token moved
  assert.equal(adapter.loadCalls, loads + 1, 'exactly one full read');
  assert.equal(store.getState().totalJobs, 1);
  assert.deepEqual(adapter.lastLoadOpts, { lines: false }, 'the lines did not move: entries only');
  loads = adapter.loadCalls;
  await env.fire();
  assert.equal(adapter.loadCalls, loads, 'and the token recorded for that read is the current one');
  adapter.data = { lines: [...L, { id: 'LX', code: 'X', sort_order: 99, is_test: false }], entries: adapter.data.entries };
  await env.fire();
  assert.deepEqual(adapter.lastLoadOpts, { lines: true }, 'a lines change reads the lines too');
  loads = adapter.loadCalls;
  adapter.data = { lines: adapter.data.lines.map((x) => (x.code === 'X' ? { ...x, id: 'LY' } : x)), entries: adapter.data.entries };
  await env.fire();
  assert.equal(adapter.loadCalls, loads + 1, 'a line re-created at the same count is still a change');
  assert.deepEqual(adapter.lastLoadOpts, { lines: true }, 'and it reads the lines');
});

test('a backend without the probe falls back to full reads, for good; a failed probe is a failed read for the connection state', async () => {
  const { env, adapter, store } = setup();
  adapter.noToken = true;
  await store.start();
  const loads = adapter.loadCalls;
  adapter.data = { lines: L, entries: [{ id: 'z', line_id: 'LA', title: 'TEST z', status: 'open' }] };
  await env.fire(); // the poll: probe says unsupported, so a full read
  assert.equal(store.getState().totalJobs, 1);
  assert.equal(adapter.loadCalls, loads + 1);
  const t = adapter.tokenCalls;
  await env.fire();
  assert.equal(adapter.tokenCalls, t, 'never asks again');
  // a probe that cannot reach the server
  const b = setup();
  await b.store.start();
  b.adapter.failToken = true;
  await b.env.fire();
  assert.equal(b.store.getState().conn, 'error');
  assert.deepEqual(b.env.pending(), [2000], 'backs off like a failed read');
  b.adapter.failToken = false;
  await b.env.fire();
  assert.equal(b.store.getState().conn, 'polling');
});

test('a hidden tab cancels the reads armed before it was hidden; becoming visible probes once and resumes', async () => {
  const { env, adapter, store } = setup();
  await store.start();
  adapter.statusCb('SUBSCRIBED');
  adapter.statusCb('CONFIRMED');
  await tick();
  assert.equal(env.pending().length, 2, 'the second catch-up and the reconcile are armed');
  env.visible = false;
  env.handlers.visible(); // the visibilitychange event
  assert.deepEqual(env.pending(), [], 'both cancelled the moment the tab is hidden: not even one more read');
  const probes = adapter.tokenCalls;
  env.visible = true;
  env.handlers.visible();
  await tick();
  assert.equal(adapter.tokenCalls, probes + 1, 'visible: one probe at once');
  assert.equal(env.pending().length, 1, 'and the reconcile read is scheduled again');
});

test('the poll timer refetches; a second device edit shows up on the next poll', async () => {
  const { env, adapter, store } = setup();
  await store.start();
  adapter.data = { lines: L, entries: [{ id: 'e1', line_id: 'LA', title: 'TEST X', status: 'open' }] };
  await env.fire();
  assert.equal(store.getState().totalJobs, 1);
  assert.equal(adapter.loadCalls, 2);
});

test('first load failure -> failedFirstLoad with backoff retries, then recovers', async () => {
  const { env, adapter, store } = setup();
  adapter.failLoad = true;
  await store.start();
  let s = store.getState();
  assert.equal(s.failedFirstLoad, true);
  assert.equal(s.conn, 'error');
  assert.deepEqual(env.pending(), [2000]);
  await env.fire();
  assert.deepEqual(env.pending(), [4000]);
  adapter.failLoad = false;
  await env.fire();
  s = store.getState();
  assert.equal(s.failedFirstLoad, false);
  assert.equal(s.loaded, true);
  assert.equal(s.conn, 'polling');
});

test('failed poll keeps the last good board visible', async () => {
  const { env, adapter, store } = setup();
  adapter.data = { lines: L, entries: [{ id: 'e1', line_id: 'LA', title: 'TEST X', status: 'open' }] };
  await store.start();
  adapter.failLoad = true;
  await env.fire();
  const s = store.getState();
  assert.equal(s.conn, 'error');
  assert.equal(s.totalJobs, 1);
  assert.equal(s.loaded, true);
  assert.equal(s.canEdit, false);
});

test('offline event: offline state, no polling, edits disabled; online event refetches and recovers', async () => {
  const { env, adapter, store } = setup();
  await store.start();
  const calls = adapter.loadCalls;
  env.goOffline();
  assert.equal(store.getState().conn, 'offline');
  assert.equal(store.getState().canEdit, false);
  assert.deepEqual(env.pending(), []);
  env.goOnline();
  await tick();
  assert.equal(adapter.loadCalls, calls + 1);
  assert.notEqual(store.getState().conn, 'offline');
  assert.equal(store.getState().canEdit, true);
});

test('generation counter: a stale slow load never overwrites newer state', async () => {
  const { adapter, store } = setup();
  await store.start();
  const slow = Promise.withResolvers();
  const orig = adapter.load.bind(adapter);
  adapter.load = () => slow.promise; // load #2 (will resolve last, with old data)
  const p2 = store.refresh();
  adapter.load = orig;
  adapter.data = { lines: L, entries: [{ id: 'new', line_id: 'LA', title: 'TEST new', status: 'open' }] };
  await store.refresh(); // load #3 resolves first with new data
  assert.equal(store.getState().totalJobs, 1);
  slow.resolve({ lines: L, entries: [] }); // stale answer arrives late
  await p2;
  assert.equal(store.getState().totalJobs, 1, 'stale load must not win');
});

test('a write invalidates loads that were already in flight', async () => {
  const { adapter, store } = setup();
  await store.start();
  const slow = Promise.withResolvers();
  adapter.load = () => slow.promise;
  const p = store.refresh();
  await store.saveEntry('good', { line_code: 'A', title: 'TEST W', details: '', initials: '', status: 'open' });
  assert.equal(store.getState().totalJobs, 1);
  slow.resolve({ lines: L, entries: [] });
  await p;
  assert.equal(store.getState().totalJobs, 1);
});

test('entry id is generated once, before the first send, and reused on retry', async () => {
  const { adapter, store } = setup();
  await store.start();
  adapter.saveResults = [{ ok: false, error: 'network' }, { ok: false, error: 'network' }];
  const draft = { line_code: 'B', title: 'TEST R', details: '', initials: 'AB', status: 'open' };
  const res = await store.saveEntry('good', draft);
  assert.equal(res.ok, true);
  assert.equal(adapter.saves.length, 3);
  const ids = new Set(adapter.saves.map((s) => s.entry.id));
  assert.equal(ids.size, 1);
  assert.match([...ids][0], /^[0-9a-f-]{36}$/);
  assert.equal(draft.id, [...ids][0]); // a manual "Save again" in the UI reuses it too
});

test('lost response against the demo backend: retry with the same id never duplicates', async () => {
  const data = {};
  const storage = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  const adapter = createDemoAdapter({ storage, channel: null, flag: 'empty', flagMemo: null });
  const store = createStore({ adapter, env: fakeEnv(), retryDelayMs: 0 });
  await store.start();
  adapter.hook.loseNextResponse = true; // server applies the write, the reply never arrives
  const res = await store.saveEntry(adapter.demoKeys.valid, { line_code: 'C', title: 'TEST Once', details: '', initials: 'AB', status: 'open' });
  assert.equal(res.ok, true);
  const { entries } = await adapter.load();
  assert.equal(entries.length, 1, 'exactly one job despite the retry');
  assert.equal(store.getState().totalJobs, 1);
});

test('optimistic concurrency against the demo backend: an edit names its revision; a changed row is a conflict, a deleted row is not_found, a create sends none', async () => {
  const data = {};
  const storage = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  const adapter = createDemoAdapter({ storage, channel: null, flag: 'empty', flagMemo: null });
  const store = createStore({ adapter, env: fakeEnv(), retryDelayMs: 0 });
  await store.start();
  const key = adapter.demoKeys.valid;
  const made = await store.saveEntry(key, { line_code: 'C', title: 'TEST One', details: '', initials: 'JA', status: 'open' });
  assert.equal(made.ok, true);
  assert.equal(made.entry.revision, 1);
  const id = made.entry.id;
  const edit = (over = {}) => ({ id, expected_revision: 1, line_code: 'C', title: 'TEST One edited', details: '', initials: 'JA', status: 'open', ...over });
  const ok = await store.saveEntry(key, edit());
  assert.equal(ok.ok, true);
  assert.equal(ok.entry.revision, 2);
  // someone else's edit moved the row on: this edit was made on revision 1
  const stale = await store.saveEntry(key, edit({ title: 'TEST stale' }));
  assert.deepEqual([stale.ok, stale.error, stale.revision], [false, 'conflict', 2]);
  assert.equal((await adapter.load()).entries[0].title, 'TEST One edited', 'nothing was saved by the conflicting edit');
  // deleted elsewhere: an edit never recreates it
  await adapter.removeEntry(key, id);
  const gone = await store.saveEntry(key, edit({ expected_revision: 2 }));
  assert.deepEqual([gone.ok, gone.error], [false, 'not_found']);
  assert.equal((await adapter.load()).entries.length, 0, 'not recreated');
  // an edit must name a row; a create sends no expected_revision and is an upsert by id, as before
  assert.equal((await adapter.saveEntry(key, { line_code: 'C', title: 'x', status: 'open', expected_revision: 1 })).error, 'invalid');
  assert.equal((await store.saveEntry(key, { line_code: 'C', title: 'TEST fresh', details: '', initials: '', status: 'open' })).ok, true);
});

test('a response lost on an edit: the retry sees a conflict against our own write and reports success, not a false conflict', async () => {
  const data = {};
  const storage = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  const adapter = createDemoAdapter({ storage, channel: null, flag: 'empty', flagMemo: null });
  const store = createStore({ adapter, env: fakeEnv(), retryDelayMs: 0 });
  await store.start();
  const key = adapter.demoKeys.valid;
  const made = await store.saveEntry(key, { line_code: 'C', title: 'TEST One', details: '', initials: '', status: 'open' });
  adapter.hook.loseNextResponse = true;
  const res = await store.saveEntry(key, { id: made.entry.id, expected_revision: 1, line_code: 'C', title: 'TEST Two', details: '', initials: '', status: 'hold' });
  assert.equal(res.ok, true);
  assert.equal((await adapter.load()).entries[0].revision, 2, 'applied exactly once');
});

test('confirming realtime refetches at once and once more shortly after, so a write made between the snapshot and the join is not lost', async () => {
  const { env, adapter, store } = setup();
  await store.start();
  const loads = adapter.loadCalls;
  const line = adapter.data.lines[0];
  // a write lands after the first snapshot but before realtime delivers anything
  adapter.data = { ...adapter.data, entries: [{ id: 'late', line_id: line.id, title: 'TEST late', status: 'open', created_at: '2026-01-01T00:00:00Z' }] };
  adapter.statusCb('SUBSCRIBED');
  adapter.statusCb('CONFIRMED');
  await tick();
  assert.equal(adapter.loadCalls, loads + 1, 'immediate catch-up fetch');
  assert.equal(store.getState().rows.flatMap((r) => r.jobs).some((j) => j.id === 'late'), true);
  await env.fire(); // the delayed second catch-up
  assert.equal(adapter.loadCalls, loads + 2);
  adapter.statusCb('CONFIRMED'); // a repeat confirmation while already live must not refetch again
  await tick();
  assert.equal(adapter.loadCalls, loads + 2);
});

test('a confirmation that arrives while the first load is still in flight does not cut the load short; the catch-up runs once the load lands', async () => {
  const { env, adapter, store } = setup();
  let release;
  const first = new Promise((r) => { release = r; });
  const real = adapter.load.bind(adapter);
  let n = 0;
  adapter.load = async () => { if (n++ === 0) await first; return real(); };
  const started = store.start();
  adapter.statusCb('SUBSCRIBED');
  adapter.statusCb('CONFIRMED');
  await tick();
  assert.equal(n, 1, 'no second fetch while the first is pending');
  assert.equal(store.getState().loading, true);
  release();
  await started;
  await tick();
  assert.equal(store.getState().loading, false);
  assert.equal(n, 2, 'one catch-up fetch right after the first load');
  await env.fire();
  assert.equal(n, 3, 'and the delayed one');
});
