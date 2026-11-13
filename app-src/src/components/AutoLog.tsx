// components/AutoLog.tsx — the AUTO half of the audit, visible beside the thread: the work the agent
// did on its own (drafted, read, prepared) with no confirmation needed. Only the consequential acts
// are gated; this is what hands-off looks like. One compact line, newest three acts.
import { useErgon } from '../data/store';

export function AutoLog() {
  const acts = useErgon((s) => s.autoLog);
  if (acts.length === 0) return null;
  return (
    <div className="auto-log" data-testid="auto-log" data-count={acts.length} aria-label="Your agent's automatic actions">
      <span className="dot ok" aria-hidden="true" />
      <span className="auto-log-tag mono">Automatic</span>
      <span className="auto-log-text">{acts.slice(0, 3).map((a) => a.text).join(' · ')}</span>
      <span className="auto-log-note">no confirmation needed</span>
    </div>
  );
}

export default AutoLog;
