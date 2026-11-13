// The functional core, end to end on the demo build: click any job for its details, adjust them, add a job on any line (occupied or empty) from the board,
// delete with confirm, with every key state (none, expired, revoked, valid), mouse and keyboard. The key arrives in the URL fragment, never typed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAndServe, launch, newCtx, openBoard, unlock, choose, STATUS_TRIGGER, DEMO_KEY, DEMO_KEYS } from './helpers.mjs';

let srv; let browser;
before(async () => { srv = await buildAndServe({ VITE_BACKEND: 'demo' }); browser = await launch(); });
after(async () => { await browser?.close(); srv?.stop(); });

async function ctxFor(t, opts) {
  const c = await newCtx(browser, opts);
  t.after(async () => { await c.ctx.close(); assert.deepEqual(c.log.errors, [], 'console errors'); });
  return c;
}
const text = (page, sel) => page.locator(sel).first().innerText();
const entries = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('rhl.demo.v1')).entries.length);
const NOTICE = { none: 'Viewing only. Your agent turns on editing when you open this board through it.', expired: 'Editing has ended. Ask your agent to open this board again.', invalid: 'Editing is not available here. Ask your agent to open this board again.' };

test('no key: everything is visible and clickable, details open read-only with a plain notice, nothing asks for a secret, nothing saves', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url);
  assert.equal(await text(page, '#key-status'), 'View only');
  assert.equal(await page.getAttribute('#key-status', 'data-state'), 'none');
  assert.equal(await page.getAttribute('#board', 'data-key-state'), 'none');
  assert.equal(await page.getAttribute('#board', 'data-can-edit'), 'false');
  for (const sel of ['#add-btn', '[data-add-line="D"]', '.job button[data-field="title"]', STATUS_TRIGGER]) assert.equal(await page.locator(sel).first().isVisible(), true, `${sel} is visible without a key`);
  // click a job: its details open (read-only)
  const before = await entries(page);
  await page.locator('.job', { hasText: 'TEST Harbour Bakery' }).click({ position: { x: 20, y: 8 } }); // the card itself, not a control
  await page.waitForSelector('#job-dialog');
  assert.equal(await page.inputValue('#f-title'), 'TEST Harbour Bakery');
  assert.equal(await page.inputValue('#f-details'), 'Pallet 4, chilled');
  assert.equal(await page.inputValue('#f-initials'), 'JA');
  assert.equal(await text(page, '#f-status'), 'Open');
  assert.match(await text(page, '#f-line'), /Line A/);
  assert.match(await text(page, '#job-meta'), /^Revision 1/);
  assert.equal(await page.getAttribute('#f-title', 'readonly'), '', 'read-only without a key');
  assert.equal(await text(page, '.key-notice p'), NOTICE.none);
  assert.equal(await page.locator('.key-notice input').count(), 0, 'the notice has no input');
  assert.equal(await page.locator('#job-save').isDisabled(), true, 'Save is disabled on a read-only job');
  assert.equal(await page.locator('#job-delete').isDisabled(), true, 'Delete is disabled on a read-only job');
  assert.equal(await entries(page), before, 'nothing is saved without a key');
  // no secret anywhere
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  assert.doesNotMatch(await page.evaluate(() => document.documentElement.innerHTML), /passcode|password/i);
  await page.waitForSelector('.demo-keys button');
  assert.deepEqual(await page.locator('.demo-keys button').allInnerTexts(), ['Try editing', 'Try an ended session', 'Try a turned-off session']);
  // a status chosen on a card without a key opens the details with the notice instead of saving
  await page.click('#job-cancel');
  await choose(page, page.locator('.job', { hasText: 'TEST Beacon Hardware' }).locator(STATUS_TRIGGER), 'Ready');
  await page.waitForSelector('#job-dialog .key-notice');
  assert.equal(await entries(page), before);
  assert.equal(await page.getAttribute('.job:has-text("TEST Beacon Hardware")', 'data-status'), 'hold', 'unchanged');
});

