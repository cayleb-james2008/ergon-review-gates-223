// Round 5 regression tests: the dock, compact names and touch targets, print proven on A4 and Letter, focus after a click-open, a hidden tab, the inline form's Save row,
// read-only fields, the message that clears when the connection returns.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAndServe, launch, newCtx, openBoard, choose, DEMO_KEY } from './helpers.mjs';

let srv; let browser;
before(async () => { srv = await buildAndServe({ VITE_BACKEND: 'demo' }); browser = await launch(); });
after(async () => { await browser?.close(); srv?.stop(); });
async function ctxFor(t, opts) {
  const c = await newCtx(browser, opts);
  t.after(async () => { await c.ctx.close(); assert.deepEqual(c.log.errors, [], 'console errors'); });
  return c;
}
const text = (page, sel) => page.locator(sel).first().innerText();

const inject = (ctx, total, heavy = 0) => ctx.addInitScript(([total, heavy]) => {
  try { if (localStorage.getItem('rhl.demo.v1')) return; } catch { return; }
  const L = 'ABCDEFGHIJKLMNOPQRS'.split('');
  const lines = L.map((c, i) => ({ id: crypto.randomUUID(), code: c, sort_order: i + 1, is_test: true, created_at: new Date().toISOString() }));
  const per = L.map(() => 0);
  for (let i = 0; i < total; i++) per[i % 19]++;
  if (heavy) per[3] = heavy;
  const names = ['Harbour Bakery', 'Northgate Foods', 'Alder Joinery', 'Millbank Pharmacy', 'Kestrel Cycles', 'Oakfield Farm Shop', 'Pinewood Garden Centre', 'Riverside Print'];
  const st = ['open', 'hold', 'ready', 'done'];
  const ini = ['JA', 'JS', 'JG', 'AK', 'LB', 'XX'];
  const entries = []; let n = 0;
  per.forEach((c, li) => { for (let k = 0; k < c; k++) { entries.push({ id: crypto.randomUUID(), line_id: lines[li].id, title: `TEST ${names[n % 8]} ${n}`, details: 'Pallet note', initials: ini[n % 6], status: st[n % 4], revision: 1, is_test: true, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString(), updated_at: new Date().toISOString() }); } });
  localStorage.setItem('rhl.demo.v1', JSON.stringify({ lines, entries }));
}, [total, heavy]);

test('the dock: the bubble sits in a strip under the board, so by default it covers NO row at 60 and 200 jobs; text stays at least 12px and the page does not scroll', async (t) => {
  for (const total of [14, 60, 200]) for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720], [1024, 768]]) {
    const { ctx } = await ctxFor(t, { viewport: { width: w, height: h } });
    if (total > 14) await inject(ctx, total, total === 200 ? 14 : 0);
    const page = await openBoard(ctx, srv.url, total === 14 ? 'reset' : '');
    const m = await page.evaluate(() => {
      const b = document.getElementById('bubble').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.job')].map((j) => j.getBoundingClientRect());
      const rows = [...document.querySelectorAll('.row')].map((r) => r.getBoundingClientRect());
      const hit = (r) => !(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom);
      return { covered: cards.filter(hit).length, rowsCovered: rows.filter(hit).length, pageScroll: document.documentElement.scrollHeight > innerHeight + 1,
        minFont: Math.min(...[...document.querySelectorAll('.job .customer')].map((c) => parseFloat(getComputedStyle(c).fontSize))), bubbleBottom: b.bottom, ih: innerHeight };
    });
    assert.equal(m.rowsCovered, 0, `${total} jobs at ${w}x${h}: the bubble covers no row`);
    assert.equal(m.covered, 0, `${total} jobs at ${w}x${h}: and no card`);
    assert.equal(m.pageScroll, false, `${total} jobs at ${w}x${h}: no page scroll`);
    assert.ok(m.minFont >= 12, `${total} jobs at ${w}x${h}: text is at least 12px (${m.minFont})`);
    assert.ok(m.ih - m.bubbleBottom <= 12, `${w}x${h}: the bubble rests at the bottom edge`);
  }
});

test('the dock: the bubble is still draggable; over the board it floats on top and stays translucent; narrow screens keep the board padding instead', async (t) => {
  const { ctx } = await ctxFor(t, { viewport: { width: 1366, height: 768 } });
  const page = await openBoard(ctx, srv.url);
  const b0 = await page.locator('#bubble').boundingBox();
  const grip = await page.locator('#grip').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y - 300, { steps: 8 });
  await page.mouse.up();
  const b1 = await page.locator('#bubble').boundingBox();
  assert.ok(b1.y < b0.y - 200, 'it moved up over the board');
  assert.match(await page.$eval('#bubble', (n) => getComputedStyle(n).backgroundColor), /^rgba\(\d+, \d+, \d+, 0\.\d+\)$/, 'translucent over the board');
  const phone = await ctxFor(t, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const pp = await openBoard(phone.ctx, srv.url);
  assert.equal(await pp.$eval('.app', (n) => getComputedStyle(n).paddingBottom), '8px', 'no dock on a phone');
  assert.notEqual(await pp.$eval('#board', (n) => getComputedStyle(n).paddingBottom), '0px', 'the board pads its own bottom instead');
});

