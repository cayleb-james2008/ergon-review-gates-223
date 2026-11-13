// Shared fakes for the store tests: manual timers and a controllable environment.
export function fakeEnv({ online = true } = {}) {
  const queue = [];
  let id = 0;
  const handlers = {};
  const env = {
    online,
    isOnline: () => env.online,
    visible: true,
    isVisible: () => env.visible,
    listen(on, off, vis) { handlers.online = on; handlers.offline = off; handlers.visible = vis; return () => {}; },
    timers: {
      set: (f, ms) => { queue.push({ id: ++id, f, ms }); return id; },
      clear: (t) => { const i = queue.findIndex((q) => q.id === t); if (i >= 0) queue.splice(i, 1); },
    },
    pending: () => queue.map((q) => q.ms),
    async fire() { const q = queue.shift(); q?.f(); await tick(); return q?.ms; },
    goOffline() { env.online = false; handlers.offline(); },
    goOnline() { env.online = true; handlers.online(); },
    handlers,
  };
  return env;
}

export const tick = () => new Promise((r) => setImmediate(r));

export function fakeAdapter(data = { lines: [], entries: [] }) {
  const a = {
    data, loadCalls: 0, failLoad: false, saves: [], saveResults: [], statusCb: null, changeCb: null,
    tokenCalls: 0, failToken: false, noToken: false, lastLoadOpts: null,
    // the backend's cheap probe: a small signature of the board
    async boardToken() {
      a.tokenCalls++;
      if (a.failToken) return { ok: false, error: 'network' };
      if (a.noToken) return { ok: false, error: 'unsupported' };
      const e = a.data.entries ?? [];
      const ls = a.data.lines ?? [];
      const f = ls.reduce((h, x) => (h + [...`${x.id}${x.code}${x.sort_order}`].reduce((s, c) => (s * 31 + c.charCodeAt(0)) | 0, 7)) | 0, 0);
      const t = { l: ls.length, f, e: e.length, u: e.reduce((m, x) => ((x.updated_at ?? '') > m ? x.updated_at : m), ''), r: e.reduce((n, x) => n + (x.revision || 0), 0) };
      return { ok: true, token: JSON.stringify(t), l: `${t.l}:${t.f}` };
    },
    async load(opts) { a.loadCalls++; a.lastLoadOpts = opts ?? null; if (a.failLoad) throw new Error('down'); return opts && opts.lines === false ? { lines: null, entries: a.data.entries } : a.data; },
    subscribe(onChange, onStatus) { a.changeCb = onChange; a.statusCb = onStatus; return () => {}; },
    async saveEntry(code, entry) { a.saves.push({ code, entry }); return a.saveResults.shift() ?? { ok: true, entry: { ...entry, line_id: 'L1', revision: 1, created_at: 'x' } }; },
    async removeEntry() { return { ok: true }; },
    async checkKey(k) { return k === 'good' ? { ok: true, subject: 'Test', expires_at: '2099-01-01T00:00:00.000Z' } : { ok: false, error: 'key_invalid' }; },
  };
  return a;
}
