// faces/Mobile.tsx — the reference's PHONE composition: Chat / Tasks / Make, with the bar FLOATING as
// a pill ABOVE a GLUED composer (owner pick 8 Nov 10:10 ET). Presence + "Your agent" and the settings
// control sit in the header, so settings is one obvious action from the main shell on this face too.
// Decisions is reachable inside Tasks (a sub-view), so the phone inbox exists without adding a fourth
// tab to the reference's three.
//
// Demo mode for the RHL warehouse showcase (data/store.ts DEMO): the same header and bottom grammar,
// but the two tabs after Chat are the demo run's own surfaces — the live board and the company
// library — so the three demo beats each have a place to happen.
import { useEffect, useRef, useState } from 'react';
import { BookOpenIcon, ChevronUpIcon, ListChecksIcon, MessageCircleIcon, ShieldCheckIcon, SparklesIcon, WarehouseIcon } from 'lucide-react';
import { TransitionPanel } from '../vendor/mp/transition-panel';
import { PresenceMark } from '../components/PresenceMark';
import { Composer } from '../components/Composer';
import { ApprovalCard, OutcomeStrip } from '../components/ApprovalCard';
import { SettingsSurface } from '../views/Settings';
import { Thread } from '../views/Thread';
import { Tasks } from '../views/Tasks';
import { Decisions } from '../views/Decisions';
import { Make } from '../views/Make';
import { DEMO, agentIsReplying, dismissOutcome, sendMessage, useErgon } from '../data/store';
import { Board } from '../views/Board';
import { Library } from '../views/Library';
import type { ViewId } from './Desktop';
import { dur, ease } from '../motion';

type TabId = 'chat' | 'tasks' | 'make' | 'board' | 'library';
const TABS = [
  { id: 'chat' as const, label: 'Chat', icon: MessageCircleIcon },
  { id: 'tasks' as const, label: 'Tasks', icon: ListChecksIcon },
  { id: 'make' as const, label: 'Make', icon: SparklesIcon },
];
// The showcase's three beats live on three surfaces: your agent, the live warehouse board, the
// company library. Demo mode swaps the base app's Tasks/Make pills for those two.
const DEMO_TABS = [
  { id: 'chat' as const, label: 'Chat', icon: MessageCircleIcon },
  { id: 'board' as const, label: 'Board', icon: WarehouseIcon },
  { id: 'library' as const, label: 'Library', icon: BookOpenIcon },
];

