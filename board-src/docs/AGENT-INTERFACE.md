# Agent interface

The board is human-native (the web UI) and agent-native (this interface). Every capability a person has in the UI is available to an employee's own AI agent, from any harness, through one documented gated surface, with the same access rule and the same data.

| File | Role |
|---|---|
| `public/agent-tools.json` (served at `/agent-tools.json`) | Single source of truth for the tool surface: names, descriptions, JSON Schemas, output shapes, error codes, limits, key rules |
| `public/agent.json` (served at `/agent.json`) | Manifest: what the app is, where the tools file is, how reads and writes work, how to get connection settings. Contains no URL or key |
| `agent/client.mjs` | Reference client. Zero dependencies, Node 22+ built-ins and `fetch` only. Imports nothing from `src/` |

These three files are the complete agent interface and work standalone (see "Using this component from a loader").

## Use it in 10 minutes

1. Get three values into the environment (never into a file you commit). `BOARD_URL` and `BOARD_ANON_KEY` come from the board owner (the anon key is public). `BOARD_KEY` is a temporary key that **your own agent issues for you**; no human types, knows or shares a secret.

   ```sh
   export BOARD_URL=...         # the board's data API base URL (https; plain http only for localhost)
   export BOARD_ANON_KEY=...    # the public anon key. Never a service-role key
   export BOARD_KEY=ergk_...    # your temporary per-employee key (writes and key_check only; reads need none)
   export BOARD_ACTOR=AGT       # optional: your initials tag, max 6 chars
   ```

2. Call tools from the shell (prints one JSON result; exit code 0 when `ok`, 1 otherwise):

   ```sh
   node agent/client.mjs --list
   node agent/client.mjs key_check '{}'
   node agent/client.mjs board_get '{}'
   node agent/client.mjs board_find '{"text":"acme","status":"hold"}'
   node agent/client.mjs job_save '{"line_code":"C","title":"Acme pallet","details":"wrap","status":"open"}'
   node agent/client.mjs job_set_status '{"id":"<uuid from board_get>","status":"ready"}'
   node agent/client.mjs job_remove '{"id":"<uuid>"}'
   ```

3. Or from code:

   ```js
   import { createBoardClient } from './agent/client.mjs';
   const board = createBoardClient();                 // BOARD_URL / BOARD_ANON_KEY / BOARD_KEY from env
   const r = await board.callTool('job_save', { line_code: 'C', title: 'Acme pallet' });
   if (!r.ok) console.log(r.error, r.message);       // never throws for expected failures
   ```

   `createBoardClient({ url, anonKey, key, actor, fetch })` also accepts the settings directly and an injected `fetch`.

4. To let the person see or edit the board in a browser, open the app with the key in the URL **fragment**: `<app url>/#key=ergk_...`. The app reads it, keeps it in `sessionStorage` for that tab, removes it from the address bar and sends it with writes. Never put a key in a query string (`?key=`): query strings reach servers and logs, fragments do not.

### Results and errors

Every call returns `{ ok: true, ... }` or `{ ok: false, error, message }`. Error codes: `key_invalid` (unknown, revoked or wrong-app key; one answer for all three), `key_expired`, `invalid`, `not_found`, `conflict` (carries `current_revision`), `network`, `config`, `unknown_tool`. Arguments are validated against the tool's JSON Schema before any network call. The key and anon key are redacted from every returned string and are never logged. `key_invalid` and `key_expired` are never retried: ask your own agent for a new key. Network errors are retried up to 3 times with the same generated id.

### Wrapping the tools file as MCP, Claude or DSH tools

Each entry in `tools[]` already has the three fields every registry needs. The mapping is mechanical:

