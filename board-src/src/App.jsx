import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { LINE_LABELS, STATUSES } from '@/config';
import { createStore } from '@/core/store';
import { createKeySession, acceptLaunchKey, messageFor } from '@/core/key';
import { filterBoard } from '@/core/lines';
import { LABELS } from '@/core/connection';
import { harnessTarget } from '@/core/handoff';
import { useStoreView, useConnection } from '@/hooks';
import { Header, VersionLabel } from '@/components/Header';
import { Banners } from '@/components/Banners';
import { Board, applySearch } from '@/components/Board';
import { Bubble } from '@/components/Bubble';
import { trackVisualViewport } from '@/ui/viewport';
import { JobDialog } from '@/components/JobDialog';
import { useAgentState } from '@/components/DragHandle';
import { TooltipProvider } from '@/components/ui/tooltip';

const HARNESS_ORIGINS = typeof __HARNESS_ORIGINS__ !== 'undefined' ? __HARNESS_ORIGINS__ : []; // from ops/harness-origins.json at build time; empty: nothing is ever posted to a parent
const VERSION = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'local';

export function App({ adapter }) {
  const store = useMemo(() => createStore({ adapter }), [adapter]);
  // The agent opens the board with #key=... : read it once, keep it for this tab, strip it from the address bar.
  const session = useMemo(() => createKeySession({ storage: sessionStorage, adapter, initial: acceptLaunchKey({ loc: location, hist: history, storage: sessionStorage }) }), [adapter]);
  const { view, shown } = useConnection(useStoreView(store), adapter);
  const key = useSyncExternalStore(session.subscribe, session.getState);
  const keyValid = key.state === 'valid';

  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState({ open: false, job: null, lineLabel: LINE_LABELS[0] });
  const [pulseKey, setPulseKey] = useState(0);
  const [writeError, setWriteError] = useState(''); // a write refused from outside the details (a status chosen on a card)
  const [agentNote, setAgentNote] = useState('');
  const [saving, setSaving] = useState(0); // status changes from a card in flight (a saving cue, so a retry is not a silent wait)
  useEffect(() => trackVisualViewport(), []); // the keyboard-aware Add job sheets read --vv-h and --vv-top
  useEffect(() => { if (!agentNote) return undefined; const id = setTimeout(() => setAgentNote(''), 6000); return () => clearTimeout(id); }, [agentNote]); // a one-time note: it clears itself
  const lastJob = useRef(null); // the job last opened, for the hand-off context
  const [notices, setNotices] = useState(0); // how many job forms are showing a key notice right now
  const opener = useRef(null); // what had focus when the job dialog opened, so closing it puts the keyboard back there
  const pulse = () => setPulseKey((k) => k + 1);

  useEffect(() => { store.start(); return () => store.stop(); }, [store]);
  useEffect(() => {
    session.check(); // who the key is for and until when
    const onHash = () => { const k = acceptLaunchKey({ loc: location, hist: history, storage: sessionStorage }); if (k) session.setKey(k); };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, [session]);

  // the open job as the board holds it now (null = gone, undefined = not known): the dialog says so when it was deleted or changed elsewhere
  const liveJob = useMemo(() => (dialog.open && dialog.job && view.loaded ? view.rows.flatMap((r) => r.jobs).find((j) => j.id === dialog.job.id) ?? null : undefined), [view, dialog.open, dialog.job]);
  const testMode = !!(view.hasTest || adapter.isDemo);
  const found = useMemo(() => (view.loaded ? filterBoard(view.rows, query) : null), [view, query]);
  useLayoutEffect(() => { applySearch(found); }, [found, view]); // after every render that could have added cards

  // one pulse per later sync that changed the board
  const sig = useMemo(() => JSON.stringify([view.loading, view.failedFirstLoad, view.noLines, view.rows.map((r) => [r.label, r.jobs])]), [view]);
  const lastSig = useRef(null);
  const wasLoaded = useRef(false);
  useEffect(() => {
    if (wasLoaded.current && lastSig.current !== sig && view.loaded) pulse(); // never on the first load: nothing animates on load
    lastSig.current = sig;
    wasLoaded.current = view.loaded;
  }, [sig, view.loaded]);

  useEffect(() => { document.body.dataset.testMode = String(testMode); }, [testMode]);
  useEffect(() => { document.documentElement.dataset.build = VERSION; }, []);

  // Runs a write with the key. No valid key: nothing is sent (the panel says so); a refusal for the key moves the key state, and the panel says that too.
  async function write(run) {
    if (session.getState().state !== 'valid') return { ok: false, error: 'key_none' };
    pulse();
    return session.run(run);
  }

  const ctx = useMemo(() => ({
    keyValid,
    canEdit: view.canEdit,
    onRetry: () => store.retry(),
    onEdit: (job) => {
      const row = store.getState().rows.find((r) => r.line?.id === job.line_id);
      // what had focus, so closing the dialog puts it back. A click on a card's body leaves focus on <body>: use the card's own edit button then.
      const act = document.activeElement;
      opener.current = act && act !== document.body ? act : document.querySelector(`[data-focus="edit:${job.id}"]`);
      lastJob.current = { id: job.id, line: row?.label ?? null };
      setDialog({ open: true, job, lineLabel: row?.label ?? LINE_LABELS[0] });
    },
    // a status chosen on a card: saved with a valid key; otherwise the job's details open and say what is needed
    onStatus: async (job, status) => {
      const row = store.getState().rows.find((r) => r.line?.id === job.line_id);
      if (session.getState().state !== 'valid') { ctx.onEdit(job); return; }
      setSaving((n) => n + 1);
      const res = await write((k) => store.saveEntry(k, { id: job.id, expected_revision: job.revision, line_code: row?.label, title: job.title ?? '', details: job.details ?? '', initials: job.initials ?? '', status }));
      setSaving((n) => n - 1);
      if (res.error === 'key_invalid' || res.error === 'key_expired') ctx.onEdit(job);
      else if (!res.ok) setWriteError(`The status was not saved. ${messageFor(res.error)}`);
      else setWriteError('');
    },
    // what the job forms need (the dialog and the compact form on each row); stable between renders
    form: { labels: LINE_LABELS, statuses: STATUSES, keyState: key.state, subject: key.subject, canEdit: view.canEdit, demoKeys: adapter.demoKeys, useKey: (k) => session.setKey(k),
      onNotice: (d) => setNotices((n) => n + d),
      save: (draft) => write((k) => store.saveEntry(k, draft)), remove: (id) => write((k) => store.removeEntry(k, id)) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [key.state, key.subject, view.canEdit, store, session]);

  // The bubble's one field: typing filters (above); Enter hands the text to the person's agent, uninterpreted (docs/AGENT-HANDOFF.md). No grammar here.
  function sendCommand(text) {
    const t = text; // as typed: the agent reads it, this page does not
    if (!t.trim()) return;
    const last = lastJob.current && store.getState().rows.some((r) => r.jobs.some((j) => j.id === lastJob.current.id)) ? lastJob.current : null; // a deleted job is not context
    const context = { search: query, focusedJobId: last?.id ?? null, lineCode: last?.line ?? null };
    const bridge = window.rhlAgent?.agent?.send;
    if (typeof bridge === 'function') {
      try {
        bridge({ type: 'rhl.agent.command', app: 'rhl-warehouse-board', text: t, context });
        setAgentNote('');
        setQuery(''); // the text was a command, not a search: never leave the board filtered by it
      } catch { setAgentNote('Your agent could not be reached. Try again.'); }
      return;
    }
    if (window.parent !== window) {
      // Framed: post only to an embedder whose origin is on the build's allow-list (ops/harness-origins.json), read from the browser. Anyone else is a plain browser.
      const target = harnessTarget({ ancestorOrigins: location.ancestorOrigins, allowed: HARNESS_ORIGINS });
      if (target) { window.parent.postMessage({ type: 'rhl.agent.command', app: 'rhl-warehouse-board', text: t, context }, target); setAgentNote(''); setQuery(''); return; }
    }
    let shown = false;
    try { shown = sessionStorage.getItem('rhl.agentNote') === '1'; sessionStorage.setItem('rhl.agentNote', '1'); } catch { /* private mode */ }
    if (!shown) setAgentNote('Connect your agent to run commands.');
  }

  // Closing the dialog: back to the opener; a deleted card falls back to Add job.
  // shortcut: focus returns to the remembered opener or a fixed fallback id, upgrade: a focus-return context if more dialogs are added
  function returnFocus() {
    const el = opener.current;
    const edited = dialog.job && document.querySelector(`[data-focus="edit:${dialog.job.id}"]`);
    (el?.isConnected ? el : edited || document.getElementById('add-btn'))?.focus();
  }

  // Banners: one sentence each
  const banners = [];
  if (view.conn === 'offline') banners.push({ kind: 'offline', text: 'Showing the last saved board. Editing is paused.', retry: true }); // the connection label already says Offline
  else if (view.conn === 'error' && view.loaded) {
    const s = view.retryInMs != null ? ' Retrying shortly.' : ''; // no countdown: a number on a banner that does not tick would go stale
    banners.push({ kind: 'error', text: `The board could not be refreshed. Showing the last saved board.${s}`, retry: true });
  }
  if (writeError) banners.push({ kind: 'error', text: writeError, alert: true, dismiss: true });
  if (view.warning && !view.noLines) banners.push({ kind: 'warn', text: view.warning });

  // Status line: whole sentences, each fact once per state. A failed first load says nothing here (the board and the Error label say it); offline says
  // nothing about editing (the banner does); a failed refresh adds the one thing its banner does not.
  const parts = [];
  if (view.failedFirstLoad) { /* stated by the board message and the connection label */ } else if (!view.loaded) parts.push('Loading the board');
  else {
    parts.push(found ? `${found.count} of ${view.totalJobs} jobs match` : `${view.totalJobs} ${view.totalJobs === 1 ? 'job' : 'jobs'}`);
    if (view.conn === 'error') parts.push('editing paused');
    if (saving > 0) parts.push('saving');
    // a refused write is in the alert banner only: said once, announced once
  }

  const data = useMemo(() => {
    const jobs = view.rows.flatMap((r) => r.jobs);
    return {
      'data-test-mode': String(testMode),
      'data-job-count': String(view.loaded ? jobs.length : 0),
      'data-line-count': String(view.loaded ? view.rows.filter((r) => r.line).length : 0), // lines present in the database (the board always draws 19 rows)
      'data-can-edit': String(!!view.canEdit && keyValid),
      'data-key-state': key.state,
      'data-version': VERSION, // which deployment this device runs
      // change token: moves whenever a job is added, removed or edited, so an agent can poll one attribute
      'data-rev': `${jobs.reduce((m, j) => (String(j.updated_at ?? '') > m ? String(j.updated_at) : m), '')}|${jobs.length}|${jobs.reduce((n, j) => n + (Number(j.revision) || 0), 0)}`,
    };
  }, [view, key.state, keyValid, testMode]);

  // calm unless a form is telling someone a key is needed; offline and error stay calm
  const agentState = useAgentState({ needsYou: notices > 0, pulseKey });

  // Bubble first in the DOM: it is position:fixed and drawn at the top, so keyboard order (grip, search, key status, Add job, then the cards) matches what is seen.
  return (
    <TooltipProvider>
      <Bubble keyState={key.state} subject={key.subject} expiresAt={key.expiresAt} canEdit={view.canEdit} query={query} onQuery={(v) => { setQuery(v); setAgentNote(''); }} onCommand={sendCommand} 
        onAdd={() => { opener.current = document.activeElement; setDialog({ open: true, job: null, lineLabel: '' }); }} agentState={agentState} />
      <div className="app">
        <Header liveText={parts.join(', ')} conn={view.conn} connLabel={shown ? (testMode && shown === 'live' ? 'Demo sync' : LABELS[shown]) : ''} testMode={testMode} note={agentNote} />
        <Banners items={banners} onRetry={() => store.retry()} onDismiss={() => setWriteError('')} />
        <Board view={view} ctx={ctx} noMatch={!!found && found.count === 0} data={data} />
        <VersionLabel version={VERSION} />
      </div>
      <JobDialog open={dialog.open} job={dialog.job} live={liveJob} lineLabel={dialog.lineLabel} form={ctx.form}
        onClose={() => setDialog((d) => ({ ...d, open: false }))} returnFocus={returnFocus} />
    </TooltipProvider>
  );
}
