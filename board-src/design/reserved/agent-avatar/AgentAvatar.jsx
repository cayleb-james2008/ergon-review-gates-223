import { useMemo } from 'react';
import { seededMark, MARK_SEED } from './seeded-mark.js';

 // one fill change per save or later sync, then back to rest. No loop.

// The agent profile icon: a little neural net, one per agent. RESERVED for agent profile icons; not a decorative surface mark anywhere in Ergon.
// Customizable: seed (the agent's or employee's name), density ('sparse' | 'medium' | 'dense' = 6 / 10 / 14 nodes), tone ('ink' | 'accent'), size (px).
// Not customizable: effects, motion, shape language. Flat and monochrome; state is fill and opacity only.
// state: 'idle' (calm) | 'working' (one fill change) | 'needs-you' (accent fill).
export function AgentAvatar({ seed = MARK_SEED, density, tone = 'ink', size = 32, state = 'idle', ...props }) {
  const m = useMemo(() => seededMark(seed, density), [seed, density]);
  return (
    <span className="agent-avatar" data-state={state} data-tone={tone === 'accent' ? 'accent' : 'ink'} style={{ width: size, height: size }} aria-hidden="true" {...props}>
      <svg className="agent-svg" viewBox={`0 0 ${m.size} ${m.size}`} focusable="false">
        {m.edges.map(([a, b]) => <line key={`${a}-${b}`} className="edge" x1={m.nodes[a].x} y1={m.nodes[a].y} x2={m.nodes[b].x} y2={m.nodes[b].y} />)}
        {m.nodes.map((n, i) => <circle key={i} className={n.core ? 'node core' : 'node'} cx={n.x} cy={n.y} r={n.r} />)}
      </svg>
    </span>
  );
}
