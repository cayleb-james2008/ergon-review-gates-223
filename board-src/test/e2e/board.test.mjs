import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { buildAndServe, launch, newCtx, openBoard, unlock, choose, STATUS_TRIGGER, DEMO_KEY, DEMO_KEYS } from './helpers.mjs';

let srv;
let browser;
const open = [];

before(async () => {
  srv = await buildAndServe({ VITE_BACKEND: 'demo' });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  srv?.stop();
});

// Each test gets a fresh context (own localStorage) and fails on any console error / failed request.
async function ctxFor(t, opts, { allowFailed = false } = {}) {
  const c = await newCtx(browser, opts);
  t.after(async () => {
    await c.ctx.close();
    assert.deepEqual(c.log.errors, [], 'console errors');
    if (!allowFailed) assert.deepEqual(c.log.failed, [], 'failed requests');
  });
  return c;
}
const text = (page, sel) => page.locator(sel).first().innerText();

test('C1/C7: exactly 19 rows A..S, TEST DATA marker, Live indicator, logo loads', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  const labels = await page.$$eval('.row .label', (n) => n.map((x) => x.textContent));
  assert.equal(labels.join(''), 'ABCDEFGHIJKLMNOPQRS');
  assert.equal(await page.locator('#test-marker').isVisible(), true);
  assert.equal(await text(page, '#test-marker'), 'Test data');
  await page.waitForSelector('#conn[data-state="live"]');
  assert.equal(await text(page, '#conn-label'), 'Live');
  assert.ok(await page.evaluate(() => { const i = [...document.querySelectorAll('.logo')].find((n) => n.offsetParent !== null); return !!i && i.complete && i.naturalWidth > 0; }), 'real RHL logo rendered');
  // jobs show a status WORD; lines with no jobs say so; boxes share the row
  assert.equal(await page.locator('.status').first().innerText(), 'Open');
  assert.equal(await text(page, '.row[data-line="D"] .no-jobs'), 'No jobs');
  assert.equal(await page.locator('.row[data-line="C"] .job').count(), 3);
  const widths = await page.$$eval('.row[data-line="C"] .job', (n) => n.map((x) => Math.round(x.getBoundingClientRect().width)));
  assert.ok(Math.max(...widths) - Math.min(...widths) <= 2, `boxes share the row equally ${widths}`);
});

test('loading state shows skeleton rows, then the board', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await ctx.newPage();
  await page.goto(srv.url + '?demo=slow');
  await page.waitForSelector('#board[data-state="loading"]');
  assert.equal(await page.locator('#board').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('.row').count(), 19);
  assert.ok((await page.locator('.skel').count()) >= 19);
  await page.waitForSelector('#board[data-state="ready"]');
  assert.equal(await page.locator('.skel').count(), 0);
});

test('empty states: zero lines = full-board message; lines without jobs = per-line "No jobs"; wrong line count warns', async (t) => {
  const { ctx } = await ctxFor(t);
  let page = await openBoard(ctx, srv.url, 'nolines');
  assert.match(await text(page, '#board'), /No lines are set up yet\./);
  assert.equal(await page.locator('#banners .banner').count(), 0, 'one message, not two');
  await page.close();
  page = await openBoard(ctx, srv.url, 'empty');
  assert.equal(await page.locator('.row').count(), 19);
  assert.equal(await page.locator('.no-jobs').count(), 19);
  assert.equal(await page.locator('#test-marker').isVisible(), true);
  await page.close();
  page = await openBoard(ctx, srv.url, 'lines=5');
  assert.equal(await page.locator('.row').count(), 19);
  assert.match(await text(page, '#banners'), /Only 5 of 19 lines are set up\./);
});

test('error state: first load failure shows a message with Retry, then recovers; later failure keeps the last good board', async (t) => {
  const { ctx } = await ctxFor(t);
  let page = await openBoard(ctx, srv.url, 'fail');
  assert.match(await text(page, '#board'), /could not be loaded/);
  assert.equal(await text(page, '#conn-label'), 'Error');
  await page.evaluate(() => { window.__rhlDemo.offline = false; });
  await page.click('#board >> text=Retry');
  await page.waitForSelector('#board[data-state="ready"]');
  await page.waitForSelector('#conn[data-state="live"]');
  // now break it again: last good board must stay visible, banner offers Retry
  await page.evaluate(() => { window.__rhlDemo.offline = true; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForSelector('#conn[data-state="error"]');
  assert.match(await text(page, '#banners'), /Showing the last saved board/);
  assert.equal(await page.locator('.row').count(), 19);
  assert.ok((await page.locator('.job').count()) > 5);
  await page.evaluate(() => { window.__rhlDemo.offline = false; });
  await page.click('#banners >> text=Retry');
  await page.waitForSelector('#conn[data-state="live"]');
  assert.equal(await page.locator('#banners .banner').count(), 0);
});

test('C2: change a status with a valid key: no prompt, it saves, and it persists after a reload', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url, '', { key: DEMO_KEY });
  page.on('dialog', () => assert.fail('window.prompt must not be used'));
  assert.equal(await page.locator('input[type="password"]').count(), 0, 'nothing ever asks for a secret');
  assert.ok((await page.locator(STATUS_TRIGGER).count()) >= 14, 'status controls on every card');
  const job = page.locator('.job', { hasText: 'TEST Harbour Bakery' });
  const id = await job.getAttribute('data-id');
  await choose(page, job.locator(STATUS_TRIGGER), 'Done');
  await page.waitForSelector(`.job[data-id="${id}"][data-status="done"]`);
  assert.equal(await page.locator('#job-dialog').count(), 0, 'a valid key just works: no dialog, no prompt');
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage)).then((x) => x.includes('demo-employee')), false, 'the key is never in localStorage');
  await page.reload();
  await page.waitForSelector('#board[data-state="ready"]');
  assert.equal(await page.getAttribute(`.job[data-id="${id}"]`, 'data-status'), 'done');
  assert.equal(await page.getAttribute('#key-status', 'data-state'), 'valid', 'the key survives a reload of the same tab');
});

test('add, edit and delete a job with a valid key; a key revoked mid-session is refused with a plain notice and nothing is saved', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url, 'empty', { key: DEMO_KEY });
  await page.click('#add-btn');
  await choose(page, '#f-line', 'Line F');
  await page.fill('#f-title', 'TEST Added Co');
  await page.fill('#f-details', 'two cages');
  await page.fill('#f-initials', 'ZZ');
  await choose(page, '#f-status', 'On hold');
  await page.click('#job-save');
  await page.waitForSelector('.row[data-line="F"] .job');
  assert.equal(await text(page, '.row[data-line="F"] .customer'), 'TEST Added Co');
  assert.equal(await page.getAttribute(`.row[data-line="F"] ${STATUS_TRIGGER}`, 'data-status'), 'hold');
  // edit via dialog
  await page.click('.row[data-line="F"] .customer-btn');
  await page.fill('#f-title', 'TEST Renamed Co');
  await page.click('#job-save');
  await page.waitForSelector('.row[data-line="F"] .customer:has-text("TEST Renamed Co")');
  assert.equal(await page.locator('.row[data-line="F"] .job').count(), 1);
  // the key is revoked while the board is open: the next write is refused, the panel says so in plain words, nothing is saved
  await page.evaluate(() => sessionStorage.setItem('rhl.key', 'demo-revoked'));
  await page.reload();
  await page.waitForSelector('#key-status[data-state="invalid"]');
  await page.click('.row[data-line="F"] .customer-btn');
  assert.equal(await text(page, '.key-notice p'), 'Editing is not available here. Ask your agent to open this board again.');
  await page.click('#job-cancel');
  assert.equal(await text(page, '.row[data-line="F"] .customer'), 'TEST Renamed Co');
  await unlock(page);
  // delete
  await page.click('.row[data-line="F"] .customer-btn');
  await page.click('#job-delete');
  await page.click('#job-delete'); // confirm
  await page.waitForSelector('.row[data-line="F"][data-empty="true"]');
});

