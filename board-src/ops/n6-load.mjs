// N6: 5-10 simultaneous viewers, no errors. Read-only by default.
// usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node ops/n6-load.mjs [viewers=10]
// Optional N6_EDIT_KEY=<a minted agent-issued key>: also makes one edit and requires every viewer to see it within 5 s;
// refused unless the board holds only TEST rows (checks ids only, reads no job text).
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key, N6_EDIT_KEY: pc } = process.env;
const n = Number(process.argv[2] || 10);
if (!url || !key) { console.error('need SUPABASE_URL and SUPABASE_ANON_KEY'); process.exit(2); }
const mk = () => createClient(url, key, { db: { schema: 'ergon_warehouse' }, auth: { persistSession: false, autoRefreshToken: false } });
const errors = []; const seen = new Array(n).fill(null); const id = randomUUID(); let t0 = 0;
const viewers = await Promise.all(Array.from({ length: n }, async (_, i) => {
  const c = mk();
  const { data, error } = await c.from('lines').select('id');
  if (error || data.length !== 19) errors.push(`viewer ${i} load: ${error?.message || data.length + ' lines'}`);
  const ch = c.channel(`n6-${i}`).on('postgres_changes', { event: '*', schema: 'ergon_warehouse', table: 'entries' }, (p) => { if (p.new?.id === id && !seen[i]) seen[i] = (Date.now() - t0) / 1000; });
  let ready = false;
  await new Promise((res) => ch.subscribe((s) => { if (s === 'SUBSCRIBED') { ready = true; res(); } else if (!ready && ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(s)) { errors.push(`viewer ${i} realtime ${s}`); res(); } }));
  return { c, ch };
}));
if (pc) {
  // Realtime applies a channel's bindings shortly after SUBSCRIBED; an edit inside that window is not delivered to a bare client (the app itself catches up with a refetch and polling). Settle before editing so this measures steady-state delivery.
  await new Promise((r) => setTimeout(r, 2000));
  const real = await viewers[0].c.from('entries').select('id').eq('is_test', false).limit(1);
  if (real.error || real.data.length) errors.push('edit skipped: board holds non-test rows (or could not check)');
  else {
    t0 = Date.now();
    const r = await viewers[0].c.rpc('save_entry', { p_key: pc, p_entry: { id, line_code: 'A', title: 'TEST n6 probe' } });
    if (!r.data?.ok) errors.push('save failed: ' + JSON.stringify(r.data));
    await new Promise((r) => setTimeout(r, 5500));
    seen.forEach((s, i) => { if (s === null || s > 5.0) errors.push(`viewer ${i} saw edit at ${s}`); });
    await viewers[0].c.rpc('remove_entry', { p_key: pc, p_id: id });
  }
}
await Promise.all(viewers.map(({ c, ch }) => c.removeChannel(ch)));
console.log(JSON.stringify({ viewers: n, edit: Boolean(pc), seenSeconds: seen, errors, pass: errors.length === 0 }, null, 2));
process.exit(errors.length ? 1 : 0);
