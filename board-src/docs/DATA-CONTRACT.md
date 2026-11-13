# Data contract (L1 data layer ⇄ L2 app)

Single source of truth for the database surface the app talks to. Schema name: `ergon_warehouse`.
The app only ever holds the publishable (anon) key. Writes go through key-gated functions (agent-issued, per-employee, expiring keys; no passcodes); there is no service-role key anywhere in the app.

## Tables — LIVE SHAPE IS GROUND TRUTH (reported by Nox from the hosted project, 2 Nov)

The hosted `ergon_warehouse` already has these two tables with RLS ENABLED, **zero policies** (deny-all for API roles today), and neither table in the realtime publication. The migration must be **non-destructive**: no drop, no re-create, no truncate, no data statements against them; only additive DDL, grants, policies and publication membership. A fresh local database gets the same tables created in exactly this shape.

`lines` (existing): `id uuid NOT NULL` · `code text NOT NULL` (the label, `A`..`S`) · `sort_order smallint NOT NULL` · `created_at timestamptz NOT NULL`.
 Additive: `is_test boolean NOT NULL DEFAULT false`.

`entries` (existing; a job on a line): `id uuid NOT NULL` · `line_id uuid NOT NULL` · `title text NULL` (the job/customer text) · `details text NULL` (the note) · `photo_metadata jsonb NOT NULL` · `revision bigint NOT NULL` · `created_at timestamptz NOT NULL` · `updated_at timestamptz NOT NULL` · `tags text[] NOT NULL`.
 Additive: `initials text NOT NULL DEFAULT ''` · `status text NOT NULL DEFAULT 'open'` (check open/hold/ready/done, assumption A7; add the check as NOT VALID-safe) · `is_test boolean NOT NULL DEFAULT false` · `updated_by text NOT NULL DEFAULT ''` (who last wrote the row: set ONLY by `save_entry` from the validated key's `subject`, on insert and on every update; any identity field in `p_entry` is ignored; existing rows keep `''`; metadata-only default, no rewrite).
 **Hosted constraints (verified by Nox from the hosted project, 2 Nov):** primary keys `lines_pkey`, `entries_pkey`; unique `lines_code_key`, `lines_sort_order_key`; index on `entries.line_id`; foreign key `entries.line_id -> lines.id ON DELETE RESTRICT`; CHECKs `entries_photo_metadata_check` (`jsonb_typeof(photo_metadata) = 'array'`, so the array convention is schema-enforced), `entries_revision_check` (`revision > 0`), `lines_code_check` (`code ~ '^[A-S]$'`), `lines_sort_order_check` (`sort_order between 1 and 19`). Hosted has 19 lines, 12 entries, ids distinct and non-null. The migration therefore adds NO primary key or other constraint to existing tables (only `entries_status_check`). Column defaults on hosted are still unknown. **Therefore every INSERT the RPCs perform must set every NOT NULL column explicitly** (`photo_metadata = '[]'::jsonb` (convention: an ARRAY — all 12 live rows hold arrays; confirmed by Nox 2 Nov), `revision = 1`, `tags = '{}'`, `created_at/updated_at = now()`, `id` = client-supplied or gen_random_uuid()), and updates do `revision = revision + 1, updated_at = now()`. Add no constraint to an existing table except the additive status check. The `updated_at` trigger is optional (RPCs set it).
 Limits: title <= 120 chars, details <= 240, initials <= 6, no control characters. `title` may be null in the DB: the app shows an empty title as "(untitled)".

Entry id: **client may supply it**; the same id twice is an idempotent upsert (no duplicate on retry).

## ACCESS MODEL (owner ruling, 2 Nov 11:53; supersedes the passcode design everywhere)
**No app has a passcode or any shared secret.** Access runs through the user's agent: the agent holds a key tool that mints TEMPORARY, app-scoped keys for a SPECIFIC EMPLOYEE and generates, manages and deletes them as it sees fit. The app validates per-employee, agent-issued keys and nothing else. Viewing stays open (owner's C5 split); keys gate every write.

**Key format.** `ergk_` + base64url of 32 random bytes (48 chars, 256-bit; guessing is infeasible, so there is no throttle and no failure log). The database stores only `sha256` of the full key string (hex). The plaintext exists once, in the issuer's output.

**Private table (RLS on, no policies, no grants to anon/authenticated):** `ergon_warehouse.access_keys`: `id uuid pk default gen_random_uuid()`, `key_hash text not null unique`, `key_prefix text not null` (first 9 chars, for operator display only), `app text not null default 'rhl-warehouse-board'`, `subject text not null` (the employee the key was minted for, 1 to 80 chars), `issued_by text not null default ''`, `created_at timestamptz not null default now()`, `expires_at timestamptz not null` (must be in the future and at most 30 days after `now()` at mint), `revoked_at timestamptz`, `last_used_at timestamptz`.

