// faces/Desktop.tsx — the reference's DESKTOP COMPOSITION: SIDEBAR · THREAD · APP CANVAS.
// Left: presence + "Your agent" + sections + settings in one obvious action.
// Centre: the one thread — morning brief first, composer glued at the bottom, approvals pin above it.
// Right: the app canvas, apps as tabs beside the thread (never inside it).
import { useEffect, useState } from 'react';
import { MessageCircleIcon, ListChecksIcon, ShieldCheckIcon } from 'lucide-react';
import { TransitionPanel } from '../vendor/mp/transition-panel';
import { PresenceMark } from '../components/PresenceMark';
import { Composer } from '../components/Composer';
import { ApprovalCard, OutcomeStrip } from '../components/ApprovalCard';
import { SettingsSurface } from '../views/Settings';
import { Thread } from '../views/Thread';
import { Tasks } from '../views/Tasks';
import { Decisions } from '../views/Decisions';
import { AppCanvas } from '../views/AppCanvas';
import { agentIsReplying, dismissOutcome, sendMessage, useErgon } from '../data/store';
import { dur, ease } from '../motion';

export type ViewId = 'chat' | 'tasks' | 'decisions';

const NAV = [
  { id: 'chat' as const, label: 'Chat', icon: MessageCircleIcon },
  { id: 'tasks' as const, label: 'Tasks', icon: ListChecksIcon },
  { id: 'decisions' as const, label: 'Decisions', icon: ShieldCheckIcon },
];

export function Desktop({ initialView }: { initialView: ViewId }) {
  const [view, setView] = useState<ViewId>(initialView);
  const idx = NAV.findIndex((n) => n.id === view);
  useEffect(() => { document.title = `${NAV[idx]?.label ?? 'Chat'} · Warehouse demo`; }, [idx]); // the tab title says where you are (I-28)
  // the view is in the address, so a reload or a copied link returns to it (X-3); replaceState leaves the history as it was
  useEffect(() => { const u = new URL(window.location.href); u.searchParams.set('view', view); window.history.replaceState({}, '', u); }, [view]);
  const messages = useErgon((s) => s.messages);
  const tasks = useErgon((s) => s.tasks);
  // the Tasks badge is the SAME number the Tasks board prints in "Needs your decision": how many
  // tasks await your decision. It is NOT the approval pin count (the pin clears when a grant is
  // acted on, while a waiting task keeps waiting) — a badge that disagreed with the inbox it opens
  // was the review-v4 state-honesty finding.
  const waitingTasks = tasks.filter((t) => t.state === 'waiting').length;
  const approvals = useErgon((s) => s.approvals);
  // the SAME needs-you derivation as the morning brief and the Decisions page
  const needsYou = approvals.length + waitingTasks;
  const decisions = useErgon((s) => s.decisions);
  const lastOutcome = useErgon((s) => s.lastOutcome);
  const settings = useErgon((s) => s.settings);
  const replying = agentIsReplying();

  return (
    <div className={`face desktop density-${settings.density} motion-${settings.motion}`} data-testid="desktop-face" data-face="desktop">
      <aside className="sidebar">
        <div className="brand">
          <PresenceMark size={26} state={needsYou ? 'needs-you' : 'working'} title="presence" />
          <span className="brand-name">Warehouse demo</span>
        </div>

        <div className="agent-block" data-testid="agent-block" data-needs-you={needsYou}>
          <PresenceMark size={36} state={needsYou ? 'needs-you' : 'working'} title="your agent" />
          <div>
            <p className="agent-name">Your agent</p>
            <p className="agent-state">
              <span className={`dot ${needsYou ? 'warn' : 'ok'}`} aria-hidden="true" />
              <span className="mono">{needsYou ? 'needs you' : 'working'}</span> · one thread
            </p>
          </div>
        </div>

        <nav className="nav" aria-label="Sections">
          {NAV.map((n) => {
            const Icon = n.icon;
            const count = n.id === 'tasks' ? waitingTasks : n.id === 'decisions' ? decisions.length : null;
            const countTitle = n.id === 'tasks' ? 'tasks waiting on your decision' : 'decisions recorded';
            return (
              <button
                key={n.id}
                type="button"
                className={n.id === view ? 'on' : ''}
                onClick={() => setView(n.id)}
                data-testid={`nav-${n.id}`}
                aria-current={n.id === view ? 'page' : undefined}
              >
                <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                <span>{n.label}</span>
                {count !== null ? <span className="nav-count mono" title={countTitle} aria-label={countTitle} data-testid={`nav-count-${n.id}`} data-count={count}>{count}</span> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <SettingsSurface />
          <p className="foot-note">one agent · one ongoing thread</p>
        </div>
      </aside>

      <main className="thread-col" data-testid="thread-col">
        <header className="col-head-main">
          <h1>{NAV[idx]?.label ?? 'Chat'}</h1>
          <p className="muted">
            {view === 'chat' ? 'One ongoing thread with your agent.' : view === 'tasks' ? 'The inbox of decisions.' : 'What you approved and denied.'}
          </p>
        </header>

        {view === 'chat' ? (
          <div className="chat-body">
            <div className="chat-scroll">
              <Thread messages={messages} replying={replying} tasks={tasks} />
            </div>
            <div className="chat-foot">
              {lastOutcome ? (
                <OutcomeStrip
                  outcome={lastOutcome.decision}
                  onDismiss={dismissOutcome}
                  onOpenDecisions={() => setView('decisions')}
                />
              ) : (
                <ApprovalCard approvals={approvals} />
              )}
              <Composer onSend={sendMessage} />
            </div>
          </div>
        ) : (
          <div className="view-body">
            <TransitionPanel
              activeIndex={idx - 1}
              transition={{ duration: dur.swap, ease }}
              variants={{
                enter: { opacity: 0, y: 8 },
                center: { opacity: 1, y: 0 },
                exit: { opacity: 0, y: -8 },
              }}
            >
              {[<div key="tasks"><Tasks /></div>, <div key="decisions"><Decisions onOpenChat={() => setView('chat')} onOpenTasks={() => setView('tasks')} /></div>]}
            </TransitionPanel>
          </div>
        )}
      </main>

      <AppCanvas />
    </div>
  );
}

export default Desktop;
