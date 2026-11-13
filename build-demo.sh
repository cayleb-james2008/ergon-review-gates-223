#!/usr/bin/env bash
# build-demo.sh — reproduce the delivered demo site tree from this tree.
#
#   site/app   <- a fresh vite build of app-src (the de-branded demo front end)
#   site/board <- board-src/dist (the real board build with VITE_BACKEND=demo; unchanged by this ticket)
#
# Installs the locked dependencies only when node_modules is absent; the project pins the exact
# vite/react versions in package.json. The de-brand rule is checked on the produced tree: zero
# case-insensitive occurrences of the vendor brand.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/app-src"
if [ ! -x node_modules/.bin/vite ]; then npm ci --ignore-scripts; fi
node_modules/.bin/vite build
rm -rf "$ROOT/site/app" "$ROOT/site/board"
mkdir -p "$ROOT/site"
cp -a dist "$ROOT/site/app"
cp -a "$ROOT/board-src/dist" "$ROOT/site/board"
if grep -ril 'ergon' "$ROOT/site" >/dev/null 2>&1; then
  echo "build-demo: FAILED de-brand scan — the served tree names the vendor brand" >&2
  grep -ril 'ergon' "$ROOT/site" >&2
  exit 1
fi
echo "build-demo: site tree ready at $ROOT/site (de-brand scan clean)"
