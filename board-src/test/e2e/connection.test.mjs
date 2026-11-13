// Connection honesty on the REAL Supabase adapter (production build, mocked network). Two L5 checker findings:
//  1. a healthy load must never flash "Reconnecting" (the realtime feed confirms a moment after the board lands),
//  2. during a REST outage the indicator must never say "Live" and must say Error within about two seconds.
// REST and the realtime socket are faked in the browser context; nothing leaves the machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildAndServe, launch, newCtx } from './helpers.mjs';

let srv; let browser;
before(async () => {
  srv = await buildAndServe({ VITE_BACKEND: 'supabase', VITE_SUPABASE_URL: 'https://fake.invalid', VITE_SUPABASE_ANON_KEY: 'sb_publishable_fake' });
  browser = await launch();
});
after(async () => { await browser?.close(); srv?.stop(); });

const LINES = 'ABCDEFGHIJKLMNOPQRS'.split('').map((code, i) => ({ id: `l${i}`, code, sort_order: i, is_test: false, created_at: '2026-11-01T00:00:00Z' }));
const ENTRIES = [{ id: 'e1', line_id: 'l0', title: 'Harbour Bakery', details: 'Pallet 4', initials: 'JA', status: 'open', revision: 1, is_test: false, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', updated_by: 'x' }];
const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': '*' }, body: JSON.stringify(body) });

// the mocked world: REST answers until `net.down`, the socket confirms its bindings `confirmMs` after the join
async function world(ctx, { confirmMs = 270 } = {}) {
  const net = { down: false };
  await ctx.route('https://fake.invalid/rest/v1/**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (net.down) return route.abort('failed');
    const u = route.request().url();
    if (u.includes('/rpc/board_token')) return route.fulfill(json({ l: LINES.length, f: 1, e: ENTRIES.length, u: '2026-11-01T00:00:00Z', r: 1 }));
    if (u.includes('/lines')) return route.fulfill(json(LINES));
    return route.fulfill(json(ENTRIES));
  });
  await ctx.routeWebSocket(/fake\.invalid\/realtime/, (ws) => {
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      const [joinRef, ref, topic, event] = Array.isArray(m) ? m : [m.join_ref, m.ref, m.topic, m.event];
      const reply = (e, payload, r = ref) => ws.send(JSON.stringify(Array.isArray(m) ? [joinRef, r, topic, e, payload] : { join_ref: joinRef, ref: r, topic, event: e, payload }));
      if (event === 'heartbeat') return reply('phx_reply', { status: 'ok', response: {} });
      if (event === 'phx_join') {
        reply('phx_reply', { status: 'ok', response: { postgres_changes: [{ id: 1, event: '*', schema: 'ergon_warehouse', table: 'lines' }, { id: 2, event: '*', schema: 'ergon_warehouse', table: 'entries' }] } });
        setTimeout(() => ws.send(JSON.stringify(Array.isArray(m) ? [null, null, topic, 'system', { extension: 'postgres_changes', status: 'ok', message: 'ok', channel: 'board' }] : { join_ref: null, ref: null, topic, event: 'system', payload: { extension: 'postgres_changes', status: 'ok', message: 'ok', channel: 'board' } })), confirmMs);
      }
    });
  });
  return net;
}

// every label the indicator ever shows, with the time it first showed
const watchLabel = (page) => page.evaluate(() => {
  window.__seen = [];
  const t0 = performance.now();
  window.__t0 = t0;
  const rec = () => { const el = document.querySelector('#conn-label'); const v = el ? el.textContent.trim() : null; const last = window.__seen[window.__seen.length - 1]; if (v !== null && (!last || last.v !== v)) window.__seen.push({ v, at: Math.round(performance.now() - t0) }); };
  new MutationObserver(rec).observe(document, { subtree: true, childList: true, characterData: true });
  rec();
});

