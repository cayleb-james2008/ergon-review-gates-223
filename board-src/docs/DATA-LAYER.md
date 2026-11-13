# Data layer (L1)

Implements `docs/DATA-CONTRACT.md` (live shape and the access model are ground truth). Files: `supabase/migrations/20261102090000_ergon_warehouse.sql`,
`supabase/inspect.sql`, `scripts/seed-test.mjs`, `ops/keys.mjs`, `test/sql/`. Nothing here talks to a hosted project.

## Access model in one paragraph
There is no passcode and no shared secret anywhere. Viewing is open (anon SELECT on `lines`/`entries`). Every write goes through `save_entry` / `remove_entry`, which need a per-employee,
agent-issued, expiring key (`ergk_` + 43 base64url chars). The database stores only the sha256 (hex) of the full key in the private table `ergon_warehouse.access_keys`
(RLS on, no policies, no grants); the plaintext key exists once, in the issuer's output, and never enters the database. A wrong, unknown, revoked or wrong-app key is `key_invalid`
(one answer, no oracle); a known, unrevoked key past `expires_at` is `key_expired`. Keys live at most 30 days. Keys are 256-bit random, so there is no throttle and no failure log.
The functions never raise on a bad key.

## What the migration does
- **Existing `lines` / `entries` (hosted):** additive only. It adds `lines.is_test`, `entries.initials`, `entries.status`, `entries.is_test`, `entries.updated_by` (constant defaults, no table rewrite),
  one `entries_status_check` constraint (`NOT VALID`, so old rows are never judged), enables RLS, revokes every grant of `anon`/`authenticated` on them and re-grants SELECT only,
  adds one SELECT policy per table (`using (true)`), sets `REPLICA IDENTITY FULL` (a table option, no row touched; realtime UPDATE/DELETE events then carry the whole old row),
  and adds both tables to publication `supabase_realtime`. No drop, re-create, truncate, update or delete of their rows; no key, FK, index, trigger or other constraint added (hosted already has them); no existing column touched.
- **Fresh database (local, or the showcase project):** each table is created (only when absent) to mirror hosted: `lines_pkey`, `entries_pkey`; unique `lines_code_key`, `lines_sort_order_key`; index on `entries(line_id)`;
  FK `entries.line_id -> lines.id ON DELETE RESTRICT`; CHECKs `entries_photo_metadata_check`, `entries_revision_check`, `lines_code_check` (`^[A-S]$`), `lines_sort_order_check` (1..19); no column defaults, so local runs still prove that
  the RPCs and seed set every NOT NULL column. Local test lines can therefore only be A..S with sort_order 1..19: SQL tests use the seeded TEST lines `E`, and cleanup deletes entries before lines (FK RESTRICT).
- **New private table:** `access_keys` (`id`, `key_hash` unique, `key_prefix` = first 9 chars, `app` default `rhl-warehouse-board`, `subject`, `issued_by`, `created_at`, `expires_at`, `revoked_at`, `last_used_at`).
- **Functions** (all `security definer`, `search_path = ''`):
  - for `anon` + `authenticated`: `check_key(p_key)` -> `{ok, subject, expires_at}`; `save_entry(p_key, p_entry)` -> `{ok, entry}`; `remove_entry(p_key, p_id)` -> `{ok, id}` / `not_found`. Errors: `key_invalid`, `key_expired`, `invalid`, `not_found`.
  - privileged, executable by `postgres` / `service_role` only: `mint_access_key(p_key_hash, p_key_prefix, p_subject, p_expires_at, p_issued_by default '')` -> uuid (hash = 64 lowercase hex, prefix = 9 chars, subject 1..80, expiry in the future and at most 30 days; raises otherwise);
    `revoke_access_key(p_id)` -> boolean (idempotent); `list_access_keys()` -> id, key_prefix, subject, issued_by, created_at, expires_at, revoked_at, last_used_at (never the hash).
  - private helper `_resolve_key` (no API access). `last_used_at` is set on a successful write only.
- **Attribution (`entries.updated_by text NOT NULL DEFAULT ''`):** filled only by `save_entry`, from the validated key's `subject`, on insert and on every update (it follows the last writer). Any `updated_by`, `updatedBy`, `subject` or similar field in `p_entry`
  is ignored, so a client cannot claim an identity it does not hold. Refused writes (no/revoked/expired/wrong-app key) change nothing. `remove_entry` is unchanged. Rows that exist before the migration keep `''` until someone with a key next edits them.
  Realtime payloads carry it (REPLICA IDENTITY FULL). The seed leaves it `''` on seeded TEST rows (no fake identity).