test('C3: a second page of the same origin sees the edit within 5 seconds', async (t) => {
  const { ctx } = await ctxFor(t);
  const a = await openBoard(ctx, srv.url);
  const b = await openBoard(ctx, srv.url);
  await unlock(a);
  const job = a.locator('.job', { hasText: 'TEST Beacon Hardware' });
  const id = await job.getAttribute('data-id');
  await choose(a, job.locator(STATUS_TRIGGER), 'Ready');
  const t0 = Date.now();
  await b.waitForFunction((i) => document.querySelector(`.job[data-id="${i}"] .status`)?.textContent === 'Ready', id, { timeout: 5000 });
  assert.ok(Date.now() - t0 < 5000);
});

test('C4: offline shows the banner and pauses editing; coming back clears it and refetches', async (t) => {
  const { ctx } = await ctxFor(t, undefined, { allowFailed: true });
  const page = await openBoard(ctx, srv.url);
  await unlock(page);
  await page.waitForSelector(STATUS_TRIGGER);
  await ctx.setOffline(true);
  await page.waitForSelector('#conn[data-state="offline"]');
  assert.equal(await text(page, '#banners .banner span'), 'Showing the last saved board. Editing is paused.');
  assert.equal(await page.locator('#banners button:has-text("Retry")').count(), 1, 'the offline banner has a Retry');
  assert.equal(await text(page, '#conn-label'), 'Offline');
  assert.equal(await page.locator('#add-btn').isDisabled(), true);
  assert.equal(await page.locator(STATUS_TRIGGER).first().isDisabled(), true);
  assert.equal(await page.locator('.job').count() > 5, true, 'last known board stays visible');
  assert.equal(await text(page, '#live-text'), '14 jobs', 'each fact once: the banner says editing is paused, the status line does not repeat it');
  assert.equal(await page.getAttribute('#board', 'data-can-edit'), 'false');
  await ctx.setOffline(false);
  await page.waitForSelector('#conn[data-state="live"]');
  assert.equal(await page.locator('#banners .banner').count(), 0);
  assert.equal(await page.locator('#add-btn').isDisabled(), false);
  assert.equal(await page.getAttribute('#board', 'data-can-edit'), 'true');
});

test('search dims non-matching jobs and lines, highlights matches, and clears', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  await page.fill('#search', 'harbour');
  assert.equal(await page.locator('.job.hit').count(), 1);
  assert.match(await text(page, '.job.hit'), /Harbour/);
  assert.ok((await page.locator('.job.dim').count()) >= 10);
  assert.equal(await page.locator('.row.dim').count(), 18);
  assert.match(await text(page, '#live-text'), /1 of 14 jobs match/);
  await page.fill('#search', 'zzzz-nothing');
  assert.equal(await page.locator('.job.hit').count(), 0);
  assert.equal(await page.locator('.row.dim').count(), 19);
  await page.fill('#search', '');
  assert.equal(await page.locator('.dim, .hit').count(), 0);
  await page.fill('#search', 'ready');
  assert.ok((await page.locator('.job.hit').count()) >= 3);
  await page.press('#search', 'Escape');
  assert.equal(await page.locator('.dim, .hit').count(), 0);
});

test('bubble: drags, stays inside the viewport, keeps its position after reload, moves with arrow keys', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  const box = () => page.locator('#bubble').boundingBox();
  const vw = 1920, vh = 1080;
  const b0 = await box();
  const g = await page.locator('#grip').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  // the default home is centre-bottom, so the drag goes up and left
  await page.mouse.move(g.x + g.width / 2 - 300, g.y + g.height / 2 - 300, { steps: 6 });
  await page.mouse.up();
  const b1 = await box();
  assert.ok(Math.abs(b1.x - (b0.x - 300)) <= 2 && Math.abs(b1.y - (b0.y - 300)) <= 2, `moved by drag ${JSON.stringify([b0, b1])}`);
  // fling far outside: must clamp
  const g1 = await page.locator('#grip').boundingBox();
  await page.mouse.move(g1.x + 5, g1.y + 5);
  await page.mouse.down();
  await page.mouse.move(vw + 800, vh + 800, { steps: 6 });
  await page.mouse.up();
  const b2 = await box();
  assert.ok(b2.x >= 0 && b2.y >= 0 && b2.x + b2.width <= vw && b2.y + b2.height <= vh, `inside viewport ${JSON.stringify(b2)}`);
  await page.reload();
  await page.waitForSelector('#board[data-state="ready"]');
  const b3 = await box();
  assert.ok(Math.abs(b3.x - b2.x) <= 1 && Math.abs(b3.y - b2.y) <= 1, 'position remembered');
  // keyboard
  await page.focus('#grip');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  const b4 = await box();
  assert.ok(Math.abs(b4.x - (b3.x - 12)) <= 1 && Math.abs(b4.y - (b3.y - 12)) <= 1, 'arrow keys move it');
  // typing in the search box must not drag
  await page.click('#search');
  await page.keyboard.type('abc');
  const b5 = await box();
  assert.equal(Math.round(b5.x), Math.round(b4.x));
});

test('floating layer and fit: the bubble has a translucent fill and a 1px border (no blur, no shadow); the board fits with no page scroll (1920x1080, 1366x768, 1280x720)', async (t) => {
  for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720]]) {
    const { ctx } = await ctxFor(t, { viewport: { width: w, height: h } });
    const page = await openBoard(ctx, srv.url);
    const m = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.row')];
      const last = rows.at(-1).getBoundingClientRect();
      const b = getComputedStyle(document.querySelector('#bubble'));
      const br = document.querySelector('#bubble').getBoundingClientRect();
      return { bubbleH: br.height, bubbleTop: br.top, sh: document.scrollingElement.scrollHeight, sw: document.scrollingElement.scrollWidth, ih: innerHeight, iw: innerWidth,
        lastBottom: last.bottom, rowH: rows.map((r) => r.getBoundingClientRect().height),
        boardScroll: document.querySelector('#board').scrollHeight - document.querySelector('#board').clientHeight,
        bg: b.backgroundColor, border: b.borderTopWidth, filter: b.backdropFilter, shadow: b.boxShadow };
    });
    assert.ok(m.sh <= m.ih && m.sw <= m.iw, `${w}x${h}: no page scroll ${JSON.stringify([m.sh, m.ih])}`);
    assert.ok(m.boardScroll <= 0, `${w}x${h}: board does not scroll`);
    // the dock: a strip under the board for the bubble (its height + 8px above + 8px below), so by default the bubble covers no row
    assert.ok(m.ih - m.lastBottom >= m.bubbleH + 16 - 1 && m.ih - m.lastBottom <= m.bubbleH + 16 + 16,  `${w}x${h}: the board ends one dock above the page bottom (${m.ih - m.lastBottom}px, the last row ends 8px above the board edge for its focus ring, bubble ${m.bubbleH}px)`);
    assert.ok(m.bubbleTop >= m.lastBottom, `${w}x${h}: the bubble sits in the dock and covers no row (bubble top ${m.bubbleTop}, last row bottom ${m.lastBottom})`);
    assert.ok(Math.max(...m.rowH) - Math.min(...m.rowH) <= 2, 'rows share the height');
    assert.match(m.bg, /^rgba\(\d+, \d+, \d+, 0\.\d+\)$/, 'bubble fill is translucent (alpha only)');
    assert.equal(m.border, '1px');
    assert.equal(m.filter, 'none');
    assert.equal(m.shadow, 'none');
    await page.screenshot({ path: process.env.E2E_SHOTS ? `${process.env.E2E_SHOTS}/e2e-${w}x${h}.png` : undefined, type: 'png' }).catch(() => {});
  }
});

