# Showcase: prepared up to the owner's act (4 Nov 2026)

The showcase is the public, TEST-data-only copy of the board. Nox's ruling (2 Nov 11:52, restated in the ledger) is that it is
backed by **TEST data only**, and that the real `ergon_warehouse` rows must be **unreachable from the showcase deployment, not
merely unshown**.

**Status: blocked on one owner act — creating a second free Supabase project.** Everything below is prepared and reversible; the
only thing this side cannot do is create that project (account-level) or hold its keys.

## Why a second project, and not a second schema

A second schema in the existing project would share the same publishable key and the same PostgREST exposure, so keeping the
real rows unreachable would rest on policies and exposure config staying untouched forever. A second project makes isolation
**structural**: the showcase bundle carries only that project's URL and publishable key, and no key in it can reach
`ergon_warehouse`.

## The sequence (owner act first, then Nox, then this side)

1. **OWNER:** create a free Supabase project with a neutral name (no personal name in it — the project name appears in the API
   host). Free tier only; no spend.
2. **NOX (Management API or dashboard):** run the same hosted apply steps against **only** that project
   (`docs/HOSTED-APPLY-PACK.md`, steps 0–2b) and expose its schema. On a fresh project the schema is created in the live shape —
   no surgery on existing data. Seed it with `scripts/seed-test.mjs` (TEST rows only; every row `is_test = true`).
3. **NOX:** hand back **that project's URL and publishable key only**. The service-role key never leaves Nox's side and is never
   used by the showcase deployment.
4. **THIS SIDE:** create the second Vercel project `rhl-warehouse-showcase` through the logged-in CLI (approved by Nox, ledger
   3 Nov 07:30 (d)), set its two environment variables to the showcase project, and deploy the **same commit** as the live v3
   with `VITE_BACKEND=supabase`.
5. **CHECKER (fresh sub-session, not the builder):** run the isolation check below **from the showcase URL's own access path**
   and file the result. The URL is shared with nobody until it passes.

## Isolation check (must PASS before the URL is shared)

Judged from the showcase deployment alone, with only its own URL and publishable key:

1. The deployed bundle's Supabase host is the **showcase** project, not the Ergon ref (`yhpjpjeedpuvcgnvfpka`); no Ergon URL or
   key appears anywhere in the served files.
2. Requests aimed at the Ergon project with the showcase key fail (401 / invalid key); there is no path to its schema.
3. Metadata-only inspection of the showcase project: no table or row from Ergon; every row `is_test = true`; RLS on every table.
4. The showcase deployment's environment variables name **only** the showcase project.
5. Nothing in the repo, the build or the deployment contains the real project's key.
6. Counts: the showcase shows the seeded TEST jobs; the real board is untouched (its `lines` 19 / `entries` 12 do not move).

## What is deliberately NOT done here

- No second Supabase project was created; no hosted write of any kind was made.
- No second Vercel project was created tonight: creating it before the Supabase project exists would leave a deployment with no
  backend, and Nox's condition is "isolation check before that URL is shared".
- No deploy, no alias change: live v3 `455a9da` stays live.
