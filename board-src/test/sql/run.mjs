#!/usr/bin/env node
// Data-layer tests against the LOCAL Supabase stack only. Usage: node test/sql/run.mjs
// Reads the DB url and anon key at run time from `supabase status -o env` (nothing secret is
// stored in the repo). Override with BOARD_TEST_DB_URL / BOARD_TEST_ANON_KEY / BOARD_TEST_API_URL.
// Test keys are minted fresh (through ops/keys.mjs) and held in memory only; the DB stores only their sha256.
// Test keys use the subject prefix 'TEST ' (or issuer l1-test / sql-test) and are deleted at the end.
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION = path.join(root, 'supabase/migrations', readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('_ergon_warehouse.sql')).sort().at(-1));
const INSPECT = path.join(root, 'supabase/inspect.sql');
const OPS = path.join(root, 'ops/keys.mjs');
let KEY = null; // plaintext test key from ops/keys.mjs: in memory only, never printed or stored

// ---------------------------------------------------------------- environment
function localEnv() {
  const env = { ...process.env };
  if (!env.DOCKER_HOST) {
    for (const s of ['board-podman-fix.sock', 'board-podman.sock']) {
      const p = `/run/user/${process.getuid()}/${s}`;
      if (existsSync(p)) { env.DOCKER_HOST = `unix://${p}`; break; }
    }
  }
  const out = {};
  if (!process.env.BOARD_TEST_DB_URL || !process.env.BOARD_TEST_ANON_KEY) {
    const r = spawnSync('supabase', ['status', '-o', 'env'], { cwd: root, env, encoding: 'utf8', timeout: 60000 });
    for (const m of (r.stdout || '').matchAll(/^([A-Z_]+)="(.*)"$/gm)) out[m[1]] = m[2];
  }
  return {
    DB: process.env.BOARD_TEST_DB_URL || out.DB_URL,
    ANON: process.env.BOARD_TEST_ANON_KEY || out.ANON_KEY,
    API: process.env.BOARD_TEST_API_URL || out.API_URL || 'http://127.0.0.1:54321',
  };
}
const { DB, ANON, API } = localEnv();
if (!DB) { console.error('BLOCKED: could not read the local DB url from `supabase status -o env`'); process.exit(2); }
// The anon key is only printed by `supabase status` when the auth service runs. Without it the REST and
// realtime tests are reported as SKIP (and the run exits 3 unless BOARD_TEST_ALLOW_SKIP=1), never as PASS.
const host = new URL(DB).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) { console.error(`REFUSING: ${host} is not a local database`); process.exit(2); }

function psql(url, sql, { single = false, vars = [] } = {}) {
  const args = [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...vars];
  if (single) args.push('-1');
  args.push('-f', '-');
  return spawnSync('psql', args, { input: sql, encoding: 'utf8', timeout: 120000 });
}
function sql(url, q, opts) {
  const r = psql(url, q, opts);
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'psql failed').trim());
  return r.stdout.trim();
}
const dbWith = (name) => { const u = new URL(DB); u.pathname = '/' + name; return u.toString(); };
const migrationSql = readFileSync(MIGRATION, 'utf8');
const applyMigration = (url) => { const r = psql(url, migrationSql, { single: true }); if (r.status !== 0) throw new Error(r.stderr.trim()); return r.stderr; };
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const truthy = (c, msg) => { if (!c) throw new Error(msg); };