test('narrow phone: page does not scroll, the board scrolls inside itself', async (t) => {
  const { ctx } = await ctxFor(t, { viewport: { width: 390, height: 844 } });
  const page = await openBoard(ctx, srv.url);
  const m = await page.evaluate(() => ({ sh: document.scrollingElement.scrollHeight, ih: innerHeight, sw: document.scrollingElement.scrollWidth, iw: innerWidth,
    inner: document.querySelector('#board').scrollHeight > document.querySelector('#board').clientHeight }));
  assert.ok(m.sh <= m.ih && m.sw <= m.iw);
  assert.equal(m.inner, true);
});

test('prints on exactly one landscape page with the bubble hidden', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  await unlock(page);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('#bubble').isVisible(), false);
  const pdf = await page.pdf({ landscape: true, preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  assert.equal(pages, 1);
  const size = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
  assert.ok(size && Number(size[1]) > Number(size[2]), `landscape MediaBox ${size?.slice(1)}`);
});

test('print is paper in either theme: white page, ink text, dark logo, one page', async (t) => {
  const { ctx } = await ctxFor(t, { colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(srv.url + '?theme=dark');
  await page.waitForSelector('#board[data-state="ready"]');
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  const m = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.querySelector('.customer')).color,
    logo: [...document.querySelectorAll('.logo')].find((i) => i.offsetParent)?.getAttribute('src'), marker: getComputedStyle(document.querySelector('.row:not([data-empty]) .label')).backgroundColor }));
  assert.equal(m.bg, 'rgb(255, 255, 255)');
  assert.equal(m.ink, 'rgb(17, 20, 24)');
  assert.equal(m.logo, '/rhl-logo.svg');
  assert.equal(m.marker, 'rgb(17, 20, 24)');
  const pdf = await page.pdf({ landscape: true, preferCSSPageSize: true, printBackground: true });
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length, 1);
});

test('request audit: only same-origin requests, no failures, no console errors across a full session', async (t) => {
  const { ctx, log } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  await unlock(page);
  await choose(page, page.locator(STATUS_TRIGGER).first(), 'On hold');
  await page.fill('#search', 'test');
  await page.click('#add-btn');
  await page.click('#job-cancel');
  await page.reload();
  await page.waitForSelector('#board[data-state="ready"]');
  const origin = new URL(srv.url).origin;
  const external = log.requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
  assert.deepEqual(external, [], 'no external requests');
  assert.ok(log.requests.length >= 3);
});

test('accessibility basics: labelled controls, aria-live status, visible focus ring', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  assert.equal(await page.locator('#live-text').getAttribute('aria-live'), 'polite');
  assert.equal(await page.locator('label[for="search"]').count(), 1);
  await page.focus('#add-btn');
  const ring = await page.$eval('#add-btn', (b) => getComputedStyle(b).outlineWidth + ' ' + getComputedStyle(b).outlineStyle);
  assert.equal(ring, '2px solid');
  const dec = await page.evaluate(() => getComputedStyle(document.querySelector('.label')).textTransform + getComputedStyle(document.querySelector('.note')).letterSpacing);
  assert.ok(!dec.includes('uppercase'));
});

test('the bubble starts centre-bottom of the viewport (and is draggable, tested above); job text keeps the 12px floor', async (t) => {
  for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720]]) {
    const { ctx } = await ctxFor(t, { viewport: { width: w, height: h } });
    const page = await openBoard(ctx, srv.url);
    const m = await page.evaluate(() => {
      const b = document.querySelector('#bubble').getBoundingClientRect();
      const cs = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
      return { cx: Math.round(b.left + b.width / 2), bottom: Math.round(innerHeight - b.bottom), vw: innerWidth, jobFont: cs('.customer'), noteFont: cs('.note'), pillFont: cs('.status') };
    });
    assert.ok(Math.abs(m.cx - m.vw / 2) <= 2, `${w}x${h}: horizontally centred ${JSON.stringify(m)}`);
    assert.ok(m.bottom >= 8 && m.bottom <= 24, `${w}x${h}: near the bottom edge ${JSON.stringify(m)}`);
    assert.ok(m.jobFont >= 12 && m.noteFont >= 12 && m.pillFont >= 12, `${w}x${h}: job text >= 12px ${JSON.stringify(m)}`);
  }
});

test('drag handle and version: grip with a flat state dot, needs-you while a form shows a key notice, no neural-net mark, version in the margin and on the logo, no build text in the header', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  assert.equal(await page.locator('#agent svg').count(), 1, 'one grip icon');
  assert.equal(await page.locator('#agent .node, #agent .edge, .agent-svg, .agent-avatar').count(), 0, 'no neural-net mark anywhere on the board');
  assert.equal(await page.locator('#agent').getAttribute('data-state'), 'idle', 'nothing pulses on load');
  await page.click('#add-btn'); // no key: the form says a key is needed
  await page.waitForSelector('.key-notice');
  assert.equal(await page.locator('#agent').getAttribute('data-state'), 'needs-you');
  await page.click('#job-cancel');
  await page.waitForSelector('#job-dialog', { state: 'detached' });
  assert.equal(await page.locator('#agent').getAttribute('data-state'), 'idle');
  await unlock(page);
  assert.equal(await page.locator('#agent').getAttribute('data-state'), 'idle');
  await choose(page, page.locator(STATUS_TRIGGER).first(), 'Done');
  await page.waitForSelector('#agent[data-state="working"]'); // one fill per save...
  await page.waitForSelector('#agent[data-state="idle"]');    // ...and it does not loop
  const v = await page.getAttribute('#board', 'data-version');
  assert.match(v, /^[0-9a-f]{7}$|^local$/);
  assert.equal(await page.getAttribute('html', 'data-build'), v);
  assert.equal(await text(page, '.version'), `Version ${v}`, 'the version sits in the page margin');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.logo')].find((i) => i.offsetParent)?.title), `Version ${v}`);
  assert.doesNotMatch(await text(page, 'header'), /build|Version/i, 'no build text in the header');
  // offline and error are calm, never the accent
  await ctx.setOffline(true);
  await page.waitForSelector('#conn[data-state="offline"]');
  assert.equal(await page.locator('#agent').getAttribute('data-state'), 'idle', 'offline does not use the needs-you accent');
  assert.equal(await page.getAttribute('#bubble', 'data-state'), 'idle');
  await ctx.setOffline(false);
  const flat = await page.$eval('#agent', (n) => ({ f: getComputedStyle(n).filter, dot: getComputedStyle(n.querySelector('.agent-dot')).boxShadow }));
  assert.deepEqual(flat, { f: 'none', dot: 'none' });
});

