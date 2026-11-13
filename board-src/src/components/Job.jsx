import { memo, useLayoutEffect, useRef } from 'react';
import { STATUSES } from '@/config';
import { statusLabel } from '@/core/lines';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge, StatusOption } from './StatusBadge';
import { cn } from '@/lib/utils';
import { hueFor } from '@/core/legend';

// Status-change cue: the card fill starts tinted and eases back to rest in 350 ms (a class and an eased fill, no keyframes).
// shortcut: the cue clears its class with a 400 ms timer, upgrade: listen for transitionend on the card
function useCue(status, enabled) {
  const ref = useRef(null);
  const prev = useRef(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    const changed = prev.current !== status;
    const first = prev.current === undefined;
    prev.current = status;
    if (!el || !changed || (first && !enabled)) return undefined;
    el.classList.remove('cue-rest');
    el.classList.add('cue');
    void el.offsetWidth; // commit the tinted state, then release it so the ease runs
    let t;
    const raf = requestAnimationFrame(() => { el.classList.add('cue-rest'); el.classList.remove('cue'); t = setTimeout(() => el.classList.remove('cue-rest'), 400); });
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [status, enabled]);
  return ref;
}

function JobCard({ job, line, ctx, fresh, hit, dim, demo, measure, compact }) {
  const customer = job.title || '(untitled)';
  const ref = useCue(job.status, fresh);
  const options = STATUSES.some((s) => s.value === job.status) ? STATUSES : [...STATUSES, { value: job.status, label: statusLabel(job.status) }];
  return (
    <div ref={ref} className={cn('job', hit && 'hit', dim && 'dim')} role="listitem"
      data-id={job.id} data-status={job.status} data-line={line} data-revision={String(job.revision ?? '')} data-test={String(!!job.is_test)} data-updated-by={job.updated_by || undefined}
      data-compact={compact ? '' : undefined} data-demo={demo === 'focus' ? undefined : demo} data-measure={measure ? '' : undefined}
      onClick={(e) => { if (!e.target.closest('[role="combobox"],[role="listbox"]') && !e.defaultPrevented) ctx.onEdit(job); }}
      aria-label={`${customer}, line ${line}, ${statusLabel(job.status)}${job.initials ? `, ${job.initials}` : ''}`}>
      <div className="job-top">
        <button type="button" className="customer customer-btn" data-field="title" data-focus={`edit:${job.id}`} title={`${customer}${job.details ? `: ${job.details}` : ''}${job.initials ? ` (${job.initials})` : ''}`}
          data-demo={demo === 'focus' ? 'focus' : undefined} aria-label={`Edit job: ${customer}`} onClick={() => ctx.onEdit(job)}>{customer}</button>
        <Select value={job.status} disabled={!ctx.canEdit} onValueChange={(v) => ctx.onStatus(job, v)}>
          <SelectTrigger variant="status" data-field="status" data-status={job.status} data-focus={`status:${job.id}`} aria-label={`Status for ${customer}: ${statusLabel(job.status)}`}>
            <SelectValue className="inline-flex items-center" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => <SelectItem key={o.value} value={o.value}><StatusOption status={o.value} label={o.label} /></SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="job-bottom">
        <span className="note" data-field="details" title={job.details ?? ''}>{job.details ?? ''}</span>
        <span className="initials" data-field="initials" data-hue={hueFor(job.initials) ?? undefined}><span className="initials-text">{job.initials ?? ''}</span></span>
      </div>
    </div>
  );
}

// A card re-renders only when its own data, the line, the mode (ctx) or a demo flag changed.
export const sameJob = (a, b) => a === b || (a.id === b.id && a.status === b.status && a.title === b.title && a.details === b.details && a.initials === b.initials
  && a.revision === b.revision && a.is_test === b.is_test && a.line_id === b.line_id && a.updated_at === b.updated_at && a.updated_by === b.updated_by);
export const Job = memo(JobCard, (p, n) => sameJob(p.job, n.job) && p.line === n.line && p.ctx === n.ctx && p.fresh === n.fresh && p.hit === n.hit && p.dim === n.dim && p.demo === n.demo && p.measure === n.measure && p.compact === n.compact);
