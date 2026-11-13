// views/Library.tsx — the company shared library surface (demo instance).
//
// The library is the Ergon shared tool library service (same code, a separate demo data directory),
// reached through the demo host's /api/demo/library proxy. What this screen adds is the ROLE view:
// which published skills the library offers to a warehouse operator. The library's own manifest has
// no per-role field, so the role selection is a named demo map (recorded in DEMO-MANIFEST.json), not
// a service capability claimed as real.
import { useCallback, useEffect, useState } from 'react';
import { DEMO_ROLE } from '../data/demo';
import { staticLibraryState } from '../data/store';

type LibTool = { name: string; version: string; description: string; summary?: string; publishedAt?: string; keywords?: string[] };
type LibState = { ok: boolean; role: string; chosen: LibTool[]; all: LibTool[]; fresh: string[]; note?: string; error?: string };

export function Library() {
  const [state, setState] = useState<LibState | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      let j = null;
      try {
        const r = await fetch('api/demo/library');
        j = await r.json();
      } catch {
        // The static publication has no demo host: show the frozen demo library snapshot instead of
        // an error, and say so on the surface. The local demo host always answers the real instance.
        setState(staticLibraryState());
        setError('');
        return;
      }
      if (!j.ok) throw new Error(j.error || 'library unavailable');
      setState(j);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="m-view" data-testid="library-view">
      <div className="m-view-head">
        <h2>Company library</h2>
        <p className="muted">shared skills · chosen for <strong>{DEMO_ROLE}</strong></p>
      </div>
      <p className="library-note">Demo instance of the company library service — separate demo data. Role selection is a named demo map.</p>
      {state && String(state.source || '').includes('frozen') ? <p className="library-note" data-testid="library-frozen">Static publication: this page carries a frozen snapshot of the demo library.</p> : null}
      {error ? <p className="library-error">The library did not answer: {error}</p> : null}
      {state ? (
        <>
          <h3 className="library-section" data-testid="library-chosen-head">Chosen for your role <span className="mono">{state.chosen.length}</span></h3>
          <ul className="m-cards" data-testid="library-list">
            {state.chosen.map((t) => (
              <li key={t.name} className={`m-card library-card${state.fresh.includes(t.name) ? ' fresh' : ''}`} data-skill={t.name}>
                <div className="m-card-top">
                  <h3 className="mono">{t.name}</h3>
                  <span className={`pill ${state.fresh.includes(t.name) ? 'done' : ''}`}>{state.fresh.includes(t.name) ? 'new' : `v${t.version}`}</span>
                </div>
                <p className="meta">{t.description || t.summary}</p>
                {t.keywords?.length ? <p className="last mono">{t.keywords.slice(0, 4).join(' · ')}</p> : null}
              </li>
            ))}
          </ul>
          <h3 className="library-section">Shared company-wide <span className="mono">{state.all.length}</span></h3>
          <ul className="m-cards" data-testid="library-all">
            {state.all.map((t) => (
              <li key={t.name} className="m-card">
                <div className="m-card-top"><h3 className="mono">{t.name}</h3><span className="pill">{t.version}</span></div>
                <p className="meta">{t.description}</p>
              </li>
            ))}
          </ul>
          <p className="library-note">Your agent can add, change, create and delete skills here — every add still passes the library's review desk, which is why the new skill shows as published by the demo reviewer.</p>
        </>
      ) : !error ? <p className="muted">Reading the library…</p> : null}
    </div>
  );
}

export default Library;
