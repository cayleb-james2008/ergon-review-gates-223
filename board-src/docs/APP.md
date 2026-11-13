# Board app (L2)

React 19 + Vite + Tailwind 4 + shadcn/ui source over Radix primitives (see docs/LIBRARIES.md and docs/DESIGN.md). The store, adapters and config are plain JS modules and unchanged; React reads the store with `useSyncExternalStore`.

## Run

```
npm install
VITE_BACKEND=demo npx vite          # in-browser TEST data, no network
npm test                            # unit tests (node --test, no browser)
npm run test:e2e                    # builds the demo backend (and the style guide), serves it with vite preview, drives /usr/bin/chromium: board flows plus the pack-check
E2E_SUPABASE=1 npm run test:e2e:live   # needs the local Supabase stack; mints its own keys with ops/keys.mjs and cleans up
VITE_BACKEND=supabase npm run build # production build (needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY at build time)
```

`VITE_BACKEND` is `supabase` (default) or `demo`. The choice is a build-time alias (`@backend` in `vite.config.js`, a static import of `src/data/backend-demo.js` or `backend-supabase.js`), so a supabase build contains no demo code and a demo build contains no Supabase client code, and the first screen needs one chunk and no second round trip. Only the publishable (anon) key is ever used. There is no passcode: an agent opens the board with `#key=ergk_...`, the page moves the key to `sessionStorage` (this tab) and strips the fragment before any module runs (docs/AGENT-INTERFACE.md, Key flow). Dark is the default theme; `?theme=light` selects light.

## Layout

| path | job |
|---|---|
| `src/config.js` | the 19 labels A..S, status vocabulary (`open/hold/ready/done`), limits, poll interval |
| `src/core/lines.js` | merge config labels with DB lines, sort, search filter |
| `src/core/connection.js` | pure state machine: live / polling / offline / error, backoff |
| `src/core/store.js` | load generation counter, realtime + 3 s poll, online/visibility refetch, idempotent save |
| `src/core/key.js` | launch-key intake (`acceptLaunchKey`), key state machine none / valid / expired / invalid with expiry timer, plain notices |
| `src/core/legend.js`, `src/config/legend.json` | initials to colour coding (alias JAN to JA, unconfirmed neutral) |
| `src/data/supabase.js`, `demo.js` | the two adapters: `load`, `subscribe`, `saveEntry`, `removeEntry`, `checkKey` |
| `src/main.jsx`, `src/App.jsx`, `src/hooks.js` | bootstrap, state wiring (key session, search, dialog, banners, agent hand-off) |
| `src/components/*.jsx` | board, job card, status badge, header, banners, command bubble (drag handle, search and agent command field), job dialog and inline Add job, key chip and notice, bay marker |
| `src/components/ui/*.jsx` | shadcn/ui source over Radix: button, input, label, select, dialog, popover, tooltip, alert, badge, skeleton |
| `src/ui/bubble.js`, `src/ui/agent-state.js` | bubble drag and keyboard move (custom); the handle's idle, working and needs-you state (the neural-net generator lives in `design/reserved/agent-avatar/`, not in the app) |
| `src/core/density.js` | per-row card density: a line whose jobs would not fit at normal card width switches its cards to the compact card |
| `src/core/handoff.js`, `ops/harness-origins.json`, `ops/headers.mjs` | who may frame the board and receive the bubble's command text: one list, read by the header generator and the build (docs/AGENT-HANDOFF.md) |
| `src/styles.css` | tokens (light, dark, paper) and board layout |
| `design/`, `styleguide.html`, `src/styleguide/` | the design pack and its rendered style guide (`STYLEGUIDE=1 vite build`, or `vite` in dev at /styleguide.html) |

## Data names (contract of 2 Nov)

Line `{id, code, sort_order, is_test, created_at}` (label shown = `code`). Entry `{id, line_id, title, details, initials, status, revision, is_test, created_at, updated_at}`; an empty title renders "(untitled)". Entries sort by `created_at`, then `id`. RPCs: `check_key(p_key)`, `save_entry(p_key, p_entry{id,line_code,title,details,initials,status})`, `remove_entry(p_key, p_id)`. Results are normalised to `{ok:true,...}` or `{ok:false,error}` with error `key_invalid | key_expired | invalid | not_found | network`.

## Behaviour notes