// Timing assertions use the page's own clock. The harness figure ("how long until Playwright saw the label") also contains up to a few hundred
// ms of polling and scheduling on a loaded host: measured here, the app's Error arrives at about 2630 ms while the harness reported about 2900 ms,
// and one loaded run reported 3042 ms - the app met its promise and the harness missed the deadline. `mark` is set just before a failure is
// triggered, so a mid-flight interval is measured from inside the page (a round trip late, which can only shorten the interval by ~10 ms).
const mark = (page) => page.evaluate(() => { window.__mark = performance.now(); });
// Returns the interval, or a string saying why it could not be measured: a null must never compare as a pass (`null <= 2800` is true),
// and a sighting recorded before the mark would give a negative interval for the same reason.
const msSinceMark = (page, label) => page.evaluate((l) => {
  const e = window.__seen.find((x) => x.v === l);
  if (!e) return `the label never showed ${l}`;
  if (window.__mark == null || window.__t0 == null) return 'no mark was taken';
  const ms = Math.round(e.at - (window.__mark - window.__t0));
  return ms < 0 ? `the ${l} sighting predates the mark (${ms} ms)` : ms;
}, label);
const within = (ms, bound, what) => {
  assert.equal(typeof ms, 'number', `could not measure ${what}: ${ms}`);
  assert.ok(ms <= bound, `${what} after ${ms} ms (bound ${bound})`);
};
const shownAt = (page, label) => page.evaluate((l) => (window.__seen.find((x) => x.v === l) ?? {}).at, label);

test('a healthy load never shows Reconnecting: blank until the feed confirms, then Live', async () => {
  const { ctx } = await newCtx(browser);
  await world(ctx, { confirmMs: 270 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__early = []; });
  await page.goto(srv.url);
  await watchLabel(page);
  await page.waitForSelector('#conn-label:text("Live")', { timeout: 8000 });
  const seen = await page.evaluate(() => window.__seen.map((s) => s.v));
  assert.ok(!seen.includes('Reconnecting'), `labels shown: ${JSON.stringify(seen)}`);
  assert.equal(await page.getAttribute('#conn', 'data-state'), 'live');
  // the live head hides the marker with the `hidden` attribute (innerText falls back to textContent there), so ask whether it renders
  assert.equal(await page.locator('#test-marker').isVisible(), false, 'real (non-TEST) rows: the test-data marker is not on screen');
  await ctx.close();
});

test('a REST outage while the feed stays up: never Live afterwards, Error within 2.8 s', async () => {
  const { ctx } = await newCtx(browser);
  const net = await world(ctx);
  const page = await ctx.newPage();
  await page.goto(srv.url);
  await page.waitForSelector('#conn-label:text("Live")', { timeout: 8000 });
  await watchLabel(page);
  net.down = true;
  await mark(page);
  await page.waitForSelector('#conn-label:text("Error")', { timeout: 6000 });
  within(await msSinceMark(page, 'Error'), 2800, 'Error (page clock)');
  const seen = await page.evaluate(() => window.__seen.map((s) => s.v));
  assert.ok(!seen.slice(seen.indexOf('Error')).includes('Live'), `Live shown after the outage began: ${JSON.stringify(seen)}`);
  // recovery: back up, the label returns to Live and stays honest
  net.down = false;
  await page.waitForSelector('#conn-label:text("Live")', { timeout: 15000 });
  await ctx.close();
});

test('a REST outage that hangs instead of failing is also an Error within 3 s', async () => {
  const { ctx } = await newCtx(browser);
  const net = await world(ctx);
  const page = await ctx.newPage();
  await page.goto(srv.url);
  await page.waitForSelector('#conn-label:text("Live")', { timeout: 8000 });
  await watchLabel(page);
  await ctx.unroute('https://fake.invalid/rest/v1/**');
  await ctx.route('https://fake.invalid/rest/v1/**', () => { /* never answers */ });
  await mark(page);
  await page.waitForSelector('#conn-label:text("Error")', { timeout: 6000 });
  within(await msSinceMark(page, 'Error'), 3000, 'Error on a hung path (page clock)');
  void net;
  await ctx.close();
});

// the labels the indicator shows, sampled from the DOM at every mutation, for `ms` after navigation
const labelsFor = async (page, ms) => { await page.waitForTimeout(ms); return page.evaluate(() => window.__seen.map((x) => x.v)); };

test('the first read hangs: the indicator is never Live, and says Error within 3 s', async () => {
  const { ctx } = await newCtx(browser);
  await world(ctx);
  await ctx.unroute('https://fake.invalid/rest/v1/**');
  await ctx.route('https://fake.invalid/rest/v1/**', () => { /* never answers */ });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__seen = []; const t0 = performance.now(); const rec = () => { const el = document.querySelector('#conn-label'); const v = el ? el.textContent.trim() : null; const l = window.__seen[window.__seen.length - 1]; if (v !== null && (!l || l.v !== v)) window.__seen.push({ v, at: Math.round(performance.now() - t0) }); }; new MutationObserver(rec).observe(document, { subtree: true, childList: true, characterData: true }); });
  await page.goto(srv.url);
  await page.waitForSelector('#conn-label:text("Error")', { timeout: 8000 });
  const firstRead = await shownAt(page, 'Error');
  assert.ok(firstRead <= 3000, `Error after ${firstRead} ms (page clock, from document start)`);
  const seen = await labelsFor(page, 200);
  assert.ok(!seen.includes('Live'), `labels shown: ${JSON.stringify(seen)}`);
  // The false claim this branch is named after, in its last hiding place: a page that never connected has nothing to reconnect
  // TO. Measured before the fix: "Reconnecting" at 1577 ms, then Error at 2577 ms.
  assert.ok(!seen.includes('Reconnecting'), `"Reconnecting" on a page that never connected: ${JSON.stringify(seen)}`);
  await ctx.close();
});