```js
import { readFileSync } from 'node:fs';
import { createBoardClient } from './agent/client.mjs';
const doc = JSON.parse(readFileSync('public/agent-tools.json', 'utf8'));
const board = createBoardClient();

// MCP server (tools/list)            -> { name, description, inputSchema, annotations }
const mcpTools = doc.tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations }));
// MCP tools/call, and any handler -> run the client and return the JSON as text
const handle = async (name, args) => ({ content: [{ type: 'text', text: JSON.stringify(await board.callTool(name, args)) }] });

// Claude Messages API tool definitions -> rename inputSchema to input_schema
const claudeTools = doc.tools.map(({ name, description, inputSchema }) => ({ name, description, input_schema: inputSchema }));

// DSH / any registry with (name, description, schema, fn): register fn = (args) => board.callTool(name, args)
```

Put `doc.keys.agentRule`, `doc.testData` and `doc.attribution` in your agent's instructions; they are the rules that are not visible in the schemas.

## Access model

**No app has a passcode or shared secret.** Access runs through the person's own agent, which holds a key tool that mints temporary, app-scoped keys for a specific employee and generates, manages and deletes them as it sees fit.

* **Reads are open.** The board is readable with the public anon key alone: PostgREST `GET /rest/v1/lines` and `/rest/v1/entries` with `apikey`, `Authorization: Bearer <anon key>` and `Accept-Profile: ergon_warehouse`.
* **Writes need a key.** Writes call the RPCs `save_entry(p_key, p_entry)`, `remove_entry(p_key, p_id)` and `check_key(p_key)` (`POST /rest/v1/rpc/<name>`, `Content-Profile: ergon_warehouse`). Direct table writes are not permitted for the anon key. This is the path the browser uses too, so a human and an agent are bound by the same rule and see the same rows.
* **Keys.** `ergk_` plus base64url of 32 random bytes (48 characters, 256-bit), stored in the database only as a sha256 hash, valid for at most 30 days, scoped to this app, issued for one employee (`subject`). Because guessing is infeasible there is no throttle and no lockout: a wrong key is just `key_invalid`, and nobody else is affected.
* **Issuing is not an agent-tool job.** Minting, revoking and listing keys are privileged database functions used by the person's own agent (see `ops/keys.mjs`). The tools in this interface only use a key, they cannot create one.
* **Live parity.** An agent write appears on the human UI within 5 s (realtime, with a 4 s polling fallback). A human edit is read by the agent on its next `board_get` or `board_find`. Proven by `test/agent/live.test.mjs`.

## Attribution

**`updated_by` is the authority.** Every job carries a read-only `updated_by`: the subject of the key that made the last change, set by the database on every save from the validated key. No caller can supply it: no tool accepts `updated_by` (passing it is `invalid`, checked locally before any request), and if a raw RPC payload contains one the database rejects or ignores it. It appears in `board_get`, `board_find`, `job_save` and `job_set_status` results (null for rows that were never written through a key). Use it, not `initials`, to answer "who changed this?".

`initials` remains a free-text display tag (the table has no actor column and none may be added). Agent writes stamp it with a short actor tag, `BOARD_ACTOR` (default `AGT`, max 6 characters), unless the call passes `initials` explicitly, including `job_set_status`. Anyone, human or agent, can type anything there, so it proves nothing. The key's subject and expiry are also readable with `key_check`.

## Idempotency

`job_save` takes an optional client-generated uuid `id`. The same id twice is the same job (an update, `revision + 1`), never a duplicate. Without an `id` the client generates one, returns it in `job.id`, and reuses it across its own network retries (up to 3). `created: true` in the result means `revision` is 1. If a create succeeded but the reply was lost, the retry shows as an update (`created: false`, revision 2): harmless.

## Optimistic concurrency (`expected_revision`)

Every job has a `revision` (1 at creation, +1 on every save). To edit without silently overwriting someone else's change, pass `expected_revision` (the revision you last read) to `job_save` or `job_set_status`:

* the stored revision matches: the write happens, the result has the new revision;
* it differs: `conflict`, **nothing written**, and the result carries `current_revision`. Re-read the job (`board_find` / `board_get`), decide whether your change still applies, then call again with the new revision. Never retry the same call;
* the job was deleted: `not_found`, nothing written, **not recreated**.

Creates never take it: a create (no `id`, or an `id` that does not exist yet and no `expected_revision`) is an idempotent upsert by client id, exactly as before. Passing `expected_revision` without an `id` is `invalid`. Omit it only when you deliberately want last-write-wins on an edit.

