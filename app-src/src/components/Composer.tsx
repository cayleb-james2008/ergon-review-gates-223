// components/Composer.tsx — the composer, glued to the bottom of the face on both widths.
// Sending appends the user's turn to the one thread; the NAMED FIXTURE reply engine answers it.
import { useState } from 'react';
import { ArrowUpIcon } from 'lucide-react';
import { DEMO } from '../data/store';

type Props = { onSend: (text: string) => void; placeholder?: string; compact?: boolean };

export function Composer({ onSend, placeholder = 'Message your agent…', compact = false }: Props) {
  const [draft, setDraft] = useState('');
  const canSend = draft.trim().length > 0;
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  }
  return (
    <form className={`composer${compact ? ' composer-compact' : ''}`} onSubmit={submit} data-testid="composer">
      <div className="composer-field">
        <input
          className="composer-input"
          aria-label="Message your agent"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          data-testid="composer-input"
        />
        <button className="composer-send" type="submit" aria-label="Send" disabled={!canSend} data-testid="composer-send">
          <ArrowUpIcon size={16} strokeWidth={2.2} aria-hidden="true" />
          Send
        </button>
      </div>
      <p className="composer-note">{DEMO ? 'scripted demo agent — no live AI' : 'fixture reply engine — no live agent runtime'}</p>
    </form>
  );
}

export default Composer;
