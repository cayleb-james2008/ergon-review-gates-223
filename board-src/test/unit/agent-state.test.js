import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentBase } from '../../src/ui/agent-state.js';

test('the drag handle asks for attention only while a form shows a key notice; offline and error stay calm', () => {
  assert.equal(agentBase({ needsYou: true }), 'needs-you');
  assert.equal(agentBase({ needsYou: false }), 'idle');
  assert.equal(agentBase({ needsYou: false, conn: 'offline' }), 'idle');
  assert.equal(agentBase({ needsYou: false, conn: 'error' }), 'idle');
});

test('the board contains no neural-net mark: nothing in src imports the reserved agent avatar or the seeded generator', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const hits = walk(join(ROOT, 'src')).filter((f) => /\.(js|jsx|css|html)$/.test(f)).filter((f) => /agent-avatar|seeded-mark|seededMark|AgentAvatar|neural/i.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
});