let passed = 0, failed = 0, skipped = 0;
async function t(name, fn, { needsKey = false } = {}) {
  if (needsKey && !ANON) { skipped++; console.log(`SKIP  ${name}\n        no anon key (set BOARD_TEST_ANON_KEY or run the stack with auth so \`supabase status -o env\` prints ANON_KEY)`); return; }
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n        ${String(e.message).split('\n').slice(0, 6).join('\n        ')}`); }
}

const clearAll = () => sql(DB, `delete from ergon_warehouse.entries where is_test;
  delete from ergon_warehouse.lines where is_test;`);   // entries first: the FK is ON DELETE RESTRICT
const clearKeys = () => sql(DB, `delete from ergon_warehouse.access_keys where subject like 'TEST %' or issued_by in ('l1-test', 'sql-test')`);
const ops = (args) => spawnSync('node', [OPS, ...args], { encoding: 'utf8', timeout: 60000 });
const lineCount = () => Number(sql(DB, 'select count(*) from ergon_warehouse.lines'));
const seed = () => { const g = spawnSync('node', [path.join(root, 'scripts/seed-test.mjs')], { encoding: 'utf8' }); if (g.status !== 0) throw new Error(g.stderr); return psql(DB, g.stdout); };
const scratch = [];

// ---------------------------------------------------------------- safety guard + setup
try {
  const has = sql(DB, `select to_regclass('ergon_warehouse.lines') is not null and to_regclass('ergon_warehouse.entries') is not null`);
  if (has === 't') {
    const real = sql(DB, `select (select count(*) from ergon_warehouse.lines where is_test is distinct from true) + (select count(*) from ergon_warehouse.entries where is_test is distinct from true)`);
    if (real !== '0') { console.error('REFUSING: the local database holds non-test rows; tests would delete data'); process.exit(2); }
  }
} catch (e) { console.error('BLOCKED: cannot query local database: ' + e.message); process.exit(2); }

// Serialise runs: the local DB is shared (other builders run this suite too, and a run deletes TEST rows and keys).
// A second run waits here until the first has finished; the lock is released when this process exits.
const lockSession = spawn('psql', [DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'inherit'] });
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('timed out waiting for another test run to finish')), 15 * 60 * 1000);
  lockSession.stdout.on('data', (d) => { if (String(d).includes('locked')) { clearTimeout(to); res(); } });
  lockSession.on('error', rej);
  lockSession.stdin.write("select pg_advisory_lock(727003);\nselect 'locked';\n");
});

let exitCode = 1;
try {
  // ---- (h) migration applies, twice, and re-applying is non-destructive
  await t('(h) migration applies to the local DB', () => applyMigration(DB));
  await t('(h) migration applies a second time (idempotent)', () => applyMigration(DB));
  sql(DB, `notify pgrst, 'reload schema'`);
  clearAll(); clearKeys();

  // ---- ops/keys.mjs (stand-in issuer) end to end against the local DB
  await t('(ops) mint via ops/keys.mjs: format, hash-only storage, 9-char prefix, expiry, plaintext printed once', () => {
    const r = ops(['mint', '--subject', 'L1 runner', '--ttl', '2h', '--issuer', 'l1-test', '--db', DB, '--json']);
    eq(r.status, 0, 'mint exit: ' + r.stderr);
    const m = JSON.parse(r.stdout);
    truthy(/^ergk_[A-Za-z0-9_-]{43}$/.test(m.key), 'key format ergk_ + 43 base64url chars (48 total)');
    truthy(/^[0-9a-f-]{36}$/.test(m.id), 'id returned'); KEY = m.key;
    const hash = createHash('sha256').update(m.key).digest('hex');
    eq(sql(DB, `select key_hash || '|' || key_prefix || '|' || subject || '|' || issued_by || '|' || app from ergon_warehouse.access_keys where id = '${m.id}'`), `${hash}|${m.key.slice(0, 9)}|L1 runner|l1-test|rhl-warehouse-board`, 'stored row');
    eq(sql(DB, `select count(*) from ergon_warehouse.access_keys k where to_jsonb(k)::text like '%${m.key}%' or to_jsonb(k)::text like '%${m.key.slice(5)}%'`), '0', 'plaintext key is nowhere in the table');
    eq(sql(DB, `select (expires_at > now() + interval '119 minutes' and expires_at < now() + interval '121 minutes') from ergon_warehouse.access_keys where id = '${m.id}'`), 't', 'expiry = ttl');
    eq(r.stderr, '', 'no stderr output'); eq(r.stdout.split(m.key).length - 1, 1, 'plaintext key appears exactly once in the output');
  });
  await t('(ops) list / revoke via ops/keys.mjs; a revoked key is key_invalid; refusals', () => {
    const m = JSON.parse(ops(['mint', '--subject', 'TEST revoke-me', '--ttl', '1d', '--db', DB, '--json']).stdout);
    const ls = JSON.parse(ops(['list', '--db', DB, '--json']).stdout);
    truthy(ls.some((k) => k.id === m.id && k.subject === 'TEST revoke-me' && k.revoked_at === null), 'list shows the key');
    truthy(!JSON.stringify(ls).includes(m.key) && !JSON.stringify(ls).includes('key_hash'), 'list never shows the key or hash');
    eq(sql(DB, `select ergon_warehouse.check_key('${m.key}')::jsonb ->> 'ok'`), 'true', 'key works before revoke');
    const rv = ops(['revoke', m.id, '--db', DB]); eq(rv.status, 0, 'revoke exit: ' + rv.stderr);
    eq(sql(DB, `select ergon_warehouse.check_key('${m.key}')::jsonb ->> 'error'`), 'key_invalid', 'revoked key');
    eq(ops(['revoke', randomUUID(), '--db', DB]).status, 3, 'revoking an unknown id exits 3');
    truthy(ops(['mint', '--subject', 'TEST x', '--ttl', '31d', '--db', DB]).status !== 0, 'ttl over 30d refused');
    truthy(ops(['mint', '--subject', '', '--ttl', '1h', '--db', DB]).status !== 0, 'empty subject refused');
    truthy(ops(['mint', '--subject', 'TEST x', '--ttl', 'soon', '--db', DB]).status !== 0, 'bad ttl refused');
    const remote = ops(['list', '--db', 'postgresql://u@db.example.com:5432/postgres']); eq(remote.status, 2, 'non-local host refused'); truthy(/non-local/.test(remote.stderr), 'message');
  });
  await t('(ops) without --db the exact SQL is printed; running it mints a hash-only key', () => {
    const r = ops(['mint', '--subject', 'TEST sql-route', '--ttl', '3h']); eq(r.status, 0, r.stderr);
    const key = /ergk_[A-Za-z0-9_-]{43}/.exec(r.stdout)[0];
    const stmt = /^select ergon_warehouse\.mint_access_key\(.*\);$/m.exec(r.stdout)[0];
    truthy(!stmt.includes(key), 'printed SQL does not contain the plaintext key');
    sql(DB, stmt);
    eq(sql(DB, `select key_hash from ergon_warehouse.access_keys where subject = 'TEST sql-route'`), createHash('sha256').update(key).digest('hex'), 'hash of the printed key');
    truthy(/^select ergon_warehouse\.revoke_access_key\('/.test(ops(['revoke', randomUUID()]).stdout), 'revoke prints SQL');
    truthy(/list_access_keys/.test(ops(['list']).stdout), 'list prints SQL');
  });

  // ---- (i) seed script
  await t('(i) seed: exactly 19 lines A..S, all is_test, jobs are TEST rows with all four statuses', () => {
    const r = seed(); eq(r.status, 0, 'seed exit status: ' + r.stderr);
    eq(sql(DB, `select count(*) filter (where is_test), count(*) from ergon_warehouse.lines`), '19|19', 'line counts');
    eq(sql(DB, `select string_agg(code, '' order by sort_order) from ergon_warehouse.lines`), 'ABCDEFGHIJKLMNOPQRS', 'codes/sort_order');
    eq(sql(DB, `select count(*) from ergon_warehouse.entries where revision = 1 and photo_metadata = '[]' and cardinality(tags) = 0 and created_at is not null and updated_at is not null`), '14', 'NOT NULL columns set explicitly');
    eq(sql(DB, `select count(*) filter (where is_test and title like 'TEST %'), count(*), count(distinct status), count(distinct line_id) from ergon_warehouse.entries`), '14|14|4|11', 'entries');
    const empty = Number(sql(DB, `select count(*) from ergon_warehouse.lines l where not exists (select 1 from ergon_warehouse.entries e where e.line_id = l.id)`));
    truthy(empty >= 3, 'some lines stay empty');
  });
  await t('(i) seed: running twice changes nothing (idempotent, deterministic ids)', () => {
    const sig = () => sql(DB, `select md5(coalesce((select string_agg(l::text, '|' order by l.code) from ergon_warehouse.lines l), '') || coalesce((select string_agg(e::text, '|' order by e.id) from ergon_warehouse.entries e), ''))`);
    const a = sig(); const r = seed(); eq(r.status, 0, 'second seed: ' + r.stderr);
    eq(sig(), a, 'rows changed by the second seed');
    eq(sql(DB, 'select count(*) from ergon_warehouse.lines'), '19', 'lines after 2nd seed');
    eq(sql(DB, `select count(*) from ergon_warehouse.entries where id::text like '5eed0000-%'`), '14', 'deterministic ids');
  });
  await t('(i) seed: refuses (non-zero, clear message, nothing written) when a non-test row exists', () => {
    clearAll();
    sql(DB, `insert into ergon_warehouse.lines (id, code, sort_order, created_at, is_test) values (gen_random_uuid(), 'S', 19, now(), false)`);
    const r = seed();
    truthy(r.status !== 0, 'seed must exit non-zero, got ' + r.status);
    truthy(/SEED REFUSED/.test(r.stderr), 'clear refusal message: ' + r.stderr);
    eq(sql(DB, 'select count(*) from ergon_warehouse.lines'), '1', 'no lines were inserted');
    sql(DB, `delete from ergon_warehouse.lines where code = 'S'`);
    // a non-test ENTRY on a test line also blocks it, and the real row survives untouched
    sql(DB, `insert into ergon_warehouse.lines (id, code, sort_order, created_at, is_test) values (gen_random_uuid(), 'S', 19, now(), true);
             insert into ergon_warehouse.entries (id, line_id, title, photo_metadata, revision, created_at, updated_at, tags, is_test)
               select 'a1000000-0000-4000-8000-000000000001', id, 'Real Customer Ltd', '[]', 1, now(), now(), '{}', false from ergon_warehouse.lines where code = 'S'`);
    const r2 = seed();
    truthy(r2.status !== 0 && /SEED REFUSED/.test(r2.stderr), 'refuses on non-test entry');
    eq(sql(DB, `select title || '/' || (select count(*) from ergon_warehouse.lines) from ergon_warehouse.entries`), 'Real Customer Ltd/1', 'real entry untouched, nothing inserted');
    sql(DB, `delete from ergon_warehouse.entries where id = 'a1000000-0000-4000-8000-000000000001'`);
    clearAll();
  });

  // ---- (a)(b)(c)(d)(e) SQL assertion files
  await t('(a-e) prepare: seed present for the SQL files', () => { const r = seed(); eq(r.status, 0, r.stderr); });
  const prelude = readFileSync(path.join(root, 'test/sql/_prelude.sql'), 'utf8');
  const files = readdirSync(path.join(root, 'test/sql')).filter((f) => /^\d.*\.sql$/.test(f)).sort();
  for (const f of files) {
    await t(`(sql) ${f}`, () => {
      const r = psql(DB, prelude + '\n' + readFileSync(path.join(root, 'test/sql', f), 'utf8'));
      if (r.status !== 0) throw new Error((r.stderr || '').trim());
    });
  }

  // ---- (f) REST with the local anon key
  const H = (extra = {}) => ({ apikey: ANON, Authorization: `Bearer ${ANON}`, 'Accept-Profile': 'ergon_warehouse', 'Content-Profile': 'ergon_warehouse', ...extra });
  const rest = async (method, p, body, extra) => {
    const r = await fetch(`${API}/rest/v1/${p}`, { method, headers: H({ 'Content-Type': 'application/json', ...extra }), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  };
  await t('(f) REST: GET lines returns the 19 seeded rows', async () => {
    const r = await rest('GET', 'lines?select=*&order=sort_order');
    eq(r.status, 200, 'status ' + JSON.stringify(r.json)); eq(r.json.length, 19, 'row count');
    eq(r.json.map((x) => x.code).join(''), 'ABCDEFGHIJKLMNOPQRS', 'labels'); truthy(r.json.every((x) => x.is_test === true), 'is_test');
    eq((await rest('GET', 'entries?select=id')).json.length, 14, 'entries visible');
  }, { needsKey: true });
  await t('(f) REST: anon POST/PATCH/DELETE on lines and entries are rejected and change nothing', async () => {
    const line = (await rest('GET', 'lines?code=eq.A&select=id')).json[0].id;
    for (const [m, p, b] of [
      ['POST', 'lines', { code: 'ZZ', sort_order: 99 }], ['PATCH', 'lines?code=eq.A', { code: 'Q' }], ['DELETE', 'lines?code=eq.A'],
      ['POST', 'entries', { line_id: line, title: 'hack' }], ['PATCH', 'entries?id=not.is.null', { title: 'hack' }], ['DELETE', 'entries?id=not.is.null'],
    ]) {
      const r = await rest(m, p, b, { Prefer: 'return=representation' });
      truthy([401, 403].includes(r.status), `${m} ${p} expected 401/403, got ${r.status} ${JSON.stringify(r.json)}`);
    }
    eq((await rest('GET', 'lines?select=id')).json.length, 19, 'lines intact'); eq((await rest('GET', 'entries?select=id')).json.length, 14, 'entries intact');
  }, { needsKey: true });
  await t('(f) REST: private tables and owner function are not reachable by anon', async () => {
    { const r = await rest('GET', 'access_keys?select=*'); truthy([401, 403, 404].includes(r.status), `access_keys: ${r.status}`); truthy(!Array.isArray(r.json), 'access_keys must not return rows'); }
    for (const [fn, body] of [['mint_access_key', { p_key_hash: 'a'.repeat(64), p_key_prefix: 'ergk_aaaa', p_subject: 'TEST hack', p_expires_at: '2099-01-01T00:00:00Z' }], ['revoke_access_key', { p_id: randomUUID() }], ['list_access_keys', {}]]) {
      const r = await rest('POST', `rpc/${fn}`, body); truthy([401, 403, 404].includes(r.status) && r.json?.ok !== true, `${fn} via anon: ${r.status} ${JSON.stringify(r.json)}`);
    }
    eq(sql(DB, `select count(*) from ergon_warehouse.access_keys where subject = 'TEST hack'`), '0', 'no key minted through the API');
  }, { needsKey: true });
  await t('(f) REST: rpc save_entry without a valid key => ok:false key_invalid; with a valid key it works, is idempotent, and remove respects not_found', async () => {
    const id = randomUUID();
    for (const k of [null, '', 'ergk_' + randomUUID(), 'wrong-' + randomUUID()]) {
      const bad = await rest('POST', 'rpc/save_entry', { p_key: k, p_entry: { id, line_code: 'A', title: 'TEST rest' } });
      eq(bad.status, 200, 'status'); eq(JSON.stringify(bad.json), '{"ok":false,"error":"key_invalid"}', 'body for key ' + String(k).slice(0, 6));
    }
    eq((await rest('POST', 'rpc/remove_entry', { p_key: 'nope', p_id: id })).json.error, 'key_invalid', 'remove without key');
    eq((await rest('POST', 'rpc/check_key', { p_key: 'nope' })).json.error, 'key_invalid', 'check_key without key');
    eq((await rest('GET', `entries?id=eq.${id}&select=id`)).json.length, 0, 'nothing written');
    const good = await rest('POST', 'rpc/save_entry', { p_key: KEY, p_entry: { id, line_code: 'A', title: 'TEST rest', status: 'ready' } });
    eq(good.json.ok, true, JSON.stringify(good.json)); eq(good.json.entry.status, 'ready', 'status'); eq(good.json.entry.revision, 1, 'revision 1'); eq(good.json.entry.updated_by, 'L1 runner', 'updated_by = key subject');
    const forged = await rest('POST', 'rpc/save_entry', { p_key: KEY, p_entry: { id, line_code: 'A', title: 'TEST rest forged', updated_by: 'TEST Mallory' } }); eq(forged.json.entry.updated_by, 'L1 runner', 'client-supplied updated_by ignored over REST');
    await rest('POST', 'rpc/save_entry', { p_key: KEY, p_entry: { id, line_code: 'A', title: 'TEST rest 2' } });
    const rows = (await rest('GET', `entries?id=eq.${id}&select=title,revision,updated_by`)).json; eq(rows.length, 1, 'one row'); eq(rows[0].title, 'TEST rest 2', 'updated'); eq(rows[0].revision, 3, 'revision bumped'); eq(rows[0].updated_by, 'L1 runner', 'updated_by readable by anon');
    const ck = (await rest('POST', 'rpc/check_key', { p_key: KEY })).json; eq(ck.ok, true, 'check_key'); eq(ck.subject, 'L1 runner', 'subject'); truthy(ck.expires_at, 'expires_at');
    // optimistic concurrency over REST: edit at the right revision, stale edit, edit after another tab deleted the row
    const ed = await rest('POST', 'rpc/save_entry', { p_key: KEY, p_entry: { id, title: 'TEST rest edit', expected_revision: 3 } }); eq(ed.json.ok, true, JSON.stringify(ed.json)); eq(ed.json.entry.revision, 4, 'edit revision');
    eq(JSON.stringify((await rest('POST', 'rpc/save_entry', { p_key: KEY, p_entry: { id, title: 'TEST rest stale', expected_revision: 3 } })).json), '{"ok":false,"error":"conflict","revision":4}', 'stale edit over REST');
    eq((await rest('POST', 'rpc/save_entry', { p_key: KEY, p_entry: { id, title: 'x', expected_revision: 'abc' } })).json.error, 'invalid', 'bad expected_revision over REST');
    eq((await rest('POST', 'rpc/remove_entry', { p_key: KEY, p_id: id })).json.ok, true, 'remove');
    eq(JSON.stringify((await rest('POST', 'rpc/save_entry', { p_key: KEY, p_entry: { id, line_code: 'A', title: 'TEST zombie', expected_revision: 4 } })).json), '{"ok":false,"error":"not_found"}', 'edit after delete over REST');
    eq((await rest('GET', `entries?id=eq.${id}&select=id`)).json.length, 0, 'not recreated');
    eq((await rest('POST', 'rpc/remove_entry', { p_key: KEY, p_id: id })).json.error, 'not_found', 'remove again');
    // a revoked key stops working at once, through the API
    const m = JSON.parse(ops(['mint', '--subject', 'TEST rest-revoke', '--ttl', '1h', '--db', DB, '--json']).stdout);
    eq((await rest('POST', 'rpc/check_key', { p_key: m.key })).json.ok, true, 'fresh key valid');
    eq(ops(['revoke', m.id, '--db', DB]).status, 0, 'revoke');
    eq((await rest('POST', 'rpc/save_entry', { p_key: m.key, p_entry: { line_code: 'A', title: 'TEST rest revoked' } })).json.error, 'key_invalid', 'revoked key via API');
    eq((await rest('GET', 'entries?title=eq.TEST rest revoked&select=id')).json.length, 0, 'nothing written by the revoked key');
    const m2 = JSON.parse(ops(['mint', '--subject', 'TEST rest-other', '--ttl', '1h', '--db', DB, '--json']).stdout);
    const id2 = randomUUID();
    await rest('POST', 'rpc/save_entry', { p_key: KEY, p_entry: { id: id2, line_code: 'A', title: 'TEST rest shared' } });
    eq((await rest('POST', 'rpc/save_entry', { p_key: m2.key, p_entry: { id: id2, title: 'TEST rest shared 2' } })).json.entry.updated_by, 'TEST rest-other', 'a different employee\'s key becomes the last writer');
    await rest('POST', 'rpc/remove_entry', { p_key: KEY, p_id: id2 });
  }, { needsKey: true });

  await t('(f) REST: POST/GET /rpc/board_token returns the tiny token and it moves on a write', async () => {
    const dbTok = () => JSON.parse(sql(DB, 'select ergon_warehouse.board_token()'));
    const post = await rest('POST', 'rpc/board_token', {}); eq(post.status, 200, JSON.stringify(post.json));
    eq(Object.keys(post.json).sort().join(''), 'efilru', 'keys'); truthy(JSON.stringify(post.json).length < 200, 'token under 200 bytes');
    eq(JSON.stringify(post.json), JSON.stringify(dbTok()), 'REST token equals the database token');
    const get = await rest('GET', 'rpc/board_token'); eq(get.status, 200, 'GET works (stable function)'); eq(JSON.stringify(get.json), JSON.stringify(post.json), 'GET = POST');
    const id = randomUUID();
    const w = await rest('POST', 'rpc/save_entry', { p_key: KEY, p_entry: { id, line_code: 'A', title: 'TEST token rest' } }); eq(w.json.ok, true, JSON.stringify(w.json));
    const after = (await rest('POST', 'rpc/board_token', {})).json; truthy(JSON.stringify(after) !== JSON.stringify(post.json), 'token moved after a write'); eq(after.e, post.json.e + 1, 'e + 1');
    await rest('POST', 'rpc/remove_entry', { p_key: KEY, p_id: id });
    eq(JSON.stringify((await rest('POST', 'rpc/board_token', {})).json), JSON.stringify(post.json), 'token back after the delete');
  }, { needsKey: true });

  // ---- (g) realtime
  await t('(g) realtime: anon postgres_changes on entries delivers INSERT, UPDATE (revision+1) and DELETE within 5 s each, with no error payloads', async () => {
    const sb = createClient(API, ANON, { db: { schema: 'ergon_warehouse' }, auth: { persistSession: false, autoRefreshToken: false } });
    const events = []; let last = 'none';
    const ch = sb.channel('l1-entries').on('postgres_changes', { event: '*', schema: 'ergon_warehouse', table: 'entries' }, (p) => events.push(p));
    try {
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('subscribe timeout, last status ' + last)), 20000);
        ch.subscribe((s, err) => { last = s; if (s === 'SUBSCRIBED') { clearTimeout(to); res(); } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(s)) { clearTimeout(to); rej(new Error('realtime ' + s + (err ? ': ' + err.message : ''))); } });
      });
      await new Promise((r) => setTimeout(r, 1000));
      const id = randomUUID();
      const waitFor = async (type) => {
        const t0 = Date.now();
        while (Date.now() - t0 < 5000) {
          const bad = events.find((x) => Array.isArray(x.errors) && x.errors.length);
          if (bad) throw new Error('realtime event carried errors: ' + JSON.stringify(bad.errors) + ' (type ' + bad.eventType + ')');
          const e = events.find((x) => x.eventType === type && (x.new?.id === id || x.old?.id === id));
          if (e) return e;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(`no ${type} event within 5 s (got ${JSON.stringify(events.map((e) => [e.eventType, e.errors]))})`);
      };
      const s = await sb.rpc('save_entry', { p_key: KEY, p_entry: { id, line_code: 'B', title: 'TEST live' } }); eq(s.data?.ok, true, JSON.stringify(s));
      const ins = await waitFor('INSERT'); eq(ins.new.id, id, 'INSERT new.id'); eq(ins.new.title, 'TEST live', 'INSERT new.title'); eq(ins.new.revision, 1, 'INSERT new.revision'); eq(ins.new.updated_by, 'L1 runner', 'INSERT carries updated_by');
      const other = JSON.parse(ops(['mint', '--subject', 'TEST rt-other', '--ttl', '1h', '--db', DB, '--json']).stdout);
      const u = await sb.rpc('save_entry', { p_key: other.key, p_entry: { id, line_code: 'B', title: 'TEST live 2' } }); eq(u.data?.ok, true, JSON.stringify(u));
      const upd = await waitFor('UPDATE'); eq(upd.new.id, id, 'UPDATE new.id'); eq(upd.new.title, 'TEST live 2', 'UPDATE new.title'); eq(upd.new.revision, 2, 'UPDATE revision incremented'); eq(upd.new.updated_by, 'TEST rt-other', 'UPDATE carries updated_by of the last writer');
      const d = await sb.rpc('remove_entry', { p_key: KEY, p_id: id }); eq(d.data?.ok, true, JSON.stringify(d));
      const del = await waitFor('DELETE'); eq(del.old.id, id, 'DELETE old.id');
    } finally { await sb.removeChannel(ch); await sb.realtime.disconnect(); }
  }, { needsKey: true });

  // ---- (h) re-applying over data keeps rows, keys, policies
  await t('(h) re-applying the migration over live data keeps rows, access keys and privileges', () => {
    // one session, one REPEATABLE READ snapshot: other writers on the shared local DB cannot make the comparison flaky
    const sigSql = `select md5(coalesce((select string_agg(l::text, '|' order by id) from ergon_warehouse.lines l), '')
      || coalesce((select string_agg(e::text, '|' order by id) from ergon_warehouse.entries e), '')
      || coalesce((select string_agg(k::text, '|' order by k.id) from ergon_warehouse.access_keys k), '')
      || (select string_agg(polname, ',' order by polname) from pg_policy where polrelid in ('ergon_warehouse.lines'::regclass, 'ergon_warehouse.entries'::regclass))
      || (select string_agg(relacl::text, ',' order by relname) from pg_class where relnamespace = 'ergon_warehouse'::regnamespace and relkind = 'r'))`;
    const inspectBefore = psql(DB, readFileSync(INSPECT, 'utf8')).stdout;
    const out = sql(DB, `begin isolation level repeatable read;\n${sigSql} as before \\gset\n\\i ${MIGRATION}\n${sigSql} as after \\gset\nselect :'before' = :'after';\nrollback;`);
    eq(out.split('\n').pop(), 't', 'rows/keys/policies/grants changed by re-apply');
    eq(psql(DB, readFileSync(INSPECT, 'utf8')).stdout, inspectBefore, 'structure changed by re-apply');
  });
  await t('(h) inspect.sql runs read-only and touches no data table', () => {
    const text = readFileSync(INSPECT, 'utf8');
    truthy(!/\b(from|join)\s+"?ergon_warehouse"?\./i.test(text), 'inspect.sql must not select from ergon_warehouse.* tables');
    truthy(!/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(text.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''")), 'inspect.sql must be read-only');
    const out = psql(DB, text); eq(out.status, 0, out.stderr);
    truthy(/rls_enabled=true/.test(out.stdout) && !/rls_enabled=false/.test(out.stdout), 'rls flags shown');
    truthy(/publication\|supabase_realtime: entries/.test(out.stdout), 'publication shown'); truthy(/policy\|lines\.lines_select_all/.test(out.stdout), 'policies shown');
    truthy(/api-exposed-schemas/.test(out.stdout), 'exposed schemas row');
    const ro = psql(DB, 'set default_transaction_read_only = on;\n' + text); eq(ro.status, 0, 'runs in a read-only transaction: ' + ro.stderr);
  });

  // ---- (h) scratch databases: fresh shape and "live-shaped" pre-existing tables
  // mint a test key inside a scratch DB (plaintext stays in memory; the DB gets only the sha256)
  const mintIn = (u) => { const k = 'ergk_' + randomBytes(32).toString('base64url'); sql(u, `select ergon_warehouse.mint_access_key('${createHash('sha256').update(k).digest('hex')}', '${k.slice(0, 9)}', 'TEST scratch', now() + interval '1 hour', 'l1-test')`); return k; };
  const mkScratch = (tag, pre) => {
    const name = `board_scratch_${tag}_${randomBytes(3).toString('hex')}`; scratch.push(name);
    sql(DB, `create database ${name}`); const u = dbWith(name);
    sql(u, `create schema extensions; create extension pgcrypto with schema extensions; create publication supabase_realtime;${pre || ''}`);
    return u;
  };
  await t('(h) scratch fresh DB: applies twice with an identical resulting structure', () => {
    const u = mkScratch('fresh');
    applyMigration(u); const a = psql(u, readFileSync(INSPECT, 'utf8')).stdout;
    applyMigration(u); const b = psql(u, readFileSync(INSPECT, 'utf8')).stdout;
    truthy(a.length > 500, 'inspect output present'); eq(a, b, 'structure after 2nd apply');
    eq(sql(u, `select count(*) from pg_constraint where conrelid in ('ergon_warehouse.lines'::regclass, 'ergon_warehouse.entries'::regclass)`), '10', 'fresh tables carry the 9 hosted constraints plus the status check');
  });
  await t('(h) scratch fresh DB: migration works without a supabase_realtime publication (guarded)', () => {
    const name = `board_scratch_nopub_${randomBytes(3).toString('hex')}`; scratch.push(name);
    sql(DB, `create database ${name}`); const u = dbWith(name);
    sql(u, 'create schema extensions; create extension pgcrypto with schema extensions;'); applyMigration(u); applyMigration(u);
  });

  // Hosted-faithful fixture (docs/DATA-CONTRACT.md "Hosted constraints"): RLS on, zero policies, wide grants, nothing in
  // realtime, the real keys / uniques / FK RESTRICT / CHECKs / index, no column defaults. Several synthetic rows each,
  // nullable title/details, arrays in photo_metadata and tags.
  const liveDdl = ({ status = false, extra = false } = {}) => {
    const entryRows = [
      ["'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'", "'11111111-1111-4111-8111-111111111111'", "'synthetic job one'", "'first note'", `'[{"k":"x"}]'`, 7, "'2026-10-03 09:00:00+00'", "'{rush,fragile}'", "'in progress'"],
      ["'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'", "'11111111-1111-4111-8111-111111111111'", 'null', 'null', "'[]'", 1, "'2026-10-02 09:01:00+00'", "'{}'", 'null'],
      ["'cccccccc-cccc-4ccc-8ccc-cccccccccccc'", "'22222222-2222-4222-8222-222222222222'", "'synthetic job three'", "'third note'", "'[]'", 2, "'2026-10-02 10:02:00+00'", "'{a}'", "'open'"],
    ].map((r) => `(${r[0]},${r[1]},${r[2]},${r[3]},${r[4]},${r[5]},'2026-10-02 09:00:00+00',${r[6]},${r[7]}${status ? ',' + r[8] : ''})`).join(',\n      ');
    return `
    create schema ergon_warehouse;
    create table ergon_warehouse.lines (id uuid not null, code text not null, sort_order smallint not null, created_at timestamptz not null,
      constraint lines_pkey primary key (id), constraint lines_code_key unique (code), constraint lines_sort_order_key unique (sort_order),
      constraint lines_code_check check (code ~ '^[A-S]$'), constraint lines_sort_order_check check (sort_order between 1 and 19));
    create table ergon_warehouse.entries (id uuid not null, line_id uuid not null, title text, details text, photo_metadata jsonb not null, revision bigint not null,
      created_at timestamptz not null, updated_at timestamptz not null, tags text[] not null${status ? ', status text' : ''}${extra ? ", required_extra text not null default 'z'" : ''},
      constraint entries_pkey primary key (id), constraint entries_line_id_fkey foreign key (line_id) references ergon_warehouse.lines (id) on delete restrict,
      constraint entries_photo_metadata_check check (jsonb_typeof(photo_metadata) = 'array'), constraint entries_revision_check check (revision > 0));
    create index entries_line_id_idx on ergon_warehouse.entries (line_id);
    alter table ergon_warehouse.lines enable row level security; alter table ergon_warehouse.entries enable row level security;
    grant all on ergon_warehouse.lines, ergon_warehouse.entries to anon, authenticated;   -- worst case: wide grants but no policies
    insert into ergon_warehouse.lines (id, code, sort_order, created_at) values
      ('11111111-1111-4111-8111-111111111111','A',1,'2026-10-01 08:00:00+00'), ('22222222-2222-4222-8222-222222222222','B',2,'2026-10-01 08:00:01+00'),
      ('33333333-3333-4333-8333-333333333333','C',3,'2026-10-01 08:00:02+00');
    insert into ergon_warehouse.entries (id, line_id, title, details, photo_metadata, revision, created_at, updated_at, tags${status ? ', status' : ''}) values
      ${entryRows};`;
  };
  const ORIG_COLS = { lines: 'id, code, sort_order, created_at', entries: 'id, line_id, title, details, photo_metadata, revision, created_at, updated_at, tags' };
  // byte-level fingerprint of the original data: row text + physical identity (xmin/ctid) + relfilenode
  const fingerprint = (u) => sql(u, `select
      (select string_agg(row(${ORIG_COLS.lines})::text || xmin::text || ctid::text, '|' order by id) from ergon_warehouse.lines) || '#' ||
      (select string_agg(row(${ORIG_COLS.entries})::text || xmin::text || ctid::text, '|' order by id) from ergon_warehouse.entries) || '#' ||
      pg_relation_filenode('ergon_warehouse.lines') || '/' || pg_relation_filenode('ergon_warehouse.entries')`);
  const colSig = (u) => sql(u, `select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), '|' order by table_name, column_name)
      from information_schema.columns where table_schema = 'ergon_warehouse' and table_name in ('lines','entries')
        and column_name in ('id','code','sort_order','created_at','line_id','title','details','photo_metadata','revision','updated_at','tags')`);
  const structSig = (u, what) => sql(u, {
    constraints: `select coalesce(string_agg(conname || ':' || pg_get_constraintdef(oid), ' ; ' order by conname), '') from pg_constraint where conrelid in ('ergon_warehouse.lines'::regclass, 'ergon_warehouse.entries'::regclass)`,
    cnames: `select coalesce(string_agg(conname, ',' order by conname), '') from pg_constraint where conrelid in ('ergon_warehouse.lines'::regclass, 'ergon_warehouse.entries'::regclass)`,
    indexes: `select coalesce(string_agg(indexname, ',' order by indexname), '') from pg_indexes where schemaname = 'ergon_warehouse' and tablename in ('lines','entries')`,
    triggers: `select count(*) from pg_trigger where tgrelid in ('ergon_warehouse.lines'::regclass, 'ergon_warehouse.entries'::regclass) and not tgisinternal`,
  }[what]);
  await t('(h) fresh-database tables mirror the hosted constraints exactly (same names and definitions, plus the additive status check)', () => {
    const host = mkScratch('mirrorh', liveDdl()); const fresh = mkScratch('mirrorf');
    applyMigration(fresh);
    const hostCons = structSig(host, 'constraints');
    const freshCons = structSig(fresh, 'constraints');
    eq(freshCons.split(' ; ').filter((c) => !c.startsWith('entries_status_check:')).join(' ; '), hostCons, 'constraint names/definitions');
    eq(structSig(fresh, 'indexes'), structSig(host, 'indexes'), 'indexes (names)');
    eq(sql(fresh, `select string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by c.relname, a.attnum)
         from pg_attribute a join pg_class c on c.oid = a.attrelid where c.oid in ('ergon_warehouse.lines'::regclass, 'ergon_warehouse.entries'::regclass) and a.attnum > 0 and not a.attisdropped and a.attname not in ('is_test','initials','status','updated_by')`),
       sql(host, `select string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by c.relname, a.attnum)
         from pg_attribute a join pg_class c on c.oid = a.attrelid where c.oid in ('ergon_warehouse.lines'::regclass, 'ergon_warehouse.entries'::regclass) and a.attnum > 0 and not a.attisdropped`), 'columns / types / nullability');
    eq(sql(fresh, `select count(*) from pg_attrdef d join pg_class c on c.oid = d.adrelid where c.oid in ('ergon_warehouse.lines'::regclass, 'ergon_warehouse.entries'::regclass) and d.adnum <= 10 and (select attname from pg_attribute where attrelid = d.adrelid and attnum = d.adnum) not in ('is_test','initials','status','updated_by')`), '0', 'no defaults on the live columns');
  });
  await t('(h) hosted-faithful existing tables, several rows: rows byte-identical; only entries_status_check added; privileges, policies, realtime, RPCs', () => {
    const u = mkScratch('live', liveDdl());
    const before = { fp: fingerprint(u), cols: colSig(u), con: structSig(u, 'cnames'), idx: structSig(u, 'indexes'), trg: structSig(u, 'triggers') };
    // the migration reads no entry row: the table's own scan counters (seq and index reads) do not move across the apply
    const reads = () => sql(u, `select pg_stat_force_next_flush(); select seq_scan::text || '/' || seq_tup_read || '/' || coalesce(idx_scan, 0) || '/' || coalesce(idx_tup_fetch, 0) from pg_stat_user_tables where relid = 'ergon_warehouse.entries'::regclass`).split('\n').pop();
    const readsBefore = reads();
    const notices = applyMigration(u);
    eq(reads(), readsBefore, 'the migration scanned or fetched rows of entries (seq_scan/seq_tup_read/idx_scan/idx_tup_fetch moved)');
    applyMigration(u);   // twice: idempotent
    eq(fingerprint(u), before.fp, 'original rows / physical identity (xmin, ctid) / relfilenode changed (a rewrite or data statement happened)');
    eq(colSig(u), before.cols, 'original columns (types, nullability, defaults) changed');
    eq(structSig(u, 'cnames').split(',').filter((c) => !before.con.split(',').includes(c)).join(','), 'entries_status_check', 'constraints added to the existing tables');
    eq(structSig(u, 'cnames').split(',').filter((c) => !c.includes('status')).join(','), before.con, 'no existing constraint changed or removed');
    eq(structSig(u, 'indexes'), before.idx, 'indexes changed'); eq(structSig(u, 'triggers'), before.trg, 'triggers changed');
    eq(sql(u, `select count(*) from ergon_warehouse.lines where is_test`) + sql(u, `select count(*) from ergon_warehouse.entries where is_test or initials <> '' or status <> 'open' or updated_by <> ''`), '00', 'additive columns (incl. updated_by) hold only their defaults on pre-existing rows');
    eq(sql(u, `select string_agg(r || ':' || t || ':' || has_table_privilege(r, 'ergon_warehouse.' || t, 'select')::text || ':' || (has_table_privilege(r, 'ergon_warehouse.' || t, 'insert') or has_table_privilege(r, 'ergon_warehouse.' || t, 'update') or has_table_privilege(r, 'ergon_warehouse.' || t, 'delete') or has_table_privilege(r, 'ergon_warehouse.' || t, 'truncate'))::text, ',' order by r, t)
               from (values ('anon'),('authenticated')) a(r), (values ('lines'),('entries')) b(t)`),
       'anon:entries:true:false,anon:lines:true:false,authenticated:entries:true:false,authenticated:lines:true:false', 'SELECT only: wide pre-existing grants cut back');
    eq(sql(u, `select string_agg(tablename || '.' || policyname || '.' || cmd, ',' order by tablename) from pg_policies where schemaname = 'ergon_warehouse'`), 'entries.entries_select_all.SELECT,lines.lines_select_all.SELECT', 'policies are exactly the two SELECT ones');
    eq(sql(u, `select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'ergon_warehouse'`), '2', 'realtime membership added');
    eq(sql(u, `select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ergon_warehouse' and relkind = 'r'`), 't', 'RLS on every table');
    eq(notices.includes('left NOT VALID'), false, 'no validation attempt, so no notice'); eq(sql(u, `select convalidated from pg_constraint where conname = 'entries_status_check'`), 'f', 'status check stays NOT VALID by design');
    { const bt = JSON.parse(sql(u, `select ergon_warehouse.board_token()`)); eq(`${bt.l}/${bt.e}/${bt.r}`, '3/3/10', 'board_token works on the live-shaped tables (function only: rows untouched above)'); }
    // RPCs on the hosted shape: insert sets every NOT NULL column and satisfies the CHECKs; update bumps revision; remove respects the FK
    const SK = mintIn(u);
    const ins = JSON.parse(sql(u, `select ergon_warehouse.save_entry('${SK}', '{"line_code":"C","title":"TEST new"}')`));
    eq(ins.ok, true, JSON.stringify(ins)); eq(ins.entry.revision, 1, 'insert revision'); eq(ins.entry.tags.length, 0, 'tags'); eq(JSON.stringify(ins.entry.photo_metadata), '[]', 'photo_metadata is an empty array'); eq(ins.entry.line_code, 'C', 'line_code');
    const stale = JSON.parse(sql(u, `select ergon_warehouse.save_entry('${SK}', '{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","title":"TEST stale","expected_revision":6}')`));
    eq(JSON.stringify(stale), '{"ok":false,"error":"conflict","revision":7}', 'stale edit on a legacy row conflicts with its stored revision');
    eq(sql(u, `select title || revision from ergon_warehouse.entries where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`), 'synthetic job one7', 'conflict changed nothing');
    const upd = JSON.parse(sql(u, `select ergon_warehouse.save_entry('${SK}', '{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","title":"TEST retitled","expected_revision":7}')`));
    eq(upd.ok, true, JSON.stringify(upd)); eq(upd.entry.revision, 8, 'revision 7 -> 8'); eq(upd.entry.details, 'first note', 'details kept');
    eq(upd.entry.updated_by, 'TEST scratch', 'legacy row (updated_by was empty) now attributed to the key subject'); eq(ins.entry.updated_by, 'TEST scratch', 'insert attributed');
    eq(sql(u, `select updated_by from ergon_warehouse.entries where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'`), '', 'untouched legacy rows keep an empty updated_by');
    eq(sql(u, `select tags::text || photo_metadata::text from ergon_warehouse.entries where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`), '{rush,fragile}[{"k": "x"}]', 'tags/photo_metadata untouched by update');
    eq(sql(u, `select count(*) from ergon_warehouse.entries`), '4', 'only one row added');
    eq(JSON.parse(sql(u, `select ergon_warehouse.remove_entry('${SK}', '${ins.entry.id}')`)).ok, true, 'remove');
    const bad = JSON.parse(sql(u, `select ergon_warehouse.save_entry('${SK}', '{"line_code":"Z","title":"x"}')`)); eq(bad.error, 'invalid', 'a code the CHECK would refuse is rejected as invalid before any write');
  });
  await t('(i) hosted pack: the step-0 read-only queries run as supabase_read_only_user with an empty search_path, and apply + rollback (PART B then PART A, with the generated restore statements) puts the catalog and the rows back exactly', () => {
    const ROLLBACK = readFileSync(path.join(root, 'supabase/hosted-rollback.sql'), 'utf8');
    const GENERATOR = readFileSync(path.join(root, 'supabase/hosted-restore-generator.sql'), 'utf8');
    const COUNTS = `select (select count(*) from ergon_warehouse.lines) as lines, (select count(*) from ergon_warehouse.entries) as entries;`;
    const u = mkScratch('rb', liveDdl());
    // read-only and schema-qualified: exactly the conditions of POST /database/query/read-only
    const roUrl = (() => { const x = new URL(u); x.username = 'supabase_read_only_user'; x.password = 'postgres'; return x.toString(); })(); // the role the read-only endpoint runs as (local password)
    const ro = (q) => { const r = psql(roUrl, `begin read only; set local search_path = '';\n${q}\nrollback;`); if (r.status !== 0) throw new Error(r.stderr.trim()); return r.stdout; };
    const inspectBefore = ro(readFileSync(INSPECT, 'utf8'));
    const restore = ro(GENERATOR).split('\n').map((l) => l.replace(/^\d+\|?/, '').trim()).filter((l) => l.startsWith('grant') || l.startsWith('revoke') || l.startsWith('alter')).join('\n');
    truthy(restore.includes('replica identity default') && restore.includes('row level security'), 'the generator printed its statements');
    eq(ro(COUNTS).trim(), '3|3', 'counts query');
    // step 1's all-grantees check (Nox 2 Nov 19:15): only expected grantees on the hosted-shaped fixture; an unknown role's grant is caught, then cleaned up
    const GRANTEES = readFileSync(path.join(root, 'supabase/hosted-grantee-check.sql'), 'utf8');
    const rows = (s) => s.trim().split('\n').filter(Boolean).map((l) => l.split('|'));
    const base = rows(ro(GRANTEES)); truthy(base.length >= 4, 'grantee rows listed (anon and authenticated on both tables, at least)');
    eq(base.filter((r) => r[3] !== 't').length, 0, 'fixture: every grantee expected: ' + JSON.stringify(base));
    const rogue = 'board_rogue_' + randomBytes(3).toString('hex');
    sql(DB, `create role ${rogue} nologin`);
    try {
      sql(u, `grant select on ergon_warehouse.entries to ${rogue}`);
      const bad = rows(ro(GRANTEES)).filter((r) => r[3] !== 't');
      eq(JSON.stringify(bad), JSON.stringify([['entries', rogue, 'SELECT', 'f']]), 'an unknown grantee is listed with expected = false');
      sql(u, `revoke select on ergon_warehouse.entries from ${rogue}`);
    } finally { sql(DB, `drop role if exists ${rogue}`); }
    const fpBefore = fingerprint(u); const cols = colSig(u);
    // step 2a, then 2b (the pack's own statements)
    psql(u, 'begin;\nalter table ergon_warehouse.entries add column if not exists updated_by text not null default \'\';\ncommit;', {});
    applyMigration(u);
    eq(sql(u, `select count(*) from pg_policies where schemaname = 'ergon_warehouse'`), '2', 'migration applied');
    // step 3 of the pack, as the read-only role with an empty search_path: the documented verify query, the validated-status-check query and the counts
    const doc = readFileSync(path.join(root, 'docs/DATA-LAYER.md'), 'utf8');
    const vq = /```sql\n\s*(select\n\s+\(select bool_and[\s\S]*?updated_by_column_expect_true;)/.exec(doc)?.[1];
    eq(ro(vq.replace(/^\s*--.*$/gm, '')).replace(/\s+/g, ''), 't|2|2|t|board_token,check_key,remove_entry,save_entry|0|2|t', 'step 3 verify result (read-only role)');
    const pack = readFileSync(path.join(root, 'docs/HOSTED-APPLY-PACK.md'), 'utf8');
    const sc = /```sql\n(select \(select convalidated[\s\S]*?;)\nselect \(select count/.exec(pack)?.[1];
    truthy(sc, 'pack status-check query found'); eq(ro(sc).trim(), 'f', 'status check is NOT VALID, as designed');
    eq(ro(COUNTS).trim(), '3|3', 'counts unchanged by the apply');
    const partB = ROLLBACK.split('-- ===== PART B')[1].split('-- ===== PART A')[0].replace(/^[^\n]*\n/, '');
    const partA = ROLLBACK.split('-- ===== PART A')[1].replace(/^[^\n]*\n/, '');
    const b = psql(u, partB.replace(/-- then, still in this transaction[^\n]*\n/, restore + '\n'), {}); if (b.status !== 0) throw new Error(b.stderr.trim());
    const a = psql(u, partA, {}); if (a.status !== 0) throw new Error(a.stderr.trim());
    eq(ro(readFileSync(INSPECT, 'utf8')), inspectBefore, 'inspect.sql output before apply equals after rollback');
    eq(fingerprint(u), fpBefore, 'rows, physical identity and relfilenode unchanged by apply + rollback');
    eq(colSig(u), cols, 'original columns unchanged');
    eq(sql(u, `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ergon_warehouse' and c.relname = 'access_keys'`), '0', 'access_keys gone');
    eq(sql(u, `select count(*) from pg_proc where pronamespace = 'ergon_warehouse'::regnamespace`), '0', 'functions gone');
    // and it can be applied again after a rollback
    applyMigration(u); eq(sql(u, `select count(*) from pg_policies where schemaname = 'ergon_warehouse'`), '2', 're-apply after rollback');
  });
  await t('(h) hosted step 2 (updated_by column alone) first, then the migration: rows byte-identical, no rewrite, idempotent', () => {
    const doc = readFileSync(path.join(root, 'docs/DATA-LAYER.md'), 'utf8');
    const step2 = /```sql\n\s*(alter table ergon_warehouse\.entries add column if not exists updated_by[^\n]*;)\s*\n\s*```/.exec(doc)?.[1];
    truthy(step2, 'step 2 SQL found in docs/DATA-LAYER.md');
    const u = mkScratch('step2', liveDdl()); const before = fingerprint(u);
    sql(u, step2); eq(fingerprint(u), before, 'adding updated_by rewrote or changed rows');
    eq(sql(u, `select count(*) from ergon_warehouse.entries where updated_by <> ''`), '0', 'existing rows read an empty updated_by');
    sql(u, step2);   // idempotent
    applyMigration(u); applyMigration(u); eq(fingerprint(u), before, 'migration after step 2 changed rows');
    eq(sql(u, `select column_default || '|' || is_nullable from information_schema.columns where table_schema = 'ergon_warehouse' and table_name = 'entries' and column_name = 'updated_by'`), `''::text|NO`, 'column definition');
  });
  await t('(h) the verify query printed in docs/DATA-LAYER.md runs and returns the documented expectation', () => {
    const doc = readFileSync(path.join(root, 'docs/DATA-LAYER.md'), 'utf8');
    const q = /```sql\n\s*(select\n\s+\(select bool_and[\s\S]*?updated_by_column_expect_true;)/.exec(doc)?.[1];
    truthy(q, 'verify SQL found'); eq(sql(DB, q.replace(/^\s*--.*$/gm, '')).replace(/\s+/g, ''), 't|2|2|t|board_token,check_key,remove_entry,save_entry|0|2|t', 'verify result');
  });
  await t('(h) existing entries with a pre-existing odd status column are never judged (NOT VALID, no scan, no notice) and the migration still succeeds', () => {
    const u = mkScratch('odd', liveDdl({ status: true }));
    const before = fingerprint(u); const notices = applyMigration(u);
    eq(fingerprint(u), before, 'rows changed');
    eq(/entries_status_check left NOT VALID/.test(notices), false, 'no validation attempt, so no notice: ' + notices);
    eq(sql(u, `select convalidated from pg_constraint where conname = 'entries_status_check'`), 'f', 'constraint not validated');
  });
  await t('(h) unknown NOT NULL column without default: migration non-destructive, save_entry INSERT raises (documented limit)', () => {
    const u = mkScratch('notnull', liveDdl({ extra: true }));
    // give the unknown column no default by dropping it after the seed rows exist
    sql(u, `alter table ergon_warehouse.entries alter column required_extra drop default`);
    const before = fingerprint(u); applyMigration(u); applyMigration(u);
    eq(fingerprint(u), before, 'rows changed');
    const SK = mintIn(u);
    const r = psql(u, `select ergon_warehouse.save_entry('${SK}', '{"line_code":"A","title":"TEST x"}')`);
    truthy(r.status !== 0 && /required_extra/.test(r.stderr) && /null value/.test(r.stderr), 'insert must fail on the unknown NOT NULL column: ' + r.stderr);
    eq(sql(u, 'select count(*) from ergon_warehouse.entries'), '3', 'nothing partially written');
  });
  await t('(h) a column of an incompatible type aborts the migration atomically with a clear message', () => {
    const u = mkScratch('badtype', `create schema ergon_warehouse; create table ergon_warehouse.lines (id bigint not null, code text not null, sort_order smallint not null, created_at timestamptz not null); create table ergon_warehouse.entries (id uuid not null, line_id uuid not null); insert into ergon_warehouse.lines values (1, 'A', 1, now());`);
    const r = psql(u, migrationSql, { single: true });
    truthy(r.status !== 0 && /needs uuid/.test(r.stderr), 'clear error: ' + r.stderr);
    eq(sql(u, `select count(*) from ergon_warehouse.lines`), '1', 'row intact');
    eq(sql(u, `select count(*) from information_schema.columns where table_schema = 'ergon_warehouse' and column_name in ('is_test','initials','status')`), '0', 'single-transaction apply left nothing half-done');
  });
} finally {
  // cleanup: test rows, test keys, scratch databases
  try { clearAll(); clearKeys(); } catch (e) { console.log('cleanup (local rows) failed: ' + e.message); }
  for (const n of scratch) { const r = psql(DB, `drop database if exists ${n} with (force)`); if (r.status !== 0) console.log('cleanup: could not drop ' + n); }
  try {
    const left = sql(DB, `select (select count(*) from ergon_warehouse.lines) || ' lines, ' || (select count(*) from ergon_warehouse.entries) || ' entries, ' || (select count(*) from ergon_warehouse.access_keys) || ' keys left'`);
    console.log(`cleanup: local schema left applied with ${left}`);
  } catch {}
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  exitCode = failed > 0 || passed === 0 ? 1 : skipped > 0 && process.env.BOARD_TEST_ALLOW_SKIP !== '1' ? 3 : 0;
}
console.log(`exit code ${exitCode}`);
lockSession.stdin.end();
process.exit(exitCode);