test('flat surfaces: tone ladder page, panel, card, marker; no blur, shadow or gradient anywhere; floating layers are solid with a 1px border', async (t) => {
  for (const theme of ['light', 'dark']) {
    const { ctx } = await ctxFor(t, { viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await page.goto(srv.url + `?theme=${theme}`);
    await page.waitForSelector('#board[data-state="ready"]');
    const m = await page.evaluate(() => {
      const all = [...document.querySelectorAll('body *')].map((n) => getComputedStyle(n));
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      return {
        blur: all.filter((c) => c.backdropFilter !== 'none' || (c.filter && c.filter !== 'none')).length,
        shadow: all.filter((c) => c.boxShadow !== 'none').length,
        gradient: all.filter((c) => /gradient/.test(c.backgroundImage)).length,
        page: cs('body').backgroundColor, panel: cs('#board').backgroundColor, card: cs('.job').backgroundColor,
        cardImage: cs('.job').backgroundImage,
        marker: cs('.row:not([data-empty]) .label').backgroundColor, bare: cs('.row[data-empty] .label').backgroundColor,
        theme: document.documentElement.dataset.theme,
      };
    });
    assert.equal(m.theme, theme);
    assert.equal(m.blur, 0, `${theme}: no blur or filter`);
    assert.equal(m.shadow, 0, `${theme}: no box-shadow`);
    assert.equal(m.gradient, 0, `${theme}: no gradient`);
    assert.equal(m.cardImage, 'none');
    assert.equal(new Set([m.page, m.panel, m.card]).size, 3, `${theme}: page, panel and card are three tone steps ${JSON.stringify([m.page, m.panel, m.card])}`);
    assert.notEqual(m.marker, m.bare, 'occupied line has a bay marker, empty line is bare floor');
    assert.equal(await page.locator('#backdrop').count(), 0, 'no decorative backdrop layer');
    // floating layers: a select list, then the job dialog and its scrim
    await unlock(page);
    await page.waitForSelector(STATUS_TRIGGER);
    await page.locator(STATUS_TRIGGER).first().click();
    await page.waitForSelector('[role="listbox"]');
    await page.waitForTimeout(400);
    const solid = (sel) => page.$eval(sel, (n) => { const c = getComputedStyle(n); return { bg: c.backgroundColor, border: c.borderTopWidth, filter: c.backdropFilter, shadow: c.boxShadow }; });
    const sel = await solid('[role="listbox"]');
    assert.match(sel.bg, /^rgb\(\d+, \d+, \d+\)$/); assert.equal(sel.border, '1px'); assert.equal(sel.filter, 'none'); assert.equal(sel.shadow, 'none');
    await page.keyboard.press('Escape');
    await page.locator('.job button[data-field="title"]').first().click();
    await page.waitForSelector('#job-dialog');
    await page.waitForTimeout(400);
    const dlg = await solid('#job-dialog');
    assert.match(dlg.bg, /^rgb\(\d+, \d+, \d+\)$/); assert.equal(dlg.border, '1px'); assert.equal(dlg.filter, 'none'); assert.equal(dlg.shadow, 'none');
    const scrim = await page.$eval('.scrim', (n) => { const c = getComputedStyle(n); return { bg: c.backgroundColor, filter: c.backdropFilter }; });
    assert.match(scrim.bg, /^rgba\(.*0\.\d+\)$/, 'scrim is a flat translucent fill');
    assert.equal(scrim.filter, 'none', 'scrim has no blur');
  }
});

test('motion budget: nothing animates on load or while typing; hover does not move cards; the status cue is a 350 ms background transition; floating layers enter with opacity only', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await ctx.newPage();
  await page.goto(srv.url);
  await page.waitForSelector('#board[data-state="ready"]');
  await page.waitForTimeout(900);
  assert.deepEqual(await page.evaluate(() => document.getAnimations().map((a) => a.animationName ?? a.transitionProperty)), [], 'no animation or transition is running after load');
  await page.fill('#search', 'har');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'typing in search animates nothing');
  const css = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.job')); const rule = [...document.styleSheets].flatMap((s) => [...s.cssRules]).flatMap((r) => (r.cssRules ? [...r.cssRules] : [r])).find((r) => r.selectorText === '.job.cue-rest'); return { prop: c.transitionDuration, anim: c.animationName, cue: rule?.style.transition }; });
  assert.equal(css.anim, 'none');
  assert.equal(css.prop, '0s', 'a card at rest has no transition (search typing cannot animate it)');
  assert.match(css.cue, /^background-color var\(--motion-sheet\)/, 'the cue returns the tint to rest over the 350 ms token');
  const rest = await page.$eval('.job', (n) => getComputedStyle(n).transform);
  await page.fill('#search', '');
  await page.hover('.job');
  await page.waitForTimeout(300);
  assert.equal(await page.$eval('.job', (n) => getComputedStyle(n).transform), rest, 'hover does not move the card');
  const loops = await page.evaluate(() => [...document.styleSheets].flatMap((s) => [...s.cssRules]).map((r) => r.cssText).filter((t) => /infinite/.test(t)).length);
  assert.equal(loops, 0, 'no infinite animation in the shipped CSS');
  await unlock(page);
  await page.waitForSelector(STATUS_TRIGGER);
  await page.waitForTimeout(400);
  // status change: the card gets the tint and a background-color transition runs back to rest
  const job = page.locator('.job', { hasText: 'TEST Harbour Bakery' });
  await page.evaluate(() => { window.__trans = []; const tick = () => { for (const a of document.getAnimations()) if (a.transitionProperty) window.__trans.push(`${a.transitionProperty}:${a.effect.getTiming().duration}`); requestAnimationFrame(tick); }; tick(); });
  await choose(page, job.locator(STATUS_TRIGGER), 'Ready');
  await page.waitForFunction(() => window.__trans.some((x) => x.startsWith('background-color:350')));
  // dialog enter: opacity only (a keyboard open is not a transition to watch)
  await page.locator('.job button[data-field="title"]').first().click();
  await page.waitForSelector('#job-dialog');
  const kf = await page.evaluate(() => { const a = document.getAnimations().find((x) => x.animationName === 'fade-in' && x.effect.target?.id === 'job-dialog'); return a ? a.effect.getKeyframes().flatMap((k) => Object.keys(k)) : null; });
  assert.ok(kf, 'dialog enter animation runs');
  assert.ok(kf.includes('opacity') && !kf.includes('transform'), 'the dialog fades in and does not move');
});