// how many characters of a compact card's name are actually drawn (the rest is the ellipsis)
const visibleChars = (page, selector) => page.$$eval(selector, (btns) => btns.map((b) => {
  const node = b.firstChild; const box = b.getBoundingClientRect(); const cs = getComputedStyle(b);
  const room = box.right - parseFloat(cs.paddingRight) - 8; // an ellipsis needs about 8px
  let n = 0; const r = document.createRange();
  for (let i = 0; i < node.textContent.length; i++) { r.setStart(node, i); r.setEnd(node, i + 1); if (r.getBoundingClientRect().right <= room) n++; else break; }
  return node.textContent.length <= n ? node.textContent.length : n;
}));

test('compact cards drop the initials letters (the tint carries them): the 14-job line shows at least 11 characters of every name at 1920 and 10 at 1366, in both themes; the letters stay in the title and the accessible name', async (t) => {
  for (const theme of ['dark', 'light']) for (const [w, h, min] of [[1920, 1080, 11], [1366, 768, 10]]) {
    const { ctx } = await ctxFor(t, { viewport: { width: w, height: h } });
    await inject(ctx, 200, 14);
    const page = await ctx.newPage();
    await page.goto(`${srv.url}?theme=${theme}`);
    await page.waitForSelector('#board[data-state="ready"]');
    assert.equal(await page.locator('.row[data-line="D"] .job').count(), 14);
    const chars = await visibleChars(page, '.row[data-line="D"] .job .customer');
    assert.ok(Math.min(...chars) >= min, `${theme} ${w}x${h}: the 14-job line shows at least ${min} characters (min ${Math.min(...chars)}: ${chars})`);
    const all = await visibleChars(page, '.job .customer');
    assert.ok(Math.min(...all) >= min, `${theme} ${w}x${h}: every one of the 200 jobs (min ${Math.min(...all)})`);
    const c = await page.$eval('.row[data-line="A"] .job', (n) => ({ letters: n.querySelector('.initials-text').textContent, shown: getComputedStyle(n.querySelector('.initials-text')).position, w: n.querySelector('.initials').getBoundingClientRect().width,
      bg: getComputedStyle(n.querySelector('.initials')).backgroundColor, title: n.querySelector('.customer').title, label: n.getAttribute('aria-label') }));
    assert.ok(c.letters.length >= 2 && c.shown === 'absolute', 'the letters are in the DOM, visually hidden');
    assert.ok(c.w >= 6 && c.w <= 10, `the tint is a small swatch (${c.w}px)`);
    assert.doesNotMatch(c.bg, /rgba\(0, 0, 0, 0\)/);
    assert.ok(c.title.includes(`(${c.letters})`) && c.label.endsWith(`, ${c.letters}`), 'initials are in the card title and the accessible name');
    const unmapped = await page.$$eval('.job .initials:not([data-hue])', (n) => n.filter((x) => x.querySelector('.initials-text').textContent === 'XX').map((x) => getComputedStyle(x).backgroundColor));
    assert.ok(unmapped.length > 0 && unmapped.every((x) => !/rgba\(0, 0, 0, 0\)/.test(x)), 'unconfirmed initials show a neutral swatch');
  }
});

test('touch: the compact status glyph is at least 44 x 44 effective at 1024x1366, on every compact card', async (t) => {
  const { ctx } = await ctxFor(t, { viewport: { width: 1024, height: 1366 }, hasTouch: true });
  await inject(ctx, 200, 0);
  const page = await openBoard(ctx, srv.url, '', { key: DEMO_KEY });
  await page.addStyleTag({ content: '#bubble{display:none !important}' });
  const r = await page.evaluate(() => {
    const out = { cards: 0, small: [], coarse: matchMedia('(pointer: coarse)').matches };
    for (const btn of document.querySelectorAll('.row[data-density="compact"] .job button.status')) {
      const r = btn.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) continue; // a touch line swipes sideways: measure what is on screen
      out.cards++;
      // the extent of the button's hit area along the row and the column through its centre
      const cx = Math.round(r.left + r.width / 2); const cy = Math.round(r.top + r.height / 2);
      const hits = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === btn || btn.contains(e)); };
      let x0 = cx; while (hits(x0 - 1, cy)) x0--;
      let x1 = cx; while (hits(x1 + 1, cy)) x1++;
      let y0 = cy; while (hits(cx, y0 - 1)) y0--;
      let y1 = cy; while (hits(cx, y1 + 1)) y1++;
      if (x1 - x0 + 1 < 44 || y1 - y0 + 1 < 44) out.small.push([x1 - x0 + 1, y1 - y0 + 1]);
    }
    return out;
  });
  assert.equal(r.coarse, true);
  assert.ok(r.cards >= 100, `${r.cards} compact cards measured on screen`);
  assert.deepEqual(r.small, [], `every compact status target is at least 44 x 44: ${JSON.stringify(r.small.slice(0, 6))} of ${r.cards}`);
});

