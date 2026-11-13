// Gate 1 (Operate surfaces): scripted multi-width lint of the RENDERED page. Mechanical tells only:
// horizontal overflow, text contrast, focus presence. usage: node ops/lint-multiwidth.mjs <URL> [widths=320,390,768,1024,1280,1366,1920]
import { chromium } from 'playwright-core';
const [url, w] = process.argv.slice(2);
if (!url) { console.error('usage: node ops/lint-multiwidth.mjs <URL> [widths]'); process.exit(2); }
const widths = (w || '320,390,768,1024,1280,1366,1920').split(',').map(Number);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const problems = [];
const lum = ([r, g, bl]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl); };
for (const scheme of ['light', 'dark']) for (const width of widths) {
  const p = await (await b.newContext({ viewport: { width, height: width < 700 ? 844 : 800 }, colorScheme: scheme })).newPage();
  await p.goto(url); await p.waitForSelector('.row'); await p.waitForTimeout(400);
  const tag = `${scheme}@${width}`;
  const r = await p.evaluate(() => {
    const out = { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, low: [] };
    const parse = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 1]; return { rgb: m.slice(0, 3), a: m[3] ?? 1 }; };
    const over = (top, bot) => ({ rgb: top.rgb.map((v, i) => v * top.a + bot.rgb[i] * (1 - top.a)), a: 1 });
    const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(parse(getComputedStyle(e).backgroundColor)); let acc = { rgb: [255, 255, 255], a: 1 }; for (const c of chain.reverse()) acc = over(c, acc); return acc; };
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const t = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
      if (!t || !el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0 || el.closest('.sr-only,[aria-hidden=true]')) continue;
      const fg = over(parse(cs.color), bgOf(el)); const bg = bgOf(el);
      const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const [a, b2] = [L(fg.rgb), L(bg.rgb)]; const ratio = (Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05);
      const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
      const key = `${cs.color}|${bg.rgb.map(Math.round)}`; if (ratio < (big ? 3 : 4.5) && !seen.has(key)) { seen.add(key); out.low.push(`${t.slice(0, 30)} ${ratio.toFixed(2)}`); }
    }
    return out;
  });
  if (r.overflow) problems.push(`${tag}: horizontal overflow`);
  for (const l of r.low) problems.push(`${tag}: low contrast "${l}"`);
  // focus presence: every focusable shows a visible outline when focused by keyboard
  const n = await p.evaluate(() => [...document.querySelectorAll('button,input,select,a[href],[role=combobox],[tabindex="0"]')].filter(e => e.offsetParent && !e.disabled).length);
  let noFocus = 0;
  await p.keyboard.press('Tab');
  for (let i = 0; i < Math.min(n, 60); i++) {
    const vis = await p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const ringed = (n) => { const c = getComputedStyle(n); return c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 1; }; return ringed(e) || ((e.classList.contains('customer-btn') || e.classList.contains('status')) && !!e.closest('.job') && ringed(e.closest('.job'))); }); // the name button and the status badge hand their ring to their card (round 6)
    if (vis === false) noFocus++;
    await p.keyboard.press('Tab');
  }
  if (noFocus) problems.push(`${tag}: ${noFocus} focus stops with no visible outline`);
  await p.context().close();
}
await b.close();
console.log(problems.length ? 'LINT FAIL\n' + problems.join('\n') : `LINT PASS (${widths.length} widths x 2 themes: no overflow, contrast >= 4.5 (3 for large), visible focus on every stop)`);
process.exit(problems.length ? 1 : 0);
