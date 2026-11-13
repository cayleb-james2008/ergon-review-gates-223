// Edit keys. Nobody types a secret into this app: the person's agent opens the board with a temporary, per-employee key in the URL FRAGMENT
// (#key=ergk_...). It is read once, kept in sessionStorage for this tab only, removed from the address bar, sent only as the p_key argument of a write,
// and never put in a query string, localStorage, a log or a request URL.
const STORE = 'rhl.key';

export const MESSAGES = {
  network: 'Could not reach the server. Check the connection and try again.',
  invalid: 'That job has a value the server rejected. Check the fields.',
  not_found: 'This job was deleted elsewhere.',
  conflict: 'This job changed elsewhere. Close it and open it again to see the latest.',
};
export const messageFor = (err) => MESSAGES[err] ?? 'Something went wrong. Try again.';

// What a panel says in place of saving when there is no usable key.
export const NOTICES = {
  none: 'Viewing only. Your agent turns on editing when you open this board through it.',
  expired: 'Editing has ended. Ask your agent to open this board again.',
  invalid: 'Editing is not available here. Ask your agent to open this board again.',
};
// The quiet chip in the bubble.
export const chipLabel = (state, subject) => ({ none: 'View only', valid: `Editing as ${subject}`, expired: 'Editing ended', invalid: 'Editing unavailable' })[state] ?? '';

// The one place a launch key comes in. Today the launch carries it in the URL fragment (#key=...): this stores it for the tab and takes it out of the address
// bar (the rest of the fragment is left alone), so no key sits in the address bar or rides along when the link is copied. index.html runs the same steps
// inline before any module loads; this is the same step for a later hash change. A contained in-harness surface that hands the key over in-process would
// replace the body with a read from its own source: callers do not change.
export function acceptLaunchKey({ loc, hist, storage }) {
  const params = new URLSearchParams((loc.hash || '').replace(/^#/, ''));
  const key = params.get('key');
  if (!key) return '';
  try { storage.setItem(STORE, key); } catch { /* private mode: the key lives in memory only */ }
  params.delete('key');
  const rest = params.toString();
  try { hist.replaceState(null, '', loc.pathname + loc.search + (rest ? `#${rest}` : '')); } catch { /* ignore */ }
  return key;
}

// none | valid(subject, expiresAt) | expired | invalid. `adapter.checkKey(key)` -> {ok, subject, expires_at} | {ok:false, error:'key_invalid'|'key_expired'|'network'}.
export function createKeySession({ storage, adapter, now = () => Date.now(), timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) }, initial = '' }) {
  let key = initial || (() => { try { return storage.getItem(STORE) || ''; } catch { return ''; } })();
  let state = key ? { state: 'checking', subject: '', expiresAt: '' } : { state: 'none', subject: '', expiresAt: '' };
  let timer = null;
  let gen = 0;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(state));
  const set = (next) => { state = next; emit(); };
  const persist = () => { try { key ? storage.setItem(STORE, key) : storage.removeItem(STORE); } catch { /* private mode */ } };

  function arm(expiresAt) {
    if (timer != null) timers.clear(timer);
    const ms = Date.parse(expiresAt) - now();
    if (!Number.isFinite(ms)) return;
    timer = timers.set(() => { timer = null; if (state.state === 'valid') set({ state: 'expired', subject: state.subject, expiresAt: state.expiresAt }); }, Math.max(0, Math.min(ms, 2 ** 31 - 1)));
  }

  function apply(res) {
    if (res.ok) { set({ state: 'valid', subject: res.subject, expiresAt: res.expires_at }); arm(res.expires_at); return; }
    if (res.error === 'key_expired') set({ state: 'expired', subject: state.subject, expiresAt: state.expiresAt });
    else if (res.error === 'key_invalid') set({ state: 'invalid', subject: '', expiresAt: '' });
    // network or anything else: keep what we knew
  }

  return {
    getState: () => state,
    get: () => key,
    canWrite: () => state.state === 'valid' || state.state === 'checking',
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Learn who the key is for and until when. Called on load and after a write is refused for the key.
    async check() {
      if (!key) { set({ state: 'none', subject: '', expiresAt: '' }); return state; }
      const g = ++gen;
      const res = await adapter.checkKey(key);
      if (g === gen) apply(res);
      return state;
    },
    async setKey(next) { key = next; persist(); return this.check(); },
    clear() { key = ''; gen++; persist(); if (timer != null) { timers.clear(timer); timer = null; } set({ state: 'none', subject: '', expiresAt: '' }); },
    // Runs a write with the key. A refusal for the key updates the state, so the panel can say so.
    async run(fn) {
      if (!key) return { ok: false, error: 'key_none' };
      const res = await fn(key);
      if (res.error === 'key_invalid' || res.error === 'key_expired') apply(res);
      return res;
    },
  };
}
