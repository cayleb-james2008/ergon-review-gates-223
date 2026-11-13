import { LINE_LABELS, POLL_MS, RECONCILE_MS } from '../config.js';
import { buildRows, emptyRows } from './lines.js';
import { initialConn, reduce, status, nextDelay, canEdit } from './connection.js';
import { uuid } from './uuid.js';

const browserEnv = () => ({
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  isVisible: () => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'),
  listen(onOnline, onOffline, onVisible) {
    addEventListener('online', onOnline);
    addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      removeEventListener('online', onOnline);
      removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  },
  timers: { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) },
});

// Board state + live-update machinery. Pure of DOM; env/timers are injectable for tests.
// After the realtime feed is confirmed: one catch-up read at once and a second this long after.
const CATCH_UP_MS = 4000;

export function createStore({ adapter, labels = LINE_LABELS, env = browserEnv(), pollMs = POLL_MS, reconcileMs = RECONCILE_MS, retryDelayMs = 400, random = Math.random }) {
  let lines = [];
  let entries = [];
  let conn = { ...initialConn(), online: env.isOnline() };
  let loaded = false;
  let lastError = '';
  let issued = 0; // generation counter: a load only applies if newer than the last applied one
  let applied = 0;
  let timer = null;
  let view = null;
  let unsubscribe = null;
  let offEnv = null;
  let stopped = true;
  // The cheap probe (adapter.boardToken, a few hundred bytes): the reconcile read and the polling fallback read only this, and fetch the whole board only when
  // the token moved. lastToken is the token read BEFORE the last full read (so a change during that read shows up as a difference next time, never as a miss).
  let lastToken = null;
  let lastL = null;
  let noProbe = typeof adapter.boardToken !== 'function';
  const listeners = new Set();
  const { timers } = env;

  function compute() {
    const b = loaded ? buildRows(labels, lines, entries) : emptyRows();
    const st = status(conn);
    view = {
      loaded,
      loading: !loaded && !lastError,
      failedFirstLoad: !loaded && !!lastError,
      noLines: loaded && lines.length === 0,
      rows: b.rows,
      warning: loaded ? b.warning : '',
      hasTest: loaded && b.hasTest,
      totalJobs: entries.length,
      conn: st,
      canEdit: canEdit(conn),
      lastError,
      retryInMs: st === 'error' ? nextDelay(conn, pollMs) : null,
    };
    return view;
  }
  const notify = () => { compute(); listeners.forEach((fn) => fn(view)); };
  const feed = (ev) => { conn = reduce(conn, ev); };
  const clearTimer = () => { if (timer != null) { timers.clear(timer); timer = null; } };

  function schedule() {
    clearTimer();
    if (stopped) return;
    const live = conn.online && conn.failures === 0 && conn.realtime === 'SUBSCRIBED';
    if (live && !env.isVisible()) return; // a hidden tab does not poll; becoming visible refetches and schedules again
    let d = nextDelay(conn, pollMs, reconcileMs);
    if (d != null && live) d = Math.round(d * (0.85 + random() * 0.3)); // jitter, so viewers that opened together do not read together
    if (d != null) timer = timers.set(() => { timer = null; probe(); }, d);
  }

  // The routine read (reconcile while Live, the 3 s fallback otherwise, a tab coming back): ask for the token, read the board only if it moved.
  async function probe() {
    if (noProbe) return refresh();
    clearTimer();
    let r;
    try { r = await adapter.boardToken(); } catch { r = { ok: false, error: 'network' }; }
    if (stopped) return undefined;
    if (!r.ok && r.error === 'unsupported') { noProbe = true; return refresh(); }
    if (!r.ok) { // a failed probe is a failed read for the connection state
      const was = status(conn);
      feed({ type: 'fetchFail' });
      if (!loaded) lastError = 'The board could not be loaded.';
      if (status(conn) !== was || !loaded) notify();
      schedule();
      return undefined;
    }
    if (loaded && r.token === lastToken) { // nothing moved: no read, and nothing to render
      const was = status(conn);
      feed({ type: 'fetchOk' });
      if (status(conn) !== was) notify();
      schedule();
      return undefined;
    }
    return refresh({ token: r.token, l: r.l, linesToo: !(loaded && r.l != null && r.l === lastL) });
  }

  // opts.token / opts.l: a probe result the caller already holds (the token to record for this read); opts.linesToo === false: the lines have not moved, read entries only
  async function refresh(opts = {}) {
    clearTimer();
    const gen = ++issued;
    let landed = false;
    try {
      let before = opts.token ?? null;
      let beforeL = opts.l ?? null;
      // a full read after the first load records the token first, so the next probe compares against a state at least as old as the data
      if (before == null && loaded && !noProbe) {
        const r = await adapter.boardToken();
        if (r.ok) { before = r.token; beforeL = r.l ?? null; } else if (r.error === 'unsupported') noProbe = true; else throw new Error('probe failed');
      }
      const data = await adapter.load({ lines: opts.linesToo !== false });
      if (gen <= applied) return; // a newer state already landed
      applied = gen;
      if (data.lines) lines = data.lines;
      entries = data.entries ?? [];
      if (before != null) { lastToken = before; lastL = beforeL; }
      loaded = true;
      lastError = '';
      feed({ type: 'fetchOk' });
      landed = true;
    } catch (e) {
      if (gen <= applied) return;
      lastError = 'The board could not be loaded.';
      feed({ type: 'fetchFail' });
    }
    if (!stopped) { notify(); schedule(); }
    if (landed && joinedEarly && conn.realtime === 'SUBSCRIBED') { joinedEarly = false; onConfirmed(); }
  }

  let changeTimer = null;
  const onChange = () => {
    if (changeTimer != null) return;
    changeTimer = timers.set(() => { changeTimer = null; refresh(); }, 120);
  };
  // The channel's SUBSCRIBED status only says the join was accepted. The postgres_changes bindings go live a moment later, and a write in that window
  // is never delivered. The server announces them with a `system` message (extension 'postgres_changes', status 'ok'), which the adapter reports as
  // 'CONFIRMED'. Only then is the feed Live and the polling relaxed to the slow reconcile probe. On confirmation fetch at once and once more
  // CATCH_UP_MS later, for anything written between the snapshot and the bindings. If the confirmation lands while the first load is still in flight, the
  // same catch-up runs as soon as that load lands.
  let catchUp = null;
  let joinedEarly = false;
  const onConfirmed = () => {
    if (stopped) return;
    if (!loaded) { joinedEarly = true; return; }
    refresh();
    if (catchUp != null) timers.clear(catchUp);
    catchUp = timers.set(() => { catchUp = null; refresh(); }, CATCH_UP_MS);
  };
  const onStatus = (s) => {
    // 'SUBSCRIBED' = joined, bindings not yet confirmed: still polling, not Live. 'CONFIRMED' = Live.
    const confirmed = s === 'CONFIRMED' && conn.realtime !== 'SUBSCRIBED';
    feed({ type: 'realtime', status: s === 'CONFIRMED' ? 'SUBSCRIBED' : s === 'SUBSCRIBED' ? 'JOINED' : s });
    notify();
    schedule();
    if (confirmed) onConfirmed();
  };

  function applyLocal(fn) {
    fn();
    applied = ++issued; // drops any load still in flight from before this write
    notify();
    schedule();
  }

  const delay = (ms) => new Promise((r) => (ms ? timers.set(r, ms) : r()));

  return {
    getState: () => view ?? compute(),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      stopped = false;
      offEnv = env.listen(
        () => { feed({ type: 'online' }); notify(); refresh(); },
        () => { feed({ type: 'offline' }); clearTimer(); notify(); },
        () => {
          if (env.isVisible()) probe();
          else { clearTimer(); if (catchUp != null) { timers.clear(catchUp); catchUp = null; } } // a hidden tab does not read: cancel what was armed before it was hidden
        },
      );
      try { unsubscribe = adapter.subscribe(onChange, onStatus); } catch { unsubscribe = null; /* no websocket in this browser: the board polls instead */ }
      notify();
      return refresh();
    },
    stop() {
      stopped = true;
      clearTimer();
      if (changeTimer != null) timers.clear(changeTimer);
      if (catchUp != null) timers.clear(catchUp);
      offEnv?.();
      unsubscribe?.();
    },
    refresh,
    retry: refresh,

    // The id is generated once, before the first send, and reused on every retry (idempotent add).
    async saveEntry(key, draft) {
      draft.id ||= uuid();
      const payload = { id: draft.id, line_code: draft.line_code, title: draft.title, details: draft.details,
        initials: draft.initials, status: draft.status };
      if (draft.expected_revision != null) payload.expected_revision = draft.expected_revision; // an edit names the revision it was made on; a create sends none
      let res;
      let retried = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { res = await adapter.saveEntry(key, payload); } catch { res = { ok: false, error: 'network' }; }
        if (res.error !== 'network') break;
        retried = true;
        await delay(retryDelayMs);
      }
      // A response lost after the server applied the edit comes back as a conflict on the retry (the revision moved on). If the row now holds exactly what we
      // sent, that is our own write: report success instead of a false conflict.
      if (retried && res.error === 'conflict') {
        try {
          const cur = (await adapter.load()).entries.find((e) => e.id === payload.id);
          const line = cur && lines.find((l) => l.id === cur.line_id)?.code;
          if (cur && cur.title === payload.title && cur.details === payload.details && cur.initials === payload.initials && cur.status === payload.status && line === payload.line_code) res = { ok: true, entry: cur };
        } catch { /* keep the conflict */ }
      }
      if (res.ok && res.entry) {
        applyLocal(() => { entries = [...entries.filter((e) => e.id !== res.entry.id), res.entry]; });
      } else if (res.ok) refresh();
      return res;
    },
    async removeEntry(key, id) {
      let res;
      try { res = await adapter.removeEntry(key, id); } catch { res = { ok: false, error: 'network' }; }
      if (res.ok || res.error === 'not_found') applyLocal(() => { entries = entries.filter((e) => e.id !== id); });
      return res.error === 'not_found' ? { ok: true } : res;
    },
    checkKey: (key) => adapter.checkKey(key),
  };
}