`job_set_status` always guards itself: unless you pass `expected_revision` it first reads the job's current revision and writes with it, so a change by someone else in between surfaces as `conflict` instead of a silent overwrite (and a missing job is `not_found` before any write). Network retries reuse the same payload; if the first attempt actually succeeded and its reply was lost, the retry of an `expected_revision` edit returns `conflict` with `retried_after_network_error: true`: read the job to see whether your change is already there.

`conflict` and `not_found` are never retried by the client.

## Key errors (read this)

* `key_invalid` (unknown, revoked or wrong app) and `key_expired`: **stop**. Do not retry, do not try other keys, do not ask a human for a password: ask your own agent to issue a new key for this employee. The reference client never retries these.
* A wrong key costs nothing and locks nobody out, but it is never a reason to loop.
* `key_check` tells you the subject and expiry; call it once per session, not in a loop.

## What agents must never do

* Retry or loop on `key_invalid` / `key_expired`, or guess keys.
* Type, ask for, store or pass around a shared secret. There is none. Never write a key to a file under version control, a prompt, a tool description or a log, and never put a key in a URL query string (use the `#key=` fragment, or the environment).
* Use another person's key, or a key for a different employee than the one you act for.
* Write to a board whose `board_get` says `test_data: true` unless the user asked you to test. Rows with `is_test = true` are synthetic; the human UI shows a `TEST DATA` badge for the same reason.
* Use a service-role key, or any key other than the public anon key for reads.
* Delete a job the user did not name (`job_remove` has no undo), or "clean up" other people's jobs.
* Poll faster than every few seconds.

## Using this component from a loader

The app is a standalone, interchangeable component, not a plugin. A loader (for example the single DSH plugin) needs nothing from this repo except the descriptor `component.json` at the repo root:

```json
"interface": { "agent": { "tools": "public/agent-tools.json", "manifest": "public/agent.json", "client": "agent/client.mjs" } }
```

A loader:

1. reads `component.json` and resolves `interface.agent.*` relative to the component folder;
2. loads the tools file and registers each entry of `tools[]` under its `name`, with `description` and `inputSchema` (the schemas are plain JSON Schema; nothing assumes a harness);
3. imports the client module, calls `createBoardClient()` (settings from `BOARD_URL`, `BOARD_ANON_KEY`, `BOARD_KEY`) and routes each tool call to `client.callTool(name, args)`.

Replacing the app means replacing the folder: the next load reads the new descriptor, tools and client. `agent/client.mjs` imports only Node built-ins and reads only `public/agent-tools.json` (or an injected `tools` object); `test/agent/offline.test.mjs` enforces that and that every path in `component.json` exists.

## DOM audit (for agents that drive the browser)

Agents should prefer the tools above: they are faster, gated identically and need no rendering. An agent that must drive the page (a computer-use harness, an accessibility-tree reader) can rely on the hooks below. The page has **no passcode, `#lock-btn`, `#passcode` or `#unlock-form`**: editing is enabled only by a key, delivered in the URL fragment.

### Key flow (contract between the page and agents)

1. Open `<app url>/#key=ergk_...`. The app reads the fragment, stores the key in `sessionStorage` (this tab only), removes the fragment with `history.replaceState`, and sends the key with writes. A key in the query string is never read.
2. `#key-status` shows the state: `data-state` = `none` (no key; view only, the page never asks for a secret) / `valid` / `expired` / `invalid`, and `data-subject` = the employee the key was issued for (present when valid).
3. `#board[data-key-state]` mirrors it (`none|valid|expired|invalid`) and `#board[data-can-edit="true"]` is true only with a valid key and a live connection.
4. After a key error on a write the page returns to the matching `data-state` and shows a message; it never opens a password field.

The live test `PAGE KEY FLOW` asserts exactly this (fragment stripped from `page.url()`, `#key-status[data-state=valid][data-subject]`, `#board[data-can-edit=true][data-key-state=valid]`, no `input[type=password]`, an expired fragment key gives `#key-status[data-state=expired]` and `data-can-edit=false`).

