// components/PresenceMark.tsx — the reference's presence mark: a FLAT MONOCHROME NEURAL-NET GLYPH
// (nodes + lines), no character, no face, no invented logo. Drawn in `currentColor` so it inherits
// ink or state colour; it is the only mark the product has (the retired m-0138 `AgentCharacter` is
// not carried into this build).
import type { CSSProperties } from 'react';

type Props = {
  size?: number;
  state?: 'working' | 'idle' | 'needs-you';
  className?: string;
  title?: string;
};

export function PresenceMark({ size = 28, state = 'working', className = '', title }: Props) {
  // Geometry is structural (a 24x24 glyph): nodes at the reference's node positions, edges between.
  // three columns of nodes (left input, middle hidden, right output) joined by short edges — a
  // flat neural-net glyph, not a sparkle and not a face.
  const nodes: [number, number][] = [
    [4.6, 6.2], [4.6, 12], [4.6, 17.8],
    [12, 4.4], [12, 12], [12, 19.6],
    [19.4, 6.2], [19.4, 12], [19.4, 17.8],
  ];
  const edges: [number, number][] = [
    [0, 3], [0, 4], [1, 3], [1, 4], [1, 5], [2, 4], [2, 5],
    [3, 6], [3, 7], [4, 6], [4, 7], [4, 8], [5, 7], [5, 8],
  ];
  const style: CSSProperties = { width: size, height: size };
  return (
    <span
      className={`presence ${state} ${className}`.trim()}
      style={style}
      role="img"
      aria-label={title || 'presence'}
      data-testid="presence-mark"
      data-state={state}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
        {edges.map(([a, b], i) => (
          <line
            key={`e${i}`}
            x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]}
            stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" opacity={i > 4 ? 0.5 : 0.75}
          />
        ))}
        {nodes.map(([cx, cy], i) => (
          <circle key={`n${i}`} cx={cx} cy={cy} r={i === 4 ? 2.0 : 1.5} fill="currentColor" />
        ))}
      </svg>
    </span>
  );
}

export default PresenceMark;
