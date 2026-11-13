// views/Board.tsx — the RHL warehouse board, live inside the phone app.
//
// The board is the REAL board build (b559e68) with VITE_BACKEND=demo, served beside this app, so
// every board function works: search, line cards, job dialog, status changes, demo keys. The app
// supplies window.rhlAgent.agent.send — the board's in-process hand-off hook (renamed here so the
// served demo bytes carry no vendor brand)
// (docs/AGENT-HANDOFF.md) — and the text typed into the board's command bubble is routed to the
// scripted demo agent. The board itself still does no interpretation of the text.
import { useEffect, useRef } from 'react';
import { handleBoardCommand } from '../data/store';

export function Board() {
  const ref = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const w = ref.current?.contentWindow as (Window & { rhlAgent?: unknown }) | null;
      try {
        if (w && w.document && w.document.getElementById('root')) {
          w.rhlAgent = {
            agent: {
              send: (msg: { type?: string; text?: string }) => {
                if (!msg || msg.type !== 'rhl.agent.command') return;
                handleBoardCommand(String(msg.text || ''));
              },
            },
          };
          clearInterval(timer);
          return;
        }
      } catch {
        /* same-origin only; if it ever stops being same-origin this stays inert and the board
           falls back to its plain-browser note ("Connect your agent to run commands.") */
      }
      if (tries > 80) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="board-wrap">
      <p className="board-strip" data-testid="board-strip">
        <span className="dot ok" aria-hidden="true" /> Live board · <strong>demo data only</strong> · not the live RHL board
      </p>
      <iframe
        ref={ref}
        className="board-frame"
        title="RHL warehouse board — demo instance"
        src="../board/?demo=reset#key=demo-employee"
        data-testid="board-frame"
      />
    </div>
  );
}

export default Board;
