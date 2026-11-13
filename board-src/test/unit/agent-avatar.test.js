import test from 'node:test';
import assert from 'node:assert/strict';
import { seededMark, MARK_SEED, DENSITY } from '../../design/reserved/agent-avatar/seeded-mark.js';

test('same seed gives identical geometry', () => {
  assert.deepEqual(seededMark(MARK_SEED), seededMark(MARK_SEED));
  assert.equal(JSON.stringify(seededMark('RHL board')), JSON.stringify(seededMark('RHL board')));
});

test('different seeds give different geometry', () => {
  const seen = new Set(['RHL board', 'RHL boards', 'rhl board', 'Line A', 'Line B', 'x', ''].map((s) => JSON.stringify(seededMark(s).nodes)));
  assert.equal(seen.size, 7);
});

test('6-14 nodes, connected, edges run left to right, nodes stay inside the box and apart', () => {
  for (let i = 0; i < 300; i++) {
    const m = seededMark(`seed-${i}`);
    assert.ok(m.nodes.length >= 6 && m.nodes.length <= 14, `nodes ${m.nodes.length}`);
    assert.equal(m.nodes.filter((n) => n.core).length, 1);
    // every node except the first has an incoming edge from an earlier node => connected
    for (let k = 1; k < m.nodes.length; k++) assert.ok(m.edges.some(([a, b]) => b === k && a < k), `node ${k} linked`);
    for (const [a, b] of m.edges) assert.ok(m.nodes[a].x <= m.nodes[b].x);
    for (const n of m.nodes) assert.ok(n.x >= 0 && n.x <= m.size && n.y >= 0 && n.y <= m.size);
    for (let a = 0; a < m.nodes.length; a++) for (let b = a + 1; b < m.nodes.length; b++)
      assert.ok(Math.hypot(m.nodes[a].x - m.nodes[b].x, m.nodes[a].y - m.nodes[b].y) > 3, 'nodes do not overlap');
  }
});

test('the seed "RHL board" mark is a real network (not a stub)', () => {
  const m = seededMark(MARK_SEED);
  assert.ok(m.edges.length >= m.nodes.length - 1);
});

test('density bounds the node count (sparse 6, medium 10, dense 14) for every seed; same seed + same density = same geometry', () => {
  assert.deepEqual(DENSITY, { sparse: 6, medium: 10, dense: 14 });
  for (let i = 0; i < 100; i++) for (const [name, n] of Object.entries(DENSITY)) {
    const m = seededMark(`agent-${i}`, name);
    assert.equal(m.nodes.length, n, `${name} ${i}`);
    for (let k = 1; k < n; k++) assert.ok(m.edges.some(([a, b]) => b === k && a < k), 'still connected');
  }
  for (const d of ['sparse', 'medium', 'dense', undefined]) assert.equal(JSON.stringify(seededMark('Ada', d)), JSON.stringify(seededMark('Ada', d)));
  assert.notEqual(JSON.stringify(seededMark('Ada', 'sparse').nodes), JSON.stringify(seededMark('Ada', 'dense').nodes));
});

test('different seeds differ at the same density; no density lets the seed decide (6 to 14)', () => {
  const geo = new Set(['Ada', 'Ben', 'Cy', 'RHL board', 'Dee'].map((s) => JSON.stringify(seededMark(s, 'medium').nodes)));
  assert.equal(geo.size, 5);
  for (let i = 0; i < 100; i++) { const n = seededMark(`s${i}`).nodes.length; assert.ok(n >= 6 && n <= 14); }
});
