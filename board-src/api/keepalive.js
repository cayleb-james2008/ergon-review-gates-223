// C17: a daily read keeps the free-tier Supabase project from pausing after ~7 idle days.
// A HEAD request with a count (Prefer: count=exact) with the publishable key: the database counts the lines and returns no row and no body, and this returns
// only a status. Counts only, so it is safe against the real project (fence: no row-content reads there).
export default async function handler(_req, res) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return res.status(200).json({ ok: true, skipped: 'no backend configured' });
  try {
    const r = await fetch(`${url}/rest/v1/lines?select=id`, {
      method: 'HEAD',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'ergon_warehouse', Prefer: 'count=exact' },
    });
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status });
  } catch {
    return res.status(502).json({ ok: false });
  }
}
