// Mechanical slop gate over the shipped source: src/**/*.css|js|jsx, index.html, styleguide.html.
// It encodes the unslop review gate's sign list and the fleet reject list (FRONTEND-LIBRARY.md section 7) as checks a script can run.
// Each rule also has a "bad sample" that must trip it, so a rule that silently stops matching fails the suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
export const FILES = [...walk(join(ROOT, 'src')).filter((p) => /\.(css|js|jsx)$/.test(p)), join(ROOT, 'index.html'), join(ROOT, 'styleguide.html')]
  .map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));
const isCss = (f) => f.path.endsWith('.css');
const isCode = (f) => /\.(js|jsx)$/.test(f.path);

// strip the three token blocks (light, dark, paper) so literals are only legal there
const stripTokenBlocks = (t) => t
  .replace(/:root,\s*\[data-theme="light"\]\s*\{[^}]*\}/, '')
  .replace(/:root\[data-theme="dark"\],\s*\[data-theme="dark"\]\s*\{[^}]*\}/, '')
  .replace(/:root,\s*:root\[data-theme\],\s*\[data-theme\]\s*\{[^}]*\}/, '');
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJsComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:'"\w])\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const hits = (text, re) => [...text.matchAll(re)].map((m) => m[0]);

// Content of every CSS rule: [selector, body]
const rules = (css) => [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);

