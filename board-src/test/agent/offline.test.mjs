// OFFLINE tests for the agent interface: no network, an injected fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoardClient, validate } from '../../agent/client.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const TOOLS = readJson('public/agent-tools.json');
const MANIFEST = readJson('public/agent.json');

const PASS = 'ergk_fakeKeyForTests0123456789abcdefghijklmnop';
const KEY = 'fake-anon-key-abcdefghijklmnop1234567890';
const URL_ = 'http://127.0.0.1:54321';
const UUID = '11111111-2222-4333-8444-555555555555';

const json = (status, body) => ({ status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });

// fake fetch: records calls, answers via `handler(call)`.
function fake(handler) {
  const calls = [];
  const f = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return handler(call, calls.length);
  };
  f.calls = calls;
  return f;
}
const client = (f, extra = {}) => createBoardClient({ url: URL_, anonKey: KEY, key: PASS, fetch: f, retryDelayMs: 0, ...extra });
const entry = (over = {}) => ({ id: UUID, line_id: 'l1', line_code: 'A', title: 'TEST x', details: '', initials: 'AGT', status: 'open', revision: 1, is_test: true, created_at: 'now', updated_at: 'now', ...over });

test('tools file: every tool is well formed, and tools and implementations match 1:1', () => {
  assert.ok(TOOLS.tools.length >= 6);
  const names = TOOLS.tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'duplicate tool name');
  for (const t of TOOLS.tools) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, `${t.name}: snake_case`);
    assert.ok(t.description.length > 60, `${t.name}: description should say when to use it`);
    assert.match(t.description, /[Dd]o not|[Nn]ot /, `${t.name}: description should say when not to use it`);
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.equal(t.outputSchema.type, 'object');
    assert.ok(Array.isArray(t.errors) && t.errors.every((e) => e in TOOLS.errorCodes), `${t.name}: errors must be declared in errorCodes`);
    assert.equal(typeof t.annotations.requiresKey, 'boolean');
    for (const r of t.inputSchema.required ?? []) assert.ok(r in t.inputSchema.properties, `${t.name}: required ${r} undefined`);
  }
  const c = createBoardClient({ url: URL_, anonKey: KEY, fetch: fake(() => json(200, [])) });
  assert.deepEqual([...c.implementedTools()].sort(), [...names].sort(), 'orphan or missing tool implementation');
  assert.deepEqual(c.tools.map((t) => t.name), names);
  assert.ok(/ergk_/.test(TOOLS.keys.rule) && /Never retry on key_invalid or key_expired/.test(TOOLS.keys.agentRule));
  assert.ok(TOOLS.tools.some((t) => t.name === 'key_check'));
  assert.equal(TOOLS.limits.title, 120);
  assert.equal(TOOLS.limits.details, 240);
  assert.equal(TOOLS.limits.initials, 6);
});

test('manifest points at real files and names the env vars', () => {
  assert.equal(MANIFEST.tools.file, '/agent-tools.json');
  assert.ok(existsSync(join(ROOT, 'public', 'agent-tools.json')));
  assert.ok(existsSync(join(ROOT, MANIFEST.client.file)));
  assert.deepEqual(Object.keys(MANIFEST.connection.env).sort(), ['BOARD_ACTOR', 'BOARD_ANON_KEY', 'BOARD_KEY', 'BOARD_URL']);
});

test('manifest and tools files contain no URL, key or secret-looking values', () => {
  for (const [name, doc] of [['agent.json', MANIFEST], ['agent-tools.json', TOOLS]]) {
    const text = readFileSync(join(ROOT, 'public', name), 'utf8');
    assert.doesNotMatch(text, /https?:\/\//i, `${name}: contains a URL`);
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}/, `${name}: contains a JWT-looking value`);
    assert.doesNotMatch(text, /sb_(publishable|secret)_/i, `${name}: contains a Supabase key`);
    assert.doesNotMatch(text, /\b[A-Za-z0-9_-]{40,}\b/, `${name}: contains a long key-looking token`);
    assert.doesNotMatch(text, /"(key|passcode|password|apikey|api_key|anon_key|secret)"\s*:\s*"[^"]+"/i, `${name}: contains a credential field`);
    JSON.stringify(doc);
  }
  assert.equal(MANIFEST.connection.secretsInThisFile, false);
});

