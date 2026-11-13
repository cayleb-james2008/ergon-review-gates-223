// Pack-check, rendered half. Builds the style guide entry (STYLEGUIDE=1) and verifies, in a real browser, that every component
// declared in design/components renders every declared state in both themes, that forced states really differ from the baseline,
// and that the themes render the pack's own tokens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildAndServe, launch, newCtx, ROOT } from './helpers.mjs';

const specs = readdirSync(join(ROOT, 'design/components')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, 'design/components', f), 'utf8')));
const tokens = JSON.parse(readFileSync(join(ROOT, 'design/tokens.json'), 'utf8'));
let srv; let browser; let page; let log;

before(async () => {
  srv = await buildAndServe({ VITE_BACKEND: 'demo', STYLEGUIDE: '1' });
  browser = await launch();
  const c = await newCtx(browser, { viewport: { width: 1400, height: 900 } });
  log = c.log;
  page = await c.ctx.newPage();
  await page.goto(`${srv.url}styleguide.html`);
  await page.waitForSelector('[data-specimen]');
  await page.waitForTimeout(800); // floating specimens mount and finish their enter animation
});
after(async () => { await browser?.close(); srv?.stop(); });

const spec = (component, state, theme) => `[data-specimen][data-component="${component}"][data-state="${state}"][data-theme-of="${theme}"]`;
const measure = (component, state, theme, prop) => page.$eval(spec(component, state, theme), (root, p) => {
  const el = root.querySelector('[data-measure]') ?? root.firstElementChild;
  const cs = getComputedStyle(el);
  return cs.getPropertyValue(p);
}, prop);