### Hooks an agent can rely on

| Where | Hook |
|---|---|
| `main#board` | `aria-label="Warehouse lines A to S"`, `aria-busy`, `data-state` = `loading` / `error` / `empty` / `ready`, `data-can-edit`, `data-key-state`, `data-test-mode`, `data-job-count`, `data-line-count`, `data-version` (deployment) and a change token (`data-rev`) |
| `.row` | `role="group"`, `data-density="compact"` when the line's jobs would not fit at normal card width (then its `.job` cards carry `data-compact`), `aria-label="Line C"`, `data-line="C"`, `data-empty="true"` when it has no jobs |
| `.label` | the bay marker; `data-tally="ready/total"` when the line has jobs. Each row also has an inline Add job button `[data-add-line="C"]` (opens a form with that line preselected; without a valid key the form carries the key notice and does not save) |
| `.job` | `role="listitem"`, `data-id` (entry uuid), `data-status`, `data-line`, `data-revision`, `data-test`, `data-updated-by` (server-set editor, read-only; the details show it as "Last edited by"), `data-hue` on the initials chip; `.job.hit` / `.dim` mark search results |
| fields | `[data-field="title"]`, `[data-field="details"]`, `[data-field="initials"]`, `[data-field="status"]` inside each card. With a valid key the title is a `button` with `aria-label="Edit job: <title>"` and the status a Radix Select trigger (`button[role="combobox"]`, `aria-label="Status for <title>"`; click it, then a `[role="option"]` in the `[role="listbox"]` portal) |
| `#key-status` | `data-state`, `data-subject` (see above) |
| `#conn` | `data-state` = `live` / `polling` / `offline` / `error`; `#conn-label` text. Never `live` before the first board has been read (it is `polling` then, so the attribute and the words agree). `data-blank` while no word is confirmed yet: the label is empty and the dot draws nothing (the first ~1.5 s of a load; never a guess). An agent that switches on the label text must handle `""` |
| `#test-marker` | `hidden` toggled, text `Test data`; the same fact is `#board[data-test-mode]` |
| `#live-text` | `aria-live="polite"`, text such as `14 jobs` |
| controls | `#search` (sr-only label), `#add-btn` (only with a valid key), `#bubble[role=group][aria-label]` with `data-state` |
| dialog | `#job-dialog` with `data-mode="create"\|"edit"` and `data-job-id` while open, fields `#f-line #f-title #f-details #f-initials #f-status`, `#job-msg[role=alert]`, buttons `#job-save #job-delete #job-cancel` |
| banners | `.banner[role=status]` |
| discovery | `<link rel="alternate" type="application/json" href="/agent.json">` in `index.html` |

### Remaining gaps

Re-audited against `src/` and `index.html` after the key-flow round: every attribute this audit asked for is now present (`#key-status`, `#board[data-key-state]`, `data-test-mode` on `#board` and `<body>`, `role="status"` on `#test-marker`, `aria-live` on `#conn`, `aria-hidden` on skeleton rows, card/row roles, `data-line` / `data-revision` / `data-test` / `data-field`, dialog `data-mode` / `data-job-id`, the discovery `<link>`). No missing hook remains. Two rules to keep:

1. **Selector stability**: the live parity tests rely on `.job[data-id]`, `.job[data-status]`, `#board[data-state]`, `#board[data-can-edit]`, `#board[data-key-state]`, `#key-status[data-state][data-subject]`, `#conn[data-state]` and the absence of `input[type=password]`. Keep them through restyles, or update `test/agent/live.test.mjs` in the same change.
2. **Change token**: `data-rev` on `#board` (digest of `updated_at`, job count and revision sum) lets an agent detect that the board changed without diffing the DOM. Keep its name stable.

## Tests

```sh
npm run test:agent                 # offline: validator, redaction, retry, no retry on key errors, tools/impl parity, no secrets, standalone-import check
E2E_SUPABASE=1 npm run test:agent  # + live against the LOCAL stack (without the flag the live tests report SKIP)
```

