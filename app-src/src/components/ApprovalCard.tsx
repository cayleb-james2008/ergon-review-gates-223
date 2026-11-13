// components/ApprovalCard.tsx — approvals are CARDS that act IN PLACE (Ticket 076 item 2, approved by
// the owner): the amber state edge, the scope, the class and the HOLD TO SEND control all live on the
// card itself, on the running approvals path — no Review detour, no dead button. Acting on it (approve
// OR deny) records a decision, clears the waiting pin and closes the card with the outcome shown
// (Ticket 062). The primary action face is the REAL Kitchen TactileButton inside HoldToSend.
import { useEffect, useState } from 'react';
import { ShieldCheckIcon } from 'lucide-react';
import { HoldToSend } from './HoldToSend';
import { decide } from '../data/store';
import type { Approval, Decision } from '../data/fixtures';

export function ApprovalCard({ approvals, compact = false }: { approvals: Approval[]; compact?: boolean }) {
  if (approvals.length === 0) return null;
  const a = approvals[0];
  return (
    <section
      className={`approval-inline${compact ? ' compact' : ''}`}
      data-testid="approval-card"
      data-answers="2"
      aria-label="Approval waiting on you"
    >
      <div className="approval-inline-top">
        <span className="approval-dot" aria-hidden="true" />
        <strong data-testid="approvals-count">
          {approvals.length} approval{approvals.length === 1 ? '' : 's'} waiting
        </strong>
        <span className="approval-tag"><ShieldCheckIcon size={12} strokeWidth={1.9} aria-hidden="true" />{a.tag}</span>
        <span className="approval-inline-expires mono">expires in {a.expires}</span>
      </div>
      <div className="approval-inline-main">
        <p className="approval-inline-title">{a.title}</p>
        {compact ? null : <p className="approval-inline-body">{a.body}</p>}
        {/* F2 (round-7 fresh-eye review): labelled two-column meta. The label and its value live in
            the same cell, so the phone never orphans "bounded grant" as a stray line. */}
        <dl className="approval-meta-grid" data-testid="approval-meta">
          <div>
            <dt>Scope</dt>
            <dd className="mono">{a.scope}</dd>
          </div>
          <div>
            <dt>Class</dt>
            <dd className="mono">{a.klass}</dd>
          </div>
        </dl>
      </div>
      <div className="approval-actions">
        <HoldToSend label="Hold to approve" onCommit={() => decide(a.id, 'approved')} />
        <button
          type="button"
          className="btn-quiet deny"
          data-testid="deny"
          onClick={() => decide(a.id, 'denied')}
        >
          Deny
        </button>
      </div>
    </section>
  );
}

// The outcome strip: shown when a decision has just been recorded, so the card closes WITH the
// outcome visible (Ticket 062 done-when 1). It links into the Decisions inbox.
export function OutcomeStrip({ outcome, onDismiss, onOpenDecisions }: {
  outcome: Decision;
  onDismiss: () => void;
  /** omitted where the face has no Decisions surface (the demo phone's tab grammar): the strip then
   *  shows the recorded decision and Dismiss only, never a button that goes nowhere */
  onOpenDecisions?: () => void;
}) {
  const approved = outcome.outcome === 'approved';
  const signedOff = outcome.kind === 'signoff';
  // TOUCH-SAFE SETTLE (round-7 UX fix): the strip replaces the hold control in the same slot while
  // the finger is still down. Without this guard, the pointerup that ends the hold is delivered to
  // whatever button has appeared under the finger — the phone walked itself into Decisions. The
  // actions ignore input until the strip has settled; the action still works a moment later.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 500);
    return () => clearTimeout(timer);
  }, []);
  const guard = (action: () => void) => () => { if (settled) action(); };
  const inert = { pointerEvents: settled ? 'auto' : 'none' } as const;
  return (
    <div
      className={`outcome-strip ${outcome.outcome}`}
      data-testid="decision-outcome"
      data-settled={settled ? '1' : '0'}
      role="status"
    >
      <span className="outcome-dot" aria-hidden="true" />
      <span className="outcome-text">
        <strong>Decision recorded — {signedOff ? 'Signed off' : approved ? 'Approved' : 'Denied'}</strong>
        <span>{outcome.title} · <span className="mono">{outcome.id}</span> · <span className="mono">{outcome.note.replace(/^you · /, '')}</span></span>
      </span>
      {onOpenDecisions ? (
        <button
          type="button" className="btn-quiet" onClick={guard(onOpenDecisions)}
          style={inert} data-testid="outcome-open-inbox"
        >
          Decisions inbox
        </button>
      ) : null}
      <button
        type="button" className="btn-quiet" onClick={guard(onDismiss)}
        style={inert} data-testid="outcome-dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
