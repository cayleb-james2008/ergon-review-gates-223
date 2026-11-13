// Pack-check, source half: tokens.json mirrors src/styles.css, every component spec is complete, every declared state has a
// check or a specimen, components reference tokens that exist. The rendered half is test/e2e/pack-check.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIGHT, DARK, PAPER } from './contrast.test.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const tokens = JSON.parse(readFileSync(join(ROOT, 'design/tokens.json'), 'utf8'));
const specs = readdirSync(join(ROOT, 'design/components')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, 'design/components', f), 'utf8')));
const strip = (T) => Object.fromEntries(Object.entries(T).filter(([k]) => k !== 'color-scheme'));

test('design/tokens.json mirrors the colour tokens in src/styles.css (light, dark, paper)', () => {
  assert.deepEqual(tokens.colour.light, strip(LIGHT));
  assert.deepEqual(tokens.colour.dark, strip(DARK));
  assert.deepEqual(tokens.colour.paper, Object.fromEntries(Object.entries(strip(PAPER)).filter(([k, v]) => LIGHT[k] !== v)));
});

test('design/tokens.json radii, type scale and motion match the CSS', () => {
  const css = readFileSync(join(ROOT, 'src/styles.css'), 'utf8');
  for (const [k, v] of Object.entries({ badge: tokens.radius.badge, control: tokens.radius.control, card: tokens.radius.card, panel: tokens.radius.panel, float: tokens.radius.float })) assert.match(css, new RegExp(`--r-${k}: ${v}`), `radius ${k}`);
  for (const [k, v] of Object.entries({ tap: tokens.motion.tap, swap: tokens.motion.swap, enter: tokens.motion.enter, sheet: tokens.motion.sheet })) assert.match(css, new RegExp(`--motion-${k}: ${v}`), `motion ${k}`);
  assert.ok(css.includes(`--ease: ${tokens.motion.ease}`));
  for (const [name, px] of Object.entries(tokens.type.scale)) assert.match(css, new RegExp(`--text-${name}: ${px}`), `type ${name}`);
  for (const [name, v] of Object.entries(tokens.opacity)) if (name !== 'rule') assert.match(css, new RegExp(`--opacity-${name}: ${v.replace('.', '\\.')}`), `opacity ${name}`);
  assert.match(css, /--fs: 14px/); assert.match(css, /--fs-title: 16px/); assert.match(css, /--fs-compact: 12px/);
});

test('every admitted component declares its file, tokens and states', () => {
  assert.ok(specs.length >= 20, `${specs.length} components`);
  for (const s of specs) {
    assert.ok(s.name && s.title && s.file && s.notes, `${s.name}: name, title, file, notes`);
    for (const f of [s.file, ...(s.also ?? [])]) assert.ok(existsSync(join(ROOT, f)), `${s.name}: ${f} exists`);
    assert.ok(s.states.length >= 1, `${s.name}: states`);
    for (const t of s.uses) assert.ok(t in tokens.colour.light && t in tokens.colour.dark, `${s.name}: token --${t} exists in both themes`);
    for (const st of Object.keys(s.check)) assert.ok(s.states.includes(st), `${s.name}: check for undeclared state ${st}`);
  }
  for (const need of ['button', 'input', 'select', 'dialog', 'popover', 'badge', 'alert', 'skeleton', 'tooltip', 'bubble', 'job-card', 'drag-handle',
    // the header, board-message and density parts that earlier rounds waved through as "no styling of their own": each is styled in src/styles.css, so each is declared with all its states
    'legend-chip', 'connection', 'test-marker', 'board-message', 'board-note', 'version-label', 'job-card-compact']) assert.ok(specs.some((s) => s.name === need), `${need} is admitted`);
});

test('interactive components declare hover, press or focus, disabled, and an error or loading state where they have one', () => {
  const by = (n) => specs.find((s) => s.name === n).states;
  for (const st of ['default', 'hover', 'press', 'focus', 'disabled', 'loading']) assert.ok(by('button').includes(st), `button ${st}`);
  for (const st of ['default', 'hover', 'focus', 'disabled', 'error']) assert.ok(by('input').includes(st), `input ${st}`);
  for (const st of ['default', 'hover', 'focus', 'disabled', 'open']) assert.ok(by('select').includes(st), `select ${st}`);
  for (const st of ['open', 'loading', 'error']) assert.ok(by('dialog').includes(st), `dialog ${st}`);
});

test('PACK.md carries the five-line direction', () => {
  const md = readFileSync(join(ROOT, 'design/PACK.md'), 'utf8');
  for (const w of ['Product.', 'Character.', 'World.', 'Moments.', 'Signature.']) assert.ok(md.includes(`**${w}**`), w);
});

test('no off-pack component: every file under src/components is an admitted component or a named composite of admitted ones', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const files = walk(join(ROOT, 'src/components')).map((p) => p.slice(ROOT.length));
  const admitted = new Set(specs.flatMap((s) => [s.file, ...(s.also ?? [])]));
  const composites = { // composed only from admitted components. The header is NOT here: its legend chip, connection indicator, test marker and version label are declared components (design/components).
    'src/components/Banners.jsx': 'list of Alert banners',
    'src/components/JobDialog.jsx': 'Dialog + JobForm',
    'src/components/JobForm.jsx': 'Input + Select + Button + KeyNotice, used by the dialog and the row form',
    'src/components/InlineAdd.jsx': 'Popover + Button + JobForm, the row Add job',
    'src/components/DemoKeys.jsx': 'demo build only: three buttons inside the key notice',
    'src/components/ui/label.jsx': 'label for Input and Select',
    'src/components/ui/portal-container.js': 'where floating layers mount (style guide uses one per theme)',
  };
  const off = files.filter((f) => !admitted.has(f) && !(f in composites));
  assert.deepEqual(off, []);
});
