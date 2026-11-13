# PROVENANCE — Ergon review gates (Slack ticket 223 / fleet mission m-0355)

This repository holds the **demo build under test** and the **human-review-gate implementation** for
Slack ticket 223: "Ergon: hands-off agent workflows, human-review-gated".

Demo data only. Nothing here reaches a live warehouse board, RHL production data, the live company
library, or any credential. The agent in the demo is a *scripted* demo agent ("scripted demo agent —
no live AI"); the call is a labelled simulation ("SIMULATED — no real call").

## The build this starts from (hashed, not assumed)

| Thing | Fact |
|---|---|
| Baseline pack | Ticket 195/207 RHL warehouse demo pack, frozen read-only for this mission at `missions/m-0355/work/reference/demo-pack-baseline/` |
| Baseline pack manifest | `BUILD-MANIFEST.json` sha256 `f37e673410cf8ae2326fd8690e4f0eff59b62d321cfd24cfc66ce0aa43d5ebb8` |
| Baseline served app | `site/app/index.html` sha256 `6c4f1e96363681fa2c413b45777eb3db02f627a6e2586f97f21dfc2929b5a324`; bundle `index-DCmS6Iha.js` sha256 `ab4aecddc85394ed818cc98ca65b3d54e75a0571d81ce2db463e9c0189a59a97`; css `index-yfHjJhRj.css` sha256 `6633ad7b51709f957a733147b80ad56dd58dd7cbdc41156990bb397b71a60622` |
| Build of record behind it | Ergon final 068 dark front end (`m-0258` `polish/dist-r6`), `index.html` sha256 `43b1943d2e0807c863ae88d573961ea02abd70fb97aedebd79ea73d33ef7c4f6`; branch `frontend/ergon-068-house-checks`, pushed head `1a32ed928be20400a57e288586a75c52ccb57917`, code head `513d1c66` in `cayleb-james2008/ergon` |
| Board | The real company board build with `VITE_BACKEND=demo` (in-browser TEST data), shipped prebuilt in `board-src/dist`; unchanged by this ticket |
| De-brand rule | 0 case-insensitive occurrences of the vendor brand in the served site tree |

`main` is this baseline tree verbatim (source only; `node_modules` and built `dist` are not committed).
`gates/hands-off-223` adds the review-gate implementation and `build-demo.sh` on top of it.

## Branch `gates/hands-off-223` — what changed

Every consequential agent act is stopped at a review gate: the agent prepares and proposes, the
employee confirms with a ~0.9 s hold (a tap cannot confirm), and only then does the act run. Deny
records the denial and changes nothing. Gates add no password, no login and no new network endpoint;
the host-layer zero-trust boundary is untouched.

| File | Change |
|---|---|
| `app-src/src/data/fixtures.ts` | `GateKind`/`GateState`/`GateCardView` message-card types; `Decision.kind` gains `gate` |
| `app-src/src/data/store.ts` | Review-gate machinery (`approveGate`, `denyGate`; each act runs **only** from the approve handler), persisted gate state, `AutoLog`, hold-gated task sign-off (`signOffTask`/`denySignOff`); the demo agent now *proposes* the call, board write, skill publish and task sign-off instead of running them |
| `app-src/src/components/GateCard.tsx` | New small purpose-built in-thread gate card: title, 2–4 mono fields stating exactly what changes, hold control, Deny, in-place "Decision recorded — Approved/Denied · D-nn" outcome |
| `app-src/src/components/HoldToSend.tsx` | Committed label parameterised ("Called", "Written", "Published", "Signed off"); aria-label names the hold (~0.9 s); a tap cannot confirm |
| `app-src/src/components/AutoLog.tsx` | New compact "Automatic" line: the agent's own reversible/low-stakes acts, logged, no confirmation needed |
| `app-src/src/components/DemoCards.tsx` | Gate cards routed in the thread; the one-tap "Build the skill" offer replaced by the skill-publish gate |
| `app-src/src/views/Thread.tsx` | AutoLog rendered under the brief in demo mode |
| `app-src/src/views/Tasks.tsx` | A waiting task is no longer a tap target: in-place hold-to-sign-off gate + Deny (recorded, task unchanged) |
| `app-src/src/styles/app.css` | Gate card / AutoLog / task-gate styles from the existing tokens (no new palette, radii or fonts) |
| `build-demo.sh` | Rebuilds the delivered site tree (`site/app` from `app-src`, `site/board` from `board-src/dist`) and fails if the de-brand scan is not clean |

## Rebuilding

```
./build-demo.sh          # npm ci if node_modules is absent, vite build, assemble site/, de-brand scan
bash serve/demo-up.sh    # demo stack: app /app/?demo=rhl&reset=1, board /board/, demo library, demo API
```

Rebuild proof (fresh clone of the PR head, `build-demo.sh`, delivered hashes compared) is recorded in
the mission's `worker-2/BUILD.md`.
