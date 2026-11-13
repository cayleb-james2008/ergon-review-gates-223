import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAdapter, normalize, makeClient } from '../../src/data/supabase.js';

function mockClient({ rpcReply = { data: { ok: true }, error: null }, tables = {} } = {}) {
  const calls = { rpc: [], from: [], channel: [], removed: [] };
  const query = (table) => {
    const q = { cols: null, orders: [] };
    const chain = { select(c) { q.cols = c; return chain; }, order(c) { q.orders.push(c); return chain; },
      then(res, rej) { calls.from.push({ table, ...q }); return Promise.resolve(tables[table] ?? { data: [], error: null }).then(res, rej); } };
    return chain;
  };
  const client = {
    rpc: async (fn, args) => { calls.rpc.push({ fn, args }); return typeof rpcReply === 'function' ? rpcReply(fn) : rpcReply; },
    from: query,
    channel(name) {
      const ch = { name, ons: [], on(type, filter, cb) { ch.ons.push({ type, filter, cb }); return ch; },
        subscribe(cb) { ch.statusCb = cb; return ch; } };
      calls.channel.push(ch);
      return ch;
    },
    removeChannel(ch) { calls.removed.push(ch); },
  };
  return { client, calls };
}

test('rpc names and argument keys match the data contract', async () => {
  const { client, calls } = mockClient({ rpcReply: { data: { ok: true, entry: { id: 'x' } }, error: null } });
  const a = createSupabaseAdapter(client);
  await a.checkKey('ergk_k');
  await a.saveEntry('ergk_k', { id: 'u1', line_code: 'A', title: 'TEST c', details: '', initials: 'AB', status: 'open' });
  await a.removeEntry('ergk_k', 'u1');
  assert.deepEqual(calls.rpc, [
    { fn: 'check_key', args: { p_key: 'ergk_k' } },
    { fn: 'save_entry', args: { p_key: 'ergk_k', p_entry: { id: 'u1', line_code: 'A', title: 'TEST c', details: '', initials: 'AB', status: 'open' } } },
    { fn: 'remove_entry', args: { p_key: 'ergk_k', p_id: 'u1' } },
  ]);
});

test('save_entry ok passes the entry through', async () => {
  const { client } = mockClient({ rpcReply: { data: { ok: true, entry: { id: 'x', status: 'ready', revision: 3 } }, error: null } });
  const r = await createSupabaseAdapter(client).saveEntry('ergk_k', { id: 'x' });
  assert.deepEqual(r, { ok: true, entry: { id: 'x', status: 'ready', revision: 3 } });
});

test('key_invalid, key_expired, invalid, not_found are mapped from the jsonb reply', async () => {
  for (const err of ['key_invalid', 'key_expired', 'invalid', 'not_found']) {
    const { client } = mockClient({ rpcReply: { data: { ok: false, error: err }, error: null } });
    assert.deepEqual(await createSupabaseAdapter(client).saveEntry('ergk_k', {}), { ok: false, error: err });
  }
  assert.equal(normalize({ data: { ok: false, error: 'surprise' }, error: null }).error, 'invalid');
  assert.equal(normalize({ data: null, error: null }).error, 'invalid');
});

test('transport failures map to network and never throw, and the key is never in an error', async () => {
  const net = createSupabaseAdapter(mockClient({ rpcReply: { data: null, error: { message: 'fetch failed' } } }).client);
  assert.equal((await net.saveEntry('ergk_k', {})).error, 'network');
  const thrower = createSupabaseAdapter({ rpc: async () => { throw new TypeError('offline'); } });
  assert.equal((await thrower.checkKey('ergk_k')).error, 'network');
});

test('a conflict carries the revision that is current; not_found and key errors pass through', () => {
  assert.deepEqual(normalize({ data: { ok: false, error: 'conflict', revision: 4 }, error: null }), { ok: false, error: 'conflict', revision: 4 });
  assert.deepEqual(normalize({ data: { ok: false, error: 'not_found' }, error: null }), { ok: false, error: 'not_found' });
});

test('board_token: the cheap probe returns a token and the lines marker; a missing function is unsupported, any other failure is the network', async () => {
  const ok = createSupabaseAdapter(mockClient({ rpcReply: { data: { l: 19, f: 123456, e: 14, u: '2026-11-02T10:00:00Z', r: 20 }, error: null } }).client);
  assert.deepEqual(await ok.boardToken(), { ok: true, token: '{"l":19,"f":123456,"e":14,"u":"2026-11-02T10:00:00Z","r":20}', l: '19:123456' });
  const old = createSupabaseAdapter(mockClient({ rpcReply: { data: { l: 19, e: 14, u: '2026-11-02T10:00:00Z', r: 20 }, error: null } }).client);
  assert.equal((await old.boardToken()).l, 19, 'a token without the fingerprint still gives the count');
  const none = createSupabaseAdapter(mockClient({ rpcReply: { data: null, error: { code: 'PGRST202', message: 'Could not find the function ergon_warehouse.board_token' } } }).client);
  assert.deepEqual(await none.boardToken(), { ok: false, error: 'unsupported' });
  const down = createSupabaseAdapter(mockClient({ rpcReply: { data: null, error: { message: 'fetch failed' } } }).client);
  assert.deepEqual(await down.boardToken(), { ok: false, error: 'network' });
  const thrower = createSupabaseAdapter({ rpc: async () => { throw new TypeError('offline'); } });
  assert.deepEqual(await thrower.boardToken(), { ok: false, error: 'network' });
});

