#!/usr/bin/env bash
# demo-up.sh — bring up THE DEMO STACK for the de-branded RHL warehouse-worker demo pack.
#
#   library  — the shared tool library service (real code), DEMO data dir inside this pack,
#              on 127.0.0.1:8751, seeded with three demo skills through the real review gate.
#   host     — serve/serve.mjs on 0.0.0.0:4966: the demo phone app at /app/, the board demo build at
#              /board/, the demo API the app calls, and the recorded footage at /footage/.
#
# DEMO DATA ONLY. Nothing here reaches the live board, RHL production data, or the live company
# library (127.0.0.1:8737). Re-running this script resets the demo library to its seeded state.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
RUN="$ROOT/.run"
LIB_SRC="${DEMO_LIBRARY_SRC:-/home/cayleb/workspace/frontend-reiteration/suite/library}"
mkdir -p "$RUN"

# stop this stack's previous processes (only the pids this script recorded)
if [ -f "$RUN/serve.pid" ]; then kill "$(cat "$RUN/serve.pid")" 2>/dev/null || true; fi
if [ -f "$RUN/library.pid" ]; then kill "$(cat "$RUN/library.pid")" 2>/dev/null || true; fi
sleep 0.4
rm -rf "$ROOT/.demo-library-data"

( cd "$LIB_SRC" && ERGON_LIBRARY_PORT=8751 ERGON_LIBRARY_DATA="$ROOT/.demo-library-data" \
  setsid node src/main.js > "$RUN/library.log" 2>&1 < /dev/null & echo $! > "$RUN/library.pid" )
for i in $(seq 1 60); do curl -sf -m 1 http://127.0.0.1:8751/health >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf -m 2 http://127.0.0.1:8751/health >/dev/null || { echo "DEMO-UP: library did not start"; tail -20 "$RUN/library.log"; exit 1; }

node "$HERE/seed-library.mjs" > "$RUN/seed.log" 2>&1
cat "$RUN/seed.log"

( cd "$ROOT" && setsid node serve/serve.mjs > "$RUN/serve.log" 2>&1 < /dev/null & echo $! > "$RUN/serve.pid" )
for i in $(seq 1 60); do curl -sf -m 1 http://127.0.0.1:4966/api/demo/health >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf -m 2 http://127.0.0.1:4966/api/demo/health >/dev/null || { echo "DEMO-UP: host did not start"; tail -20 "$RUN/serve.log"; exit 1; }

echo "DEMO-UP: ready"
echo "  app   http://127.0.0.1:4966/app/?demo=rhl&reset=1"
echo "  board http://127.0.0.1:4966/board/?demo=reset#key=demo-employee"
