import { LINE_LABELS, STATUSES, LIMITS } from '../config.js';

// The stand-in issuer for the demo build: three public test keys, the same #key= fragment the agent uses in production.
export const DEMO_KEYS = { valid: 'demo-employee', expired: 'demo-expired', revoked: 'demo-revoked' };
const FAR = '2099-01-01T00:00:00.000Z';
// The scenario clock: Mon 9 Nov 2026 08:42 ET. The demo board must not leak the wall clock into its
// revision stamps (Ticket 108 polish item 5).
const DEMO_STAMP = '2026-11-09T13:42:00.000Z';
const KEY = 'rhl.demo.v1';
import { uuid } from '../core/uuid.js';

const JOBS = [
  ['A', 'TEST Harbour Bakery', 'Pallet 4, chilled', 'JA', 'open'], ['A', 'TEST Northgate Foods', 'Short dated', 'JS', 'ready'],
  ['B', 'TEST Alder Joinery', 'Collect Tue', 'JG', 'hold'],
  ['C', 'TEST Millbank Pharmacy', 'Fragile', 'JA', 'ready'], ['C', 'TEST Kestrel Cycles', '', 'AK', 'open'], ['C', 'TEST Oakfield Farm Shop', 'Credit hold', 'JS', 'hold'],
  ['E', 'TEST Pinewood Garden Centre', 'Two cages', 'JG', 'open'],
  ['G', 'TEST Riverside Print', 'Rolls, keep upright', 'AK', 'done'],
  ['H', 'TEST Summit Outdoor', 'Part ship', 'JA', 'open'], ['H', 'TEST Tanner & Daughters', '', 'JS', 'ready'],
  ['K', 'TEST Willow Crafts', 'Label with PO 4471', 'LB', 'open'],
  ['M', 'TEST Beacon Hardware', 'Heavy, forklift', 'AK', 'hold'],
  ['P', 'TEST Fernhill Nurseries', 'Tail lift needed', 'JA', 'ready'],
  ['S', 'TEST Granite Stoneworks', 'Banded', 'XX', 'done'],
];

function seed({ lineCount = LINE_LABELS.length, withJobs = true } = {}) {
  const lines = LINE_LABELS.slice(0, lineCount).map((code, i) => ({ id: uuid(), code, sort_order: i + 1, is_test: true, created_at: DEMO_STAMP }));
  const entries = [];
  if (withJobs) {
    JOBS.forEach(([code, title, details, initials, status], i) => {
      const line = lines.find((l) => l.code === code);
      if (line) entries.push({ id: uuid(), line_id: line.id, title, details, initials, status, revision: 1, is_test: true,
        created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), updated_at: DEMO_STAMP });
    });
  }
  return { lines, entries };
}

// URL flag ?demo=empty|nolines|lines=N|reset rewrites the stored demo data; slow|fail only change behaviour (docs/APP.md).
function applyFlag(flag) {
  if (flag === 'empty') return seed({ withJobs: false });
  if (flag === 'nolines') return { lines: [], entries: [] };
  if (flag === 'reset') return seed();
  const m = /^lines=(\d+)$/.exec(flag ?? '');
  return m ? seed({ lineCount: Math.min(+m[1], LINE_LABELS.length) }) : null;
}