test('load({lines:false}) reads the entries only; a first read that index.html already started is used once, then never again', async () => {
  const entries = [{ id: 'e1', line_id: 'l1' }];
  const m = mockClient({ tables: { lines: { data: [{ id: 'l1', code: 'A' }], error: null }, entries: { data: entries, error: null } } });
  const a = createSupabaseAdapter(m.client);
  assert.deepEqual(await a.load({ lines: false }), { lines: null, entries });
  assert.deepEqual(m.calls.from.map((c) => c.table), ['entries'], 'one table, not two');
  globalThis.__rhlEarly = Promise.resolve([[{ id: 'early-line' }], [{ id: 'early-entry' }]]);
  assert.deepEqual(await a.load(), { lines: [{ id: 'early-line' }], entries: [{ id: 'early-entry' }] });
  assert.equal(globalThis.__rhlEarly, null, 'consumed');
  assert.equal((await a.load()).entries.length, 1, 'the next read goes to the network');
  globalThis.__rhlEarly = Promise.reject(new Error('blocked'));
  assert.equal((await a.load()).entries.length, 1, 'a failed early read falls back to the normal read');
});

test('load reads lines and entries ordered, and surfaces errors by throwing', async () => {
  const lines = [{ id: 'l1', code: 'A', sort_order: 1, is_test: true }];
  const entries = [{ id: 'e1', line_id: 'l1' }];
  const { client, calls } = mockClient({ tables: { lines: { data: lines, error: null }, entries: { data: entries, error: null } } });
  assert.deepEqual(await createSupabaseAdapter(client).load(), { lines, entries });
  assert.deepEqual(calls.from.map((c) => [c.table, c.orders]), [['lines', ['sort_order']], ['entries', ['created_at']]]);
  assert.equal(calls.from[0].cols, 'id,code,sort_order,is_test,created_at');
  assert.equal(calls.from[1].cols, 'id,line_id,title,details,initials,status,revision,is_test,created_at,updated_at,updated_by');
  const bad = mockClient({ tables: { lines: { data: null, error: { message: 'boom' } } } }).client;
  await assert.rejects(() => createSupabaseAdapter(bad).load(), /boom/);
});

test('subscribe listens to postgres_changes on ergon_warehouse lines+entries and relays status', () => {
  const { client, calls } = mockClient();
  const seen = { change: 0, status: [] };
  const off = createSupabaseAdapter(client).subscribe(() => seen.change++, (s) => seen.status.push(s));
  const ch = calls.channel[0];
  assert.deepEqual(ch.ons.map((o) => [o.type, o.filter.schema, o.filter.table, o.filter.event]),
    [['postgres_changes', 'ergon_warehouse', 'lines', '*'], ['postgres_changes', 'ergon_warehouse', 'entries', '*'], ['system', undefined, undefined, undefined]]);
  ch.ons[1].cb({});
  ch.statusCb('SUBSCRIBED');
  // the server's system message for the postgres_changes bindings is what makes the feed CONFIRMED (a join alone is not enough)
  ch.ons[2].cb({ extension: 'postgres_changes', status: 'ok', message: 'Subscribed to PostgreSQL' });
  ch.ons[2].cb({ extension: 'system', status: 'ok', message: 'something else' }); // other extensions are ignored
  ch.ons[2].cb({ extension: 'postgres_changes', status: 'error', message: 'failed' });
  ch.statusCb('CHANNEL_ERROR');
  assert.deepEqual(seen, { change: 1, status: ['SUBSCRIBED', 'CONFIRMED', 'CHANNEL_ERROR', 'CHANNEL_ERROR'] });
  off();
  assert.equal(calls.removed[0], ch);
});

test('client creation needs the two public env values and never embeds a key', () => {
  assert.throws(() => makeClient({}), /not configured/);
  const c = makeClient({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'x'.repeat(20) });
  assert.equal(typeof c.rpc, 'function');
});

// A hung data read used to be indistinguishable from a healthy one: the token probe kept answering, so the label stayed Live over a frozen
// board (the independent check measured 26 s). The read now has a deadline, and a second caller joins the outstanding read instead of
// starting another, so a dead data path cannot pile requests up while the deadline expires.
test('a data read that never answers is a failure after the deadline, and does not start a second request', async () => {
  let fromCalls = 0;
  const hungChain = { select: () => hungChain, order: () => hungChain, then: () => { fromCalls += 1; return new Promise(() => {}); } };
  const a = createSupabaseAdapter({ from: () => hungChain, rpc: async () => ({ data: null, error: null }) }, { readTimeoutMs: 60 });
  const first = a.load();
  const second = a.load(); // a second caller while the first read is outstanding
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, 'rejected');
  assert.match(String(results[0].reason?.message ?? results[0].reason), /timed out/);
  assert.equal(results[1].status, 'rejected', 'the joined caller sees the same failure');
  assert.equal(fromCalls, 2, 'one read starts two table queries (lines and entries); a second read must not add any');
});

test('a read that answers inside the deadline is untouched by it', async () => {
  const a = createSupabaseAdapter(mockClient({ tables: { lines: { data: [{ id: 'l1' }], error: null }, entries: { data: [{ id: 'e1' }], error: null } } }).client, { readTimeoutMs: 500 });
  const r = await a.load();
  assert.deepEqual(r.lines, [{ id: 'l1' }]);
  assert.deepEqual(r.entries, [{ id: 'e1' }]);
});
