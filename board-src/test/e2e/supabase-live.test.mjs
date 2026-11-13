// Live two-device test against the LOCAL Supabase stack. Not run by default:
//   (seed with scripts/seed-test.mjs first)  E2E_SUPABASE=1 npm run test:e2e:live
// The stack URL and publishable (anon) key are read at runtime from `supabase status -o env`. Keys are minted with the stand-in issuer
// (ops/keys.mjs mint --db <local db>), delivered in the URL fragment, never printed or written to disk; the test removes the keys it minted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { buildAndServe, launch, newCtx, openBoard, unlock, choose, STATUS_TRIGGER, ROOT } from './helpers.mjs';

const enabled = process.env.E2E_SUPABASE === '1';
const skip = enabled ? false : 'set E2E_SUPABASE=1 to run against the local Supabase stack';

let srv;
let browser;
// A backend that does not have board_token yet answers the probe with a 404 and the board falls back to full reads (documented, unit tested); the browser logs that 404.
const NO_PROBE_404 = /status of 404/;
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql) => execFileSync('psql', ['-X', '-tA', '-v', 'ON_ERROR_STOP=1', DB, '-c', sql], { encoding: 'utf8' }).trim();
const minted = [];
// mint a key for a made-up employee through the stand-in agent tool; the plaintext never leaves this process
function mint(subject, ttl = '1h') {
  const out = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'ops/keys.mjs'), 'mint', '--subject', subject, '--ttl', ttl, '--issuer', 'e2e', '--db', DB, '--json'], { encoding: 'utf8' }));
  minted.push(out.id);
  return out;
}

