# Operations (deploy, keep-alive, keys, rollback)

Status: written for the L4 deploy and updated after it. Items marked **not exercised** have not been run for this project; nothing here claims they work until they have.

## Two backends, two environments

| Environment | Backend | Data | Env values |
|---|---|---|---|
| Staging previews (so far) | `VITE_BACKEND=demo` (in the browser) | synthetic TEST rows in `localStorage` | none |
| Real project | `VITE_BACKEND=supabase` | the project's real `ergon_warehouse` tables (19 lines, 12 entries at the cutover) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Showcase (planned) | `VITE_BACKEND=supabase` | TEST rows only, on a SECOND project | that project's URL and publishable key |

`.env.example` lists the variable names only. The values are entered by the owner in the Vercel project settings (or a local `.env`), never committed, never pasted into a chat. Only the project URL and the publishable (anon) key are ever given to the app: never the service-role key, never a Management API token.

The showcase must not be able to reach the real rows. Verify it from the showcase URL's own access path before the URL is shared (separate project, separate keys).

## Deploy (L4)

1. `npm ci && npm test && npm run test:e2e` green on the commit to deploy; the multi-width lint passes on the built preview.
2. Build with `VITE_BACKEND=supabase` and the target project's two values in the Vercel environment. A neutral alias carries no personal name; the preview URL with a personal slug is staging only.
3. After the deploy: the served files equal the build by hash; the headers match `vercel.json` (CSP `frame-ancestors 'self'`, nosniff, no-referrer, cache rules); `ops/harness-origins.json` ships empty until the Ergon shell origins are supplied.
4. The owner's working key is minted **after** the deploy, through the app flow (below), never before.

## Keep-alive

`api/keepalive.js`, run by the daily cron in `vercel.json` (`17 9 * * *`), sends a count-only `HEAD` (`Prefer: count=exact`) to `/rest/v1/lines` with the publishable key and returns only a status. It reads no row.

- A free Supabase project pauses after about 7 idle days; a paid one does not. **The plan is not visible through the Management API surfaces available to us**: read it on the Dashboard billing page. If the project is paid, the cron is unnecessary.
- The cron needs the two environment values above in the same Vercel project. It lives only in this repo's `vercel.json`, not in the staging-only one.
- After a schema change PostgREST can take up to about 30 s to answer the first request: wait and retry before concluding anything.
- The long-term owned form (an owned scheduler, or a paid plan) is the owner's call.

## Connection indicator (what it costs)

The indicator states only what has been confirmed. Live is never claimed before the first board has been read; the word
"Reconnecting" is held back 1.5 s (blank before that, never a guess on a healthy load) **and needs a loaded board behind it**,
so a first read that hangs shows no word at all rather than claiming a reconnection that never happened; and a cheap probe asks
`board_token` every second from first paint **while the tab is visible**, so a failed *or hung* read turns the indicator to
Error instead of leaving a stale "Live" (the L5 checker measured about 6 s of stale "Live" before this change).

What counts as hung is measured, not fixed. The probe's deadline is three times this connection's own average round trip,
clamped to 1.5–10 s (about 11 s end to end before the label says Error): a fast link still names a hang in about two seconds, while a link answering in 2–3 s is allowed to be
slow (the first version used a fixed 1.5 s and the independent check measured it cycling Error → Live every 4 s at 3 s per
answer, 36 % of the run calling a working server down). A **board read** that never answers is the same problem on a different path: the probe asks `board_token`, so the data endpoints can hang while the probe answers and the label stays Live (measured 26 s). The read now has a 15 s deadline and only one is ever in flight, so that case ends in Error rather than a frozen board that claims to be live.

A timed-out probe keeps its own request alive and learns from the
answer if it arrives, and only one is ever outstanding, so a dead path cannot pile requests up (measured: 2 starts in 9 s).

Cost, measured (independent check, 4 Nov): one `board_token` RPC per second per **visible** tab, measured at **12 requests in
10 s** (~72/min on an idle board), paused while hidden (0 in 5 s). At 0.5–0.6 KB on the wire per request that is about
**35 KB a minute**, i.e. roughly **4.5 GB a month** at the 10-viewer × 10 h × 22 day model — a large share of the 5 GB free
egress allowance, not the "few percent" an earlier draft of this section guessed. The interval is the lever: 2 s halves it and
moves the worst-case Error from about 2.5 s to about 3.5 s. That trade is a data-lane decision (Nox); the promise and the
number change together.

## Keys (access)

Nobody types a secret into the board. The employee's own agent mints a temporary, per-employee key and opens the board with it in the URL fragment (`#key=ergk_...`, never the query string); the app keeps it for that tab, clears it from the address bar at once and shows nothing about it.

- `ops/keys.mjs` is the stand-in issuer: `mint` prints the plaintext **once** and the SQL (which holds only the sha256); `revoke <id>` and `list` print SQL. Run the SQL through the privileged route (the Management API `database/query`, as `postgres` or `service_role`), never through the read-only route.
- The plaintext exists exactly once. A script that mints and then dies before using the key leaves a key nobody can present: revoke it untested. Any automated mint must capture the plaintext in the same process that uses it.
- On the real project a key can write and delete real entries. Mint for a named employee, one at a time, with the shortest lifetime that does the job (30 days at most; 8 hours is the default for a test).
- To prove a key without exposing anything: `select ergon_warehouse.check_key('<key>')` through the **write** SQL route (the read-only route is permission-denied by design, error 42501). Revoking takes effect on the key's next call; there is no push to a browser that already holds it.

## Rollback

- **Application:** the previous deployment is restored in one step and the alias then serves it (**exercised 3 Nov**: v2 deployed, `vercel rollback` to v1 took 4 s and the alias served v1 within about 6 to 9 s, `vercel promote` of v2 took 4 s and the alias served it within about 6 s; the stale demo build was never rolled back to. The post-idle load test of N8 in `docs/ON-NETWORK-PACK.md` is **not yet exercised**, and the 7-day free-tier pause cannot be tested in a session. A deploy from the CLI has no git, so pass the commit as `--build-env RHL_BUILD_ID=<sha7>` or the version label reads `local`). The data layer does not need to move for an application rollback.
- **Database:** `supabase/hosted-rollback.sql` with the saved step-0 restore statements, as in `docs/HOSTED-APPLY-PACK.md`. Do not roll the database back once the board is in use without exporting what the added columns hold (`initials`, `status`, `is_test`, `updated_by`) and the key table.
- **Exposure:** removing `ergon_warehouse` from the project's `db_schema` (the `PATCH` in step 4, with the saved list) should make the Data API stop serving the board's tables (not exercised; expect a short reload); the rows stay.

## Where things are

`docs/HOSTED-APPLY-PACK.md` (the database apply and its execution record), `docs/DATA-LAYER.md` and `docs/DATA-CONTRACT.md` (shape and access), `docs/ON-NETWORK-PACK.md` (the N1 to N9 pack), `docs/AGENT-INTERFACE.md` (the agent client), `CONTRACT-AND-LEDGER.md` one folder up (decisions and run record).
