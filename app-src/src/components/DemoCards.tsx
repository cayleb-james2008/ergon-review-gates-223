// components/DemoCards.tsx — the demo-only cards in the thread: the SIMULATED call, the job card
// the agent pulled from it, the published skill, and the review gates (GateCard) that hold every
// consequential act. No production path uses these components; the base suite thread renders plain
// turns only.
import type { Msg, MsgCard } from '../data/fixtures';
import { GateCard } from './GateCard';

function SimulationBadge() {
  return <span className="demo-badge">SIMULATED — no real call</span>;
}

export function CallCard({ card }: { card: Extract<MsgCard, { kind: 'call' }> }) {
  return (
    <div className="demo-card call-card" data-testid="call-card">
      <header className="demo-card-head">
        <span className={`dot ${card.status === 'done' ? 'ok' : 'warn'}`} aria-hidden="true" />
        <strong>{card.callee}</strong>
        <SimulationBadge />
      </header>
      <p className="demo-card-sub mono">
        {card.status === 'dialing' ? 'dialling…' : card.status === 'live' ? `on the call · ${card.ended ? '' : 'live'}` : `call ended · ${card.ended ?? '00:14'}`}
      </p>
      <ol className="call-turns">
        {card.turns.map((t, i) => (
          <li key={i} className={`call-turn ${t.who}`}>
            <span className="call-who">{t.label}</span>
            <p>{t.text}</p>
          </li>
        ))}
      </ol>
      {card.status === 'done' ? (
        <p className="demo-card-foot">Scripted transcript for the demo — no telephony, no real call was placed.</p>
      ) : null}
    </div>
  );
}

export function JobCard({ card }: { card: Extract<MsgCard, { kind: 'job' }> }) {
  return (
    <div className="demo-card job-card" data-testid="job-card" data-ref={card.ref}>
      <header className="demo-card-head">
        <strong>{card.title}</strong>
        <span className="line-chip mono">line {card.line}</span>
      </header>
      <dl className="job-rows">
        {card.rows.map((r) => (
          <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>
        ))}
      </dl>
      <p className="demo-card-foot">{card.note}</p>
    </div>
  );
}

export function SkillCard({ card }: { card: Extract<MsgCard, { kind: 'skill' }> }) {
  return (
    <div className="demo-card skill-card" data-testid="skill-card" data-skill={card.name}>
      <header className="demo-card-head">
        <strong className="mono">{card.name}</strong>
        <span className="line-chip mono">v{card.version}</span>
      </header>
      <p className="demo-card-sub">company library · {card.role} · {card.published ? 'published' : 'in review'}</p>
      <p className="demo-card-text">{card.summary}</p>
    </div>
  );
}

export function MessageCard({ m }: { m: Msg }) {
  if (!m.card) return null;
  switch (m.card.kind) {
    case 'call': return <CallCard card={m.card} />;
    case 'job': return <JobCard card={m.card} />;
    case 'skill': return <SkillCard card={m.card} />;
    case 'gate': return <GateCard card={m.card} messageId={m.id} />;
    default: return null;
  }
}