The live tests seed synthetic `TEST` rows with `scripts/seed-test.mjs` and mint keys the way an issuer does: the test generates an `ergk_` key, computes its sha256 and calls `ergon_warehouse.mint_access_key` as the database superuser (the plaintext key never enters the database). They exercise every tool, prove a revoked key gives `key_invalid`, an expired key (inserted with a past `expires_at`) gives `key_expired`, and no key or an unknown key writes nothing, prove parity against a headless chromium page that receives its key by URL fragment, and clean up (entries before lines, then `access_keys`). They read the stack URL and anon key at runtime from `supabase status -o env` and never print or store them.

## Agent usability trial prompt

The integrator gives a fresh Haiku agent only `public/agent-tools.json`, `public/agent.json` and `agent/client.mjs`, with `BOARD_URL`, `BOARD_ANON_KEY` and `BOARD_KEY` set in its shell environment. `BOARD_KEY` is a freshly minted TEST key: the integrator generates `ergk_` + base64url(32 random bytes), computes its sha256 and calls `ergon_warehouse.mint_access_key(<hash>, <first 9 chars>, 'TEST Trial Agent', now() + interval '2 hours', 'trial')` as the database superuser (or uses `ops/keys.mjs`); the agent never sees the hash or the database. The local stack is seeded with TEST data, so the TEST-data rule is switched on for the trial. Then check the database afterwards (see the checks below).

```text
You are an assistant for a warehouse lines board. You have only three files: public/agent.json (a manifest),
public/agent-tools.json (the tool list) and agent/client.mjs (a Node client). Read the manifest and the tools file first.
Connection settings, including your temporary board key, are already in your environment variables; never print them, never write them to a file and never put a key in a URL query string.
Run tools with:  node agent/client.mjs <tool> '<json args>'   (it prints JSON; "ok": false means it failed).

This board is a LOCAL TEST board with synthetic data, and your user explicitly authorises writing to it for this trial.
Everything you create must start with "TEST TRIAL ".

Do these tasks in order. After each, state in one line what you did and the result.
1. Check that your key works (key_check) and tell me who it was issued for. If it fails with key_invalid or key_expired, stop, tell me the error code and do not retry; there is no password to ask anyone for.
2. Tell me how many lines the board has, how many jobs, and whether it shows TEST data.
3. Create a job on line M with title "TEST TRIAL pallet one", note "wrap and label", status open. Tell me its id.
4. Create it again with the SAME id (change the note to "wrapped"). Confirm there is still exactly one such job on the board.
5. Create a second job on line N titled "TEST TRIAL pallet two" without choosing an id yourself.
6. Mark "TEST TRIAL pallet one" as ready, then find it again by searching for "TRIAL pallet one" and report its status and revision.
7. List all jobs with status hold on any line and report their titles (do not change them).
8. Delete "TEST TRIAL pallet two". Then try to delete it a second time and report the error code you get.
9. Try to create a job with a title of 130 characters. Report what happens and whether anything was written.
10. Do NOT touch any job that does not start with "TEST TRIAL ". Do not change or delete any seeded job.
Finish with a summary table: task, tool used, result, error code if any.
```

Checks to run on the database afterwards (psql, local only):

* exactly one entry titled `TEST TRIAL pallet one`, status `ready`, `revision >= 3`, `initials = 'AGT'`, on line M; no entry titled `TEST TRIAL pallet two`; no entry with a 130-character title;
* the 14 seeded jobs are unchanged (same titles, statuses and revisions);
* `ergon_warehouse.access_keys` shows the trial key used (`last_used_at` set) and no other key was created or used;
* then clean up: revoke or delete the trial key (`delete from ergon_warehouse.access_keys`), and delete all test entries before lines.

Pass criteria: every task done with the right tool on the first or second try, no invented tool names, no secret printed, the key_check subject reported correctly, task 8's second delete reported as `not_found`, task 9 reported as `invalid`, and no write outside the `TEST TRIAL` rows.