test('prefers-reduced-motion: no transforms and no entrance movement; no looping animation', async (t) => {
  const { ctx } = await ctxFor(t, { reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(srv.url);
  await page.waitForSelector('#board[data-state="ready"]');
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await page.hover('.job');
  await page.waitForTimeout(250);
  assert.equal(await page.$eval('.job', (n) => getComputedStyle(n).transform), 'none');
  await unlock(page);
  await page.waitForSelector(STATUS_TRIGGER);
  await page.locator('.job button[data-field="title"]').first().click();
  await page.waitForSelector('#job-dialog');
  const kf = await page.evaluate(() => { const a = document.getAnimations().find((x) => x.animationName === 'fade-in' && x.effect.target?.id === 'job-dialog'); return a ? a.effect.getKeyframes().flatMap((k) => Object.keys(k)) : null; });
  assert.ok(kf, 'dialog enter animation still runs (opacity)');
  assert.ok(!kf.includes('transform'), 'the dialog enter keeps opacity and has no transform');
});

// ---- agent- and human-native structure (attributes only; docs/AGENT-INTERFACE.md "DOM audit") ----
const board = (page) => page.$eval('#board', (b) => ({ ...b.dataset }));

test('structure: cards, rows and board carry the agent hooks and the counts match what is rendered', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  await page.waitForSelector('#conn[data-state="live"]');
  const d = await board(page);
  assert.equal(d.state, 'ready');
  assert.equal(d.testMode, 'true');
  assert.equal(Number(d.jobCount), await page.locator('.job').count());
  assert.equal(Number(d.lineCount), 19);
  assert.equal(d.canEdit, 'false');
  assert.equal(d.keyState, 'none');
  assert.match(d.version, /^[0-9a-f]{7}$|^local$/);
  assert.equal(d.version, await page.getAttribute('html', 'data-build'), 'board version matches the build id on the document');
  assert.equal(await page.getAttribute('body', 'data-test-mode'), 'true');
  assert.equal(await page.getAttribute('#test-marker', 'role'), 'status');
  assert.equal(await page.getAttribute('#conn', 'aria-live'), 'polite');
  assert.equal(await page.getAttribute('link[rel="alternate"]', 'href'), '/agent.json');
  // a card
  const job = page.locator('.job', { hasText: 'TEST Millbank Pharmacy' });
  assert.deepEqual(await job.evaluate((n) => ({ ...n.dataset, role: n.getAttribute('role'), label: n.getAttribute('aria-label'), hasId: !!n.dataset.id })),
    { id: await job.getAttribute('data-id'), status: 'ready', line: 'C', revision: '1', test: 'true', role: 'listitem', label: 'TEST Millbank Pharmacy, line C, Ready, JA', hasId: true });
  assert.equal(await job.locator('[data-field="title"]').innerText(), 'TEST Millbank Pharmacy');
  assert.equal(await job.locator('[data-field="details"]').innerText(), 'Fragile');
  assert.equal(await job.locator('[data-field="initials"]').innerText(), 'JA');
  assert.equal(await job.locator('[data-field="status"]').innerText(), 'Ready');
  assert.equal(await page.getAttribute('.row[data-line="C"] .jobs', 'role'), 'list');
  assert.equal(await page.getAttribute('.row[data-line="C"] .jobs', 'aria-label'), 'Jobs on line C');
  // rows: a named group, no orphan rowheader, empty rows flagged, occupied rows not
  assert.equal(await page.getAttribute('.row[data-line="C"]', 'role'), 'group');
  assert.equal(await page.getAttribute('.row[data-line="C"]', 'aria-label'), 'Line C');
  assert.equal(await page.locator('[role="rowheader"]').count(), 0);
  assert.equal(await page.getAttribute('.row[data-line="D"]', 'data-empty'), 'true');
  assert.equal(await page.getAttribute('.row[data-line="C"]', 'data-empty'), null);
  assert.equal(await page.locator('.row[data-empty="true"]').count(), 19 - (await page.locator('.row:has(.job)').count()));
  // every card has the hooks
  const bad = await page.$$eval('.job', (n) => n.filter((x) => !x.dataset.id || !x.dataset.line || !x.dataset.revision || !['true', 'false'].includes(x.dataset.test) || !x.querySelector('[data-field="status"]')).length);
  assert.equal(bad, 0);
});

test('structure: unlock, edit, add and delete keep the attributes and the change token honest', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  assert.equal(await page.getAttribute('#key-status', 'data-state'), 'none');
  assert.equal(await text(page, '#key-status'), 'View only');
  assert.equal(await page.getAttribute('#board', 'data-can-edit'), 'false');
  const before = await board(page);
  await unlock(page);
  assert.equal(await text(page, '#key-status'), 'Editing as Demo employee');
  assert.equal(await page.getAttribute('#key-status', 'data-subject'), 'Demo employee');
  const b2 = await board(page);
  assert.deepEqual([b2.keyState, b2.canEdit, b2.unlocked], ['valid', 'true', undefined], 'data-key-state and data-can-edit; data-unlocked is gone');
  const job = page.locator('.job', { hasText: 'TEST Harbour Bakery' });
  assert.equal(await job.locator(STATUS_TRIGGER).getAttribute('data-status'), 'open');
  assert.equal(await job.locator('button[data-field="title"]').getAttribute('aria-label'), 'Edit job: TEST Harbour Bakery');
  const id = await job.getAttribute('data-id');
  await choose(page, job.locator(STATUS_TRIGGER), 'On hold');
  await page.waitForSelector(`.job[data-id="${id}"][data-status="hold"]`);
  assert.equal(await page.getAttribute(`.job[data-id="${id}"]`, 'data-revision'), '2', 'revision moves with the edit');
  assert.equal(await page.getAttribute(`.job[data-id="${id}"]`, 'aria-label'), 'TEST Harbour Bakery, line A, On hold, JA');
  const after = await board(page);
  assert.notEqual(after.rev, before.rev, 'change token moves on an edit');
  assert.equal(after.jobCount, before.jobCount);
  // dialog knows what it is editing
  await page.click(`.job[data-id="${id}"] button[data-field="title"]`);
  assert.equal(await page.getAttribute('#job-dialog', 'data-mode'), 'edit');
  assert.equal(await page.getAttribute('#job-dialog', 'data-job-id'), id);
  await page.click('#job-cancel');
  await page.waitForSelector('#job-dialog', { state: 'detached' });
  await page.click('#add-btn');
  assert.equal(await page.getAttribute('#job-dialog', 'data-mode'), 'create');
  assert.equal(await page.getAttribute('#job-dialog', 'data-job-id'), null);
  await choose(page, '#f-line', 'Line D');
  await page.fill('#f-title', 'TEST Structure Co');
  await page.click('#job-save');
  await page.waitForSelector('.row[data-line="D"] .job');
  assert.equal(await page.getAttribute('.row[data-line="D"]', 'data-empty'), null, 'a row that gained a job is no longer empty');
  const added = await board(page);
  assert.equal(Number(added.jobCount), Number(before.jobCount) + 1);
  assert.equal(Number(added.jobCount), await page.locator('.job').count());
  assert.equal(await page.getAttribute('.row[data-line="D"] .job', 'data-test'), 'true');
});