test('component.json interface paths exist; client imports nothing outside agent/, the tools file and node: built-ins', () => {
  const comp = readJson('component.json');
  for (const k of ['tools', 'manifest', 'client']) {
    assert.ok(comp.interface?.agent?.[k], `component.json interface.agent.${k} missing`);
    assert.ok(existsSync(join(ROOT, comp.interface.agent[k])), `component.json interface.agent.${k} -> ${comp.interface.agent[k]} does not exist`);
  }
  const src = readFileSync(join(ROOT, 'agent', 'client.mjs'), 'utf8');
  const specs = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  assert.ok(specs.length > 0);
  for (const s of specs) assert.match(s, /^node:/, `non built-in import: ${s}`);
  // the only file path it reaches for is the tools file (and relative URLs must stay inside the repo's agent/ or public/)
  const rels = [...src.matchAll(/new URL\(\s*'([^']+)'/g)].map((m) => m[1]);
  for (const r of rels) assert.ok(r === '.' || r === '../public/agent-tools.json' || r === './' , `unexpected file reference ${r}`);
  assert.doesNotMatch(src, /\.\.\/src\b|\bsrc\/(data|core|ui)/, 'must not reference board internals');
});

test('validator rejects bad arguments with no network call', async () => {
  const f = fake(() => json(200, []));
  const c = client(f);
  const bad = [
    ['job_save', { title: 'x'.repeat(121), line_code: 'A' }],
    ['job_save', { title: 'ok', line_code: 'T' }],
    ['job_save', { title: 'ok', line_code: 'A', details: 'd'.repeat(241) }],
    ['job_save', { title: 'ok', line_code: 'A', initials: 'TOOLONG1' }],
    ['job_save', { title: 'ok', line_code: 'A', status: 'finished' }],
    ['job_save', { title: 'tab\there', line_code: 'A' }],
    ['job_save', { title: 'ok', line_code: 'A', id: 'not-a-uuid' }],
    ['job_save', { title: 'ok', line_code: 'A', surprise: 1 }],
    ['job_save', { line_code: 'A' }],
    ['job_save', { title: 'no line' }],
    ['job_set_status', { id: UUID }],
    ['job_set_status', { id: UUID, status: 'nope' }],
    ['job_remove', {}],
    ['board_find', { line: 'Z' }],
    ['board_find', { limit: 0 }],
    ['board_get', { extra: true }],
  ];
  for (const [name, args] of bad) {
    const r = await c.callTool(name, args);
    assert.equal(r.ok, false, name + JSON.stringify(args));
    assert.equal(r.error, 'invalid', name + JSON.stringify(args));
  }
  assert.equal((await c.callTool('nope', {})).error, 'unknown_tool');
  assert.equal(f.calls.length, 0, 'validation must happen before any network call');
});

test('validate(): code points count like the database, errors never echo the value', () => {
  const schema = TOOLS.tools.find((t) => t.name === 'job_save').inputSchema;
  assert.deepEqual(validate(schema, { title: '😀'.repeat(120), line_code: 'A' }), []);
  const p = validate(schema, { title: 'secret-value\u0007', line_code: 'A' });
  assert.equal(p.length, 1);
  assert.ok(!p[0].includes('secret-value'));
});

test('missing settings give a clear config error, not a throw; plain http is refused off localhost', async () => {
  const f = fake(() => json(200, []));
  assert.match((await createBoardClient({ fetch: f, url: '', anonKey: '', key: '' }).callTool('board_get', {})).message, /BOARD_URL.*BOARD_ANON_KEY/);
  const noPass = createBoardClient({ url: URL_, anonKey: KEY, key: '', fetch: f });
  assert.equal((await noPass.callTool('job_remove', { id: UUID })).error, 'config');
  assert.match((await noPass.callTool('job_remove', { id: UUID })).message, /BOARD_KEY/);
  const badKey = createBoardClient({ url: URL_, anonKey: KEY, key: 'not-a-board-key', fetch: f });
  assert.match((await badKey.callTool('key_check', {})).message, /ergk_/);
  const http = createBoardClient({ url: 'http://example.org', anonKey: KEY, key: PASS, fetch: f });
  assert.match((await http.callTool('board_get', {})).message, /https/);
  assert.equal(f.calls.length, 0);
});

test('board key and anon key never appear in any result or error text, even if the server echoes them', async () => {
  const outs = [];
  const echo = fake((call) => {
    if (call.method === 'GET') return json(200, [{ id: 'l1', code: 'A', sort_order: 1, is_test: false, title: `${KEY}` }]);
    return json(200, { ok: true, entry: entry({ title: `leaked ${PASS} and ${KEY}` }) });
  });
  const c = client(echo);
  outs.push(await c.callTool('board_get', {}));
  outs.push(await c.callTool('job_save', { title: 'x', line_code: 'A' }));
  const boom = client(async () => { throw new Error(`connect failed to ${URL_} with ${KEY} ${PASS}`); });
  outs.push(await boom.callTool('board_get', {}));
  outs.push(await boom.callTool('job_remove', { id: UUID }));
  const bad = client(fake(() => json(200, { ok: false, error: 'key_invalid', detail: PASS })));
  outs.push(await bad.callTool('key_check', {}));
  const invalid = await client(echo).callTool('job_save', { title: PASS + '\u0001', line_code: 'A' });
  outs.push(invalid);
  const text = JSON.stringify(outs);
  assert.ok(!text.includes(PASS), 'board key leaked');
  assert.ok(!text.includes(KEY), 'key leaked');
  // headers/body carry them to the server only
  assert.ok(echo.calls.some((x) => x.body?.p_key === PASS));
});

test('network errors retry up to 3 times with the SAME generated id, then report network', async () => {
  const f = fake(() => { throw new Error('ECONNRESET'); });
  const r = await client(f).callTool('job_save', { title: 'TEST retry', line_code: 'B' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'network');
  assert.equal(f.calls.length, 4, '1 try + 3 retries');
  const ids = f.calls.map((c) => c.body.p_entry.id);
  assert.match(ids[0], /^[0-9a-f-]{36}$/);
  assert.equal(new Set(ids).size, 1, 'retries must reuse the id');
});

test('a retry that succeeds after a network error returns the job (same id throughout)', async () => {
  let n = 0;
  const f = fake((call) => { if (++n < 3) throw new Error('boom'); return json(200, { ok: true, entry: entry({ id: call.body.p_entry.id }) }); });
  const r = await client(f).callTool('job_save', { title: 'TEST', line_code: 'A' });
  assert.equal(r.ok, true);
  assert.equal(new Set(f.calls.map((c) => c.body.p_entry.id)).size, 1);
  assert.equal(r.job.id, f.calls[0].body.p_entry.id);
});

test('key_invalid and key_expired are never retried and are returned as-is', async () => {
  for (const code of ['key_invalid', 'key_expired']) {
    const f = fake(() => json(200, { ok: false, error: code }));
    const c = client(f);
    for (const [name, args] of [['job_remove', { id: UUID }], ['job_save', { title: 'x', line_code: 'A' }], ['key_check', {}]]) {
      const before = f.calls.length;
      const r = await c.callTool(name, args);
      assert.equal(r.ok, false);
      assert.equal(r.error, code, name);
      assert.match(r.message, /ask your own agent/i);
      assert.equal(f.calls.length, before + 1, `${name}: exactly one request, no retry`);
    }
  }
});

test('there is no passcode, throttle or rate_limited logic left in the client or the tool files', () => {
  const all = ['agent/client.mjs', 'public/agent-tools.json', 'public/agent.json'].map((p) => readFileSync(join(ROOT, p), 'utf8')).join('\n');
  assert.doesNotMatch(all.replace(/There is no passcode[^"]*/g, '').replace(/No app has a passcode[^"]*/g, ''), /passcode|rate_limited|bad_passcode|access_check/i);
  assert.ok(!('rate_limited' in TOOLS.errorCodes) && !('bad_passcode' in TOOLS.errorCodes));
  assert.ok('key_invalid' in TOOLS.errorCodes && 'key_expired' in TOOLS.errorCodes);
});

test('an HTTP 429 from the gateway is a plain network error (retry later), not an access error', async () => {
  const g = fake(() => json(429, { message: 'slow down' }));
  const r = await client(g).callTool('board_get', {});
  assert.equal(r.error, 'network');
});

test('key_check returns subject and expiry', async () => {
  const f = fake(() => json(200, { ok: true, subject: 'TEST Alex', expires_at: '2099-01-01T00:00:00Z' }));
  const r = await client(f).callTool('key_check', {});
  assert.deepEqual(r, { ok: true, subject: 'TEST Alex', expires_at: '2099-01-01T00:00:00Z' });
  assert.ok(f.calls[0].url.endsWith('/rest/v1/rpc/check_key'));
  assert.deepEqual(Object.keys(f.calls[0].body), ['p_key']);
});

test('RPC and read requests are shaped per the contract', async () => {
  const f = fake((call) => (call.method === 'GET' ? json(200, []) : json(200, { ok: true, entry: entry() })));
  const c = client(f);
  await c.callTool('board_get', {});
  const get = f.calls.find((x) => x.url.includes('/rest/v1/lines'));
  assert.equal(get.headers['Accept-Profile'], 'ergon_warehouse');
  assert.equal(get.headers.apikey, KEY);
  await c.callTool('job_save', { title: ' TEST pad ', line_code: 'C', initials: 'ZZ' });
  const post = f.calls.at(-1);
  assert.ok(post.url.endsWith('/rest/v1/rpc/save_entry'));
  assert.equal(post.headers['Content-Profile'], 'ergon_warehouse');
  assert.equal(post.body.p_key, PASS);
  assert.equal(post.body.p_entry.title, 'TEST pad', 'trimmed like the database does');
  assert.equal(post.body.p_entry.initials, 'ZZ');
  await c.callTool('job_save', { title: 'TEST', line_code: 'C' });
  assert.equal(f.calls.at(-1).body.p_entry.initials, 'AGT', 'default actor tag');
  await createBoardClient({ url: URL_, anonKey: KEY, key: PASS, actor: 'BOB', fetch: f, retryDelayMs: 0 }).callTool('job_save', { title: 'TEST', line_code: 'C' });
  assert.equal(f.calls.at(-1).body.p_entry.initials, 'BOB');
});

test('job_set_status maps a missing job to not_found, and board_find filters', async () => {
  const f = fake((call) => {
    if (call.method === 'POST') return json(200, { ok: false, error: 'invalid' });
    if (call.url.includes('/entries?') && call.url.includes('id=eq.')) return json(200, []);
    if (call.url.includes('/lines?')) return json(200, [{ id: 'l1', code: 'A', sort_order: 1, is_test: true }, { id: 'l2', code: 'B', sort_order: 2, is_test: true }]);
    return json(200, [
      entry({ id: 'e1', line_id: 'l1', title: 'TEST Acme', status: 'open' }),
      entry({ id: 'e2', line_id: 'l2', title: 'TEST Bluebird', details: 'Acme-ish', status: 'hold' }),
    ]);
  });
  const c = client(f);
  assert.equal((await c.callTool('job_set_status', { id: UUID, status: 'done' })).error, 'not_found');
  const all = await c.callTool('board_find', { text: 'acme' });
  assert.equal(all.count, 2);
  assert.equal(all.test_data, true);
  assert.equal((await c.callTool('board_find', { text: 'acme', status: 'hold' })).matches[0].line_code, 'B');
  assert.equal((await c.callTool('board_find', { line: 'A' })).count, 1);
});

test('CLI: lists tools, prints JSON, exits non-zero with a config error when settings are missing', async () => {
  const { spawnSync } = await import('node:child_process');
  const run = (args) => spawnSync(process.execPath, [join(ROOT, 'agent', 'client.mjs'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  const list = run(['--list']);
  assert.equal(list.status, 0);
  assert.deepEqual(JSON.parse(list.stdout).map((t) => t.name), TOOLS.tools.map((t) => t.name));
  const noEnv = run(['board_get', '{}']);
  assert.equal(noEnv.status, 1);
  assert.equal(JSON.parse(noEnv.stdout).error, 'config');
  const badJson = run(['board_get', '{nope']);
  assert.equal(JSON.parse(badJson.stdout).error, 'invalid');
  assert.equal(run([]).status, 2);
});

test('updated_by is read-only: no tool accepts it, and passing it is invalid with no network call', async () => {
  for (const t of TOOLS.tools) {
    assert.ok(!('updated_by' in t.inputSchema.properties), `${t.name}: inputSchema must not accept updated_by`);
    assert.equal(t.inputSchema.additionalProperties, false);
  }
  const f = fake(() => json(200, []));
  const c = client(f);
  for (const [name, args] of [['job_save', { title: 'x', line_code: 'A', updated_by: 'employee-b' }], ['job_set_status', { id: UUID, status: 'done', updated_by: 'x' }], ['board_find', { updated_by: 'x' }]]) {
    const r = await c.callTool(name, args);
    assert.deepEqual([r.ok, r.error], [false, 'invalid'], name);
  }
  assert.equal(f.calls.length, 0);
  // it is requested on reads and returned on results
  const g = fake((call) => (call.method === 'GET' ? json(200, []) : json(200, { ok: true, entry: entry({ updated_by: 'employee-a' }) })));
  const cc = client(g);
  await cc.callTool('board_get', {});
  assert.ok(g.calls.some((x) => x.url.includes('/entries?') && x.url.includes('updated_by')));
  const r = await cc.callTool('job_save', { title: 'x', line_code: 'A' });
  assert.equal(r.job.updated_by, 'employee-a');
  const sent = g.calls.find((x) => x.method === 'POST').body.p_entry;
  assert.ok(!('updated_by' in sent), 'the client never sends updated_by');
  // documented in the output shapes and the attribution convention
  const bg = TOOLS.tools.find((t) => t.name === 'board_get').outputSchema.properties.lines.items.properties.jobs.items.properties;
  assert.ok(bg.updated_by);
  assert.match(TOOLS.attribution, /updated_by/);
  assert.match(MANIFEST.attribution.convention, /updated_by/);
});

test('expected_revision: schema accepts positive integers only; creates cannot carry it', async () => {
  for (const name of ['job_save', 'job_set_status']) {
    const props = TOOLS.tools.find((t) => t.name === name).inputSchema.properties;
    assert.equal(props.expected_revision.type, 'integer');
    assert.equal(props.expected_revision.minimum, 1);
  }
  assert.ok('conflict' in TOOLS.errorCodes);
  assert.ok(TOOLS.tools.filter((t) => ['job_save', 'job_set_status'].includes(t.name)).every((t) => t.errors.includes('conflict') && t.errors.includes('not_found')));
  assert.match(MANIFEST.concurrency, /expected_revision/);
  const f = fake(() => json(200, {}));
  const c = client(f);
  for (const bad of [0, -2, 1.5, '3', null]) {
    assert.equal((await c.callTool('job_save', { id: UUID, status: 'done', expected_revision: bad })).error, 'invalid', String(bad));
    assert.equal((await c.callTool('job_set_status', { id: UUID, status: 'done', expected_revision: bad })).error, 'invalid', String(bad));
  }
  assert.equal((await c.callTool('job_save', { title: 'x', line_code: 'A', expected_revision: 2 })).error, 'invalid', 'a create has no revision to expect');
  assert.equal(f.calls.length, 0, 'all rejected before any request');
});

test('conflict and not_found are never retried; conflict carries current_revision and writes nothing', async () => {
  const f = fake(() => json(200, { ok: false, error: 'conflict', current_revision: 7 }));
  const c = client(f);
  const r = await c.callTool('job_save', { id: UUID, status: 'done', expected_revision: 3 });
  assert.deepEqual([r.ok, r.error, r.current_revision], [false, 'conflict', 7]);
  assert.match(r.message, /revision 7/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.p_entry.expected_revision, 3);
  const g = fake(() => json(200, { ok: false, error: 'not_found' }));
  const n = await client(g).callTool('job_save', { id: UUID, status: 'done', expected_revision: 3 });
  assert.deepEqual([n.ok, n.error], [false, 'not_found']);
  assert.equal(g.calls.length, 1, 'no retry, and no pre-read when expected_revision is given');
});

test('job_set_status reads the revision first and writes with it; a caller-supplied revision skips the read', async () => {
  const f = fake((call) => (call.method === 'GET' ? json(200, [{ revision: 4 }]) : json(200, { ok: true, entry: entry({ revision: 5, status: 'done' }) })));
  const c = client(f);
  const r = await c.callTool('job_set_status', { id: UUID, status: 'done' });
  assert.equal(r.ok, true);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].url.includes('select=revision'));
  assert.equal(f.calls[1].body.p_entry.expected_revision, 4);
  const g = fake(() => json(200, { ok: true, entry: entry() }));
  await client(g).callTool('job_set_status', { id: UUID, status: 'done', expected_revision: 9 });
  assert.equal(g.calls.length, 1);
  assert.equal(g.calls[0].body.p_entry.expected_revision, 9);
  // a change between the read and the write surfaces as conflict
  const h = fake((call) => (call.method === 'GET' ? json(200, [{ revision: 4 }]) : json(200, { ok: false, error: 'conflict', current_revision: 5 })));
  const x = await client(h).callTool('job_set_status', { id: UUID, status: 'done' });
  assert.deepEqual([x.error, x.current_revision], ['conflict', 5]);
  assert.equal(h.calls.length, 2);
});

test('network retry of an edit reuses the same payload (id and expected_revision); a conflict after such a retry is flagged', async () => {
  let n = 0;
  const f = fake(() => { if (++n < 3) throw new Error('boom'); return json(200, { ok: false, error: 'conflict', current_revision: 4 }); });
  const r = await client(f).callTool('job_save', { id: UUID, status: 'hold', expected_revision: 3 });
  assert.equal(f.calls.length, 3);
  assert.equal(new Set(f.calls.map((c) => JSON.stringify(c.body))).size, 1, 'identical payload on every attempt');
  assert.equal(r.error, 'conflict');
  assert.equal(r.retried_after_network_error, true);
  assert.match(r.message, /may have succeeded/);
  // creates stay idempotent: no expected_revision is ever added to a create
  const g = fake(() => json(200, { ok: true, entry: entry() }));
  await client(g).callTool('job_save', { id: UUID, title: 'TEST', line_code: 'A' });
  assert.ok(!('expected_revision' in g.calls[0].body.p_entry));
});