export const RULES = [
  { id: 'no-backdrop-filter', desc: 'no backdrop-filter or blur anywhere (Lumen depth is tone steps and borders)',
    check: (f) => hits(f.text, /backdrop-(filter|blur)|(?<![\w-])blur(-\w+|\()|filter:\s*(blur|drop-shadow)/g),
    bad: '.a { backdrop-filter: blur(8px); }' },
  { id: 'no-gradients', desc: 'no gradients (hue washes, sheens, stripes)',
    check: (f) => hits(f.text, /(linear|radial|conic)-gradient|repeating-(linear|radial)|(?<![\w-])bg-(gradient|linear|radial|conic)|(?<![\w-])(from|via|to)-(\w+)/g),
    bad: '.a { background: linear-gradient(red, blue); }' },
  { id: 'no-box-shadow', desc: 'no box-shadow except the single focus-ring token; no shadow/ring utilities, no rim hacks',
    check: (f) => [
      ...(isCss(f) ? rules(f.text).flatMap(([sel, body]) => [...body.matchAll(/box-shadow:\s*([^;]+);?/g)].filter((m) => !/^(none|var\(--focus-ring\))$/.test(m[1].trim())).map((m) => `${sel}: box-shadow ${m[1]}`)) : []),
      ...hits(f.text, /inset 0 1px 0|(?<![\w-])(drop-shadow|inset-shadow|text-shadow|shadow|ring|ring-offset)(?:-[\w[\]/.]+)?(?=["'\s:`])/g).filter((m) => !/^ring$/.test(m) || /className/.test(f.text)),
    ].filter((m) => !/^ring$/.test(m)),
    bad: '.a { box-shadow: 0 1px 2px rgb(0 0 0 / .2); }' },
  { id: 'no-transition-all', desc: 'no transition: all / transition-all, no animated layout properties',
    check: (f) => [
      ...hits(f.text, /transition(-property)?:\s*all|(?<![\w-])transition-all/g),
      ...(isCss(f) ? rules(f.text).flatMap(([sel, body]) => [...body.matchAll(/transition(?:-property)?:\s*([^;]+)/g)].filter((m) => /(?<![\w-])(width|height|margin|padding|top|left|right|bottom|inset|gap|grid-template)/.test(m[1])).map((m) => `${sel}: transitions layout ${m[1]}`)) : []),
      ...hits(f.text, /transition-\[[^\]]*(width|height|margin|padding|top|left)[^\]]*\]/g),
    ],
    bad: '.a { transition: all 200ms; }' },
  { id: 'no-loops', desc: 'no infinite animation, no pulse/ping/spin/bounce',
    check: (f) => hits(f.text, /infinite|animate-(spin|pulse|ping|bounce)|animation-iteration-count:\s*(?!1\b)\S+/g),
    bad: '.a { animation: x 1s infinite; }' },
  { id: 'animation-only-on-open-state', desc: 'nothing animates on load: animations exist only on floating layers while they open or close',
    check: (f) => (isCss(f) ? rules(f.text).filter(([sel, body]) => /(?<![\w-])animation(-name)?:/.test(body) && !/\[data-state=/.test(sel) && !/^@keyframes/.test(sel)).map(([sel]) => `animation on ${sel}`) : hits(f.text, /(?<![\w-])animate-\[|(?<![\w-])animate-\w+/g)),
    bad: '.row { animation: reveal 250ms; }' },
  { id: 'no-hover-motion', desc: 'no hover scale or lift; press scale only',
    check: (f) => hits(f.text, /hover:(scale|translate|-translate|rotate)[\w-[\]./]*|:hover[^{]*\{[^}]*(transform|scale|translate)/g),
    bad: '.a:hover { transform: translateY(-1px); }' },
  { id: 'weights', desc: 'font weights 400, 500, 600 only',
    check: (f) => [...hits(f.text, /font-(bold|extrabold|black|light|extralight|thin|heavy)/g), ...[...f.text.matchAll(/font-weight:\s*(\w+)/g)].filter((m) => !['400', '500', '600'].includes(m[1])).map((m) => m[0])],
    bad: '.a { font-weight: 700; }' },
  { id: 'no-monospace', desc: 'no monospace anywhere',
    check: (f) => hits(f.text, /monospace|font-mono|ui-monospace|Menlo|Consolas|Courier|SF Mono|Cascadia/gi),
    bad: '.a { font-family: ui-monospace, monospace; }' },
  { id: 'no-uppercase-labels', desc: 'no uppercase or tracked labels',
    check: (f) => hits(f.text, /uppercase|capitalize|text-transform:\s*(?!none)\S+|tracking-(wide|wider|widest|tight|tighter)|letter-spacing:\s*(?!normal|0\b)[^;]+/g),
    bad: '.a { text-transform: uppercase; letter-spacing: .1em; }' },
  { id: 'one-font-family', desc: 'one self-hosted sans: font-family is declared only for the token and the metric fallback',
    check: (f) => (isCss(f) ? rules(f.text).flatMap(([sel, body]) => [...body.matchAll(/font-family:\s*([^;]+)/g)].filter((m) => !/^"Geist Fallback"$/.test(m[1].trim()) && !/var\(--font-sans\)/.test(m[1])).map((m) => `${sel}: ${m[0]}`)) : hits(f.text, /font-family/g)),
    bad: '.a { font-family: Arial; }' },
  { id: 'type-scale', desc: 'font-size from the 12/14/16/18/22 scale (or a function of the one fluid job size); no arbitrary text-[..]',
    check: (f) => [
      ...(isCss(f) ? rules(f.text).flatMap(([, body]) => [...body.matchAll(/(?<![\w-])font-size:\s*([^;]+)/g)].filter((m) => !/\(/.test(m[1]) && !/^(inherit|var\(.*\))$/.test(m[1].trim()) && !/^(12|14|16|18|22)px$/.test(m[1].trim())).map((m) => m[0])) : []),
      ...hits(f.text, /(?<![\w-])text-\[[^\]]+\]/g),
    ],
    bad: '.a { font-size: 15px; }' },
  { id: 'font-size-tokens', desc: 'every font-size is a token (var(--text-*), --fs, --fs-title, --fs-compact) or inherit: no literal px, em or rem',
    check: (f) => (isCss(f) ? rules(f.text).flatMap(([sel, body]) => [...body.matchAll(/(?<![\w-])font-size:\s*([^;]+)/g)].filter((m) => !/^(inherit|var\(--[\w-]+\))$/.test(m[1].trim())).map((m) => `${sel}: ${m[0]}`)) : []),
    bad: '.a { font-size: 14px; }' },
  { id: 'spacing-grid', desc: 'padding, margin, gap and inset on the 4px grid; no half-step utilities',
    check: (f) => [
      ...(isCss(f) ? rules(f.text).flatMap(([sel, body]) => [...body.matchAll(/(?<![\w-])(padding|margin|gap|row-gap|column-gap|inset|top|left|right|bottom)(?:-[a-z]+)?:\s*([^;]+)/g)]
        .filter((m) => [...m[2].matchAll(/(-?\d+(?:\.\d+)?)px/g)].some((n) => Math.abs(+n[1]) % 4 !== 0)).map((m) => `${sel}: ${m[0]}`)) : []),
      ...hits(f.text, /(?<![\w-])-?(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|size|inset)-\d+\.5\b/g),
      ...hits(f.text, /(?<![\w-])-?(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-\[[\d.]+px\]/g),
    ],
    bad: '.a { padding: 3px 10px; }' },
  { id: 'tokens-only-colour', desc: 'no hex, rgb, hsl or oklch literal outside the theme token blocks',
    check: (f) => (isCss(f) || isCode(f) ? hits(stripTokenBlocks(stripComments(f.text)), /#[0-9a-fA-F]{3,8}\b(?![\w-])|(?<![\w-])(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/g) : hits(f.text.replace(/<meta name="theme-color"[^>]*>/g, ''), /#[0-9a-fA-F]{6}\b/g)),
    bad: '.a { color: #ff00aa; }' },
  { id: 'no-tailwind-palette', desc: 'no default Tailwind palette classes (bg-red-500 etc.)',
    check: (f) => hits(f.text, /(?<![\w-])(bg|text|border|outline|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(-\d+)?(?![\w-])/g),
    bad: '<div className="bg-red-500">' },
  { id: 'opacity-tokens', desc: 'opacity comes from tokens (0 and 1 allowed); no opacity literal, no opacity-NN utility',
    check: (f) => (isCss(f) ? rules(f.text).flatMap(([sel, body]) => [...body.matchAll(/(?<![\w-])opacity:\s*([^;]+)/g)].filter((m) => !/^(0|1|var\(--opacity-[\w-]+\))$/.test(m[1].trim())).map((m) => `${sel}: ${m[0]}`)) : hits(f.text, /(?<![\w-])opacity-\d+(?![\w-])/g)),
    bad: '.a { opacity: 0.4; }' },
  { id: 'type-names-by-use', desc: 'Tailwind type sizes are named by use (text-label, text-body-sm, text-body, text-title, text-marker), never bare text-xs, sm, base, lg or xl',
    check: (f) => hits(f.text, /(?<![\w-])text-(xs|sm|base|lg|xl|2xl|3xl)(?![\w-])/g),
    bad: '<div className="text-sm">' },
  { id: 'no-passcode', desc: 'nothing in the product asks for a passcode or a password: no such strings, no password input (access runs on agent-issued keys)',
    check: (f) => hits(f.text, /passcode|password|type=["']password["']/gi),
    bad: '<input type="password">' },
  { id: 'no-build-text-in-header', desc: 'no "build <id>" text in the header',
    check: (f) => (/Header\.jsx$|index\.html$/.test(f.path) ? hits(f.text, /\bbuild\s/gi) : []),
    bad: null, headerOnly: '<span>build abc</span>' },
  { id: 'copy-punctuation', desc: 'no em or en dashes, middle dots, arrow decoration, exclamation marks in strings, emoji',
    check: (f) => [
      ...hits(f.text, /[–—·•→←⟶]/g),
      ...hits(f.text, /\p{Extended_Pictographic}/gu),
      ...(isCode(f) ? hits(f.text, /(?<=[>'"`])[A-Za-z][^<>'"`{}\n]*!(?=[<'"`])/g) : []),
      ...hits(f.text, /\s-\s(?=[A-Za-z])/g).filter(() => isCode(f) && false),
    ],
    bad: "const s = 'Saved — done';" },
  { id: 'no-hazard-or-stripe', desc: 'no hazard stripes or side stripes',
    check: (f) => hits(f.text, /hazard|(?<![\w-])stripe|border-(left|l)-[2-9]|border-inline-start-width/gi),
    bad: '.a { border-left: 4px; } /* hazard */' },
  { id: 'no-decorative-layers', desc: 'no backdrop, constellation, wash or glow layers',
    check: (f) => hits(f.text, /createBackdrop|class="backdrop"|constellation|\bglow\b|\bhalo\b|\bwash\b|sheen/gi),
    bad: '.glow { }' },
  { id: 'no-native-select-chrome', desc: 'no native <select> element in components (Radix Select only)',
    check: (f) => (isCode(f) && !f.path.includes('ui/select') ? hits(f.text, /<select[\s>]/g) : []),
    bad: null, codeOnly: '<select>' },
];

// Rules look at code, not comments, except the copy rule which reads everything.
const RAW = new Set(['copy-punctuation']);
const view = (r, f) => (RAW.has(r.id) || /\.html$/.test(f.path) ? f : { ...f, text: stripJsComments(f.text) });

for (const r of RULES) {
  test(`gate: ${r.desc}`, () => {
    const found = FILES.flatMap((f) => r.check(view(r, f)).map((v) => `${f.path}: ${v}`));
    assert.deepEqual(found, []);
  });
}

test('gate self-test: every rule fires on a known-bad sample', () => {
  const quiet = [];
  for (const r of RULES) {
    const sample = r.bad ?? r.headerOnly ?? r.codeOnly;
    const path = r.headerOnly ? 'src/components/Header.jsx' : r.codeOnly ? 'src/components/X.jsx' : /className|<div/.test(sample) ? 'src/components/X.jsx' : /^const /.test(sample) ? 'src/x.js' : 'src/x.css';
    if (!r.check({ path, text: sample }).length) quiet.push(r.id);
  }
  assert.deepEqual(quiet, [], 'rules that did not fire on their bad sample');
});

test('gate scans the real source (not an empty list)', () => {
  assert.ok(FILES.length >= 25, `${FILES.length} files`);
  assert.ok(FILES.some((f) => f.path === 'src/styles.css'));
  assert.ok(FILES.some((f) => f.path === 'src/components/Job.jsx'));
});