- The entry id is made with `crypto.randomUUID()` before the first send and reused on every retry (3 automatic attempts on `network`, plus manual Save again), so a lost response cannot duplicate a job.
- A load only applies if it is newer than the last applied state; a write invalidates loads already in flight.
- Connection label: **blank** until the first board has been read and the feed has settled (about 1.5 s at most; `data-blank`), then Live (realtime SUBSCRIBED and read), Reconnecting (3 s poll, only after that settle **and only once a board has loaded** — a page that never connected has nothing to reconnect to — so it stays blank), Offline (navigator offline, or 3 failed fetches with a board loaded), Error (a failed read at once; a hung one at the probe deadline). The indicator's own 1 s probe decides what "hung" means from what this connection has actually been doing: three times its measured round trip, from 1.5 s (nothing slower seen, so a hang is named in about two seconds) up to 10 s (about 11 s end to end, with the confirm window), so a link answering in 2–3 s is not called an outage. Editing is only enabled in Live and Reconnecting. A **read** that never answers is its own outage: the probe asks a different RPC, so a data path can die while the probe keeps answering (measured: 26 s of Live over a frozen board). The board read therefore has a 15 s deadline, and only one read is ever in flight, so a dead data path shows Error and cannot pile requests up.
- Test data marker: any loaded line or entry with `is_test`, or the demo backend.
- If the DB does not have 19 lines the 19 configured rows are still drawn and a banner says "Only N of 19 lines are set up." With zero lines a full-board message ("No lines are set up yet.") replaces the rows.

## Re-skinning

All colours (light, dark, paper), radii, spacing and motion durations are custom properties at the top of `src/styles.css`; `design/tokens.json` mirrors the colours. `?theme=light|dark` overrides the system scheme. The green `#88AE3F` is for fills and accents only (2.57:1 on white).

## Demo flags (query string, demo build only)

`?demo=reset` reseed 19 lines + 14 jobs; `empty` lines without jobs; `nolines` zero lines; `lines=N` only N lines; `slow` first load takes 1.5 s (skeleton); `fail` first load fails (error state). Data flags rewrite the stored data once per tab (a reload keeps later edits). Demo keys (demo build only, three buttons on the page and in `#key=`): `demo-employee` (valid), `demo-expired`, `demo-revoked`. The production build contains none of them (grep test). Test hooks on `window.__rhlDemo`: `offline`, `loseNextResponse`, `loadDelayMs`, `freeze(on)` (pins the routine probe to the board as it is, so a test can hold a tab that has not heard about an outside change until it calls `freeze(false)`; without it those tests race the reconcile read).

## Known limits

- On touch screens (pointer: coarse) rows have a 52 px minimum, so a 19-row board on a tablet shorter than about 1000 px scrolls inside the board instead of fitting. Wall screens with a mouse or no input fit exactly.
- `supabase-live.test.mjs` runs only with `E2E_SUPABASE=1` against the local stack (keys minted by `ops/keys.mjs`).

## Realtime and polling cost
The board is Live only after the server confirms the `postgres_changes` bindings (a join alone is not enough). Until then it probes every 3 s. Once confirmed it reads the whole board once at once and once more 4 s later, then does one **reconcile probe every 15 s** (jittered, none while the tab is hidden: the timers armed before hiding are cancelled; one probe when it becomes visible again), so a missed event heals within one interval.
The probe is `board_token()` (`{l, f, e, u, r, i}`: lines count, lines fingerprint, entries, newest update, revisions; a few hundred bytes, answered by a stable SQL function): the routine reads fetch the token and read the board **only when it differs** from the token recorded before the last full read, entries only when the lines marker (the count plus the fingerprint `f`, so a line re-created at the same count still counts as moved) did not change. Full reads remain for the first load, the post-confirmation catch-ups, realtime-driven refreshes and after local writes. A backend without the function (or a failed answer of 'unsupported') makes the store fall back to full reads for good. Measured on the local stack, idle and Live, 14 jobs: the reconcile's 4 token reads a minute plus the indicator's own health probe — **`board_token` once a second while the tab is visible** (see below), so an idle board is about **60 to 72 requests a minute**, not 4. That is the honest number: the indicator's promise costs about 0.5-0.6 KB on the wire per probe (payload plus headers), i.e. roughly **35 KB a minute** while a tab is open and visible, or about **4.5 GB a month at the 10-viewer x 10 h x 22 day model** the design uses (about 90 % of the 5 GB free egress allowance; half that at 5 viewers). Preflights are cached on the hosted gateway, so the hosted count is nearer the lower end of that range than the local one. The probe is paused while the tab is hidden (measured: 0 in 5 s). The lever, if egress binds, is the 1 s interval: 2 s halves it and moves the worst-case Error from about 2.5 s to about 3.5 s; changing it changes the promise in the same commit. The reconcile's own reads remain as described: The old behaviour was a full read of both tables every 15 s: 34 KB a minute at 14 jobs and about 280 KB a minute at 200. The bubble's alpha fill is .9, the lowest that keeps the text and field contrast over a painted bay marker and over the page.
