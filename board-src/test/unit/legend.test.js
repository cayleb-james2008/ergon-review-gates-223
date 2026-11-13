import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Owner ruling, Cayleb 3 Nov 2026: the legend is initials and colours only, now and as a later default. No name field exists anywhere in the path.
// (src/core/legend.js imports through the build's "@/" alias, which node:test cannot resolve, so the files are read as text; the rendered legend is checked in e2e round3.)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the legend config has no name on any entry, and the code that builds and renders the legend has no name path', () => {
  const legend = JSON.parse(read('src/config/legend.json'));
  const walk = (v) => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...walk(x)]) : []);
  assert.ok(!walk(legend.initials).includes('name'), 'no entry in src/config/legend.json has a name');
  assert.ok(Object.keys(legend.initials).length >= 5, 'the five coded initials are there');
  assert.doesNotMatch(read('src/core/legend.js'), /\.name\b|name:/, 'LEGEND is built from initials and hue only');
  const header = read('src/components/Header.jsx');
  assert.doesNotMatch(header.split('export const LegendChip')[1].split('\n')[0], /name|title=/, 'LegendChip takes no name and sets no tooltip');
  assert.doesNotMatch(header, /name=\{l\.name\}/, 'the header passes no name to the chip');
});