test('every declared component has a section and every declared state renders in both themes', async () => {
  const missing = [];
  for (const s of specs) {
    if (!(await page.locator(`section[data-component="${s.name}"]`).count())) { missing.push(`${s.name}: no section`); continue; }
    for (const state of s.states) for (const theme of ['light', 'dark']) {
      const loc = page.locator(spec(s.name, state, theme));
      if ((await loc.count()) !== 1) { missing.push(`${s.name}/${state}/${theme}: ${await loc.count()} specimens`); continue; }
      if (await loc.locator('.guide-missing').count()) { missing.push(`${s.name}/${state}/${theme}: no specimen implemented`); continue; }
      // floating layers (dialog, popover, tooltip, open select) mount in their cell's portal container, next to the specimen
      const target = (await loc.innerHTML()).trim() && ((await loc.boundingBox())?.height ?? 0) >= 8 ? loc : loc.locator('xpath=ancestor::div[contains(@class,"cell")]').locator('.floating').first();
      const box = await target.boundingBox().catch(() => null);
      if (!box || box.width < 8 || box.height < 8) missing.push(`${s.name}/${state}/${theme}: not rendered`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the style guide has no section that the pack does not declare', async () => {
  const sections = await page.$$eval('section[data-component]', (n) => n.map((x) => x.dataset.component));
  assert.deepEqual(sections.sort(), specs.map((s) => s.name).sort());
  const states = await page.$$eval('[data-specimen]', (n) => n.length);
  assert.equal(states, specs.reduce((n, s) => n + s.states.length * 2, 0));
});

test('forced states really differ from their baseline (hover, press, focus, disabled, error, hit, dim, cue ...)', async () => {
  const same = [];
  for (const s of specs) for (const [state, prop] of Object.entries(s.check)) for (const theme of ['light', 'dark']) {
    const base = (s.against ?? {})[state] ?? s.states[0];
    const [a, b] = [await measure(s.name, base, theme, prop), await measure(s.name, state, theme, prop)];
    if (a === b) same.push(`${s.name}/${state}/${theme}: ${prop} is ${a} in both ${base} and ${state}`);
  }
  assert.deepEqual(same, []);
});

test('the two themes render the pack tokens (computed custom properties equal design/tokens.json)', async () => {
  for (const theme of ['light', 'dark']) {
    // compare as the browser resolves them, so #fff and #ffffff, or rgb() and its hex form, are the same colour
    const { got, want } = await page.$eval(`.cell[data-theme="${theme}"]`, (el, t) => {
      const px = document.createElement('i'); el.append(px);
      const resolve = (v) => { px.style.color = ''; px.style.color = v; return getComputedStyle(px).color; };
      const out = { got: {}, want: {} };
      for (const [k, v] of Object.entries(t)) { out.got[k] = resolve(getComputedStyle(el).getPropertyValue(`--${k}`).trim()); out.want[k] = resolve(v); }
      px.remove();
      return out;
    }, tokens.colour[theme]);
    assert.deepEqual(got, want, theme);
  }
  const bg = await page.$$eval('.cell', (n) => [...new Set(n.map((c) => `${c.dataset.theme}:${getComputedStyle(c).backgroundColor}`))]);
  assert.equal(bg.length, 2, 'one background per theme');
});

test('style guide renders without console errors, failed or external requests, and shows no blur, shadow or gradient', async () => {
  assert.deepEqual(log.errors, []);
  assert.deepEqual(log.failed, []);
  const origin = new URL(srv.url).origin;
  assert.deepEqual(log.requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:')), []);
  const bad = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((n) => { const c = getComputedStyle(n); return (c.backdropFilter && c.backdropFilter !== 'none') || c.boxShadow !== 'none' || /gradient/.test(c.backgroundImage); }).length);
  assert.equal(bad, 0);
});

test('the compact card specimens show the declared anatomy inside the visible box: name, status glyph and initials tint, in every state and both themes; the occupied line row shows cards', async () => {
  const bad = [];
  const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
  for (const state of ['default', 'hover', 'focus', 'hit', 'dim', 'disabled']) for (const theme of ['light', 'dark']) {
    const root = page.locator(spec('job-card-compact', state, theme));
    const card = root.locator('.job'); const jobs = root.locator('.jobs');
    const [c, j] = [await card.boundingBox(), await jobs.boundingBox()];
    const parts = { name: await card.locator('.customer').boundingBox(), glyph: await card.locator('.status .glyph svg').boundingBox(), tint: await card.locator('.initials').boundingBox() };
    for (const [k, box] of Object.entries(parts)) {
      if (!box || box.width < 4 || box.height < 4) bad.push(`${state}/${theme}: ${k} not rendered`);
      else if (!inside(box, c) || !inside(box, j)) bad.push(`${state}/${theme}: ${k} is outside the visible card`);
    }
    if (parts.name && parts.name.width < 40) bad.push(`${state}/${theme}: the name has ${parts.name.width}px`);
    const tint = await card.locator('.initials').evaluate((n) => getComputedStyle(n).backgroundColor);
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(tint)) bad.push(`${state}/${theme}: the initials tint is empty`);
  }
  for (const theme of ['light', 'dark']) {
    const n = await page.locator(spec('line-row', 'occupied', theme)).locator('.job').count();
    if (n < 2) bad.push(`line-row/occupied/${theme}: ${n} cards`);
  }
  assert.deepEqual(bad, []);
});

test('bubble specimens show the whole placeholder in every state and both themes (the field is not clipped)', async () => {
  const clipped = await page.$$eval('[data-specimen][data-component="bubble"] input[type="search"]', (inputs) => inputs.flatMap((el) => {
    const cs = getComputedStyle(el); const c = document.createElement('canvas').getContext('2d'); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const need = c.measureText(el.placeholder).width; const have = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return need > have ? [`${el.closest('[data-specimen]').dataset.state}/${el.closest('[data-specimen]').dataset.themeOf}: needs ${need.toFixed(0)}px, has ${have.toFixed(0)}px`] : [];
  }));
  assert.equal(await page.locator('[data-specimen][data-component="bubble"] input[type="search"]').count(), 8, 'all 8 bubble specimens were measured');
  assert.deepEqual(clipped, []);
});
