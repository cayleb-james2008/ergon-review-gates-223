// views/AppCanvas.tsx — the app canvas: APPS OPEN AS TABS BESIDE THE THREAD, never inside it
// (the reference grammar). The thread column keeps its own scroll; the canvas is the right-hand
// region on desktop with its own tab strip. On the phone face the canvas is not stacked into the
// thread: apps live behind the Make tab.
import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { StatePill, type PillState } from '../components/StatePill';
import { APP_TABS } from '../data/fixtures';
import { dur, ease } from '../motion';

const ENTER = { duration: dur.swap, ease } as const;

export function AppCanvas() {
  const [active, setActive] = useState(APP_TABS[0].id);
  const reduce = useReducedMotion();
  const app = APP_TABS.find((a) => a.id === active) ?? APP_TABS[0];
  // the tab pattern (I-28, X-17): one tab stop, ArrowLeft/ArrowRight/Home/End move the selection and the focus
  function onTabKeys(e: React.KeyboardEvent) {
    const n = APP_TABS.length;
    const i = APP_TABS.findIndex((a) => a.id === active);
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(APP_TABS[next].id);
    document.querySelector<HTMLElement>(`[data-testid="app-tab-${APP_TABS[next].id}"]`)?.focus();
  }

  return (
    <section className="canvas" data-testid="app-canvas" aria-label="Apps">
      <header className="canvas-head">
        <span className="canvas-eyebrow">Apps</span>
        <span className="canvas-note">open beside the thread</span>
      </header>
      <div className="canvas-tabs" role="tablist" aria-label="Apps" onKeyDown={onTabKeys}>
        {APP_TABS.map((a) => (
          <button
            key={a.id}
            role="tab"
            type="button"
            aria-selected={a.id === active}
            tabIndex={a.id === active ? 0 : -1}
            className={a.id === active ? 'on' : ''}
            onClick={() => setActive(a.id)}
            data-testid={`app-tab-${a.id}`}
          >
            {a.name}
          </button>
        ))}
      </div>
      <motion.div
        key={app.id}
        className="canvas-panel"
        data-testid={`app-panel-${app.id}`}
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={ENTER}
      >
        <header className="panel-head">
          <h3>{app.name}</h3>
          <p className="muted">{app.desc}</p>
        </header>
        <ul className="panel-rows">
          {app.rows.map((r) => (
            <li key={r.id} className="panel-row">
              <span className="mono row-id">{r.id}</span>
              <span className="row-label">{r.label}</span>
              <span className="row-value mono">{r.value}</span>
              {r.state ? <StatePill state={r.state as PillState} /> : null}
            </li>
          ))}
        </ul>
      </motion.div>
      <p className="canvas-foot">Read-only in this build · your agent opens these; you look.</p>
    </section>
  );
}

export default AppCanvas;
