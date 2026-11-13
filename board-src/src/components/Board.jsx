import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isCompact } from '@/core/density';
import { Job, sameJob } from './Job';
import { InlineAdd } from './InlineAdd';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

export function Message({ title, text, action }) {
  return (
    <div className="board-msg" role="status">
      <p className="board-msg-title">{title}</p>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export const BoardNote = () => <p className="board-note" role="status">No jobs match.</p>;

// A row re-renders only when its own jobs changed (by content, so a refetch of identical data costs nothing), or the mode changed.
const sameRow = (a, b) => a.row.label === b.row.label && a.ctx === b.ctx && a.fresh === b.fresh && a.loading === b.loading && a.compact === b.compact
  && a.row.jobs.length === b.row.jobs.length && a.row.jobs.every((j, i) => sameJob(j, b.row.jobs[i]));

const Row = memo(function Row({ row, ctx, fresh, loading, compact }) {
  const empty = !loading && !row.jobs.length;
  const ready = row.jobs.filter((j) => j.status === 'ready').length;
  return (
    <div className="row" role="group" aria-label={`Line ${row.label}`} data-line={row.label} data-density={compact ? 'compact' : undefined} data-empty={empty ? 'true' : undefined} data-loading={loading ? 'true' : undefined}
      data-ready={row.jobs.length ? String(ready) : undefined} data-total={row.jobs.length ? String(row.jobs.length) : undefined}>
      <div className="label" aria-hidden="true" data-tally={row.jobs.length ? `${ready}/${row.jobs.length}` : undefined}>{row.label}</div>
      {loading ? (
        <div className="jobs"><Skeleton /><Skeleton /></div>
      ) : (
        // One tree for an empty and an occupied line, so the row's Add job keeps its place (and its keyboard focus) when the first job arrives.
        // shortcut: density is a pure function of job count and row width (normal cards up to 6 jobs at 1920 / 4 at 1366, then compact; a line of 17+ at 1366 scrolls vertically inside its own row); upgrade: a third, denser level or a drill-in view if real lines go past about 16 at wall width
        <div className="jobs" role={empty ? undefined : 'list'} aria-label={empty ? undefined : `Jobs on line ${row.label}`}>
          {empty && <span className="no-jobs sr-only">No jobs</span>}
          {row.jobs.map((j) => <Job key={j.id} job={j} line={row.label} ctx={ctx} fresh={fresh} compact={compact} />)}
          <div role={empty ? undefined : 'listitem'} className="contents"><InlineAdd line={row.label} form={ctx.form} /></div>
        </div>
      )}
    </div>
  );
}, sameRow);

// The 19-row grid. `data` carries the machine-readable board state for agents (attributes only).
// Search dim and highlight are class toggles applied by App after render (see applySearch), so typing never re-renders a card.
export const Board = memo(function Board({ view, ctx, noMatch, data }) {
  const state = view.loading ? 'loading' : view.failedFirstLoad ? 'error' : view.noLines ? 'empty' : 'ready';
  const everReady = useRef(false);
  const wasReady = everReady.current; // cards that arrive after the first ready paint get the status-change cue
  useEffect(() => { if (state === 'ready') everReady.current = true; });

  // the board's width decides, per row, whether its cards fit at normal width (src/core/density.js); measured once and on resize, not per card
  const ref = useRef(null);
  const [width, setWidth] = useState(() => (typeof innerWidth === 'number' ? innerWidth : 1920) - 48);
  const [viewport, setViewport] = useState(() => (typeof innerWidth === 'number' ? innerWidth : 1920));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => { setWidth(el.clientWidth); setViewport(window.innerWidth); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  let body;
  if (view.failedFirstLoad) {
    body = <Message title={view.fatal ? 'This board is not set up.' : 'The board could not be loaded.'}
      text={view.fatal ?? 'Check the connection. It will try again automatically.'}
      action={view.fatal ? null : <Button variant="outline" onClick={ctx.onRetry}>Retry</Button>} />;
  } else if (view.noLines) {
    body = <Message title="No lines are set up yet." />;
  } else {
    body = view.rows.map((row) => <Row key={row.label} row={row} ctx={ctx} fresh={wasReady} loading={view.loading} compact={isCompact(row.jobs.length, width, viewport)} />);
  }
  return (
    <main id="board" ref={ref} className="board" aria-label="Warehouse lines A to S" aria-busy={view.loading} data-state={state} {...data}>
      {body}
      {noMatch && <BoardNote />}
    </main>
  );
});

// Dim non-matching lines and cards, highlight matches. Plain class toggles: the search box can change on every key, and 60 jobs should not re-render for it.
export function applySearch(found) {
  const root = document.getElementById('board');
  if (!root) return;
  for (const r of root.querySelectorAll('.row')) r.classList.toggle('dim', !!found && !found.lineLabels.has(r.dataset.line));
  for (const j of root.querySelectorAll('.job')) {
    const hit = !!found && found.jobIds.has(j.dataset.id);
    j.classList.toggle('hit', hit);
    j.classList.toggle('dim', !!found && !hit);
  }
}