export function createDemoAdapter({ storage = localStorage, channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('rhl-demo'), flag = new URLSearchParams(globalThis.location?.search ?? '').get('demo'), flagMemo = globalThis.sessionStorage } = {}) {
  const hook = { offline: flag === 'fail', loseNextResponse: false, loadDelayMs: flag === 'slow' ? 1500 : 0, frozen: null }; // test hooks
  if (globalThis.window) window.__rhlDemo = hook;
  const read = () => { try { return JSON.parse(storage.getItem(KEY)); } catch { return null; } };
  const write = (d) => { storage.setItem(KEY, JSON.stringify(d)); channel?.postMessage('change'); };

  // A data flag rewrites the stored demo data once per tab, so a reload keeps later edits.
  const applied = (() => { try { return flagMemo?.getItem('rhl.demo.flag'); } catch { return null; } })();
  const flagged = flag && flag !== applied ? applyFlag(flag) : null;
  if (flagged) { write(flagged); try { flagMemo?.setItem('rhl.demo.flag', flag); } catch { /* private mode */ } }
  else if (!read()) write(seed());

  // The board's signature as the probe reports it. Split out so the freeze hook can capture one snapshot.
  const tokenOf = (d) => {
    const lf = d.lines.reduce((h, x) => (h + [...`${x.id}${x.code}${x.sort_order}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) | 0, 0);
    const t = { l: d.lines.length, f: lf, e: d.entries.length, u: d.entries.reduce((m, x) => (x.updated_at > m ? x.updated_at : m), ''), r: d.entries.reduce((n, x) => n + (x.revision || 0), 0) };
    return { token: JSON.stringify(t), l: `${t.l}:${t.f}` };
  };
  // Test hook: freeze(true) pins the probe's answer to the board as it is at that moment, so this tab stops hearing about outside changes until
  // freeze(false). Without it the "this page has not heard yet" tests race the routine probe: under load the tab learns before the click and the
  // Save button is already off, which is the app behaving correctly and the test having lost its precondition.
  hook.freeze = (on) => { hook.frozen = on ? tokenOf(read() ?? seed()) : null; };

  // key -> error code ('' = fine), mirroring the server: unknown or revoked is key_invalid, past its expiry is key_expired
  const gate = (key) => (key === DEMO_KEYS.valid ? '' : key === DEMO_KEYS.expired ? 'key_expired' : 'key_invalid');

  return {
    isDemo: true,
    demoKeys: DEMO_KEYS,
    hook,
    // the cheap probe the real backend offers (board_token): a small signature of the whole board. {l, e, u, r} = lines, entries, newest update, revisions.
    async boardToken() {
      if (hook.offline) return { ok: false, error: 'network' };
      return { ok: true, ...(hook.frozen ?? tokenOf(read() ?? seed())) };
    },
    async load() {
      const wait = hook.loadDelayMs; // first load only
      hook.loadDelayMs = 0;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (hook.offline) throw new Error('demo offline');
      const d = read() ?? seed();
      return { lines: d.lines, entries: d.entries };
    },
    subscribe(onChange, onStatus) {
      const h = () => onChange();
      channel?.addEventListener('message', h);
      const s = (e) => { if (e.key === KEY) onChange(); };
      globalThis.addEventListener?.('storage', s);
      queueMicrotask(() => { onStatus('SUBSCRIBED'); onStatus('CONFIRMED'); }); // a local channel has no gap between join and bindings
      return () => { channel?.removeEventListener('message', h); globalThis.removeEventListener?.('storage', s); };
    },
    async checkKey(key) {
      if (hook.offline) return { ok: false, error: 'network' };
      const err = gate(key);
      return err ? { ok: false, error: err } : { ok: true, subject: 'Demo employee', expires_at: FAR };
    },
    async saveEntry(key, e) {
      if (hook.offline) return { ok: false, error: 'network' };
      const err = gate(key);
      if (err) return { ok: false, error: err };
      const d = read() ?? seed();
      // optimistic concurrency, in the server's order: expected_revision present = an EDIT of a known revision (it must name an existing row at that
      // revision; never recreate a deleted job). Absent = a create or an idempotent upsert by client id, as before.
      const exp = e.expected_revision;
      if (exp != null) {
        if (!Number.isInteger(exp) || exp < 1 || !e.id) return { ok: false, error: 'invalid' };
        const cur = d.entries.find((x) => x.id === e.id);
        if (!cur) return { ok: false, error: 'not_found' };
        if (cur.revision !== exp) return { ok: false, error: 'conflict', revision: cur.revision };
      }
      const line = d.lines.find((l) => l.code === e.line_code || l.id === e.line_id);
      const bad = !line || !STATUSES.some((s) => s.value === e.status) || (e.title ?? '').length > LIMITS.title
        || (e.details ?? '').length > LIMITS.details || (e.initials ?? '').length > LIMITS.initials;
      if (bad) return { ok: false, error: 'invalid' };
      const now = DEMO_STAMP;
      const old = e.id && d.entries.find((x) => x.id === e.id);
      const entry = { ...(old ?? { id: e.id || uuid(), created_at: now, is_test: true }), line_id: line.id,
        title: e.title ?? '', details: e.details ?? '', initials: e.initials ?? '', status: e.status,
        revision: (old?.revision ?? 0) + 1, updated_at: now, updated_by: 'Demo employee' }; // server side: from the validated key's subject, never from the client
      d.entries = [...d.entries.filter((x) => x.id !== entry.id), entry];
      write(d);
      if (hook.loseNextResponse) { hook.loseNextResponse = false; throw new Error('response lost'); }
      return { ok: true, entry };
    },
    async removeEntry(key, id) {
      if (hook.offline) return { ok: false, error: 'network' };
      const err = gate(key);
      if (err) return { ok: false, error: err };
      const d = read() ?? seed();
      if (!d.entries.some((x) => x.id === id)) return { ok: false, error: 'not_found' };
      d.entries = d.entries.filter((x) => x.id !== id);
      write(d);
      return { ok: true };
    },
  };
}
