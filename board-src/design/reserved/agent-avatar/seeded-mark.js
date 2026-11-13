// The little neural network: a node-and-connection mark grown deterministically from a name. RESERVED for agent profile icons.
// Pure geometry only; AgentAvatar.jsx draws it. Not imported by the board (see README.md). Personalization surface: seed, density (and tone/size in the component).
// Same seed + same density => same geometry.

export const MARK_SEED = 'RHL board';
const SIZE = 40;   // viewBox edge
const PAD = 5;

// xmur3-style string hash -> 32-bit seed
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

// mulberry32: small seeded PRNG returning floats in [0, 1)
export function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (v) => Math.round(v * 100) / 100;

// Node counts per density (the Lumen v2 design report's 6 / 10 / 14). No density: the seed decides, 6 to 14.
export const DENSITY = { sparse: 6, medium: 10, dense: 14 };

// 6-14 nodes sorted left to right; every node links to an earlier one (so it is connected and edges run
// left -> right); a few extra links make it look like a network.
export function seededMark(seed, density) {
  const rnd = mulberry32(hashSeed(String(seed)));
  const auto = 6 + Math.floor(rnd() * 9); // always drawn, so the rest of the sequence does not depend on density
  const n = DENSITY[density] ?? auto;
  const pts = [];
  let minDist = 8;
  while (pts.length < n) {
    let placed = false;
    for (let tries = 0; tries < 40 && !placed; tries++) {
      const p = { x: r2(PAD + rnd() * (SIZE - 2 * PAD)), y: r2(PAD + rnd() * (SIZE - 2 * PAD)) };
      if (pts.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= minDist)) { pts.push(p); placed = true; }
    }
    if (!placed) minDist *= 0.85;
  }
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  const d = (i, j) => Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
  const edges = [];
  const has = (a, b) => edges.some((e) => e[0] === a && e[1] === b);
  for (let i = 1; i < n; i++) {
    const near = [...Array(i).keys()].sort((a, b) => d(i, a) - d(i, b));
    edges.push([near[0], i]);
    if (near[1] != null && rnd() < 0.5 && !has(near[1], i)) edges.push([near[1], i]);
  }
  const deg = Array(n).fill(0);
  for (const [a, b] of edges) { deg[a]++; deg[b]++; }
  const core = deg.indexOf(Math.max(...deg));
  const nodes = pts.map((p, i) => ({ ...p, r: r2((i === core ? 3.8 : 2.4) + rnd() * 0.5), core: i === core }));
  return { seed: String(seed), size: SIZE, nodes, edges };
}

