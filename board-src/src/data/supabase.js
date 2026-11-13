// The browser needs two things from Supabase: reads and RPCs over PostgREST, and the realtime channel. Those are two small packages
// (postgrest-js, realtime-js); the full client also carries auth, storage and functions, which this app never uses. Same calls, same wire format.
import { PostgrestClient } from '@supabase/postgrest-js';
import { RealtimeClient } from '@supabase/realtime-js';

const SCHEMA = 'ergon_warehouse';
const KNOWN = new Set(['key_invalid', 'key_expired', 'invalid', 'not_found', 'conflict']);

// Maps a PostgREST rpc reply to {ok:true,...} | {ok:false,error}. Never throws, never logs the key.
export function normalize({ data, error }) {
  if (error) return { ok: false, error: 'network', message: error.message };
  if (data && data.ok === true) return data;
  const e = KNOWN.has(data?.error) ? data.error : 'invalid';
  return e === 'conflict' && Number.isFinite(data.revision) ? { ok: false, error: e, revision: data.revision } : { ok: false, error: e }; // conflict says which revision is current
}

// Only the two named values are read, never the whole import.meta.env object: Vite inlines a whole-object read, which put every VITE_-prefixed variable
// of the build (on Vercel, its VITE_VERCEL_* system variables, including the deployment's own team-slug host name) into the public bundle (found at the L4 verify).
export function makeClient(env = { VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY }) {
  const url = env?.VITE_SUPABASE_URL;
  const key = env?.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Backend is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  const base = new URL(url);
  const rest = new PostgrestClient(new URL('rest/v1', base).href, { schema: SCHEMA, headers: { apikey: key, Authorization: `Bearer ${key}` } });
  // the realtime client is built on first use, so a browser without WebSocket only loses the live feed (the board polls) and never fails to start
  let realtime = null;
  const rt = () => {
    if (!realtime) {
      const u = new URL('realtime/v1', base);
      u.protocol = u.protocol.replace('http', 'ws');
      realtime = new RealtimeClient(u.href, { params: { apikey: key }, accessToken: async () => key });
    }
    return realtime;
  };
  return { from: (t) => rest.from(t), rpc: (fn, args, opts) => rest.rpc(fn, args, opts), channel: (n) => rt().channel(n), removeChannel: (ch) => rt().removeChannel(ch) };
}

// A read that never answers is indistinguishable from a healthy one if nothing ever gives up on it: the token probe (a different RPC) kept
// answering, so the label stayed Live over a board that had been frozen for 26 s (measured by the independent check). The read therefore
// gets a deadline, and only one read is ever in flight, so a dead data path cannot pile requests up while the deadline expires.
const READ_TIMEOUT_MS = 15000;

export function createSupabaseAdapter(client = makeClient(), { readTimeoutMs = READ_TIMEOUT_MS } = {}) {
  const rpc = async (fn, args) => {
    try { return normalize(await client.rpc(fn, args)); } catch (e) { return { ok: false, error: 'network', message: String(e?.message ?? e) }; }
  };
  let inFlight = null; // the read currently outstanding, whatever its options: a second caller joins it instead of starting another
  const api = {
    isDemo: false,
    // opts.lines === false: the lines have not moved (the token says so), read the entries only
    load(opts = {}) {
      if (inFlight) return inFlight; // one read at a time: a hung path cannot be joined by a second request
      let timer = null;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('read timed out')), readTimeoutMs); });
      // the timer is cleared when the read settles, or every successful read would leave a 15 s timer behind it (first draft did: the unit
      // file then took 15 s to exit)
      const read = Promise.race([api.readBoard(opts), timeout]).finally(() => { clearTimeout(timer); inFlight = null; });
      inFlight = read;
      return inFlight;
    },
    async readBoard(opts = {}) {
      // the first read may already be in flight: index.html starts it before any script has downloaded (vite.config.js, rhl-early-fetch)
      const early = globalThis.__rhlEarly;
      globalThis.__rhlEarly = null;
      if (early && opts.lines !== false) {
        try { const [l, e] = await early; if (Array.isArray(l) && Array.isArray(e)) return { lines: l, entries: e }; } catch { /* read it again below */ }
      }
      const [l, e] = await Promise.all([
        opts.lines === false ? { data: null, error: null } : client.from('lines').select('id,code,sort_order,is_test,created_at').order('sort_order'),
        client.from('entries').select('id,line_id,title,details,initials,status,revision,is_test,created_at,updated_at,updated_by').order('created_at'),
      ]);
      if (l.error) throw new Error(l.error.message);
      if (e.error) throw new Error(e.error.message);
      return { lines: opts.lines === false ? null : (l.data ?? []), entries: e.data ?? [] };
    },
    // The cheap probe: board_token() returns {l, e, u, r} (lines, entries, newest update, revisions), a few hundred bytes. The routine reads (the reconcile
    // read, the polling fallback) ask for it and fetch the board only when it moved. A backend that does not have the function says 'unsupported'.
    async boardToken() {
      try {
        const { data, error } = await client.rpc('board_token', {}, { get: true });
        if (error) return /PGRST202|Could not find the function|not find/i.test(`${error.code ?? ''} ${error.message ?? ''}`) ? { ok: false, error: 'unsupported' } : { ok: false, error: 'network' };
        if (!data || typeof data !== 'object') return { ok: false, error: 'unsupported' };
        return { ok: true, token: JSON.stringify(data), l: data.f != null ? `${data.l}:${data.f}` : (data.l ?? null) }; // l = the lines marker: count plus fingerprint, so a re-created line at the same count still reads as moved
      } catch { return { ok: false, error: 'network' }; }
    },
    subscribe(onChange, onStatus) {
      const ch = client
        .channel('board')
        .on('postgres_changes', { event: '*', schema: SCHEMA, table: 'lines' }, onChange)
        .on('postgres_changes', { event: '*', schema: SCHEMA, table: 'entries' }, onChange)
        // The server sends this `system` message once the postgres_changes bindings are active (realtime-js: RealtimeSystemPayload, extension
        // 'postgres_changes', status 'ok'). SUBSCRIBED alone only means the join was accepted; a write in the gap is never delivered.
        .on('system', {}, (p) => { if (p?.extension === 'postgres_changes') onStatus(p.status === 'ok' ? 'CONFIRMED' : 'CHANNEL_ERROR'); })
        .subscribe((s) => onStatus(s));
      return () => client.removeChannel(ch);
    },
    checkKey: (key) => rpc('check_key', { p_key: key }),
    saveEntry: (key, entry) => rpc('save_entry', { p_key: key, p_entry: entry }),
    removeEntry: (key, id) => rpc('remove_entry', { p_key: key, p_id: id }),
  };
  return api;
}