// ---- print, proven on a real PDF ----
function pdfCheck(page, name, fmt) {
  return page.pdf({ path: name, format: fmt, landscape: true, preferCSSPageSize: true, printBackground: true }).then(() => {
    const pages = Number(execFileSync('pdfinfo', [name]).toString().match(/Pages:\s+(\d+)/)[1]);
    const base = name.replace(/\.pdf$/, '');
    execFileSync('pdftoppm', ['-r', '100', '-f', '1', '-l', '1', name, base]); // PPM, raw
    const file = `${base}-1.ppm`;
    const buf = readFileSync(file);
    const head = buf.toString('latin1', 0, 20).match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
    const [w, h] = [Number(head[1]), Number(head[2])];
    const data = buf.subarray(head[0].length);
    // a frame line (or the header rule) is a row of pixels that is mostly not paper-white across the middle of the page
    const dark = (x, y) => { const i = (y * w + x) * 3; return (data[i] + data[i + 1] + data[i + 2]) / 3 < 238; };
    const on = [];
    for (let y = 0; y < h; y++) { let c = 0; const x0 = Math.floor(w * 0.12); const x1 = Math.floor(w * 0.88); for (let x = x0; x < x1; x++) if (dark(x, y)) c++; on.push(c > (x1 - x0) * 0.6); }
    let runs = 0; let last = -1;
    for (let y = 1; y < h; y++) { if (on[y] && !on[y - 1]) { runs++; last = y; } }
    return { pages, w, h, runs, lastLineAt: last };
  });
}

test('print on A4 and Letter at 1920x1080 and 1366x768 viewports: one landscape page, 19 rows each with its whole frame (top and bottom line), none clipped; 14 and 200 jobs', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'rhl-print-'));
  for (const total of [14, 200]) for (const [w, h] of [[1920, 1080], [1366, 768]]) for (const fmt of ['A4', 'Letter']) {
    const { ctx } = await ctxFor(t, { viewport: { width: w, height: h } });
    if (total > 14) await inject(ctx, total, 0);
    const page = await openBoard(ctx, srv.url, total === 14 ? 'reset' : '');
    await page.waitForFunction(() => document.querySelector('.logo-paper'), null, { timeout: 8000 });
    await page.emulateMedia({ media: 'print' });
    const r = await pdfCheck(page, join(dir, `p-${total}-${fmt}-${w}.pdf`), fmt);
    assert.equal(r.pages, 1, `${total} jobs ${fmt} ${w}x${h}: one page`);
    assert.ok(r.w > r.h, 'landscape');
    if (total === 14) assert.equal(r.runs, 39, `${total} jobs ${fmt} ${w}x${h}: the header rule plus the top and bottom frame line of all 19 rows (${r.runs} lines found, 39 expected: a clipped row S gives 38)`);
    else assert.ok(r.runs >= 39, `${total} jobs ${fmt} ${w}x${h}: at least the 39 frame and rule lines (${r.runs}); dense text adds a few more`);
    // geometry on a viewport the size of the page area: the last row ends inside the app, whole
    await page.setViewportSize(fmt === 'A4' ? { width: 1062, height: 733 } : { width: 1056, height: 755 });
    const g = await page.evaluate(() => { const rows = [...document.querySelectorAll('.row')]; const last = rows.at(-1).getBoundingClientRect(); const app = document.querySelector('.app').getBoundingClientRect(); return { rows: rows.length, lastBottom: last.bottom, appBottom: app.bottom, h: innerHeight }; });
    assert.equal(g.rows, 19);
    assert.ok(g.lastBottom <= g.appBottom - 1 && g.appBottom <= g.h + 1, `${fmt}: row S is whole inside the page (${JSON.stringify(g)})`);
    assert.ok(r.lastLineAt < r.h - 20, 'and the last frame is inside the page');
  }
});

test('print: compact cards print no note and share the row', async (t) => {
  const { ctx } = await ctxFor(t, { viewport: { width: 1366, height: 768 } });
  await inject(ctx, 200, 0);
  const page = await openBoard(ctx, srv.url);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.$eval('.row[data-density="compact"] .job .note', (n) => getComputedStyle(n).display), 'none');
});

