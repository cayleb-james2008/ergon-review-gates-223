import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

// React over the plain store: state lives in src/core/store.js, this only subscribes.
export const useStoreView = (store) => useSyncExternalStore(store.subscribe, store.getState);

// ---- connection honesty ------------------------------------------------------------------------------------------------------------------------
// The indicator states only what has been confirmed. The store trusts a confirmed realtime feed and re-reads only on a slow reconcile, so a read path that
// dies while the feed stays up (or never answered the first read) would keep saying Live. This probe asks the same cheap token read (adapter.boardToken)
// every HEALTH_MS from the first paint while the tab is visible and watches how long the answer takes; only a failure or a hang is an outage, and what
// counts as a hang follows the connection's own measured speed (see MAX_DEADLINE_MS).
const HEALTH_MS = 1000;
const PROBE_TIMEOUT_MS = 1500;
// A fixed 1.5 s deadline cannot tell "slow" from "down". With one, a network answering in 3 s was named an outage on every probe, the late answer cleared
// it, and the label cycled Error -> Live every 4 s: 36 % of a 20 s run said Error about a server that was answering (measured by the independent check).
// The deadline is therefore three times the round trip this connection has actually been seeing, from 1.5 s (nothing slower has been seen, so a hang is
// still named in about two seconds) up to 10 s (a genuinely slow link is allowed to be slow).
const MAX_DEADLINE_MS = 10000;
const DEADLINE_FACTOR = 3;
// How long a probe that timed out waits for its own kept-alive answer before an outage is named. Short on purpose: the promise is that a hung read is
// named in about two seconds, so this only absorbs an answer that was already on its way.
const CONFIRM_MS = 1000;
// A round trip at least this long means this connection is genuinely slow, so a timeout may be an answer still on its way rather than a hang.
const SLOW_HINT_MS = 800;
// How long that same probe may still answer after an outage was named. One outstanding request at a time, so a dead path cannot pile fetches up, and a
// merely slow one still gets to teach this hook its speed - one late answer is what ends the false "down" for good.
const LATE_GRACE_MS = 10000;
// "Reconnecting" is a claim that something dropped. The first second of a healthy load (the feed joins about 250 ms after the board lands) is not that, so the
// word waits this long before it is allowed on screen; until then the indicator is blank, never a guess.
const SETTLE_MS = 1500;

// One probe. A failure is answered at once; a slow answer is not thrown away: the timeout only decides when we *say* the read path is down. The same request
// is kept alive and, if it lands late and fine, it clears the outage again.
const probeOnce = (adapter, timeoutMs = PROBE_TIMEOUT_MS) => new Promise((resolve) => {
  let done = false;
  const late = Promise.resolve().then(() => adapter.boardToken()).catch(() => ({ ok: false, error: 'network' }));
  const timer = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'timeout', late }); } }, timeoutMs);
  late.then((r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } });
});

function useOutage(adapter, enabled) {
  const [outage, setOutage] = useState(false);
  // The connection's own speed: an exponential average of the probe round trips it has actually seen. Deliberately not seeded from the page's load time:
  // boot, render and the first read are not the round trip, and seeding with them pushed the deadline to ~6 s on a healthy load (measured: the suite's
  // "Error within 2.8 s" promises then failed).
  const speed = useRef({ slowMs: 0 });
  useEffect(() => {
    if (!enabled || typeof adapter.boardToken !== 'function') { setOutage(false); return undefined; }
    let stopped = false;
    let busy = false;
    let id = null;
    const deadline = () => Math.min(MAX_DEADLINE_MS, Math.max(PROBE_TIMEOUT_MS, Math.round(speed.current.slowMs * DEADLINE_FACTOR)));
    const tick = async () => {
      if (busy || stopped || document.visibilityState === 'hidden') return;
      busy = true;
      const started = Date.now();
      const r = await probeOnce(adapter, deadline());
      if (stopped) { busy = false; return; }
      if (r.error === 'unsupported') { busy = false; stopped = true; clearInterval(id); return; } // a backend without the probe is not an outage, and is not asked again
      const learn = () => {
        const dt = Date.now() - started;
        speed.current.slowMs = speed.current.slowMs ? speed.current.slowMs * 0.6 + dt * 0.4 : dt;
        setOutage(false);
      };
      if (r.ok) { learn(); busy = false; return; }
      // A real failure (refused, offline, 5xx) is an outage at once. A timeout is not yet evidence of anything: give the answer already in flight a
      // moment to arrive, and only then say the read path is down. If it arrives after that, it is still the measurement that matters.
      if (r.error === 'timeout' && r.late) {
        // Absorbing the answer matters only when this connection is known to be slow; on a fast connection a timeout is a hang and
        // is named at the deadline (waiting here as well would push "Error within about two seconds" out to ~3 s, which the suite's
        // own deadlines caught when this was unconditional).
        if (speed.current.slowMs >= SLOW_HINT_MS) {
          const late = await Promise.race([r.late, new Promise((res) => setTimeout(() => res(null), CONFIRM_MS))]);
          if (stopped) { busy = false; return; }
          if (late && late.ok) { learn(); busy = false; return; }
        }
        setOutage(true);
        const veryLate = await Promise.race([r.late, new Promise((res) => setTimeout(() => res(null), LATE_GRACE_MS))]);
        if (!stopped && veryLate && veryLate.ok) learn();
        busy = false;
        return;
      }
      setOutage(true);
      busy = false;
    };
    id = setInterval(tick, HEALTH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { stopped = true; clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [adapter, enabled]);
  return outage;
}

// The view the screen draws: the store's, with an outage the probe saw folded in, and the word the indicator may show (null = blank for now).
// Live is never claimed before the first board has been read, and Reconnecting is held back SETTLE_MS (decided during render, so it is never in the page for a frame).
export function useConnection(view, adapter) {
  const outage = useOutage(adapter, view.conn !== 'offline');
  // The documented agent-facing attribute must not claim a state the words do not: a confirmed feed with nothing read yet is
  // reported as `polling` (not confirmed) rather than `live`, so `data-state` and the visible word never disagree.
  const raw = outage && view.conn !== 'offline' ? 'error' : view.conn;
  const conn = raw === 'live' && !view.loaded ? 'polling' : raw;
  const waiting = conn === 'polling' || (conn === 'live' && !view.loaded); // not yet confirmed: no word
  const [track, setTrack] = useState({ conn, settled: !waiting });
  if (track.conn !== conn) setTrack({ conn, settled: !waiting });
  const settled = track.conn === conn ? track.settled : !waiting;
  useEffect(() => {
    if (!waiting) return undefined;
    const id = setTimeout(() => setTrack({ conn, settled: true }), SETTLE_MS);
    return () => clearTimeout(id);
  }, [conn, waiting]);
  const effective = useMemo(() => (conn === view.conn ? view : { ...view, conn, canEdit: false, retryInMs: view.retryInMs ?? HEALTH_MS }), [view, conn]);
  // Never Live with nothing read, and never "Reconnecting" on a page with nothing to reconnect to. A first read that hangs showed "Reconnecting" at
  // 1577 ms and Error at 2577 ms (measured): a page that has never loaded a board has not dropped anything, so the word would be a guess. The agent-facing
  // `data-state` still says `polling` there; the visible word stays blank until the board lands or the read is named an outage.
  const unreadYet = conn === 'live' && !view.loaded;
  const nothingToReconnectTo = conn === 'polling' && !view.loaded;
  return { view: effective, shown: unreadYet || nothingToReconnectTo || (conn === 'polling' && !settled) ? null : conn };
}
