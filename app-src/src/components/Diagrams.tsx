// components/Diagrams.tsx — ERGON CALIBRATION: a visual appears only where it shows state faster than
// words (Nox, 8 Nov 12:22 ET). Three small, single-purpose, real-state visuals, numbers riding on them in
// mono figures. No chart wallpaper, no diagram for its own sake — the fuller treatment belongs to
// OpenBell under Ticket 070 and is deliberately NOT pulled into this surface.
import type { Task, TaskState } from '../data/fixtures';

const ORDER: TaskState[] = ['done', 'working', 'waiting'];
const LABEL: Record<TaskState, string> = { done: 'done', working: 'in progress', waiting: 'waiting' };

function counts(tasks: Task[]): Record<TaskState, number> {
  const c: Record<TaskState, number> = { done: 0, working: 0, waiting: 0 };
  for (const t of tasks) c[t.state] += 1;
  return c;
}

/**
 * Board progress — one thin segmented bar: done · in progress · waiting, with the counts riding on the
 * visual. It replaces a three-cell counter strip because the proportion is read in one glance and the
 * numbers are still there in mono.
 */
export function BoardProgress({ tasks, compact = false }: { tasks: Task[]; compact?: boolean }) {
  const c = counts(tasks);
  const total = Math.max(1, c.done + c.working + c.waiting);
  const seg = (n: number, key: TaskState) => ({ flexGrow: Math.max(n, 0), key, n });
  const segs = ORDER.map((k) => seg(c[k], k));
  return (
    <section className={`board-progress${compact ? ' compact' : ''}`} data-testid="board-progress" aria-label="Board progress">
      <div className="bp-head">
        <span className="bp-title">Board progress</span>
        <span className="bp-total mono">{total} tasks</span>
      </div>
      <div className="bp-bar" role="img" aria-label={`${c.done} done, ${c.working} in progress, ${c.waiting} waiting on you`}>
        {segs.map((s) => (s.n > 0 ? (
          <span key={s.key} className={`bp-seg ${s.key}`} style={{ flexGrow: s.n, flexBasis: 0 }} />
        ) : null))}
      </div>
      <div className="bp-legend">
        {ORDER.map((k) => (
          <span key={k} className={`bp-item ${k}`}>
            <span className="bp-dot" aria-hidden="true" />
            <span className="mono bp-num">{c[k]}</span>
            <span className="bp-label">{LABEL[k]}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

/**
 * Delivery route — what the agent did and what it is doing, as a step rail read left to right. The steps
 * ARE the persisted board: EVERY task is drawn (nothing is invented, nothing is dropped), in the day's
 * chronological order, and the caption's counts are computed from the same step array that is drawn —
 * the diagram can never print a number for a mark it does not show. States: done = closed, working =
 * being worked on now (both live tasks read as in progress), waiting = blocked on you. The desktop rail
 * carries a compact legend that names each mark; the narrow face puts the state word on every step so
 * the amber "waiting on you" state is never left unlabelled.
 */
const STEP_WORD: Record<TaskState, string> = { done: 'done', working: 'in progress', waiting: 'waiting on you' };

export function DeliveryRoute({ tasks, compact = false }: { tasks: Task[]; compact?: boolean }) {
  const byTime = [...tasks].sort((a, b) => a.at - b.at);
  const steps = byTime.map((t) => ({ id: t.id, label: t.title, state: t.state }));
  // counts ride on the DIAGRAM (the drawn steps), not on a separate total: same array, same numbers
  const totals: Record<TaskState, number> = { done: 0, working: 0, waiting: 0 };
  for (const s of steps) totals[s.state] += 1;
  return (
    <section
      className="route"
      data-testid="delivery-route"
      aria-label={`Today's route: ${totals.done} done, ${totals.working} in progress, ${totals.waiting} waiting on you`}
    >
      <div className="route-head">
        <span className="route-title">Today's route</span>
        <span className="route-meta mono">{totals.done} done · {totals.working} in progress · {totals.waiting} waiting</span>
      </div>
      <ol className={`route-steps${compact ? ' vertical' : ''}`}>
        {steps.map((s) => (
          <li key={s.id} className={`route-step ${s.state}`} title={s.label}>
            <span className="route-node" aria-hidden="true" />
            <span className="route-label">{s.label}</span>
            {compact ? <span className="route-state mono">{STEP_WORD[s.state]}</span> : null}
          </li>
        ))}
      </ol>
      {compact ? null : (
        <div className="route-legend" aria-hidden="true">
          {(['done', 'working', 'waiting'] as TaskState[]).map((k) => (
            <span key={k} className={`route-key ${k}`}>
              <span className="route-key-node" />
              {STEP_WORD[k]}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Task state — a three-tick rail so a card's place in the flow is read at a glance: 1 in progress,
 * 2 waiting on you, 3 done. State colour only; no text needed beside the pill already on the card.
 */
export function StateRail({ state }: { state: TaskState }) {
  const pos = state === 'working' ? 1 : state === 'waiting' ? 2 : 3;
  return (
    <span className={`state-rail ${state}`} data-testid="state-rail" data-state={state} aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= pos ? 'on' : ''} />
      ))}
    </span>
  );
}
