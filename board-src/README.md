# RHL warehouse board — app source

This folder is the rebuilt board app (React 19 + Vite + Tailwind 4 + shadcn/ui over Radix). The project's goal, finish
criteria and live-state pointer are one level up, in [`../GOAL.md`](../GOAL.md); the order, the acceptance list and the
append-only ledger are in [`../CONTRACT-AND-LEDGER.md`](../CONTRACT-AND-LEDGER.md).

Start with `docs/OPERATIONS.md` (deploy, keep-alive, keys, rollback), then `docs/APP.md` (run and test), then
`docs/DATA-CONTRACT.md` (the database surface the app is allowed to touch).

```sh
npm install
VITE_BACKEND=demo npx vite     # in-browser TEST data, no network
npm test                       # unit tests
npm run test:e2e               # demo backend + board flows + pack-check + connection honesty (faked REST/socket)
```

The live deployment is `https://rhl-warehouse-board.vercel.app` (build `455a9da`). The data is real customer data:
read counts and structure only, never row text, and never write to it from a development session.

Binding docs: `docs/DESIGN.md` (the look), `docs/DATA-CONTRACT.md` (the data), and the fences in
`../L5-CHECK-BRIEF.md` and `../GOAL.md`. Do not commit to any main; this branch is the deliverable.
