// components/GateCard.tsx — the review gate: a small purpose-built in-thread card for ONE
// consequential act. The agent has prepared the act and states exactly what will change; nothing
// changes until the employee confirms with a ~0.9 s hold (a tap cannot confirm). Deny records the
// denial and changes nothing. The card closes in place with the outcome and the Decisions record.
// The shell is the demo card; the body is the gate's own mono fields, never a paragraph of prose.
import { ShieldCheckIcon } from 'lucide-react';
import { HoldToSend } from './HoldToSend';
import { approveGate, denyGate } from '../data/store';
import type { GateCardView, GateKind } from '../data/fixtures';

/** The control names the act: the hold label and the committed label both say what happened. */
const CONTROL: Record<GateKind, { label: string; committed: string }> = {
  call: { label: 'Hold to place the call', committed: 'Called' },
  board: { label: 'Hold to write the job', committed: 'Written' },
  skill: { label: 'Hold to publish', committed: 'Published' },
  signoff: { label: 'Hold to sign off', committed: 'Signed off' },
};

export function GateCard({ card, messageId }: { card: GateCardView; messageId: string }) {
  const pending = card.state === 'pending';
  const approved = card.state === 'approved';
  const control = CONTROL[card.gate];
  return (
    <section
      className={`gate-card ${card.state}`}
      data-testid={`gate-${card.gate}`}
      data-gate={card.gate}
      data-state={card.state}
      aria-label={`Review gate: ${card.title}`}
    >
      <header className="gate-head">
        <span className={`gate-dot ${card.state}`} aria-hidden="true" />
        <span className="gate-tag">
          <ShieldCheckIcon size={12} strokeWidth={1.9} aria-hidden="true" />
          review gate · {pending ? 'waiting on you' : approved ? 'approved' : 'denied'}
        </span>
      </header>
      <p className="gate-title">{card.title}</p>
      <dl className="gate-fields">
        {card.fields.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd className="mono">{f.value}</dd>
          </div>
        ))}
      </dl>
      {pending ? (
        <div className="gate-actions">
          <HoldToSend
            label={control.label}
            committedLabel={control.committed}
            onCommit={() => approveGate(messageId)}
          />
          <button type="button" className="btn-quiet deny" data-testid="gate-deny" onClick={() => denyGate(messageId)}>
            Deny
          </button>
        </div>
      ) : (
        <p className={`gate-outcome ${card.state}`} data-testid="gate-outcome" role="status">
          <span className="outcome-dot" aria-hidden="true" />
          <span>
            Decision recorded — <strong>{approved ? 'Approved' : 'Denied'}</strong>
            {card.decisionId ? <> · <span className="mono">{card.decisionId}</span></> : null}
            {' · '}{approved ? 'in the Decisions inbox' : 'nothing changed'}
          </span>
        </p>
      )}
      <p className="gate-note">{card.note}</p>
    </section>
  );
}

export default GateCard;
