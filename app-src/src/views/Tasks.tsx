// views/Tasks.tsx — TASKS ARE THE INBOX OF DECISIONS (the reference grammar): what your agent needs
// from you first, then what it is working on, then what closed today. Creating a task works on BOTH
// faces and persists across leaving/returning and a full reload (Ticket 063).
import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PlusIcon } from 'lucide-react';
import { StatePill } from '../components/StatePill';
import { BoardProgress, StateRail } from '../components/Diagrams';
import { createTask, signOffTask, useErgon } from '../data/store';
import type { Task, TaskState } from '../data/fixtures';
import { dur, ease } from '../motion';

const COLUMNS: { id: TaskState; label: string; note: string }[] = [
  { id: 'waiting', label: 'Needs your decision', note: 'the inbox · one tap turns each' },
  { id: 'working', label: 'In progress', note: 'your agent is on it' },
  { id: 'done', label: 'Done today', note: 'tracked, quiet' },
];

const ENTER = { duration: dur.enter, ease } as const;

/** A waiting task is a REAL CONTROL IN PLACE on both faces (round-7 blocking fix): role, tab order and
 *  a handler that signs it off through the same store the morning brief, the Tasks badge and the
 *  Decisions inbox derive from. Working and done cards are informational and get no control. */
function taskActionProps(task: Task) {
  if (task.state !== 'waiting') return {};
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': `Sign off ${task.title} — waiting on your decision`,
    onClick: () => signOffTask(task.id),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        signOffTask(task.id);
      }
    },
  };
}

/** The visible affordance inside a waiting card. It is presentation only (aria-hidden): the card is
 *  the control, so a tap anywhere on the card — including this label — signs the task off in place. */
function SignOffRow({ task }: { task: Task }) {
  // F1 (round-7 fresh-eye review): the top StatePill already says "waiting on you" and the body
  // already says what the agent is waiting for. The bottom row carries ONE white primary — the
  // action itself — so the card does not print the same state a third time. The card remains the
  // in-place control (role=button/tabindex/handlers above), so the label is not the affordance.
  return (
    <span className="task-signoff-row" aria-hidden="true">
      <span className="task-signoff-btn" data-testid={`task-signoff-${task.id}`}>Sign off</span>
    </span>
  );
}

export function NewTaskControl({ compact = false }: { compact?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const reduce = useReducedMotion();

  function add(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    createTask(title);
    setDraft('');
    setAdding(false);
  }

  if (!adding) {
    return (
      <button
        type="button"
        className="btn-quiet new-task"
        data-testid="new-task"
        onClick={() => setAdding(true)}
      >
        <PlusIcon size={16} strokeWidth={2.2} aria-hidden="true" /> New task
      </button>
    );
  }
  return (
    <motion.form
      className={`new-task-form${compact ? ' compact' : ''}`}
      onSubmit={add}
      onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }} /* Escape closes the form (X-17) */
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      data-testid="new-task-form"
    >
      <input
        autoFocus
        aria-label="New task title"
        placeholder="Ask your agent for anything…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        data-testid="new-task-input"
      />
      <button className="btn-primary" type="submit" data-testid="new-task-submit" disabled={!draft.trim()}>Add task</button>
      <button className="btn-quiet" type="button" onClick={() => setAdding(false)} data-testid="new-task-cancel">Cancel</button>
    </motion.form>
  );
}

export function Tasks({ compact = false }: { compact?: boolean }) {
  const tasks = useErgon((s) => s.tasks);
  const reduce = useReducedMotion();
  const grouped = useMemo(() => {
    const g: Record<TaskState, typeof tasks> = { waiting: [], working: [], done: [] };
    for (const t of tasks) (g[t.state] ||= []).push(t);
    return g;
  }, [tasks]);

  if (compact) {
    return (
      <div className="m-view" data-testid="tasks">
        {/* F3: no duplicate "Tasks" heading — the sub-tab above already names the view. The inbox line
            and the New task action share the header row so the first card starts high on 390 px. */}
        <div className="m-view-head m-view-head-row">
          <p className="muted">the inbox of decisions</p>
          <NewTaskControl compact />
        </div>
        <BoardProgress tasks={tasks} compact />
        <ul className="m-cards" data-testid="task-list">
          {COLUMNS.map((col) => grouped[col.id].map((t) => (
            <motion.li
              layout={!reduce}
              key={t.id}
              {...taskActionProps(t)}
              className={`m-card state-${t.state}${t.state === 'waiting' ? ' actionable' : ''}`}
              data-testid={`task-${t.id}`}
              data-actionable={t.state === 'waiting' ? '1' : '0'}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={ENTER}
            >
              <h3 className="m-card-title">{t.title}</h3>
              <div className="m-card-state-row">
                <StateRail state={t.state} />
                <StatePill state={t.state} />
              </div>
              <p className="meta"><span className="mono">{t.id}</span> · owner: your agent</p>
              <p className="last">{t.last}</p>
              {t.state === 'waiting' ? <SignOffRow task={t} /> : null}
            </motion.li>
          )))}
        </ul>
      </div>
    );
  }

  return (
    <div className="surface" data-testid="tasks">
      <div className="section-head">
        <p className="muted">Every task goes to the one agent — no roster, no crew board. Waiting tasks are the decisions your agent needs from you.</p>
        <NewTaskControl />
      </div>

      <BoardProgress tasks={tasks} />

      <div className="board">
        {COLUMNS.map((col) => (
          <section className="board-col" key={col.id} data-testid={`col-${col.id}`}>
            <header className="col-head">
              <span className={`col-dot ${col.id}`} aria-hidden="true" />
              <span className="col-label">{col.label}</span>
              <span className="col-count mono">{grouped[col.id].length}</span>
            </header>
            <p className="col-note">{col.note}</p>
            <div className="col-cards">
              <AnimatePresence initial={false}>
                {grouped[col.id].map((t) => (
                  <motion.article
                    layout={!reduce}
                    key={t.id}
                    {...taskActionProps(t)}
                    className={`task-card state-${t.state}${t.state === 'waiting' ? ' actionable' : ''}`}
                    data-testid={`task-${t.id}`}
                    data-actionable={t.state === 'waiting' ? '1' : '0'}
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0 }}
                    transition={ENTER}
                  >
                    <h4 className="task-title">{t.title}</h4>
                    <div className="task-state-row">
                      <StateRail state={t.state} />
                      <StatePill state={t.state} />
                    </div>
                    <p className="meta"><span className="mono">{t.id}</span> · owner: your agent</p>
                    <p className="last">{t.last}</p>
                    {t.state === 'waiting' ? <SignOffRow task={t} /> : null}
                  </motion.article>
                ))}
              </AnimatePresence>
              {grouped[col.id].length === 0 ? <p className="empty-col">Nothing here.</p> : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default Tasks;
