// views/Make.tsx — the phone face's third tab (Chat / Tasks / Make). Make is what your agent has
// produced: artefacts with their state, carried from the real Ergon IA.
import { StatePill, type PillState } from '../components/StatePill';
import { MAKES } from '../data/fixtures';

const PILL: Record<string, PillState> = { ready: 'done', 'in review': 'waiting', 'in progress': 'working' };

export function Make({ compact = true }: { compact?: boolean }) {
  const body = (
    <>
      <div className="m-view-head">
        <h2>Make</h2>
        <p className="muted">artefacts your agent produced</p>
      </div>
      <ul className="m-cards" data-testid="make-list">
        {MAKES.map((m) => (
          <li key={m.id} className="m-card" data-testid={`make-${m.id}`}>
            <div className="m-card-top">
              <h3>{m.title}</h3>
              <StatePill state={PILL[m.state] ?? 'working'} label={m.state} />
            </div>
            <p className="meta"><span className="mono">{m.id}</span> · {m.kind}</p>
            <p className="last">{m.preview}</p>
          </li>
        ))}
      </ul>
    </>
  );
  if (compact) return <div className="m-view" data-testid="make">{body}</div>;
  return (
    <div className="surface" data-testid="make">
      <div className="section-head"><div><h2>Make</h2><p className="muted">Artefacts your agent produced.</p></div></div>
      {body}
    </div>
  );
}

export default Make;