test('structure: empty, no-lines, partial-lines, loading and offline states', async (t) => {
  const { ctx } = await ctxFor(t, undefined, { allowFailed: true });
  let page = await openBoard(ctx, srv.url, 'empty');
  let d = await board(page);
  assert.equal(d.jobCount, '0');
  assert.equal(d.lineCount, '19');
  assert.equal(d.testMode, 'true');
  assert.equal(await page.locator('.row[data-empty="true"]').count(), 19);
  assert.equal(await page.locator('.jobs[role="list"]').count(), 0, 'no list role on a line with no jobs');
  await page.close();
  page = await openBoard(ctx, srv.url, 'nolines');
  d = await board(page);
  assert.equal(d.state, 'empty');
  assert.equal(d.jobCount, '0');
  assert.equal(d.lineCount, '0');
  await page.close();
  page = await openBoard(ctx, srv.url, 'lines=5');
  d = await board(page);
  assert.equal(d.lineCount, '5');
  assert.equal(Number(d.jobCount), await page.locator('.job').count());
  await page.close();
  page = await ctx.newPage();
  await page.goto(srv.url + '?demo=slow');
  await page.waitForSelector('#board[data-state="loading"]');
  assert.equal(await page.locator('.skel:not([aria-hidden="true"])').count(), 0, 'skeletons are hidden from assistive tech');
  assert.equal(await page.locator('.row[data-empty]').count(), 0, 'loading rows are not "empty"');
  await page.waitForSelector('#board[data-state="ready"]');
  await ctx.setOffline(true);
  await page.waitForSelector('#conn[data-state="offline"]');
  d = await board(page);
  assert.equal(d.canEdit, 'false');
  assert.ok(Number(d.jobCount) > 5, 'last known board and its counts stay');
  await ctx.setOffline(false);
});

// ---- new for the component rebuild ----
test('themes: dark is the default whatever the system says, ?theme=light shows the light theme, both fit the viewport', async (t) => {
  for (const [scheme, query, want] of [['dark', '', 'dark'], ['light', '', 'dark'], ['dark', '?theme=light', 'light'], ['light', '?theme=light', 'light'], ['light', '?theme=dark', 'dark'], ['dark', '?theme=nonsense', 'dark']]) {
    const { ctx } = await ctxFor(t, { colorScheme: scheme, viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await page.goto(srv.url + query);
    await page.waitForSelector('#board[data-state="ready"]');
    const m = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, sh: document.scrollingElement.scrollHeight, ih: innerHeight,
      logo: [...document.querySelectorAll('.logo')].find((i) => i.offsetParent)?.getAttribute('src') }));
    assert.equal(m.theme, want, `${scheme} ${query}`);
    assert.ok(m.sh <= m.ih);
    assert.equal(m.logo, want === 'dark' ? '/rhl-logo-light.svg' : '/rhl-logo.svg', 'light logo on dark, dark logo on light');
    const lum = m.bg.match(/\d+/g).slice(0, 3).map(Number).reduce((a, c) => a + c, 0);
    assert.ok(want === 'dark' ? lum < 200 : lum > 600, `${want} page tone ${m.bg}`);
  }
});

test('Radix select: opens and picks with the keyboard; Escape closes it; the dialog selects work the same way', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  await unlock(page);
  await page.waitForSelector(STATUS_TRIGGER);
  const job = page.locator('.job', { hasText: 'TEST Harbour Bakery' });
  const id = await job.getAttribute('data-id');
  await job.locator(STATUS_TRIGGER).focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role="listbox"]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="listbox"]', { state: 'detached' });
  await job.locator(STATUS_TRIGGER).focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role="listbox"]');
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement?.textContent === 'On hold');
  await page.keyboard.press('Enter');
  await page.waitForSelector(`.job[data-id="${id}"][data-status="hold"]`);
  await page.click('#add-btn');
  await page.locator('#f-status').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('option').count(), 4);
  await page.getByRole('option', { name: 'Ready', exact: true }).click();
  assert.equal(await text(page, '#f-status'), 'Ready');
});

test('inline add: every line (occupied and empty) has Add job at the end of its cards; the form opens anchored to that row with the line already chosen, Escape returns focus', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url, '', { key: DEMO_KEY });
  assert.equal(await page.locator('[data-add-line]').count(), 19, 'one Add job on every row');
  for (const line of ['C', 'D']) { // C has jobs, D is empty
    const btn = page.locator(`[data-add-line="${line}"]`);
    assert.equal(await btn.isVisible(), true);
    await btn.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector(`#add-${line}-title`);
    assert.equal(await page.evaluate(() => document.activeElement.id), `add-${line}-title`);
    assert.match(await text(page, '.inline-add, [data-radix-popper-content-wrapper] [role="dialog"]'), new RegExp(`Add job on line ${line}`));
    assert.equal(await page.locator(`#add-${line}-line`).count(), 0, 'no Line field: it is already chosen');
    const m = await page.evaluate((l) => { const r = document.querySelector(`.row[data-line="${l}"]`).getBoundingClientRect(); const f = document.querySelector(`#add-${l}-form`).getBoundingClientRect(); return { dy: f.top - r.bottom, left: f.left - r.left }; }, line);
    assert.ok(Math.abs(m.dy) < 80 || m.dy < 0, `the form sits at its row ${JSON.stringify(m)}`);
    await page.keyboard.press('Escape');
    await page.waitForSelector(`#add-${line}-title`, { state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-add-line')), line, 'focus returns to that row\'s Add job');
  }
});