function stackEnv() {
  const out = execFileSync('supabase', ['status', '-o', 'env'], {
    env: { ...process.env, DOCKER_HOST: process.env.DOCKER_HOST ?? 'unix:///run/user/1000/board-podman.sock' },
    encoding: 'utf8',
  });
  const kv = Object.fromEntries([...out.matchAll(/^([A-Z0-9_]+)="?([^"\n]*)"?$/gm)].map((m) => [m[1], m[2]]));
  const url = kv.API_URL;
  const key = kv.ANON_KEY ?? kv.PUBLISHABLE_KEY;
  assert.ok(url && key, 'supabase status did not report API_URL and ANON_KEY / PUBLISHABLE_KEY');
  return { url, key };
}

before(async () => {
  if (!enabled) return;
  const { url, key } = stackEnv();
  srv = await buildAndServe({ VITE_BACKEND: 'supabase', VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  srv?.stop();
  if (enabled && minted.length) psql(`delete from ergon_warehouse.access_keys where id in (${minted.map((i) => `'${i}'`).join(',')})`);
});

const waitWord = (page, id, word) =>
  page.waitForFunction(([i, w]) => document.querySelector(`.job[data-id="${i}"] .status`)?.textContent === w, [id, word], { timeout: 5000 });

async function editInA(a, id, value) {
  const label = { ready: 'Ready', hold: 'On hold', open: 'Open', done: 'Done' };
  await choose(a, a.locator(`.job[data-id="${id}"] ${STATUS_TRIGGER}`), label[value]);
  await a.waitForSelector(`.job[data-id="${id}"][data-status="${value}"]`);
}

test('realtime: an edit in context A appears in context B within 5s', { skip }, async () => {
  const A = await newCtx(browser);
  const B = await newCtx(browser);
  const k = mint('Live Realtime');
  const a = await openBoard(A.ctx, srv.url, '', { key: k.key });
  const b = await openBoard(B.ctx, srv.url);
  await b.waitForSelector('#conn[data-state="live"]', { timeout: 10000 });
  await a.waitForSelector(STATUS_TRIGGER);
  const id = await a.locator('.job').first().getAttribute('data-id');
  const before = await a.getAttribute(`.job[data-id="${id}"]`, 'data-status');
  const next = before === 'ready' ? 'hold' : 'ready';
  await editInA(a, id, next);
  const label = { ready: 'Ready', hold: 'On hold', open: 'Open', done: 'Done' };
  await waitWord(b, id, label[next]);
  await editInA(a, id, before); // restore
  await waitWord(b, id, label[before]);
  await A.ctx.close();
  await B.ctx.close();
  assert.deepEqual([...A.log.errors, ...B.log.errors].filter((e) => !/WebSocket/i.test(e) && !NO_PROBE_404.test(e)), []);
});

test('polling fallback: with the websocket blocked, B still sees A\'s edit within 5s', { skip }, async () => {
  const A = await newCtx(browser);
  const B = await newCtx(browser);
  await B.ctx.routeWebSocket(/.*/, (ws) => ws.close());
  const k = mint('Live Polling');
  const a = await openBoard(A.ctx, srv.url, '', { key: k.key });
  const b = await openBoard(B.ctx, srv.url);
  await b.waitForSelector('#conn[data-state="polling"]', { timeout: 10000 });
  assert.equal(await b.locator('#conn-label').innerText(), 'Reconnecting');
  await a.waitForSelector(STATUS_TRIGGER);
  const id = await a.locator('.job').first().getAttribute('data-id');
  const before = await a.getAttribute(`.job[data-id="${id}"]`, 'data-status');
  const next = before === 'done' ? 'open' : 'done';
  await editInA(a, id, next);
  const label = { ready: 'Ready', hold: 'On hold', open: 'Open', done: 'Done' };
  await waitWord(b, id, label[next]);
  await editInA(a, id, before); // restore
  await waitWord(b, id, label[before]);
  await A.ctx.close();
  await B.ctx.close();
});


// An agent-side write through the real RPC with a minted key. The SQL (which carries the key) goes in on stdin, never on a command line or into a log.
const rpcWrite = (key, entry) => new Promise((resolve, reject) => {
  const p = spawn('psql', ['-X', '-tA', '-v', 'ON_ERROR_STOP=1', DB], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => (code === 0 && /"ok": ?true/.test(out) ? resolve(JSON.parse(out.trim())) : reject(new Error(`rpc write failed (${code}): ${err.slice(0, 200)} ${out.slice(0, 100)}`))));
  p.stdin.end(`select ergon_warehouse.save_entry('${key.replace(/'/g, "''")}', '${JSON.stringify(entry).replace(/'/g, "''")}'::jsonb);\n`);
});

test('LIVE realtime sequence: 6 pages, an agent write at +0.3, +1.5, +3, +6 and +12 s after each page loads; every page shows every write within 5 s; 5 repetitions; no misses', { skip }, async () => {
  assert.equal(Number(psql('select count(*) from ergon_warehouse.entries where title like \'TEST LIVE seq%\'')), 0);
  const k = mint('Live Sequence', '2h');
  const OFFS = [300, 1500, 3000, 6000, 12000];
  const PAGES = 6;
  const REPS = 5;
  let worst = 0; let misses = 0; let total = 0; const perRep = [];
  for (let rep = 1; rep <= REPS; rep++) {
    const c = await newCtx(browser);
    const pages = await Promise.all(Array.from({ length: PAGES }, () => openBoard(c.ctx, srv.url)));
    const loadedAt = pages.map(() => Date.now());
    await Promise.all(pages.map((pg) => pg.evaluate(() => {
      window.__seen = {};
      const scan = () => { for (const n of document.querySelectorAll('.job .customer')) { const t = n.textContent; if (t.startsWith('TEST LIVE seq') && !(t in window.__seen)) window.__seen[t] = Date.now(); } };
      new MutationObserver(scan).observe(document.getElementById('board'), { childList: true, subtree: true, characterData: true });
      scan();
    })));
    const wrote = {};
    await Promise.all(pages.flatMap((_, i) => OFFS.map((off, j) => new Promise((resolve, reject) => {
      setTimeout(async () => {
        const title = `TEST LIVE seq ${rep}-${i}-${j}`;
        try { await rpcWrite(k.key, { line_code: 'D', title, details: '', initials: '', status: 'open' }); wrote[title] = Date.now(); resolve(); } catch (e) { reject(e); }
      }, Math.max(0, loadedAt[i] + off - Date.now()));
    }))));
    await pages[0].waitForTimeout(5500);
    let repWorst = 0; let repMiss = 0;
    for (const pg of pages) {
      const seen = await pg.evaluate(() => window.__seen);
      for (const [title, at] of Object.entries(wrote)) {
        total++;
        if (!(title in seen)) { misses++; repMiss++; continue; }
        const d = seen[title] - at;
        repWorst = Math.max(repWorst, d);
      }
    }
    worst = Math.max(worst, repWorst);
    perRep.push(`${rep}: worst ${repWorst} ms, misses ${repMiss}`);
    await c.ctx.close();
    psql("delete from ergon_warehouse.entries where title like 'TEST LIVE seq%'");
  }
  console.log(`# LIVE sequence: ${total} deliveries (${REPS} reps x ${PAGES} pages x ${PAGES * OFFS.length} writes); worst delivery ${worst} ms; misses ${misses}; ${perRep.join(' | ')}`);
  assert.equal(misses, 0, 'no page ever stayed stale');
  assert.ok(worst <= 5000, `worst delivery ${worst} ms`);
});


test('LIVE optimistic concurrency through the real RPC: an edit made on a stale revision is refused (conflict), an edit of a deleted job is refused (not_found) and never recreates it', { skip }, async () => {
  const k = mint('Live Concurrency');
  const made = await rpcWrite(k.key, { line_code: 'E', title: 'TEST LIVE concurrency', details: 'one', initials: 'JA', status: 'open' });
  const id = made.entry.id;
  // the server's own answers, then the page's
  const stale = await rpcWrite(k.key, { id, expected_revision: 1, line_code: 'E', title: 'TEST LIVE concurrency', details: 'two', initials: 'JA', status: 'open' });
  assert.equal(stale.entry.revision, 2);
  const A = await newCtx(browser);
  const a = await openBoard(A.ctx, srv.url, '', { key: k.key });
  await a.locator(`.job[data-id="${id}"] .customer-btn`).click();
  await a.waitForSelector('#job-dialog');
  // someone else edits while A has it open: A is told, Save goes off
  await rpcWrite(k.key, { id, expected_revision: 2, line_code: 'E', title: 'TEST LIVE concurrency', details: 'three', initials: 'JA', status: 'open' });
  await a.waitForFunction(() => /changed elsewhere/.test(document.querySelector('#job-msg')?.textContent ?? ''), null, { timeout: 5000 });
  assert.equal(await a.locator('#job-save').isDisabled(), true);
  assert.equal(psql(`select details || '|' || revision from ergon_warehouse.entries where id = '${id}'`), 'three|3');
  await a.click('#job-cancel');
  // deleted elsewhere
  await a.locator(`.job[data-id="${id}"] .customer-btn`).click();
  await a.waitForSelector('#job-dialog');
  psql(`delete from ergon_warehouse.entries where id = '${id}'`);
  await a.waitForFunction(() => /deleted elsewhere/.test(document.querySelector('#job-msg')?.textContent ?? ''), null, { timeout: 5000 });
  assert.equal(await a.locator('#job-save').isDisabled(), true);
  assert.equal(Number(psql(`select count(*) from ergon_warehouse.entries where id = '${id}'`)), 0, 'never recreated');
  // and the RPC itself refuses an edit of a row that is gone
  let refused = false;
  try { await rpcWrite(k.key, { id, expected_revision: 3, line_code: 'E', title: 'x', details: '', initials: '', status: 'open' }); } catch (e) { refused = true; }
  assert.equal(refused, true);
  await A.ctx.close();
});

const DEMO_NOTICE = { none: 'Viewing only. Your agent turns on editing when you open this board through it.', expired: 'Editing has ended. Ask your agent to open this board again.', invalid: 'Editing is not available here. Ask your agent to open this board again.' };
const count = () => Number(psql("select count(*) from ergon_warehouse.entries where title like 'TEST LIVE%'"));

test('LIVE walkthrough through the real RPCs: no key cannot write; a minted key can open details, adjust them, add inline on an occupied and an empty line, delete; reload persists; a second page sees it; revoked and expired keys are refused', { skip }, async () => {
  const A = await newCtx(browser);
  const B = await newCtx(browser);
  const a = await openBoard(A.ctx, srv.url);
  const b = await openBoard(B.ctx, srv.url);
  const rows = (sql) => psql(sql);
  // 1. no key: details open, a plain notice, nothing is written
  assert.equal(await a.getAttribute('#key-status', 'data-state'), 'none');
  const first = a.locator('.job').first();
  const id = await first.getAttribute('data-id');
  await first.locator('.customer-btn').click();
  assert.equal(await a.locator('.key-notice p').innerText(), DEMO_NOTICE.none);
  assert.equal(await a.locator('input[type="password"]').count(), 0);
  const before = rows(`select title || '|' || revision from ergon_warehouse.entries where id = '${id}'`);
  assert.equal(await a.locator('#job-save').isDisabled(), true, 'Save is disabled on a read-only job');
  assert.equal(rows(`select title || '|' || revision from ergon_warehouse.entries where id = '${id}'`), before, 'no key, nothing written');
  await a.click('#job-cancel');
  // 2. a key minted by the stand-in agent tool, delivered in the fragment
  const k = mint('Live Tester');
  await unlock(a, k.key);
  assert.equal(await a.locator('#key-status').innerText(), 'Editing as Live Tester');
  await a.locator(`.job[data-id="${id}"] .customer-btn`).click();
  await a.fill('#f-title', 'TEST LIVE edited');
  await a.fill('#f-details', 'live note');
  await a.fill('#f-initials', 'JA');
  await choose(a, '#f-status', 'Ready');
  await a.click('#job-save');
  await a.waitForSelector(`.job[data-id="${id}"][data-status="ready"]`);
  assert.match(rows(`select title || '|' || details || '|' || initials || '|' || status || '|' || updated_by from ergon_warehouse.entries where id = '${id}'`), /^TEST LIVE edited\|live note\|JA\|ready\|Live Tester$/, 'saved through save_entry, updated_by from the key');
  await b.waitForSelector(`.job[data-id="${id}"][data-status="ready"]`, { timeout: 5000 });
  assert.equal(await b.locator(`.job[data-id="${id}"]`).getAttribute('data-updated-by'), 'Live Tester');
  // 3. inline add on an occupied line and on an empty line
  const occupied = await a.evaluate(() => document.querySelector(".row:not([data-empty])").dataset.line);
  const empty = await a.evaluate(() => document.querySelector('.row[data-empty="true"]').dataset.line);
  for (const [line, title] of [[occupied, 'TEST LIVE inline occupied'], [empty, 'TEST LIVE inline empty']]) {
    await a.click(`[data-add-line="${line}"]`);
    await a.fill(`#add-${line}-title`, title);
    await a.click(`#add-${line}-save`);
    await a.waitForSelector(`.row[data-line="${line}"] .job:has-text("${title}")`);
    assert.equal(rows(`select count(*) from ergon_warehouse.entries e join ergon_warehouse.lines l on l.id = e.line_id where e.title = '${title}' and l.code = '${line}'`), '1', `${title} is in the database on line ${line}`);
  }
  await a.reload();
  await a.waitForSelector(`.job[data-id="${id}"][data-status="ready"]`);
  await a.waitForSelector(`.row[data-line="${empty}"] .job:has-text("TEST LIVE inline empty")`);
  // 4. delete with confirm
  await a.locator(`.row[data-line="${empty}"] .customer-btn`).click();
  await a.click('#job-delete');
  await a.click('#job-delete');
  await a.waitForSelector(`.row[data-line="${empty}"][data-empty="true"]`);
  assert.equal(rows("select count(*) from ergon_warehouse.entries where title = 'TEST LIVE inline empty'"), '0');
  // 5. revoked: refused plainly, nothing saved
  execFileSync(process.execPath, [join(ROOT, 'ops/keys.mjs'), 'revoke', k.id, '--db', DB], { encoding: 'utf8' });
  const n = count();
  await a.click(`[data-add-line="${occupied}"]`);
  await a.fill(`#add-${occupied}-title`, 'TEST LIVE refused revoked');
  await a.click(`#add-${occupied}-save`);
  await a.waitForSelector('.key-notice');
  assert.equal(await a.locator('.key-notice p').innerText(), DEMO_NOTICE.invalid);
  assert.equal(count(), n);
  await a.keyboard.press('Escape');
  // the form fades out in 120 ms and stays in the DOM until then: wait for it to go, so the next panel's notice is the only one (this race failed 7 of 20 runs)
  await a.waitForSelector(`#add-${occupied}-title`, { state: 'detached' });
  // 6. expired: a fresh key whose expiry has passed
  const k2 = mint('Live Expired');
  psql(`update ergon_warehouse.access_keys set expires_at = now() - interval '1 minute' where id = '${k2.id}'`);
  await unlock(a, k2.key, 'expired');
  await a.click('#add-btn');
  await a.fill('#f-title', 'TEST LIVE refused expired');
  assert.equal(await a.locator('#job-save').isDisabled(), true, 'Save is off without a usable key');
  assert.equal(await a.locator('#job-dialog .key-notice p').innerText(), DEMO_NOTICE.expired);
  assert.equal(count(), n);
  await A.ctx.close();
  await B.ctx.close();
  assert.deepEqual([...A.log.errors, ...B.log.errors].filter((e) => !/WebSocket/i.test(e) && !NO_PROBE_404.test(e)), []);
});
