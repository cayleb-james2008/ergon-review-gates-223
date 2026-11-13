// LIVE tests of the agent interface against the LOCAL Supabase stack. Skipped (reported as SKIP) unless E2E_SUPABASE=1.
//   E2E_SUPABASE=1 npm run test:agent
// Settings: the stack URL and anon key are read at runtime from `supabase status -o env` (never printed or stored).
// Keys are minted the way a harness-side issuer does: the test generates an ergk_ key, computes its sha256 and calls
// ergon_warehouse.mint_access_key as the database superuser; the plaintext key never enters the database. Everything is cleaned up afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createBoardClient } from '../../agent/client.mjs';
import { buildAndServe, launch, newCtx, ROOT } from '../e2e/helpers.mjs';

const enabled = process.env.E2E_SUPABASE === '1';
const skip = enabled ? false : 'SKIP: set E2E_SUPABASE=1 to run against the local Supabase stack';
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let url;
let key; // the main valid key
let srv;
let browser;

const psql = (sql) => execFileSync('psql', ['-X', '-tA', '-v', 'ON_ERROR_STOP=1', DB_URL, '-c', sql], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const agent = (over = {}) => createBoardClient({ url, anonKey: anon, key, retryDelayMs: 50, ...over });
const rows = (id) => Number(psql(`select count(*) from ergon_warehouse.entries where id = '${id}'`));
let anon;

const newKey = () => `ergk_${randomBytes(32).toString('base64url')}`;
const sha = (k) => createHash('sha256').update(k).digest('hex');
// Mint like an issuer: only the hash reaches the database. Returns { key, id }.
function mint(subject, hours = 1) {
  const k = newKey();
  const id = psql(`select ergon_warehouse.mint_access_key('${sha(k)}', '${k.slice(0, 9)}', '${subject}', now() + interval '${hours} hours', 'agent-live-test')`);
  return { key: k, id };
}
function stackEnv() {
  const out = execFileSync('supabase', ['status', '-o', 'env'], {
    env: { ...process.env, DOCKER_HOST: process.env.DOCKER_HOST ?? 'unix:///run/user/1000/board-podman-fix.sock' },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  const kv = Object.fromEntries([...out.matchAll(/^([A-Z0-9_]+)="?([^"\n]*)"?$/gm)].map((m) => [m[1], m[2]]));
  assert.ok(kv.API_URL && (kv.ANON_KEY ?? kv.PUBLISHABLE_KEY), 'supabase status did not report API_URL and ANON_KEY');
  return { url: kv.API_URL, key: kv.ANON_KEY ?? kv.PUBLISHABLE_KEY };
}

function cleanup() {
  // entries before lines (FK RESTRICT); only after the seed guard proved the tables held test data only
  psql('delete from ergon_warehouse.entries; delete from ergon_warehouse.lines; delete from ergon_warehouse.access_keys;');
}

before(() => {
  if (!enabled) return;
  psql('select 1');
  assert.equal(psql("select to_regclass('ergon_warehouse.access_keys') is not null"), 't', 'the key-based migration is not applied to the local database (ergon_warehouse.access_keys missing)');
  ({ url, key: anon } = stackEnv());
  assert.equal(psql("select count(*) from information_schema.columns where table_schema='ergon_warehouse' and table_name='entries' and column_name='updated_by'"), '1', 'the updated_by migration is not applied to the local database');
  const seed = spawnSync(process.execPath, [`${ROOT}/scripts/seed-test.mjs`], { encoding: 'utf8' });
  assert.equal(seed.status, 0, 'seed generation failed');
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', DB_URL], { input: seed.stdout, stdio: ['pipe', 'ignore', 'inherit'] });
  key = mint('TEST Alex Agent').key;
});

after(async () => {
  if (!enabled) return;
  await browser?.close();
  srv?.stop();
  cleanup();
});

test('key_check returns the subject and expiry; reads need no key', { skip }, async () => {
  const r = await agent().callTool('key_check', {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.subject, 'TEST Alex Agent');
  const ms = Date.parse(r.expires_at) - Date.now();
  assert.ok(ms > 50 * 60_000 && ms <= 61 * 60_000, 'expiry about one hour out');
  assert.ok(!JSON.stringify(r).includes(key));
  const rd = await agent({ key: '' }).callTool('board_get', {});
  assert.equal(rd.ok, true);
  assert.equal(rd.line_count, 19);
});

test('board_get returns 19 lines A..S with TEST rows flagged', { skip }, async () => {
  const r = await agent().callTool('board_get', {});
  assert.equal(r.ok, true);
  assert.equal(r.lines.map((l) => l.code).join(''), 'ABCDEFGHIJKLMNOPQRS');
  assert.equal(r.test_data, true);
  assert.ok(r.job_count >= 14, 'the 14 seeded jobs are there');
  assert.equal(r.lines.find((l) => l.code === 'A').jobs.length, 2);
  assert.ok(r.lines.every((l) => l.jobs.every((j) => j.revision >= 1 && ['open', 'hold', 'ready', 'done'].includes(j.status))));
});

const state = {};

test('job_save creates; same id again is idempotent (one row) and bumps revision; partial update keeps other fields', { skip }, async () => {
  const c = agent();
  const id = randomUUID();
  const a = await c.callTool('job_save', { id, line_code: 'R', title: 'TEST agent job', details: 'first', status: 'open' });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.created, true);
  assert.equal(a.job.id, id);
  assert.equal(a.job.revision, 1);
  assert.equal(a.job.initials, 'AGT');
  assert.equal(a.job.is_test, true);
  const b = await c.callTool('job_save', { id, line_code: 'R', title: 'TEST agent job', details: 'second' });
  assert.equal(b.ok, true);
  assert.equal(b.created, false);
  assert.equal(b.job.revision, 2);
  assert.equal(rows(id), 1);
  const p = await c.callTool('job_save', { id, status: 'hold' }); // partial: title/details/line untouched
  assert.equal(p.ok, true);
  assert.equal(p.job.title, 'TEST agent job');
  assert.equal(p.job.details, 'second');
  assert.equal(p.job.line_code, 'R');
  assert.equal(p.job.status, 'hold');
  assert.equal(p.job.revision, 3);
  // no id given: the client generates one and returns it
  const g = await c.callTool('job_save', { line_code: 'S', title: 'TEST generated id', initials: 'ZQ' });
  assert.equal(g.ok, true);
  assert.match(g.job.id, /^[0-9a-f-]{36}$/);
  assert.equal(g.job.initials, 'ZQ');
  state.id = id;
  state.gid = g.job.id;
  // a brand-new id with no title is refused locally/by the DB and creates nothing
  const bad = await c.callTool('job_save', { id: randomUUID(), status: 'done' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'invalid');
});

test('job_set_status works; board_find finds the job; unknown id is not_found', { skip }, async () => {
  const c = agent();
  const s = await c.callTool('job_set_status', { id: state.id, status: 'ready' });
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.equal(s.job.status, 'ready');
  assert.equal(s.job.revision, 4);
  const f = await c.callTool('board_find', { text: 'agent job', line: 'R', status: 'ready' });
  assert.equal(f.ok, true);
  assert.equal(f.count, 1);
  assert.equal(f.matches[0].id, state.id);
  assert.equal(f.matches[0].line_code, 'R');
  assert.equal((await c.callTool('board_find', { text: 'agent job', status: 'done' })).count, 0);
  assert.equal((await c.callTool('job_set_status', { id: randomUUID(), status: 'done' })).error, 'not_found');
});

test('job_remove removes; the second remove is not_found', { skip }, async () => {
  const c = agent();
  const r = await c.callTool('job_remove', { id: state.gid });
  assert.deepEqual({ ok: r.ok, id: r.id }, { ok: true, id: state.gid });
  assert.equal(rows(state.gid), 0);
  const again = await c.callTool('job_remove', { id: state.gid });
  assert.equal(again.ok, false);
  assert.equal(again.error, 'not_found');
});

test('updated_by is the key subject, set server-side: employee-a, then employee-b changes it; a claimed identity is never accepted', { skip }, async () => {
  const a = mint('employee-a').key;
  const b = mint('employee-b').key;
  const id = randomUUID();
  const ca = agent({ key: a });
  const cb = agent({ key: b });
  const created = await ca.callTool('job_save', { id, line_code: 'E', title: 'TEST updated_by' });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.job.updated_by, 'employee-a');
  assert.equal(psql(`select updated_by from ergon_warehouse.entries where id = '${id}'`), 'employee-a');
  // initials is only a tag; it does not decide who changed it
  assert.equal(created.job.initials, 'AGT');
  const second = await cb.callTool('job_set_status', { id, status: 'hold' });
  assert.equal(second.ok, true);
  assert.equal(second.job.updated_by, 'employee-b');
  assert.equal((await cb.callTool('job_save', { id, initials: 'EMP-A' })).job.updated_by, 'employee-b', 'initials claiming another person does not change it');
  // readers see it
  const found = (await agent().callTool('board_find', { text: 'TEST updated_by' })).matches[0];
  assert.equal(found.updated_by, 'employee-b');
  assert.equal((await agent().callTool('board_get', {})).lines.find((l) => l.code === 'E').jobs.find((j) => j.id === id).updated_by, 'employee-b');
  // the client refuses to send it at all
  const local = await ca.callTool('job_save', { id, status: 'done', updated_by: 'employee-b' });
  assert.deepEqual([local.ok, local.error], [false, 'invalid']);
  // a raw RPC payload claiming another identity: rejected, or ignored; either way not the claimed value
  const raw = createClient(url, anon, { db: { schema: 'ergon_warehouse' }, auth: { persistSession: false, autoRefreshToken: false } });
  const rev = Number(psql(`select revision from ergon_warehouse.entries where id = '${id}'`));
  const { data } = await raw.rpc('save_entry', { p_key: a, p_entry: { id, status: 'ready', updated_by: 'employee-c' } });
  const row = psql(`select updated_by || '|' || status || '|' || revision from ergon_warehouse.entries where id = '${id}'`).split('|');
  assert.notEqual(row[0], 'employee-c', 'a claimed identity was stored');
  if (data.ok) assert.equal(row[0], 'employee-a', 'ignored: the key subject is recorded, not the claim');
  else assert.deepEqual([row[0], row[1], Number(row[2])], ['employee-b', 'hold', rev], 'rejected: row unchanged');
  console.log(`# updated_by claim via raw payload was ${data.ok ? 'ignored (subject recorded)' : 'rejected (' + data.error + ')'}`);
  const claimOnCreate = randomUUID();
  const r2 = await raw.rpc('save_entry', { p_key: b, p_entry: { id: claimOnCreate, line_code: 'E', title: 'TEST claim on create', updated_by: 'employee-a' } });
  if (r2.data.ok) assert.equal(psql(`select updated_by from ergon_warehouse.entries where id = '${claimOnCreate}'`), 'employee-b');
  else assert.equal(rows(claimOnCreate), 0);
});

test('optimistic concurrency: stale write -> conflict with nothing changed; deleted job -> not_found and no row; creates stay idempotent', { skip }, async () => {
  const c = agent();
  const id = randomUUID();
  const snap = () => psql(`select revision || '|' || status || '|' || coalesce(title,'') || '|' || coalesce(details,'') from ergon_warehouse.entries where id = '${id}'`);
  const made = await c.callTool('job_save', { id, line_code: 'F', title: 'TEST concurrency', details: 'v1' });
  assert.equal(made.job.revision, 1);
  // create idempotency is unchanged: same id, no expected_revision, still one row
  assert.equal((await c.callTool('job_save', { id, line_code: 'F', title: 'TEST concurrency', details: 'v1' })).job.revision, 2);
  assert.equal(rows(id), 1);
  // a good guarded edit
  const ok = await c.callTool('job_save', { id, details: 'v2', expected_revision: 2 });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.job.revision, 3);
  // stale edits: conflict, current revision reported, nothing changed
  const state0 = snap();
  const stale = await c.callTool('job_save', { id, details: 'STALE', expected_revision: 2 });
  assert.deepEqual([stale.ok, stale.error, stale.current_revision], [false, 'conflict', 3]);
  const staleStatus = await c.callTool('job_set_status', { id, status: 'done', expected_revision: 1 });
  assert.deepEqual([staleStatus.error, staleStatus.current_revision], ['conflict', 3]);
  assert.equal(snap(), state0, 'refused writes changed nothing');
  assert.equal(state0, '3|open|TEST concurrency|v2');
  // job_set_status guards itself: a concurrent change between its read and write surfaces as conflict
  const raw = createClient(url, anon, { db: { schema: 'ergon_warehouse' }, auth: { persistSession: false, autoRefreshToken: false } });
  const viaRaw = await raw.rpc('save_entry', { p_key: key, p_entry: { id, status: 'hold', expected_revision: 3 } });
  assert.equal(viaRaw.data.ok, true);
  assert.equal(viaRaw.data.entry.revision, 4);
  const auto = await c.callTool('job_set_status', { id, status: 'ready' }); // reads revision 4, writes with it
  assert.equal(auto.ok, true);
  assert.equal(auto.job.revision, 5);
  // the raw RPC reports the current revision on conflict too
  const rawConflict = await raw.rpc('save_entry', { p_key: key, p_entry: { id, status: 'done', expected_revision: 4 } });
  assert.equal(rawConflict.data.ok, false);
  assert.equal(rawConflict.data.error, 'conflict');
  // deleted job: not_found, nothing written, not recreated (even with a title and line that would otherwise create it)
  assert.equal((await c.callTool('job_remove', { id })).ok, true);
  for (const args of [{ id, details: 'ghost', expected_revision: 5 }, { id, line_code: 'F', title: 'TEST ghost', expected_revision: 5 }]) {
    const r = await c.callTool('job_save', args);
    assert.deepEqual([r.ok, r.error], [false, 'not_found']);
    assert.equal(rows(id), 0, 'a deleted job must not be recreated');
  }
  assert.equal((await c.callTool('job_set_status', { id, status: 'done' })).error, 'not_found');
  assert.equal((await c.callTool('job_set_status', { id, status: 'done', expected_revision: 5 })).error, 'not_found');
  assert.equal(rows(id), 0);
  // and a plain create with that id (no expected_revision) is still allowed
  assert.equal((await c.callTool('job_save', { id, line_code: 'F', title: 'TEST concurrency again' })).job.revision, 1);
});

test('last_used_at is set by a successful write', { skip }, async () => {
  assert.equal(psql("select count(*) from ergon_warehouse.access_keys where subject = 'TEST Alex Agent' and last_used_at is not null"), '1');
});

test('no key, a revoked key, an expired key and a made-up key are all refused and write nothing', { skip }, async () => {
  const attempt = async (c, label) => {
    const id = randomUUID();
    const r = await c.callTool('job_save', { id, line_code: 'A', title: `TEST must not exist (${label})` });
    assert.equal(rows(id), 0, `${label}: wrote a row`);
    return r;
  };
  // no key: refused by the client before any request, and by the database if the RPC is called with nothing
  const none = await attempt(agent({ key: '' }), 'no key');
  assert.deepEqual([none.ok, none.error], [false, 'config']);
  assert.match(none.message, /BOARD_KEY/);
  const raw = createClient(url, anon, { db: { schema: 'ergon_warehouse' }, auth: { persistSession: false, autoRefreshToken: false } });
  for (const p_key of ['', null, 'nonsense']) {
    const { data } = await raw.rpc('save_entry', { p_key, p_entry: { line_code: 'A', title: 'TEST must not exist (raw)' } });
    assert.deepEqual([data.ok, data.error], [false, 'key_invalid'], `raw rpc with ${JSON.stringify(p_key)}`);
  }
  // revoked
  const rev = mint('TEST Revoked Rita');
  assert.equal((await agent({ key: rev.key }).callTool('key_check', {})).ok, true);
  assert.equal(psql(`select ergon_warehouse.revoke_access_key('${rev.id}')`), 't');
  const revoked = await attempt(agent({ key: rev.key }), 'revoked');
  assert.deepEqual([revoked.ok, revoked.error], [false, 'key_invalid']);
  assert.equal((await agent({ key: rev.key }).callTool('key_check', {})).error, 'key_invalid');
  assert.equal((await agent({ key: rev.key }).callTool('job_remove', { id: state.id })).error, 'key_invalid');
  // expired: superuser insert with a past expiry (mint refuses that by design)
  const exp = newKey();
  psql(`insert into ergon_warehouse.access_keys (key_hash, key_prefix, subject, issued_by, created_at, expires_at) values ('${sha(exp)}', '${exp.slice(0, 9)}', 'TEST Expired Ed', 'agent-live-test', now() - interval '2 hours', now() - interval '1 hour')`);
  const expired = await attempt(agent({ key: exp }), 'expired');
  assert.deepEqual([expired.ok, expired.error], [false, 'key_expired']);
  assert.equal((await agent({ key: exp }).callTool('key_check', {})).error, 'key_expired');
  // an ergk_-shaped key nobody minted
  const ghost = await attempt(agent({ key: newKey() }), 'unknown');
  assert.deepEqual([ghost.ok, ghost.error], [false, 'key_invalid']);
  assert.equal(psql("select count(*) from ergon_warehouse.entries where title like 'TEST must not exist%'"), '0');
  assert.equal(rows(state.id), 1, 'the job a refused key tried to remove is still there');
  // refusals neither throttle nor lock anyone out: the good key still works after many bad ones
  for (let i = 0; i < 12; i++) assert.equal((await agent({ key: newKey() }).callTool('key_check', {})).error, 'key_invalid');
  assert.equal((await agent().callTool('job_set_status', { id: state.id, status: 'open' })).ok, true);
});

test('a key never appears in a result or error, even from a live refusal', { skip }, async () => {
  const bad = newKey();
  const outs = [];
  for (const c of [agent({ key: bad }), agent()]) {
    outs.push(await c.callTool('key_check', {}), await c.callTool('job_save', { id: randomUUID(), line_code: 'Z', title: 'x' }), await c.callTool('job_remove', { id: randomUUID() }));
  }
  const text = JSON.stringify(outs);
  assert.ok(!text.includes(bad) && !text.includes(key) && !text.includes(anon));
});

test('PARITY: an agent write shows on the human page within 5 s; a write through the browser\'s own RPC path is read by the agent', { skip }, async () => {
  srv = await buildAndServe({ VITE_BACKEND: 'supabase', VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anon });
  browser = await launch();
  const { ctx, log } = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${srv.url}#key=${key}`); // the key reaches the page only through the URL fragment
  await page.waitForSelector('#board[data-state="ready"]', { timeout: 15000 });
  const c = agent();

  // agent -> human
  const id = randomUUID();
  const t0 = Date.now();
  const saved = await c.callTool('job_save', { id, line_code: 'C', title: 'TEST parity from agent', status: 'open' });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  await page.waitForSelector(`.job[data-id="${id}"]`, { timeout: 5000 }).catch(async (e) => {
    const conn = await page.locator('#conn').getAttribute('data-state');
    throw new Error(`agent job not on the page after 5 s (conn=${conn}, jobs on page=${await page.locator('.job').count()}, errors=${JSON.stringify(log.errors)}): ${e.message.split('\n')[0]}`);
  });
  const appearedMs = Date.now() - t0;
  assert.match(await page.locator(`.job[data-id="${id}"]`).innerText(), /TEST parity from agent/);
  const t1 = Date.now();
  assert.equal((await c.callTool('job_set_status', { id, status: 'ready' })).ok, true);
  await page.waitForFunction((i) => document.querySelector(`.job[data-id="${i}"]`)?.dataset.status === 'ready', id, { timeout: 5000 });
  const statusMs = Date.now() - t1;
  console.log(`# parity: agent create visible after ${appearedMs} ms, agent status change visible after ${statusMs} ms`);

  // human -> agent, same RPC the browser uses (supabase-js, schema ergon_warehouse): the agent reads the row
  const human = createClient(url, anon, { db: { schema: 'ergon_warehouse' }, auth: { persistSession: false, autoRefreshToken: false } });
  const hid = randomUUID();
  const { data, error } = await human.rpc('save_entry', { p_key: key, p_entry: { id: hid, line_code: 'D', title: 'TEST parity from human path', initials: 'HUM', status: 'hold' } });
  assert.equal(error, null);
  assert.equal(data.ok, true);
  const board = await c.callTool('board_get', {});
  const row = board.lines.find((l) => l.code === 'D').jobs.find((j) => j.id === hid);
  assert.ok(row, 'agent sees the row written through the human RPC path');
  assert.deepEqual({ t: row.title, i: row.initials, s: row.status }, { t: 'TEST parity from human path', i: 'HUM', s: 'hold' });
  await page.waitForSelector(`.job[data-id="${hid}"]`, { timeout: 5000 }); // and so does the page
  assert.equal(psql(`select count(*) from ergon_warehouse.entries where id in ('${id}','${hid}')`), '2');
  assert.deepEqual(log.errors.filter((e) => !/WebSocket/i.test(e)), []);
  state.page = page;
  state.ctx = ctx;
});

test('PAGE KEY FLOW: the fragment key is consumed, shown as valid for its subject, and enables editing', { skip }, async () => {
  const page = state.page;
  assert.ok(page, 'needs the parity test page');
  assert.doesNotMatch(page.url(), /key=|ergk_/, 'the key must be stripped from the address bar');
  const ks = page.locator('#key-status');
  await ks.waitFor({ timeout: 5000 });
  assert.equal(await ks.getAttribute('data-state'), 'valid');
  assert.equal(await ks.getAttribute('data-subject'), 'TEST Alex Agent');
  const board = page.locator('#board');
  assert.equal(await board.getAttribute('data-can-edit'), 'true');
  assert.equal(await board.getAttribute('data-key-state'), 'valid');
  assert.equal(await page.locator('#lock-btn, #passcode, #unlock-form').count(), 0, 'no passcode UI any more');
  // a second visit without a key: view only, never asks for a secret
  const { ctx } = await newCtx(browser);
  const bare = await ctx.newPage();
  await bare.goto(srv.url);
  await bare.waitForSelector('#board[data-state="ready"]', { timeout: 15000 });
  assert.equal(await bare.locator('#key-status').getAttribute('data-state'), 'none');
  assert.equal(await bare.locator('#board').getAttribute('data-can-edit'), 'false');
  assert.equal(await bare.locator('input[type=password]').count(), 0);
  // an expired key in the fragment is reported, not accepted
  const exp = newKey();
  psql(`insert into ergon_warehouse.access_keys (key_hash, key_prefix, subject, issued_by, created_at, expires_at) values ('${sha(exp)}', '${exp.slice(0, 9)}', 'TEST Expired Ed', 'agent-live-test', now() - interval '2 hours', now() - interval '1 hour')`);
  const stale = await ctx.newPage();
  await stale.goto(`${srv.url}#key=${exp}`);
  await stale.waitForSelector('#key-status[data-state="expired"]', { timeout: 10000 });
  assert.equal(await stale.locator('#board').getAttribute('data-can-edit'), 'false');
  await ctx.close();
  await state.ctx.close();
});