test('expired and revoked keys: refused with their own plain notice, the chip says so, nothing is saved', async (t) => {
  const { ctx } = await ctxFor(t);
  for (const [name, key, state, label] of [['expired', DEMO_KEYS.expired, 'expired', 'Editing ended'], ['revoked', DEMO_KEYS.revoked, 'invalid', 'Editing unavailable']]) {
    const page = await openBoard(ctx, srv.url, '', { key });
    assert.equal(await page.getAttribute('#key-status', 'data-state'), state, name);
    assert.equal(await text(page, '#key-status'), label);
    const before = await entries(page);
    await page.click('#add-btn');
    await page.waitForSelector('#job-dialog');
    assert.equal(await text(page, '.key-notice p'), NOTICE[state === 'invalid' ? 'invalid' : 'expired']);
    await page.fill('#f-title', `TEST refused ${name}`);
    assert.equal(await page.locator('#job-save').isDisabled(), true, `${name}: Save is off without a usable key`);
    assert.equal(await entries(page), before, `${name}: nothing saved`);
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    await page.keyboard.press('Escape');
    await page.locator('.job').first().click({ position: { x: 20, y: 8 } });
    await page.waitForSelector('#job-dialog');
    assert.equal(await page.locator('#job-save').isDisabled(), true, `${name}: Save is disabled on an existing job`);
    assert.equal(await page.locator('#job-delete').isDisabled(), true, `${name}: Delete is disabled on an existing job`);
    await page.close();
  }
});

test('valid key: the whole functional core, mouse: details, edit every field, move line, persist, second device, delete with confirm, inline add on an occupied and an empty line', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url, '', { key: DEMO_KEY });
  const second = await openBoard(ctx, srv.url);
  assert.equal(await text(page, '#key-status'), 'Editing as Demo employee');
  assert.equal(await page.getAttribute('#board', 'data-can-edit'), 'true');
  // 1. click a job -> details; edit title, note, initials, status and move to line E; save
  const card = page.locator('.job', { hasText: 'TEST Harbour Bakery' });
  const id = await card.getAttribute('data-id');
  await card.click({ position: { x: 20, y: 8 } });
  await page.waitForSelector('#job-dialog');
  assert.equal(await page.locator('.key-notice').count(), 0, 'a valid key just works: no notice, no prompt');
  await page.fill('#f-title', 'TEST Harbour Bakery 2');
  await page.fill('#f-details', 'moved and changed');
  await page.fill('#f-initials', 'ZQ');
  await choose(page, '#f-status', 'Ready');
  await choose(page, '#f-line', 'Line E');
  await page.click('#job-save');
  await page.waitForSelector(`.row[data-line="E"] .job[data-id="${id}"][data-status="ready"]`);
  assert.equal(await text(page, `.job[data-id="${id}"] [data-field="title"]`), 'TEST Harbour Bakery 2');
  assert.equal(await text(page, `.job[data-id="${id}"] [data-field="details"]`), 'moved and changed');
  assert.equal(await text(page, `.job[data-id="${id}"] [data-field="initials"]`), 'ZQ');
  assert.equal(await page.getAttribute(`.job[data-id="${id}"]`, 'data-revision'), '2');
  // second device (same origin) sees it within 5 s
  await second.waitForSelector(`.row[data-line="E"] .job[data-id="${id}"][data-status="ready"]`, { timeout: 5000 });
  // reload persists
  await page.reload();
  await page.waitForSelector(`.row[data-line="E"] .job[data-id="${id}"][data-status="ready"]`);
  assert.equal(await text(page, `.job[data-id="${id}"] [data-field="title"]`), 'TEST Harbour Bakery 2');
  // 2. inline add on an OCCUPIED line (C) and on an EMPTY line (D), line preselected, no hunting
  for (const [line, title] of [['C', 'TEST Inline Occupied'], ['D', 'TEST Inline Empty']]) {
    const n = await page.locator(`.row[data-line="${line}"] .job`).count();
    await page.click(`[data-add-line="${line}"]`);
    await page.waitForSelector(`#add-${line}-title`);
    await page.fill(`#add-${line}-title`, title);
    await page.fill(`#add-${line}-details`, 'added on the board');
    await page.fill(`#add-${line}-initials`, 'IN');
    await choose(page, `#add-${line}-status`, 'On hold');
    await page.click(`#add-${line}-save`);
    await page.waitForSelector(`.row[data-line="${line}"] .job:has-text("${title}")`);
    assert.equal(await page.locator(`.row[data-line="${line}"] .job`).count(), n + 1);
    assert.equal(await page.locator(`.row[data-line="${line}"] .job:has-text("${title}")`).getAttribute('data-status'), 'hold');
  }
  assert.equal(await page.getAttribute('.row[data-line="D"]', 'data-empty'), null, 'the empty line is no longer empty');
  await page.reload();
  await page.waitForSelector('.row[data-line="D"] .job:has-text("TEST Inline Empty")');
  await page.waitForSelector('.row[data-line="C"] .job:has-text("TEST Inline Occupied")');
  // 3. delete asks twice
  await page.click('.row[data-line="D"] .customer-btn');
  await page.click('#job-delete');
  assert.equal(await text(page, '#job-delete'), 'Confirm delete');
  assert.equal(await page.locator('.row[data-line="D"] .job').count(), 1, 'one click does not delete');
  await page.click('#job-delete');
  await page.waitForSelector('.row[data-line="D"][data-empty="true"]');
  await second.waitForSelector('.row[data-line="D"][data-empty="true"]', { timeout: 5000 });
});

