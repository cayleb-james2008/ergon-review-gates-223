// Pure connection state machine. UI label comes from status(); the store feeds it events.
export const OFFLINE_AFTER_FAILURES = 3;
export const initialConn = () => ({ online: true, realtime: 'connecting', failures: 0, hasBoard: false });

export function reduce(c, ev) {
  switch (ev.type) {
    case 'online': return { ...c, online: true };
    case 'offline': return { ...c, online: false };
    case 'realtime': return { ...c, realtime: ev.status };
    case 'fetchOk': return { ...c, failures: 0, hasBoard: true };
    case 'fetchFail': return { ...c, failures: c.failures + 1 };
    default: return c;
  }
}

export function status(c) {
  if (!c.online) return 'offline';
  if (c.failures >= OFFLINE_AFTER_FAILURES && c.hasBoard) return 'offline';
  if (c.failures > 0) return 'error';
  return c.realtime === 'SUBSCRIBED' ? 'live' : 'polling';
}

export const LABELS = { live: 'Live', polling: 'Reconnecting', offline: 'Offline', error: 'Error' };
export const canEdit = (c) => ['live', 'polling'].includes(status(c));

export const backoffMs = (failures) => Math.min(30000, 2000 * 2 ** Math.max(0, failures - 1));

// ms until the next automatic fetch, or null for none (offline waits for the 'online' event).
// Confirmed live: the feed is trusted, with one slow reconcile read as a safety net (reconcileMs, null = none). Anything else polls at pollMs.
export function nextDelay(c, pollMs, reconcileMs = null) {
  if (!c.online) return null;
  if (c.failures > 0) return backoffMs(c.failures);
  return c.realtime === 'SUBSCRIBED' ? reconcileMs : pollMs;
}
