// Measured contrast for BOTH themes. Reads the literal tokens from src/styles.css (light block, dark block, the :root inside
// @media print = paper), composites any translucent token over its backdrop, and asserts WCAG ratios on the real pairs.
// Surfaces are opaque tone steps (page, panel, raised, floating), so there is no backdrop to guess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const blockAfter = (src, selectorRe) => {
  const m = selectorRe.exec(src);
  if (!m) throw new Error(`no token block for ${selectorRe}`);
  const end = src.indexOf('}', m.index);
  return src.slice(m.index + m[0].length, end);
};
export const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().replace(/\s*\/\*.*$/, '')]));
export const LIGHT = tokens(blockAfter(css, /:root,\s*\[data-theme="light"\]\s*\{/));
export const DARK = tokens(blockAfter(css, /:root\[data-theme="dark"\],\s*\[data-theme="dark"\]\s*\{/));
const printAt = css.indexOf('@media print');
export const PAPER = { ...LIGHT, ...tokens(blockAfter(css.slice(printAt), /:root,\s*:root\[data-theme\],\s*\[data-theme\]\s*\{/)) };

export function parse(v) {
  v = v.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(v);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
  throw new Error(`token is not a literal colour: ${v}`);
}
const over = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
export const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export const results = {}; // theme -> [name, ratio, min]
for (const [theme, T] of Object.entries({ light: LIGHT, dark: DARK, paper: PAPER })) {
  const c = (k) => parse(T[k]);
  const rows = [];
  const check = (name, fg, bg, min) => rows.push([name, ratio(fg, bg), min]);
  const page = c('page');
  const surf = { page, panel: over(c('panel'), page), raised: over(c('raised'), page), floating: over(c('floating'), page), hover: over(c('hover'), page), field: over(c('field'), page), cue: over(c('cue'), page) };
  for (const [n, bg] of Object.entries(surf)) check(`ink on ${n}`, c('ink'), bg, 7);
  for (const [n, bg] of Object.entries(surf)) check(`muted on ${n}`, c('muted'), bg, 4.5);
  if (theme !== 'paper') {
    for (const n of ['page', 'panel', 'raised', 'floating', 'hover']) check(`accent text on ${n}`, c('accent-text'), surf[n], 4.5);
    for (const n of ['page', 'panel', 'raised', 'floating', 'hover', 'field']) check(`focus ring on ${n}`, c('ring'), surf[n], 3);
    for (const n of ['page', 'panel', 'raised', 'floating', 'field']) check(`field boundary vs ${n}`, c('field-line'), surf[n], 3);
    check('danger text on floating', c('danger'), surf.floating, 4.5);
    check('danger text on panel', c('danger'), surf.panel, 4.5);
    check('ink on warn banner', c('ink'), c('warn-bg'), 7);
    check('ink on error banner', c('ink'), c('error-bg'), 7);
    check('warn banner edge vs page', c('dot-warn'), page, 3);
    check('danger edge vs page', c('danger'), page, 3);
    check('test-data dot vs page', c('dot-warn'), page, 3);
    check('live dot vs page', c('accent-text'), page, 3);
    check('on-accent text on primary button', c('on-accent'), c('accent'), 7);
    check('on-accent text on primary button hover', c('on-accent'), c('accent-hover'), 7);
    check('selection text on accent', c('on-accent'), c('accent'), 7);
    check('row frame vs page (a boundary, 3:1)', c('frame'), page, 3);
    check('row frame vs row fill', c('frame'), surf.panel, 3);
    check('compact initials swatch edge (muted) vs the card', c('muted'), surf.raised, 3);
    // initials colour coding: ink on each tint (the chip and the legend)
    for (const h of ['blue', 'pink', 'orange', 'green', 'purple']) { check(`ink on initials tint "${h}"`, c('ink'), c(`hue-${h}`), 7); check(`initials tint "${h}" on the card is still a tint (not the card colour)`, c(`hue-${h}`), surf.raised, 1.05); }
    // the command bubble is translucent (alpha fill, no blur): text must pass over the worst thing that can sit under it, the bay marker
    const bubbleOver = over(c('bubble-fill'), over(c('marker-bg'), page));
    check('ink on the translucent bubble over a bay marker', c('ink'), bubbleOver, 7);
    check('muted on the translucent bubble over a bay marker', c('muted'), bubbleOver, 4.5);
    check('field boundary on the translucent bubble over a bay marker', c('field-line'), bubbleOver, 3);
    // the dock: by default the bubble rests on the page ground under the board, not on a row
    const bubbleOnPage = over(c('bubble-fill'), page);
    check('ink on the translucent bubble in the dock (over the page)', c('ink'), bubbleOnPage, 7);
    check('muted on the translucent bubble in the dock (over the page)', c('muted'), bubbleOnPage, 4.5);
    check('field boundary on the translucent bubble in the dock (over the page)', c('field-line'), bubbleOnPage, 3);
    check('bubble frame edge vs the page in the dock', c('frame'), page, 3);
    check('floating layer edge vs board panel', c('line-strong'), surf.panel, 1.1);
    check('bay marker block vs board panel (occupied line reads at distance)', c('marker-bg'), surf.panel, 4.5);
    // drag handle: the idle state dot is a muted ring on the floating bubble, needs-you is an accent ring, working fills with ink
    check('drag handle idle ring (muted) on bubble', c('muted'), surf.floating, 3);
    check('drag handle needs-you ring (accent) on bubble', c('accent-text'), surf.floating, 3);
    check('drag handle working dot (ink) on bubble', c('ink'), surf.floating, 3);
  }
  for (const s of ['open', 'hold', 'ready', 'done']) check(`status "${s}": word on badge fill`, c(`${s}-fg`), c(`${s}-bg`), 4.5);
  check('line letter on bay marker', c('marker-fg'), c('marker-bg'), 7);
  check('dimmed (non-matching) text: muted on board panel', c('muted'), surf.panel, 4.5);
  results[theme] = rows;
}

for (const theme of ['light', 'dark', 'paper']) {
  test(`${theme}: every measured pair meets its WCAG threshold`, () => {
    const bad = results[theme].filter(([, r, min]) => r < min).map(([n, r, min]) => `${n}: ${r.toFixed(2)} < ${min}`);
    assert.deepEqual(bad, []);
  });
}

test('light and dark define the same tokens, all literal colours', () => {
  assert.deepEqual(Object.keys(LIGHT).sort(), Object.keys(DARK).sort());
  for (const T of [LIGHT, DARK]) for (const [k, v] of Object.entries(T)) if (k !== 'color-scheme') parse(v);
});

test('the surface ladder steps up page -> panel -> raised -> floating in each theme, and dark is lifted off black', () => {
  for (const [theme, T] of Object.entries({ light: LIGHT, dark: DARK })) {
    const page = parse(T.page);
    const steps = [page, over(parse(T.panel), page), over(parse(T.raised), page), over(parse(T.floating), page)];
    for (let i = 1; i < steps.length; i++) if (!(theme === 'light' && i === 2)) assert.ok(ratio(steps[i - 1], steps[i]) >= 1.04, `${theme}: step ${i} is distinguishable (${ratio(steps[i - 1], steps[i]).toFixed(3)})`);
  }
  assert.ok(lum(parse(DARK.page)) >= 0.006, 'dark page is graphite, not black');
  assert.ok(lum(parse(DARK.page)) < lum(parse(DARK.panel)) && lum(parse(DARK.panel)) < lum(parse(DARK.raised)) && lum(parse(DARK.raised)) < lum(parse(DARK.floating)), 'dark ladder rises');
  assert.ok(lum(parse(LIGHT.page)) < lum(parse(LIGHT.panel)), 'light: panel is a step above the page');
});

test('paper tokens are opaque', () => {
  for (const k of ['page', 'panel', 'raised', 'floating', 'open-bg', 'hold-bg', 'ready-bg', 'done-bg']) assert.equal(parse(PAPER[k])[3], 1, k);
});

if (process.env.CONTRAST_TABLE) for (const [t, rows] of Object.entries(results)) { console.log(`\n# ${t}`); for (const [n, r, min] of rows) console.log(`${r.toFixed(2).padStart(6)}  >= ${String(min).padEnd(3)}  ${n}`); }