test('the same functional core, keyboard only: Tab order is the page order, open details, edit, save, add inline', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url, 'empty', { key: DEMO_KEY });
  await page.evaluate(() => document.activeElement?.blur());
  const order = [];
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement.id || document.activeElement.getAttribute('data-add-line') || document.activeElement.tagName)); }
  assert.deepEqual(order.slice(0, 3), ['grip', 'search', 'add-btn'], 'the bubble comes first, as it is drawn (the key chip is a status, not a stop)');
  assert.equal(order[3], 'A', 'then the board, line A first'); // the first Add job of the first row
  // add on the empty line F with the keyboard
  await page.focus('[data-add-line="F"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#add-F-title');
  await page.keyboard.type('TEST Keyboard Added');
  await page.keyboard.press('Tab'); await page.keyboard.type('by keys');
  await page.keyboard.press('Tab'); await page.keyboard.type('KB');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.row[data-line="F"] .job:has-text("TEST Keyboard Added")');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-add-line') === 'F', null, { timeout: 2000 }).catch(() => {});
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-add-line')), 'F', 'focus is not lost when the empty row gains its first job: it stays on that row\'s Add job');
  // open its details from the keyboard, rename, save
  await page.focus('.row[data-line="F"] .customer-btn');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#job-dialog');
  await page.fill('#f-title', 'TEST Keyboard Renamed');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.row[data-line="F"] .customer:has-text("TEST Keyboard Renamed")');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-focus')?.startsWith('edit:')), true, 'focus is back on the card');
});

test('the key walkthrough in one tab: no key, expired, revoked, then valid via the demo buttons, the notice goes and the same panel saves', async (t) => {
  const { ctx } = await ctxFor(t);
  const page = await openBoard(ctx, srv.url, 'empty');
  await page.click('[data-add-line="B"]');
  await page.waitForSelector('#add-B-title');
  assert.equal(await text(page, '.key-notice p'), NOTICE.none);
  await page.fill('#add-B-title', 'TEST Walkthrough');
  await page.click('button:has-text("Try an ended session")');
  await page.waitForSelector('#key-status[data-state="expired"]');
  assert.equal(await text(page, '.key-notice p'), NOTICE.expired);
  await page.click('button:has-text("Try a turned-off session")');
  await page.waitForSelector('#key-status[data-state="invalid"]');
  assert.equal(await text(page, '.key-notice p'), NOTICE.invalid);
  await page.click('button:has-text("Try editing")');
  await page.waitForSelector('#key-status[data-state="valid"]');
  assert.equal(await page.locator('.key-notice').count(), 0);
  assert.equal(await page.inputValue('#add-B-title'), 'TEST Walkthrough', 'what was typed is still there');
  await page.click('#add-B-save');
  await page.waitForSelector('.row[data-line="B"] .job:has-text("TEST Walkthrough")');
});

