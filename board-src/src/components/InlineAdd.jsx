import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { JobForm } from './JobForm';
import { BayMarker } from './BayMarker';

// A quiet "Add job" at the end of a line's cards (occupied or empty): a compact form anchored to that row, with the line already chosen.
export function InlineAdd({ line, form }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="row-add h-auto min-h-0 shrink-0 self-stretch px-2 text-muted pointer-coarse:h-auto focus-visible:-outline-offset-2" data-add-line={line} disabled={!form.canEdit} aria-label={`Add job on line ${line}`} title={`Add job on line ${line}`}>
          <Plus aria-hidden="true" /><span className="btn-label-row">Add job</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="add-popover w-90" aria-label={`Add job on line ${line}`}
        onOpenAutoFocus={(e) => { e.preventDefault(); document.getElementById(`add-${line}-title`)?.focus(); }}>
        <div className="mb-4 flex items-center gap-2"><BayMarker letter={line} /><p className="m-0 text-body-sm font-medium">{`Add job on line ${line}`}</p></div>
        <JobForm compact p={`add-${line}-`} lineLabel={line} job={null} form={{ ...form, save: (draft) => form.save({ ...draft, line_code: line }) }} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
