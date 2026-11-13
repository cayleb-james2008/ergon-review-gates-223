// components/HoldToSend.tsx — the approval card's primary action: HOLD TO SEND, ~0.9 s to commit.
// A tap can never send: the commit fires only when the pointer/key has been held for the full budget
// (`--eg-hold-commit` = 900 ms, the reference grammar). The face is the REAL Kitchen `TactileButton`
// (vendored verbatim), with the Ergon token values passed through its own style contract — no vendored
// byte is edited. The hold progress is drawn from the same tokens.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon } from 'lucide-react';
import { TactileButton } from '../vendor/kitchen/TactileButton';

const HOLD_MS = 900;

type Props = {
  label?: string;
  heldLabel?: string;
  onCommit: () => void;
  disabled?: boolean;
};

export function HoldToSend({ label = 'Hold to approve', heldLabel = 'Keep holding…', onCommit, disabled = false }: Props) {
  const [progress, setProgress] = useState(0); // 0..1
  const [committed, setCommitted] = useState(false);
  const raf = useRef<number | null>(null);
  const startedAt = useRef<number>(0);
  const done = useRef(false);

  const stop = useCallback((cancel: boolean) => {
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
    if (cancel) setProgress(0);
  }, []);

  const start = useCallback(() => {
    if (disabled || done.current) return;
    startedAt.current = performance.now();
    setProgress(0.001);
    const step = () => {
      const elapsed = performance.now() - startedAt.current;
      const p = Math.min(1, elapsed / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        if (!done.current) {
          done.current = true;
          setCommitted(true);
          stop(false);
          onCommit();
        }
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [disabled, onCommit, stop]);

  useEffect(() => () => stop(true), [stop]);

  const holding = progress > 0 && !committed;

  return (
    <div
      className={`hold-wrap${holding ? ' holding' : ''}`}
      data-testid="hold-to-send"
      data-hold-progress={progress.toFixed(2)}
      data-committed={committed ? '1' : '0'}
    >
      <TactileButton
        size="lg"
        tone="light"
        depth="medium"
        aria-label={`${label} — hold about 0.9 seconds to commit; a tap cannot send`}
        onPointerDown={(e: React.PointerEvent) => { e.preventDefault(); start(); }}
        onPointerUp={() => stop(true)}
        onPointerLeave={() => stop(true)}
        onPointerCancel={() => stop(true)}
        onKeyDown={(e: React.KeyboardEvent) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); }
        }}
        onKeyUp={() => stop(true)}
        style={{
          '--tactile-face': 'var(--eg-accent)',
          '--tactile-face-highlight': 'var(--eg-accent-hover)',
          '--tactile-content': 'var(--eg-on-accent)',
          '--tactile-base': 'var(--eg-accent-press)',
          '--tactile-base-shadow': 'var(--eg-accent-press)',
        } as React.CSSProperties}
      >
        <span className="hold-label">
          {committed ? <CheckIcon size={16} strokeWidth={2.2} aria-hidden="true" /> : null}
          {committed ? 'Approved' : holding ? heldLabel : label}
        </span>
      </TactileButton>
      <span className="hold-track" aria-hidden="true">
        <span className="hold-fill" style={{ transform: `scaleX(${progress})` }} />
      </span>
      <span className="hold-hint mono">hold ~0.9 s · a tap cannot send</span>
    </div>
  );
}

export default HoldToSend;
