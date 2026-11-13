// views/Decisions.tsx — the DECISIONS INBOX (Ticket 062 done-when 2): a surface, on both faces, that
// lists the decisions that were actually acted on, with their outcome, scope and time. It reads the
// persisted record, so an approval acted on earlier is still here after a reload.
import { ShieldCheckIcon } from 'lucide-react';
import { StatePill } from '../components/StatePill';
import { useErgon } from '../data/store';

function when(at: number) {
  return new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// The sentence is the same words as before; the two places it names are now links to where the person acts (I-9, X-8).
function Waiting({ approvals, waiting, onOpenChat, onOpenTasks }: { approvals: number; waiting: number; onOpenChat: () => void; onOpenTasks: () => void }) {
  return (
    <span>
      {approvals + waiting} still waiting on your decision — {approvals > 0 ? (
        <button type="button" className="link-inline" onClick={onOpenChat} data-testid="decisions-open-chat">{approvals} approval{approvals === 1 ? '' : 's'} in Chat</button>
      ) : null}{approvals > 0 && waiting > 0 ? ' + ' : null}{waiting > 0 ? (
        <button type="button" className="link-inline" onClick={onOpenTasks} data-testid="decisions-open-tasks">{waiting} task{waiting === 1 ? '' : 's'} on the Tasks board</button>
      ) : null}.
    </span>
  );
}

export function Decisions({ compact = false, onOpenChat, onOpenTasks }: { compact?: boolean; onOpenChat: () => void; onOpenTasks: () => void }) {
  const decisions = useErgon((s) => s.decisions);
  const approvals = useErgon((s) => s.approvals);
  const tasks = useErgon((s) => s.tasks);
  // The SAME needs-you derivation the morning brief prints (approvals + waiting tasks). The inbox is
  // the record of what was acted on; this line is the honest statement of what is still outstanding,
  // so after the approval is acted on it must still name the waiting task rather than say "nothing".
  const waitingTasks = tasks.filter((t) => t.state === 'waiting').length;
  const needsYou = approvals.length + waitingTasks;

  const body = (
    <>
      <div className="decisions-head">
        <ShieldCheckIcon size={16} strokeWidth={1.9} aria-hidden="true" />
        <span>
          <strong>Decision inbox</strong>
          <span className="muted"> every decision acted on, newest first — {decisions.length} recorded</span>
        </span>
      </div>
      {needsYou > 0 ? (
        <p className="decisions-waiting" data-testid="decisions-waiting" data-needs={needsYou}>
          <span className="dot warn" aria-hidden="true" /> <Waiting approvals={approvals.length} waiting={waitingTasks} onOpenChat={onOpenChat} onOpenTasks={onOpenTasks} />
        </p>
      ) : (
        <p className="decisions-waiting quiet" data-testid="decisions-clear" data-needs="0">
          <span className="dot ok" aria-hidden="true" /> Nothing waiting on you.
        </p>
      )}
      <ul className="decision-list" data-testid="decision-list">
        {decisions.map((d) => (
          <li key={d.id} className={`decision-row ${d.outcome}`} data-testid={`decision-${d.id}`}>
            <div className="decision-main">
              <h4>{d.title}</h4>
              <p className="meta">
                <span className="mono">{d.id}</span> · {d.scope} · {when(d.at)}
              </p>
            </div>
            <StatePill state={d.outcome} />
          </li>
        ))}
      </ul>
      {decisions.length === 0 ? <p className="empty-col">No decisions recorded yet.</p> : null}
    </>
  );

  if (compact) return <div className="m-view" data-testid="decisions">{body}</div>;
  return (
    <div className="surface" data-testid="decisions">
      <div className="section-head">
        <p className="muted">Kept, not implied — the record survives a reload.</p>
      </div>
      {body}
    </div>
  );
}

export default Decisions;