## Functions (security definer, `search_path=''`)
Execute granted to anon + authenticated, revoked from public. All return `jsonb`; they never raise on a bad key: `{"ok":false,"error":"key_invalid"|"key_expired"|"invalid"|"not_found"|"conflict"}` (`conflict` only from `save_entry` with `expected_revision`, and it also carries `"revision": <current revision>`). `key_invalid` = unknown or revoked key (same answer, no oracle); `key_expired` = known, not revoked, past `expires_at`. A key for a different `app` is `key_invalid`.
- `check_key(p_key text)` -> `{ok:true, subject, expires_at}` or the error. (Used by the app to show who is editing and until when; never needed to write.)
- `save_entry(p_key text, p_entry jsonb)` -> `{ok, entry}`; `p_entry` keys: `id` (uuid, optional, client-generated, idempotent upsert), `line_code` or `line_id`, `title`, `details`, `initials`, `status`, `expected_revision` (bigint, optional; see below). **Optimistic concurrency:** creates omit `expected_revision` and keep the idempotent upsert-by-id behaviour (a retry never duplicates). When `expected_revision` is present the call is an EDIT (it then requires `id`; a positive integer, else `invalid`): if the row does not exist -> `{ok:false,error:"not_found"}` and nothing is written (never recreated); if the stored `revision` differs -> `{ok:false,error:"conflict",revision:<current>}` and nothing is written; otherwise the normal update (`revision + 1`, `updated_by` from the key). This also covers moving an entry to another line. A bad/revoked/expired key is still refused first. Returns the whole row incl. `revision` and `updated_by` (= the key's subject, never client text). Validates lengths/status. Sets `last_used_at` on success.
- `remove_entry(p_key text, p_id uuid)` -> `{ok}` / `not_found`.
- `board_token()` -> jsonb `{"l":<lines count>,"f":<sum of a hash of each line's id, code and sort order>,"e":<entries count>,"u":<max(entries.updated_at) as UTC text or null>,"r":<sum of entries.revision>,"i":<sum of a hash of the entry ids>}` (under 120 bytes). A cheap change probe for pollers: any insert, update (revision bump), delete or line count change alters it, and it is unchanged when nothing changed, so a viewer re-reads the whole board only when the token moved. No key needed. `SECURITY INVOKER` and `STABLE`: it sees exactly what the caller can SELECT; execute granted to anon + authenticated, revoked from public. Callable as `POST /rpc/board_token` (or GET) with `Content-Profile`/`Accept-Profile: ergon_warehouse`.
KEY-CREATION SURFACE (what an agent key tool calls; owner order 2 Nov 12:05). Issuer side (**privileged: executable only by postgres/service_role; the agent's key tool and the stand-in issuer use it; the plaintext key never enters the database**):
- `mint_access_key(p_key_hash text, p_key_prefix text, p_subject text, p_expires_at timestamptz, p_issued_by text default '')` -> uuid (validates: hash is 64 hex chars, expiry future and <= 30 days, subject length).
- `revoke_access_key(p_id uuid)` -> boolean (sets `revoked_at`; idempotent).
- `list_access_keys()` -> rows of id, key_prefix, subject, issued_by, created_at, expires_at, revoked_at, last_used_at (never the hash).
**There is NO `set_edit_passcode`, `edit_gate`, `gate_failures`, `check_passcode`, throttle or passcode column anywhere.**

Delivery contract: the key arrives WITH the launch and is never typed into anything (Nox confirmation 2 Nov: fragment delivery is the app-side launch contract; contained in-harness surfaces may satisfy it in-process). Web form, agent-mediated: the agent opens the app with the key in the URL FRAGMENT (`#key=ergk_...`, never the query string, so it is not sent to any server or log); the app reads it, keeps it in `sessionStorage` for that tab only, clears it from the visible URL IMMEDIATELY after reading, before any other code runs (`history.replaceState`), so no key sits in the address bar or rides along when the link is copied, and sends it with writes. The agent tool surface and the CLI use env `BOARD_KEY`. With no key the app never asks for a secret: it says editing needs a key from the person's agent.

## Realtime
`lines` and `entries` are in publication `supabase_realtime`; anon has a SELECT policy (`using (true)`), so realtime events reach viewers. Clients also poll every 4 s while the realtime channel is not SUBSCRIBED, so an edit reaches a second device within ~5 s even on networks that block websockets.

## TEST marker
Seeded rows carry `is_test = true`. The app shows a persistent visible `TEST DATA` marker whenever any loaded row has `is_test = true` (and always in the `demo` backend).

## Live-schema note (A2, resolved)
The hosted schema was inspected read-only (metadata only) by Nox on 2 Nov; the shape above is that ground truth. Policies and realtime membership are absent on the hosted project and are what the migration adds. Real rows are never read, copied, modified or seeded over: the seed script refuses to run against any table containing a row with `is_test = false`. `supabase/inspect.sql` remains as a re-runnable read-only check.

## Local-fixture divergence (recorded)
An earlier local "live-shape" fixture had no keys or checks, so Realtime failed locally with "no primary key" while hosted already has primary keys. Fixtures now carry the real hosted constraints above, so local tests exercise the hosted configuration. Local fresh-database creation mirrors hosted exactly (same keys, uniques, FK RESTRICT, CHECKs).