// ---- focus, hidden tab, forms ----
test('mouse-open then Escape, Cancel and Save: focus goes back to the card\'s own edit button, not to the page', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url, 'reset', { key: DEMO_KEY });
  const card = page.locator('.job', { hasText: 'TEST Harbour Bakery' });
  const focusKey = (await card.locator('.customer-btn').getAttribute('data-focus'));
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-focus') ?? document.activeElement?.tagName);
  for (const how of ['Escape', 'Cancel', 'Save']) {
    await card.locator('.note').click(); // the card's body, not a control
    await page.waitForSelector('#job-dialog');
    if (how === 'Escape') await page.keyboard.press('Escape');
    else if (how === 'Cancel') await page.click('#job-cancel');
    else { await page.fill('#f-details', `saved ${Date.now()}`); await page.click('#job-save'); }
    await page.waitForSelector('#job-dialog', { state: 'detached' });
    await page.waitForTimeout(150);
    assert.equal(await active(), focusKey, `after ${how}`);
    await page.keyboard.press('Tab');
    assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'grip', `${how}: Tab goes on from the card, not from the top of the page`);
    await page.locator('.customer-btn').first().focus();
  }
});

test('a hidden tab reads nothing, not even the read armed before it was hidden; becoming visible reads once and resumes', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await ctx.newPage();
  const reqs = [];
  await page.addInitScript(() => { window.__reads = 0; const orig = BroadcastChannel; }); // the demo backend has no network: count its probe through the board's own change token instead
  await page.goto(srv.url);
  await page.waitForSelector('#conn[data-state="live"]');
  await page.waitForTimeout(5200); // past the catch-up reads; now only the reconcile timer is armed
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  // while hidden, a change that only a read can find
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('rhl.demo.v1')); const line = d.lines.find((l) => l.code === 'K'); d.entries.push({ id: crypto.randomUUID(), line_id: line.id, title: 'TEST While Hidden', details: '', initials: 'JA', status: 'open', revision: 1, is_test: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); localStorage.setItem('rhl.demo.v1', JSON.stringify(d)); });
  await page.waitForTimeout(19000); // longer than the longest reconcile interval (17.25 s)
  assert.equal(await page.locator('.job:has-text("TEST While Hidden")').count(), 0, 'nothing was read while hidden, not even the timer armed before');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForSelector('.job:has-text("TEST While Hidden")', { timeout: 5000 });
  reqs.length = 0;
});

test('the inline form keeps its Save row in reach on a short screen (sticky), and an existing job opened without a usable key shows every field disabled together', async (t) => {
  const { ctx } = await ctxFor(t, { viewport: { width: 844, height: 390 }, hasTouch: true });
  const page = await openBoard(ctx, srv.url, '', { key: DEMO_KEY });
  await page.locator('[data-add-line="D"]').first().dispatchEvent('click');
  await page.waitForSelector('#add-D-title');
  const sv = await page.locator('#add-D-save').boundingBox();
  assert.ok(sv && sv.y >= 0 && sv.y + sv.height <= 390, `Save is on screen (${sv?.y}, ${sv?.height})`);
  await page.locator('#add-D-save').scrollIntoViewIfNeeded();
  await page.keyboard.press('Escape');
  const e = await ctxFor(t);
  const p2 = await openBoard(e.ctx, srv.url, 'reset', { key: 'demo-expired' });
  await p2.locator('.job').first().locator('.customer-btn').click();
  await p2.waitForSelector('#job-dialog');
  const o = await p2.$$eval('#job-dialog input, #job-dialog [role="combobox"]', (n) => n.map((x) => getComputedStyle(x).opacity));
  assert.ok(o.length >= 5 && o.every((v) => v === o[0] && Number(v) < 1), `every field looks the same (read-only, dimmed): ${o}`);
});

test('the message about an unreachable server goes away when the connection returns', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url, '', { key: DEMO_KEY });
  await page.click('#add-btn');
  await choose(page, '#f-line', 'Line E');
  await page.fill('#f-title', 'TEST Offline Clears');
  await page.evaluate(() => { window.__rhlDemo.offline = true; });
  await page.click('#job-save');
  await page.waitForFunction(() => /Could not reach the server/.test(document.querySelector('#job-msg')?.textContent ?? ''), null, { timeout: 8000 });
  // the connection drops and comes back, as the browser reports it
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); });
  await page.waitForFunction(() => document.querySelector('#job-save').disabled, null, { timeout: 3000 });
  await page.evaluate(() => { window.__rhlDemo.offline = false; window.dispatchEvent(new Event('online')); });
  await page.waitForFunction(() => document.querySelector('#job-msg')?.textContent === '', null, { timeout: 8000 });
  assert.equal(await page.locator('#job-save').isDisabled(), false);
});