export function Mobile({ initialView }: { initialView: ViewId | 'make' }) {
  const demo = DEMO;
  const tabs = demo ? DEMO_TABS : TABS;
  const [tab, setTab] = useState<TabId>(demo ? 'chat' : initialView === 'tasks' || initialView === 'decisions' ? 'tasks' : initialView === 'make' ? 'make' : 'chat');
  const [taskSub, setTaskSub] = useState<'tasks' | 'decisions'>(initialView === 'decisions' ? 'decisions' : 'tasks');
  const [barHidden, setBarHidden] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Navigation lands at the top of the new view: the m-body is ONE scroll container shared by the
  // panels, and the thread's keep-in-view effect leaves it scrolled to the bottom — without this a
  // tab switch opened Tasks mid-scroll, with its header row (and the New task action) under the
  // app header and unclickable.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [tab, taskSub]);
  const messages = useErgon((s) => s.messages);
  const tasks = useErgon((s) => s.tasks);
  const approvals = useErgon((s) => s.approvals);
  // the SAME needs-you derivation as the morning brief and the Decisions page
  const needsYou = approvals.length + tasks.filter((t) => t.state === 'waiting').length;
  const decisions = useErgon((s) => s.decisions);
  const lastOutcome = useErgon((s) => s.lastOutcome);
  const settings = useErgon((s) => s.settings);
  const notice = useErgon((s) => s.notice ?? null);
  const replying = agentIsReplying();
  const tabIdx = tab === 'chat' ? 0 : tab === 'tasks' ? 1 : tab === 'make' ? 2 : tab === 'board' ? 1 : 2;
  const viewLabel = demo
    ? (tabs.find((t) => t.id === tab)?.label ?? 'Chat')
    : tab === 'chat' ? 'Chat' : tab === 'make' ? 'Make' : taskSub === 'decisions' ? 'Decisions' : 'Tasks';
  useEffect(() => { document.title = `${viewLabel} · Warehouse demo`; }, [viewLabel]); // the tab title says where you are (I-28)
  // the view is in the address, so a reload or a copied link returns to it (X-3); replaceState leaves the history as it was
  useEffect(() => { const u = new URL(window.location.href); u.searchParams.set('view', viewLabel.toLowerCase()); window.history.replaceState({}, '', u); }, [viewLabel]);

  function openDecisions() {
    setTab('tasks');
    setTaskSub('decisions');
  }

  return (
    <div className={`face phone density-${settings.density} motion-${settings.motion}`} data-testid="phone-face" data-face="phone">
      <header className="m-head" data-needs-you={needsYou}>
        <PresenceMark size={30} state={needsYou ? 'needs-you' : 'working'} title="your agent" />
        <div className="m-head-text">
          <p className="m-title">Your agent {demo ? <span className="demo-chip" data-testid="demo-chip">DEMO</span> : null}</p>
          <p className="m-sub">
            <span className={`dot ${needsYou ? 'warn' : 'ok'}`} aria-hidden="true" />
            <span className="mono">{needsYou ? 'needs you' : 'working'}</span> · {demo ? 'RHL warehouse · demo data only' : 'one ongoing thread'}
          </p>
        </div>
        <SettingsSurface compact />
      </header>

      {demo && notice ? (
        <div className="demo-notice" role="status" data-testid="demo-notice">
          <span className="demo-notice-bell" aria-hidden="true">●</span>
          <div><strong>{notice.title}</strong><p>{notice.body}</p></div>
        </div>
      ) : null}

      <div className={`m-body${demo && tab === 'board' ? ' m-body-board' : ''}`} data-testid="m-body" ref={bodyRef}>
        {demo ? (
          tab === 'board' ? <Board /> : tab === 'library' ? <div className="m-panel"><Library /></div> : (
            <div className="m-panel"><Thread messages={messages} replying={replying} tasks={tasks} compact /></div>
          )
        ) : (
        <TransitionPanel
          activeIndex={tabIdx}
          transition={{ duration: dur.swap, ease }}
          variants={{
            enter: { opacity: 0, y: 8 },
            center: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -8 },
          }}
        >
          {[
            <div data-panel="chat" key="chat" className="m-panel">
              <Thread messages={messages} replying={replying} tasks={tasks} compact />
            </div>,
            <div data-panel="tasks" key="tasks" className="m-panel">
              <div className="m-subswitch" role="tablist" aria-label="Tasks and decisions">
                <button
                  role="tab" type="button"
                  aria-selected={taskSub === 'tasks'}
                  className={taskSub === 'tasks' ? 'on' : ''}
                  onClick={() => setTaskSub('tasks')}
                  data-testid="m-sub-tasks"
                ><ListChecksIcon size={14} strokeWidth={1.9} aria-hidden="true" /> Tasks</button>
                <button
                  role="tab" type="button"
                  aria-selected={taskSub === 'decisions'}
                  className={taskSub === 'decisions' ? 'on' : ''}
                  onClick={() => setTaskSub('decisions')}
                  data-testid="m-sub-decisions"
                ><ShieldCheckIcon size={14} strokeWidth={1.9} aria-hidden="true" /> Decisions <span className="mono">{decisions.length}</span></button>
              </div>
              {taskSub === 'tasks' ? <Tasks compact /> : <Decisions compact onOpenChat={() => setTab('chat')} onOpenTasks={() => { setTab('tasks'); setTaskSub('tasks'); }} />}
            </div>,
            <div data-panel="make" key="make" className="m-panel"><Make /></div>,
          ]}
        </TransitionPanel>
        )}
      </div>

      <div className="m-bottom">
        {demo ? null : tab === 'chat' ? (
          lastOutcome ? (
            <OutcomeStrip
              outcome={lastOutcome.decision}
              onDismiss={dismissOutcome}
              onOpenDecisions={openDecisions}
            />
          ) : (
            <ApprovalCard approvals={approvals} compact />
          )
        ) : null}

        {!demo || tab === 'chat' ? (
        <div className="composer-glued">
          <Composer
            compact
            onSend={(text) => { setTab('chat'); sendMessage(text); }}
            placeholder={demo ? 'Tell your agent what to do…' : 'Message your agent…'}
          />
        </div>
        ) : null}

        {/* the confirmed grammar, restated by the 8 Nov standard: the bar sits UNDER the glued composer
            and is tap-to-hide; the slim handle below toggles it, and the approvals pin stays above. */}
        <div className={`m-bar${barHidden ? ' hidden' : ''}`} data-testid="m-bar" data-hidden={barHidden ? '1' : '0'}>
          <button
            type="button"
            className="m-bar-handle"
            onClick={() => setBarHidden((v) => !v)}
            aria-expanded={!barHidden}
            aria-controls="m-tabbar"
            aria-label={barHidden ? 'Show tabs' : 'Hide tabs'}
            data-testid="bar-toggle"
          >
            {barHidden ? (
              <span className="m-bar-restore" aria-hidden="true">
                <ChevronUpIcon size={12} strokeWidth={2.1} /> Show tabs
              </span>
            ) : (
              <span className="m-bar-grip" aria-hidden="true" />
            )}
          </button>
          <nav className="m-pill" id="m-tabbar" data-testid="tabbar" aria-label="Tabs">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={t.id === tab ? 'on' : ''}
                  onClick={() => { if (barHidden) return; setTab(t.id); }}
                  data-testid={`tab-${t.id}`}
                  aria-current={t.id === tab ? 'page' : undefined}
                >
                  <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}

export default Mobile;
