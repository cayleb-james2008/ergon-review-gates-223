import { Eye, Pencil } from 'lucide-react';
import { chipLabel } from '@/core/key';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const when = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };

// A quiet status, not a control (not a tab stop; the expiry tooltip opens on hover): who is editing, or why nobody can. Nothing here asks a person for a secret.
export function KeyChip({ state, subject, expiresAt, id }) {
  const chip = (
    <span id={id} className="key-chip" role="status" data-state={state} data-subject={state === 'valid' ? subject : undefined}>
      {state === 'valid' ? <Pencil aria-hidden="true" /> : <Eye aria-hidden="true" />}<span>{state === 'checking' ? 'Checking access' : chipLabel(state, subject)}</span>
    </span>
  );
  if (state !== 'valid' || !expiresAt) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent>{`Editing until ${when(expiresAt)}`}</TooltipContent>
    </Tooltip>
  );
}