test('touch: 44px hit areas on the status trigger, the card and the bubble controls, at 1024x1366 and 390x844', async (t) => {
  for (const [w, h] of [[1024, 1366], [390, 844]]) {
    const { ctx } = await ctxFor(t, { viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    const page = await openBoard(ctx, srv.url, '', { key: DEMO_KEY });
    const r = await page.evaluate((sel) => {
      const out = {};
      for (const [name, q] of [['status', sel], ['customer', '.job button[data-field="title"]'], ['add', '#add-btn'], ['grip', '#grip']]) {
        const el = document.querySelector(q);
        const b = el.getBoundingClientRect();
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        let up = 0; while (up < 40 && document.elementFromPoint(cx, cy - up - 1)?.closest(q)) up++;
        let down = 0; while (down < 40 && document.elementFromPoint(cx, cy + down + 1)?.closest(q)) down++;
        out[name] = { h: Math.round(b.height), hit: up + down + 1 };
      }
      return out;
    }, STATUS_TRIGGER);
    for (const k of ['status', 'customer', 'add', 'grip']) assert.ok(r[k].hit >= 44, `${w}x${h}: ${k} hit height ${r[k].hit} (${JSON.stringify(r)})`);
    assert.ok(r.status.h < 40, 'the badge itself stays compact');
  }
});

const lumOf = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
const ratioOf = (a, b) => { const [x, y] = [lumOf(a), lumOf(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgbOf = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);

const cardFit = (page) => page.evaluate(() => [...document.querySelectorAll('.job')].map((j) => {
  const b = j.getBoundingClientRect();
  const over = [...j.querySelectorAll('.customer, .note, .initials, .status')].filter((e) => e.getBoundingClientRect().bottom > b.bottom + 0.5 || e.getBoundingClientRect().top < b.top - 0.5).map((e) => e.className);
  return { clipped: j.scrollHeight > j.clientHeight + 0.5, over, two: getComputedStyle(j).display === 'grid' };
}).filter((r) => r.clipped || r.over.length).length);

test('card fit: no job card overflows its box, locked or unlocked, at 1920x1080, 1366x768 and 1280x720 (two-line cards included)', async (t) => {
  for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720], [1440, 1000], [2560, 1440]]) {
    const { ctx } = await ctxFor(t, { viewport: { width: w, height: h } });
    const page = await openBoard(ctx, srv.url);
    if (h >= 1080) assert.equal(await page.$eval('.job', (n) => getComputedStyle(n).display), 'grid', `${w}x${h}: two-line cards (2 lines of text) are exercised`);
    assert.equal(await cardFit(page), 0, `${w}x${h} locked`);
    await unlock(page);
    await page.waitForSelector(STATUS_TRIGGER);
    assert.equal(await cardFit(page), 0, `${w}x${h} unlocked`);
    const hs = await page.evaluate((sel) => { const a = document.querySelector('.job .status').getBoundingClientRect().height; return a; }, STATUS_TRIGGER);
    assert.ok(hs > 10);
  }
  // the editable status trigger is exactly as tall as the read-only badge
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  const locked = await page.$eval('.job .status', (n) => n.getBoundingClientRect().height);
  await unlock(page);
  await page.waitForSelector(STATUS_TRIGGER);
  assert.equal(await page.$eval(STATUS_TRIGGER, (n) => n.getBoundingClientRect().height), locked);
});

test('failed first load: the header status line stays empty (each fact once), and a missing backend shows a plain sentence', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url, 'fail');
  assert.equal((await text(page, '#live-text')).trim(), '', 'the board message and the Error label say it, the status line stays empty');
  assert.match(await text(page, '#board'), /could not be loaded/);
  // no Supabase settings: no env var names on a staff screen, the technical text goes to the console
  const bare = await buildAndServe({ VITE_BACKEND: 'supabase', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' });
  try {
    const c = await newCtx(browser);
    const p = await c.ctx.newPage();
    await p.goto(bare.url);
    await p.waitForSelector('#board[data-state="error"]');
    const body = await p.locator('#board').innerText();
    assert.match(body, /This board is not set up\./);
    assert.doesNotMatch(body, /VITE_|Supabase|configured/i);
    assert.ok(c.log.errors.some((e) => /VITE_SUPABASE/.test(e)), 'technical text is logged, not shown');
    assert.equal(await p.locator('header .logo').count() > 0, true, 'the header with the logo is there');
    await c.ctx.close();
  } finally { bare.stop(); }
});

test('search: one flat dim step keeps text at 3:1 or better, no opacity stacking, and an empty result says so', async (t) => {
  for (const theme of ['light', 'dark']) {
    const { ctx } = await ctxFor(t);
    const page = await ctx.newPage();
    await page.goto(srv.url + `?theme=${theme}`);
    await page.waitForSelector('#board[data-state="ready"]');
    await page.fill('#search', 'harbour');
    const m = await page.evaluate(() => {
      const dimJob = document.querySelector('.row.dim .job.dim');
      const dimRow = document.querySelector('.row.dim');
      const pick = (n, sel) => getComputedStyle(n.querySelector(sel)).color;
      return { rowOp: getComputedStyle(dimRow).opacity, jobOp: getComputedStyle(dimJob).opacity, bg: getComputedStyle(dimRow).backgroundColor,
        colors: ['.customer', '.note', '.initials', '.status'].map((s) => pick(dimJob, s)), letter: getComputedStyle(dimRow.querySelector('.label')).color, letterBg: getComputedStyle(dimRow.querySelector('.label')).backgroundColor };
    });
    assert.equal(m.rowOp, '1'); assert.equal(m.jobOp, '1');
    for (const c of [...m.colors, m.letter]) assert.ok(ratioOf(rgbOf(c), rgbOf(m.bg)) >= 3, `${theme}: dimmed text ${c} on ${m.bg}`);
    assert.match(m.letterBg, /rgba\(0, 0, 0, 0\)/, 'a non-matching line shows the bare floor, not the marker');
    await page.fill('#search', 'zzzz-nothing');
    assert.equal(await text(page, '.board-note'), 'No jobs match.');
    await page.fill('#search', '');
    assert.equal(await page.locator('.board-note').count(), 0);
  }
});

test('keyboard only: closing the job dialog (Escape, Cancel, Save) returns focus to what opened it', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url, 'empty', { key: DEMO_KEY });
  const active = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('data-focus') || document.activeElement?.tagName);
  for (const how of ['Escape', 'Cancel', 'Save']) {
    await page.focus('#add-btn');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#job-dialog');
    assert.equal(await active(), 'f-title');
    if (how === 'Escape') await page.keyboard.press('Escape');
    else if (how === 'Cancel') { await page.focus('#job-cancel'); await page.keyboard.press('Enter'); }
    else { await choose(page, '#f-line', 'Line A'); await page.focus('#f-title'); await page.keyboard.type(`TEST Keyboard ${how}`); await page.keyboard.press('Enter'); }
    await page.waitForSelector('#job-dialog', { state: 'detached' });
    await page.waitForTimeout(150);
    assert.equal(await active(), 'add-btn', `after ${how} on Add job`);
  }
  // edit: back on the card's own edit button
  const btn = page.locator('.customer-btn').first();
  const key = await btn.getAttribute('data-focus');
  await btn.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('#job-dialog');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#job-dialog', { state: 'detached' });
  await page.waitForTimeout(150);
  assert.equal(await active(), key, 'after Escape on Edit job');
});

test('one focus ring on card controls: the name button and the status badge both hand the ring to the card', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  await unlock(page);
  await page.waitForSelector(STATUS_TRIGGER);
  for (const sel of ['.job .customer-btn', STATUS_TRIGGER]) {
    await page.focus(sel);
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); // keyboard focus, so :focus-visible matches
    const m = await page.evaluate((q) => { const e = document.querySelector(q); const j = e.closest('.job'); const c = getComputedStyle(e); const jc = getComputedStyle(j); return { ring: `${c.outlineWidth} ${c.outlineStyle}`, off: parseFloat(c.outlineOffset), card: jc.outlineStyle, btnNone: c.outlineStyle === 'none', active: document.activeElement === e }; }, sel);
    assert.equal(m.active, true, sel);
    // round 6: the card carries the ring for both its controls (a ring on a 12 to 18px strip ran through the letters and the glyph); the controls draw none
    assert.equal(m.card, 'solid', `${sel}: the card carries the ring`);
    assert.ok(m.btnNone, `${sel}: and the control draws none, so there is one ring`);
  }
  // the row's Add job: the jobs strip clips overflow, so its ring must sit inside the control
  await page.focus('.row-add'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  const ra = await page.$eval('.row-add', (n) => { const c = getComputedStyle(n); return { w: c.outlineWidth, s: c.outlineStyle, o: parseFloat(c.outlineOffset), active: document.activeElement === n }; });
  assert.deepEqual([ra.active, ra.w, ra.s, ra.o < 0], [true, '2px', 'solid', true], 'row Add job ring is drawn inside the control, so it is never clipped');
});