test('launch key: stripped from the address bar before the page runs, kept in sessionStorage only, in no request URL, not in a copied link; other fragment parameters stay', async (t) => {
  const { ctx, log } = await ctxFor(t);
  const page = await ctx.newPage();
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { window.__dcl = { hash: location.hash, href: location.href, ss: sessionStorage.getItem('rhl.key'), ls: JSON.stringify(localStorage) }; }));
  await page.goto(`${srv.url}?demo=empty#view=wall&key=${DEMO_KEY}`);
  await page.waitForSelector('#key-status[data-state="valid"]');
  const dcl = await page.evaluate(() => window.__dcl);
  assert.equal(dcl.hash, '#view=wall', 'at DOMContentLoaded the key is already out of the address bar, the rest of the fragment stays');
  assert.equal(dcl.ss, DEMO_KEY);
  assert.ok(!dcl.href.includes(DEMO_KEY) && !dcl.ls.includes(DEMO_KEY));
  const now = await page.evaluate(() => ({ hash: location.hash, href: location.href, ss: sessionStorage.getItem('rhl.key'), ls: JSON.stringify(localStorage), search: location.search }));
  assert.equal(now.hash, '#view=wall');
  assert.equal(now.ss, DEMO_KEY, 'sessionStorage holds it for this tab');
  assert.ok(!now.ls.includes(DEMO_KEY), 'localStorage does not');
  assert.ok(!now.href.includes(DEMO_KEY), 'a copied link has no key');
  assert.ok(!now.search.includes('key'), 'never in the query string');
  assert.deepEqual(log.requests.filter((u) => u.includes(DEMO_KEY)), [], 'no request URL carries the key');
  // a key handed to an open board by a fragment change is taken the same way
  await unlock(page, DEMO_KEYS.expired, 'expired');
  assert.ok(!(await page.evaluate(() => location.href)).includes('demo-expired'));
  // another tab does not inherit it
  const other = await ctx.newPage();
  await other.goto(srv.url + '?demo=empty');
  await other.waitForSelector('#board');
  assert.equal(await other.getAttribute('#key-status', 'data-state'), 'none');
});

test('production build: only the two named VITE_ values reach the bundle (no other VITE_ variable, no Vercel system variable), and RHL_BUILD_ID sets the version label', async () => {
  const prod = await buildAndServe({ VITE_BACKEND: 'supabase', VITE_SUPABASE_URL: 'http://127.0.0.1:1', VITE_SUPABASE_ANON_KEY: 'dummy', VITE_CANARY_MUST_NOT_SHIP: 'canary-7d1c', VITE_VERCEL_URL: 'canary-team-slug.vercel.app', RHL_BUILD_ID: 'abc1234def' });
  try {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const all = walk(prod.outDir).filter((f) => /\.(js|css|html)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const needle of ['canary-7d1c', 'canary-team-slug', 'VITE_CANARY', 'VITE_VERCEL']) assert.ok(!all.includes(needle), `production bundle must not carry ${needle}`);
    assert.ok(all.includes('abc1234'), 'the build id comes from RHL_BUILD_ID (first 7 characters)');
  } finally { prod.stop(); }
});

test('production build: no demo key, no demo buttons, no passcode anywhere in the shipped files (static flag)', async () => {
  const prod = await buildAndServe({ VITE_BACKEND: 'supabase', VITE_SUPABASE_URL: 'http://127.0.0.1:1', VITE_SUPABASE_ANON_KEY: 'dummy' });
  try {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const files = walk(prod.outDir).filter((f) => /\.(js|css|html)$/.test(f));
    const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const needle of ['demo-employee', 'demo-expired', 'demo-revoked', 'Try editing', 'Try an ended session', 'Try a turned-off session', 'Demo employee']) assert.ok(!all.includes(needle), `production build contains "${needle}"`);
    assert.doesNotMatch(all, /passcode|check_passcode|edit_gate|type="password"|type:"password"|type:'password'/i);
    assert.ok(!files.some((f) => /DemoKeys|demo-[\w-]*\.js$/.test(f)), 'no demo chunk is emitted');
  } finally { prod.stop(); }
});
