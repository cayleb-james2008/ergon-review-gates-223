# On-network test pack (N1–N9) — per-item pass criteria

Run from the RHL work desktop against the deployed URL (`<URL>` below). Definitions are Nox's, relayed verbatim from the work-desktop session that authored them; thresholds are hard lines (Nox ruling, 2 Nov): no implied slack either side. Only N1 (3.0 s), N3 (5.0 s) and N6 (5–10 viewers) carry numbers; none are implied elsewhere.

The board is TEST DATA until the owner cuts over to live data: a visible `TEST DATA` marker is expected during this pack.

| # | Item | Pass criterion | Evidence |
|---|---|---|---|
| N1 | Load from the work desktop | HTTPS valid; every response is HTTP 200; **median server response ≤ 3.0 s over the scripted run, cold start included**; full page load measured separately in the browser pane and recorded | status + timing log (`scripts/n1-timing.mjs`), screenshot |
| N2 | Other RHL devices | The board loads and shows 19 lines on a floor/other device, over Wi-Fi and over Ethernet, on the pinned build (the build id, `Version <id>` in the logo tooltip and `data-version` on the board, matches the deployed one; the rebuild removed the visible header text, so a screenshot needs the tooltip or a console read, see docs/DESIGN.md) | one screenshot per device |
| N3 | Proxy and filter | A change made on device A shows on device B **≤ 5.0 s** later, on the RHL network (websocket may be blocked; the 4 s polling fallback must carry it) | stopwatch or log of edit time vs seen time, per attempt |
| N4 | End to end | All 19 lines A–S render; a status edit survives a reload and shows on a second device; bad input (over-long text, no or invalid key, empty title) is rejected with a plain message and nothing is saved | scripted run output + screenshots |
| N5 | Access | Behaves as designed from inside and outside the network: viewing works without sign-in; **editing without an agent-issued key is impossible** (absent, unknown, revoked or expired key returns a refusal and writes nothing; no passcode exists anywhere); no new public surface beyond the deployment URL | access check results (`scripts/n5-access.mjs`) |
| N6 | Concurrency | 5–10 simultaneous viewers, no errors in any client; one edit reaches all of them | run log (`scripts/n6-load.mjs`) |
| N7 | Browsers | Works on RHL's Edge versions and warehouse screen sizes: 19 rows visible with no page scroll, readable text, bubble draggable | screenshots |
| N8 | Rollback | The previous deployment can be restored in one step and the URL then serves it; also a **post-idle load test** (free-tier pause risk, C17): load the board after an idle period and confirm it still loads and shows data | rollback log + reload check; post-idle load result |
| N9 | Cayleb's grade | Rendered page, his call | his verdict |

Scripts named above are built in L4/L5 and read the URL and the publishable key from environment variables; none contains a secret.