test('the first read is refused at the network level: never Live, Error within 3 s', async () => {
  const { ctx } = await newCtx(browser);
  const net = await world(ctx);
  net.down = true;
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__seen = []; const t0 = performance.now(); const rec = () => { const el = document.querySelector('#conn-label'); const v = el ? el.textContent.trim() : null; const l = window.__seen[window.__seen.length - 1]; if (v !== null && (!l || l.v !== v)) window.__seen.push({ v, at: Math.round(performance.now() - t0) }); }; new MutationObserver(rec).observe(document, { subtree: true, childList: true, characterData: true }); });
  await page.goto(srv.url);
  await page.waitForSelector('#conn-label:text("Error")', { timeout: 10000 });
  const refused = await shownAt(page, 'Error');
  assert.ok(refused <= 3000 + 1000, `Error after ${refused} ms (page clock, page load included)`);
  const seen = await labelsFor(page, 200);
  assert.ok(!seen.includes('Live'), `labels shown: ${JSON.stringify(seen)}`);
  await ctx.close();
});

test('a slow but working server (1.2 s answers) is never called an outage', async () => {
  const { ctx } = await newCtx(browser);
  await world(ctx);
  const page = await ctx.newPage();
  await page.goto(srv.url);
  await page.waitForSelector('#conn-label:text("Live")', { timeout: 8000 });
  await ctx.unroute('https://fake.invalid/rest/v1/**');
  await ctx.route('https://fake.invalid/rest/v1/**', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    const u = route.request().url();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    return route.fulfill(json(u.includes('/rpc/board_token') ? { l: LINES.length, f: 1, e: ENTRIES.length, u: '2026-11-01T00:00:00Z', r: 1 } : u.includes('/lines') ? LINES : ENTRIES));
  });
  await page.waitForTimeout(7000);
  assert.equal(await page.locator('#conn-label').innerText(), 'Live');
  await ctx.close();
});

