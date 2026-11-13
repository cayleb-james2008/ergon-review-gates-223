// components/StatePill.tsx — a state pill. Colour appears ONLY as state (the reference grammar):
// green = done/approved, amber = waiting/needs-you, red = denied/blocked. Never decorative.
export type PillState = 'working' | 'waiting' | 'done' | 'approved' | 'denied' | 'idle';

const LABEL: Record<PillState, string> = {
  working: 'working',
  waiting: 'waiting on you',
  done: 'done',
  approved: 'approved',
  denied: 'denied',
  idle: 'idle',
};

export function StatePill({ state, label }: { state: PillState; label?: string }) {
  return (
    <span className={`pill ${state}`} data-testid={`pill-${state}`}>
      <span className="pill-dot" aria-hidden="true" />
      {label ?? LABEL[state]}
    </span>
  );
}

export default StatePill;