test('lists and the dialog fade only; nothing rises (select, popover and dialog 120 ms fade)', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url, '', { key: DEMO_KEY });
  await page.click('[data-add-line="C"]');
  await page.waitForSelector('#add-C-title');
  const pop = await page.evaluate(() => { const a = document.getAnimations().find((x) => /float-in|fade-in/.test(x.animationName)); return a ? { n: a.animationName, d: a.effect.getTiming().duration, k: a.effect.getKeyframes().flatMap((k) => Object.keys(k)) } : null; });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.locator(STATUS_TRIGGER).first().click();
  await page.waitForSelector('[role="listbox"]');
  const sel = await page.evaluate(() => { const a = document.getAnimations().find((x) => x.animationName === 'fade-in'); return a ? { d: a.effect.getTiming().duration, k: a.effect.getKeyframes().flatMap((k) => Object.keys(k)) } : null; });
  assert.ok(sel, 'select list fades in');
  assert.equal(sel.d, 120);
  assert.ok(!sel.k.includes('transform'), 'no rise on the select list');
  if (pop) { assert.equal(pop.n, 'fade-in'); assert.equal(pop.d, 120); assert.ok(!pop.k.includes('transform')); }
  await page.keyboard.press('Escape');
  await page.locator('.job button[data-field="title"]').first().click();
  await page.waitForSelector('#job-dialog');
  const dlg = await page.evaluate(() => { const a = document.getAnimations().find((x) => x.animationName === 'fade-in' && x.effect.target?.id === 'job-dialog'); return a ? { d: a.effect.getTiming().duration, k: a.effect.getKeyframes().flatMap((k) => Object.keys(k)) } : null; });
  assert.equal(dlg.d, 120);
  assert.ok(!dlg.k.includes('transform'), 'the dialog does not rise');
});

test('dialog validation: aria-invalid on the field, danger border instead of the green ring, cleared when typing', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url, 'empty');
  await unlock(page);
  await page.click('#add-btn');
  assert.equal(await page.locator('#job-save').isDisabled(), true, 'Save stays off until a line is chosen, and says so');
  assert.equal(await text(page, '#job-msg'), 'Choose a line.');
  await choose(page, '#f-line', 'Line A');
  await page.click('#job-save');
  assert.equal(await page.getAttribute('#f-title', 'aria-invalid'), 'true');
  assert.equal(await page.getAttribute('#f-title', 'aria-describedby'), 'job-msg');
  await page.focus('#f-title');
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  await page.waitForTimeout(250); // the border colour eases over 120 ms
  const c = await page.$eval('#f-title', (n) => { const s = getComputedStyle(n); return { border: s.borderTopColor, ring: s.outlineColor, rs: s.outlineStyle }; });
  const danger = await page.evaluate(() => { const i = document.createElement('i'); i.style.color = getComputedStyle(document.documentElement).getPropertyValue('--danger'); document.body.append(i); const v = getComputedStyle(i).color; i.remove(); return v; });
  assert.equal(c.border, danger); assert.equal(c.ring, danger, 'the focus ring turns danger, it does not stack a green ring on a red border');
  await page.keyboard.type('x');
  assert.equal(await page.getAttribute('#f-title', 'aria-invalid'), null);
});

test('phone: the bubble with a valid key keeps a usable search field and the placeholder reads Search', async (t) => {
  const { ctx } = await ctxFor(t, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await openBoard(ctx, srv.url, '', { key: DEMO_KEY });
  const m = await page.evaluate(() => { const i = document.querySelector('#search'); const b = document.querySelector('#bubble').getBoundingClientRect(); return { w: i.getBoundingClientRect().width, ph: i.placeholder, clipped: i.scrollWidth > i.clientWidth, bw: b.width, right: b.right, vw: innerWidth, lock: document.querySelector('#key-status').getBoundingClientRect().width, add: document.querySelector('#add-btn').getBoundingClientRect().width }; });
  assert.equal(m.ph, 'Search or tell your agent');
  assert.ok(m.w >= 150, `search width ${m.w}`);
  assert.ok(m.right <= m.vw, 'bubble inside the viewport');
  assert.ok(m.add >= 44, `the Add job button keeps a 44px target ${m.add}`);
  assert.equal(await page.getAttribute('#key-status', 'data-state'), 'valid');
  assert.equal(await text(page, '#add-btn'), 'Add job', 'the label stays for assistive tech');
});

test('print: notes wrap instead of truncating, cards do not clip, in both themes', async (t) => {
  for (const theme of ['light', 'dark']) {
    const { ctx } = await ctxFor(t, { colorScheme: theme });
    const page = await ctx.newPage();
    await page.goto(srv.url + `?theme=${theme}`);
    await page.waitForSelector('#board[data-state="ready"]');
    await page.setViewportSize({ width: 996, height: 692 }); // the printable width of a landscape Letter page (11 in less 8 mm margins; A4 is wider)
    await page.emulateMedia({ media: 'print', colorScheme: theme });
    const m = await page.evaluate(() => ({
      notes: [...document.querySelectorAll('.note')].filter((n) => n.textContent && (n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1)).map((n) => n.textContent),
      cards: [...document.querySelectorAll('.job')].filter((j) => j.scrollHeight > j.clientHeight + 1).map((j) => j.getAttribute('aria-label')),
      lh: getComputedStyle(document.querySelector('.note')).lineHeight, fs: getComputedStyle(document.querySelector('.note')).fontSize }));
    assert.deepEqual(m.notes, [], `${theme}: truncated notes`);
    assert.deepEqual(m.cards, [], `${theme}: clipped cards`);
    assert.ok(parseFloat(m.lh) / parseFloat(m.fs) >= 1.09, 'wrapped print text keeps its leading (two lines at most)');
  }
});

test('type: unitless line-heights by role, weights 400 or heavier, one family, header and body ratios', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  const m = await page.evaluate(() => {
    const ratio = (sel) => { const c = getComputedStyle(document.querySelector(sel)); return parseFloat(c.lineHeight) / parseFloat(c.fontSize); };
    const fams = new Set([...document.querySelectorAll('body *')].map((n) => getComputedStyle(n).fontFamily.split(',')[0].trim()));
    const weights = new Set([...document.querySelectorAll('body *')].filter((n) => n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())).map((n) => getComputedStyle(n).fontWeight));
    return { h1: ratio('h1'), body: ratio('body'), search: ratio('#search'), fams: [...fams], weights: [...weights], letter: parseFloat(getComputedStyle(document.querySelector('.label')).fontSize), customer: parseFloat(getComputedStyle(document.querySelector('.customer')).fontSize), h1px: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize) };
  });
  assert.ok(Math.abs(m.h1 - 1.1) < 0.02, `h1 ${m.h1}`);
  assert.ok(m.body >= 1.5 && m.body <= 1.6, `body ${m.body}`);
  assert.deepEqual(m.fams, ['"Geist Variable"']);
  assert.ok(m.weights.every((w) => ['400', '500', '600'].includes(w)), m.weights.join());
  assert.ok(m.letter > m.h1px && m.letter > m.customer, `the bay marker letter (${m.letter}px) is the largest type on the board (customer ${m.customer}, h1 ${m.h1px})`);
  assert.equal(m.letter, 22);
});

test('built CSS carries no ban-listed utility (Tailwind reads only src and the html entries)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = join(srv.outDir, 'assets');
  const css = readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  for (const re of [/\.backdrop-[\w-]+\s*\{/, /\.filter\s*\{/, /\.uppercase\s*\{/, /\.ring[\w-]*\s*\{/, /\.shadow[\w-]*\s*\{/, /\.blur[\w-]*\s*\{/, /text-shadow/, /gradient\(/, /\.animate-(spin|pulse|ping|bounce)/, /\.font-(bold|extrabold|black|light)/, /\.tracking-/]) assert.ok(!re.test(css), `built CSS contains ${re}`);
});