test('a browser online/offline blip: the word Reconnecting is never in the page for a 400 ms blip', async () => {
  const { ctx } = await newCtx(browser);
  await world(ctx);
  const page = await ctx.newPage();
  await page.goto(srv.url);
  await page.waitForSelector('#conn-label:text("Live")', { timeout: 8000 });
  await page.evaluate(() => { window.__w = []; new MutationObserver(() => { const t = document.querySelector('#conn-label')?.textContent.trim(); if (t) window.__w.push(t); }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
  await page.evaluate(() => window.dispatchEvent(new Event('offline'))); // a blip of the browser's own network flag, 400 ms
  await page.waitForTimeout(400);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(2500);
  const w = await page.evaluate(() => window.__w);
  assert.ok(!w.includes('Reconnecting'), `words in the page: ${JSON.stringify(w)}`);
  await ctx.close();
});

test('a uniformly slow network (2 s and 3 s answers) is not branded an outage: low Error duty and a Live label at the end', async () => {
  // One instant of an oscillating signal proves nothing (the old version sampled once and passed on the good phase while the 3 s
  // case was cycling Error -> Live every 4 s, Error 36 % of the run). This samples the label every 100 ms for 12 s.
  for (const latency of [2000, 3000]) {
    const { ctx } = await newCtx(browser);
    await world(ctx);
    const page = await ctx.newPage();
    await page.goto(srv.url);
    await page.waitForSelector('#conn-label:text("Live")', { timeout: 8000 });
    await ctx.unroute('https://fake.invalid/rest/v1/**');
    await ctx.route('https://fake.invalid/rest/v1/**', async (route) => {
      await new Promise((r) => setTimeout(r, latency));
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      const u = route.request().url();
      if (u.includes('/rpc/board_token')) return route.fulfill(json({ l: LINES.length, f: 1, e: ENTRIES.length, u: '2026-11-01T00:00:00Z', r: 1 }));
      if (u.includes('/lines')) return route.fulfill(json(LINES));
      return route.fulfill(json(ENTRIES));
    });
    const run = await page.evaluate((ms) => new Promise((res) => {
      const t0 = performance.now(); let err = 0; let n = 0; let lateErr = 0; let lateN = 0;
      const id = setInterval(() => {
        const el = document.querySelector('#conn-label');
        const v = el ? el.textContent.trim() : '';
        const t = performance.now() - t0;
        n += 1;
        if (v === 'Error') err += 1;
        if (t >= ms - 5000) { lateN += 1; if (v === 'Error') lateErr += 1; }
        if (t >= ms) { clearInterval(id); res({ frac: err / Math.max(1, n), lateFrac: lateErr / Math.max(1, lateN), final: v, n }); }
      }, 100);
    }), 12000);
    const pct = Math.round(run.frac * 100);
    // One probe's worth of Error while the link changes speed is the honest cost of naming a hang quickly; what must not happen is
    // the label staying wrong, or coming back. So the last five seconds must be clean, and the whole run must be mostly Live.
    assert.ok(run.frac <= 0.20, `${latency} ms answers: Error for ${pct}% of a 12 s run (${run.n} samples) - the server was answering`);
    assert.equal(run.lateFrac, 0, `${latency} ms answers: still saying Error in the last 5 s (${Math.round(run.lateFrac * 100)}%)`);
    assert.equal(run.final, 'Live', `${latency} ms answers: the label ended as ${JSON.stringify(run.final)} after ${pct}% Error`);
    await ctx.close();
  }
});

test('the documented data-state never says live before a board has been read', async () => {
  const { ctx } = await newCtx(browser);
  await world(ctx);
  await ctx.unroute('https://fake.invalid/rest/v1/**');
  await ctx.route('https://fake.invalid/rest/v1/**', () => { /* never answers */ });
  const page = await ctx.newPage();
  await page.goto(srv.url);
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const st = await page.evaluate(() => ({ s: document.querySelector('#conn')?.dataset.state ?? null, rows: document.querySelectorAll('.job').length }));
    if (st.s) seen.push(st);
    await page.waitForTimeout(150);
  }
  const unread = seen.filter((x) => x.rows === 0);
  assert.ok(unread.length > 0, 'the first read never answered, so there is an unread window to sample');
  assert.ok(unread.every((x) => x.s !== 'live'), `data-state said live with nothing read: ${JSON.stringify(unread)}`);
  await ctx.close();
});

test('a hung read path never piles up probes: at most three starts in 9 s, and after the setup nothing keeps starting', async () => {
  const { ctx } = await newCtx(browser);
  await world(ctx);
  const page = await ctx.newPage();
  await page.goto(srv.url);
  await page.waitForSelector('#conn-label:text("Live")', { timeout: 8000 });
  // What is counted is requests *started* against a path that never answers: a route that never fulfils cannot be observed finishing, so
  // "in flight" and "started" are the same number here, and the honest thing to assert is how many the app began in the window. Two callers
  // share this read path (the indicator's probe and the store's reconcile read), each keeps at most one outstanding, and a retry after a
  // failure is the only third. The pathology this test exists for is one request per interval, i.e. 6 or more in this window.
  const starts = []; const t0 = Date.now();
  await ctx.unroute('https://fake.invalid/rest/v1/**');
  await ctx.route('https://fake.invalid/rest/v1/**', () => { starts.push(Date.now() - t0); /* never answers */ });
  await page.waitForTimeout(9000);
  assert.ok(starts.length <= 3, `${starts.length} requests started in 9 s against a hung path: a dead path is piling them up`);
  // The property the old test was named for, in the form this route can actually show. A pairwise "no two starts close together" rule was
  // tried and thrown out: two independent callers (the indicator's probe and the store's reconcile read) legitimately began 327 ms apart
  // in 1 of 12 runs, so that rule failed correct code, while a genuine duplicate probe 1.6 s late slipped through it. What separates a
  // pile-up from that legitimate pair is WHEN they start: the pair happens during setup, a pile-up keeps going. So after the first 5 s,
  // at most one start is allowed. Measured sequences: 0.55 s and 3.9 s; 0.68 s, 1.01 s and 3.99 s. A regression to one probe per
  // interval would put four starts in the last 4 s, and two per interval eight.
  const late = starts.filter((t) => t >= 5000).length;
  assert.ok(late <= 1, `${late} requests started in the last 4 s of a 9 s window against a hung path (starts at ${JSON.stringify(starts)} ms): a dead path is piling them up`);
  assert.equal(await page.locator('#conn-label').innerText(), 'Error');
  await ctx.close();
});