- **Change probe `board_token()`:** returns `{"l","f","e","u","r","i"}` (lines count, a fingerprint `f` of each line's id, code and sort order, entries count, max `updated_at` as UTC text, sum of `revision`, sum of a hash of the entry ids; under 120 bytes). Any insert, update, delete or line count change alters it
  (the id hash catches a delete plus an insert in the same instant, which can leave `e`, `u` and `r` equal), and it is unchanged when nothing changed. Viewers poll it instead of re-reading the whole board and fetch the full board only when it moves.
  `SECURITY INVOKER` and `STABLE`: it runs as the caller, so RLS applies and it reveals nothing a SELECT would not. Executable by anon and authenticated, revoked from public. It is a function only (no table), part of the same single migration transaction;
  rollback is `drop function ergon_warehouse.board_token();`.
- **Optimistic concurrency (`expected_revision`):** `save_entry` accepts an optional `expected_revision` (positive integer) in `p_entry`; with it the call is an EDIT and needs `id`. A missing row returns `not_found` (never recreated, so a job deleted in another tab stays deleted);
  a different stored `revision` returns `{"ok":false,"error":"conflict","revision":<current>}`; in both cases nothing is written. Otherwise the normal update (`revision + 1`, `updated_by` from the key). It covers line moves too.
  Creates omit it and keep the idempotent upsert by client id; JSON `null` counts as absent; a non-number, zero, negative or fractional value is `invalid`. The key is checked first, so a refused key learns nothing about the row.
  This is a replacement of the existing `save_entry` function inside the single migration transaction: no new object, so the hosted steps and the verify query are unchanged.
- **RPC writes:** every INSERT sets every NOT NULL column explicitly (`photo_metadata '[]'` (empty array, the live convention), `revision 1`, `tags '{}'`, `created_at/updated_at now()`, id client-supplied or `gen_random_uuid()`);
  every UPDATE does `revision = revision + 1, updated_at = now()` (a re-save of identical content still bumps `revision`; it never duplicates the row). `title`/`details` are stored NULL when never supplied.
  A new entry inherits `is_test` from its line. `save_entry` returns id, line_id, line_code, title, details, initials, status, revision, updated_by, photo_metadata, tags, is_test, created_at, updated_at.
  Text is trimmed; control characters (including newline) are rejected; title <= 120, details <= 240, initials <= 6; status in open/hold/ready/done.
- No passcode, `edit_gate`, `gate_failures`, throttle or passcode column exists anywhere (a test checks the catalog).

## Local use
- Apply: `psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261102090000_ergon_warehouse.sql` (`DB_URL` from `supabase status -o env`). Safe to re-run.
- Test: `node test/sql/run.mjs`. It refuses any non-local host and any DB holding non-test rows, mints its own keys through `ops/keys.mjs`, keeps them in memory only, and removes them at the end; it leaves the schema applied and empty.
  The REST and realtime tests need the local anon JWT (from `supabase status -o env` as `ANON_KEY`, or set `BOARD_TEST_ANON_KEY`); without one they print `SKIP` and the run exits 3 (`BOARD_TEST_ALLOW_SKIP=1` makes that 0).
- Seed (test databases only): `node scripts/seed-test.mjs | psql -v ON_ERROR_STOP=1 "$DB_URL"`: 19 lines (A..S, `sort_order` 1..19) and 14 `TEST ` jobs, all `is_test = true`. One transaction; if any row with `is_test = false` exists in either table it raises
  `SEED REFUSED` (psql exits 3, nothing written). `WHERE NOT EXISTS` guards, so it needs no unique index and a re-run is a no-op.
- Stand-in issuer (`ops/keys.mjs`, zero dependencies; the agent's key tool replaces it):
  - `node ops/keys.mjs mint --subject "<employee>" --ttl 8h [--issuer <label>] [--db <DB_URL>] [--json]`: generates the key, prints the PLAINTEXT KEY ONCE, and with `--db` mints it through `psql` (local hosts only unless `--allow-remote`);
    without `--db` it prints the exact `select ergon_warehouse.mint_access_key(...)` to run through another privileged route. Only the sha256 is in that SQL. The key is never written to a file or log. `--ttl` is `Nm|Nh|Nd`, 1m..30d.
  - `node ops/keys.mjs list [--db ...]`, `node ops/keys.mjs revoke <id> [--db ...]` (prints the SQL without `--db`).

## Hosted apply, in order (needs Management API / SQL access as postgres or service_role)
**The presentation pack for Nox is `docs/HOSTED-APPLY-PACK.md`** (backup first, each step with its request, expected output and tested rollback; counts-only against the real project). Where it differs from the list below (a count-only smoke test and keep-alive instead of reading rows), the pack wins.

Run each SQL as one request to `POST /v1/projects/{ref}/database/query` (or the SQL editor). A multi-statement request is a single implicit transaction: it applies fully or not at all.
There is no passcode step: it was cancelled by the owner.

1. **Pre-flight, read-only.** Send the contents of `supabase/inspect.sql` (catalog only: no row or count of any data table). Confirm it matches the contract: `lines` = id uuid, code text, sort_order smallint, created_at timestamptz (NOT NULL);
   `entries` = id, line_id uuid, title, details text (nullable), photo_metadata jsonb, revision bigint, created_at, updated_at timestamptz, tags text[] (NOT NULL); RLS on; no policies; `supabase_realtime` lists neither table.
   Each `table|...` row ends with `has_primary_key=...` (information only; hosted has `lines_pkey`/`entries_pkey`) and the `constraint|` rows should list the hosted keys, uniques, FK RESTRICT and CHECKs. Note the `api-exposed-schemas` row.
   If a column is missing or has another type, stop: the migration would refuse anyway with a message and change nothing.
2. **Additive column `entries.updated_by` (its own step, run first: smallest and safest).** Attribution of the last writer (see above). Send exactly:
   ```sql
   alter table ergon_warehouse.entries add column if not exists updated_by text not null default '';
   ```
   Expected output: success, no rows. A constant default is stored in the catalog only: no table rewrite, no row is touched, existing rows read `''`. Verify (read-only):
   ```sql
   select column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'ergon_warehouse' and table_name = 'entries' and column_name = 'updated_by';
   ```
   Expect one row: `updated_by | text | NO | ''::text`. Idempotent (`if not exists`); the migration repeats the same statement, so step 3 treats it as already done.
   Rollback: `alter table ergon_warehouse.entries drop column updated_by;` only if nothing depends on it. It deletes the recorded attribution of every row written since (rows are otherwise untouched), so do not roll back once the board is in use; the app and agent tools that read `updated_by` must be rolled back first or they will error.
3. **Apply the migration.** Send exactly: `begin;` + the full contents of `supabase/migrations/20261102090000_ergon_warehouse.sql` + `commit;`. The keys schema (`access_keys` and the functions) is part of this one transaction and contains no secret. It also contains the `updated_by` statement of step 2, which is then a no-op.
   Success is no error. No validation scan runs against existing rows (Nox, 2 Nov): `entries_status_check` is added `NOT VALID` and stays so; it guards every new insert and update.
4. **Verify, read-only.** Send:
   ```sql
   select
     (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'ergon_warehouse' and c.relkind = 'r')                                       as rls_on_every_table,
     (select count(*) from pg_policies where schemaname = 'ergon_warehouse')                            as policies_expect_2,
     (select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
        and schemaname = 'ergon_warehouse' and tablename in ('lines','entries'))                       as realtime_tables_expect_2,
     not has_table_privilege('anon', 'ergon_warehouse.entries', 'insert,update,delete')
       and not has_table_privilege('anon', 'ergon_warehouse.access_keys', 'select')
       and has_table_privilege('anon', 'ergon_warehouse.lines', 'select')                               as anon_read_only,
     (select string_agg(distinct p.proname, ',' order by p.proname) from pg_proc p
        where p.pronamespace = 'ergon_warehouse'::regnamespace
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))
                                                                                                        as api_functions_expect_board_token_check_key_remove_entry_save_entry,
     (select count(*) from pg_proc p where p.pronamespace = 'ergon_warehouse'::regnamespace
        and p.proname ~* '(passcode|gate|throttle)')                                                    as passcode_objects_expect_0,
     (select count(*) from pg_constraint where contype = 'p'
        and conrelid in ('ergon_warehouse.lines'::regclass, 'ergon_warehouse.entries'::regclass))      as primary_keys_exist_expect_2,   -- read-only expectation, not added by the migration
     exists (select 1 from information_schema.columns where table_schema = 'ergon_warehouse'
        and table_name = 'entries' and column_name = 'updated_by' and column_default = '''''::text'
        and is_nullable = 'NO')                                                                        as updated_by_column_expect_true;
   ```
   Expect `true, 2, 2, true, board_token,check_key,remove_entry,save_entry, 0, 2, true`. Re-run `inspect.sql` if anything differs.
5. **Expose the schema to the Data API.** Read the current setting (`GET /v1/projects/{ref}/postgrest`, or Dashboard > Project Settings > API > Exposed schemas), then write it back with `ergon_warehouse` appended
   (`PATCH /v1/projects/{ref}/postgrest` with `db_schema`; never replace the existing list). The supabase-js client then uses `db: { schema: 'ergon_warehouse' }`.
6. **Mint test keys.** Run `node ops/keys.mjs mint --subject "<employee>" --ttl 8h` (no `--db`) on a trusted machine. It prints the plaintext key once and the SQL; Nox executes that SQL through the Management API route as postgres/service_role.
   Keys are secrets: deliver each one only to its person through their agent (opened as `<app url>#key=ergk_...`, URL fragment, never the query string), never commit or log it, and revoke with `node ops/keys.mjs revoke <id>` (prints SQL) when done.
7. **Smoke test with the publishable key (no data written).** `HEAD {url}/rest/v1/lines?select=id` with `apikey`, `Accept-Profile: ergon_warehouse` and `Prefer: count=exact` returns `Content-Range: */<n>` (a count, no rows; the earlier GET read row content);
   `POST {url}/rest/v1/rpc/save_entry` with `Content-Profile: ergon_warehouse` and a bogus `p_key` returns `{"ok":false,"error":"key_invalid"}`; `POST .../rpc/check_key` with a minted key returns `{"ok":true,"subject":...,"expires_at":...}`;
   a POST/PATCH/DELETE on `lines`/`entries` and any call to `mint_access_key`/`revoke_access_key`/`list_access_keys` is refused (401/403/404).
8. **Do not seed the real Ergon project** (the seed refuses anyway) and give the app the project URL and the publishable key only, never the service-role key.
9. **Keep-alive.** Free projects pause after about 7 days without API traffic. Schedule a count-only `HEAD /rest/v1/lines?select=id` with `Prefer: count=exact` (publishable key, `Accept-Profile: ergon_warehouse`) every few days, or upgrade the plan.

## Showcase mechanism
The showcase uses a SECOND free Supabase project, not the real Ergon one. The `ergon_warehouse` schema does not exist there, so the same migration creates it fresh in the live shape (steps 2-5 above, with the same verify query), and
it is seeded with TEST rows only: `node scripts/seed-test.mjs` prints the SQL, to run through the privileged route against that project. The real Ergon project gets NO hosted-apply step for the showcase: nothing of the showcase
(TEST rows, showcase keys, seed) is applied to it.

## What the migration does not guarantee
- Any column other than the contract columns that is NOT NULL without a default makes `save_entry` INSERTs fail with a not-null error (the migration itself still succeeds, rows untouched; tested).
- A column present with an incompatible type, or a missing contract column, aborts the migration before any change (tested for a bigint id).
- A `NOT VALID` status check still blocks any UPDATE of a row whose status is invalid until that value is fixed (only possible if the live table already had a `status` column).
- The migration relies on the hosted constraints being there (keys, FK RESTRICT, CHECKs) and adds none to existing tables. A table without a primary key would not deliver realtime changes (`no primary key`): the pre-flight `has_primary_key` row shows this.
- `save_entry` resolves a `line_code` to the lowest `sort_order` if codes were ever duplicated; deleting a line with entries is refused by the hosted FK (RESTRICT).
- Existing policies on the live tables are not removed; the privilege revoke is what stops any write by `anon`/`authenticated`.
- Rotating or revoking a key takes effect on its next call; there is no push to a browser that already holds it. Keys are bearer secrets: anyone holding the plaintext can use it until it expires or is revoked.
