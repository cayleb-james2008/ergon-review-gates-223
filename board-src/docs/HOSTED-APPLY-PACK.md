# Hosted apply pack (for Nox to present, one step at a time)

Nothing in this file runs by itself. Nox presents each step, runs it through the Management API route with Nox's own token, and reads the result back. The pack was prepared against the repo at the commit that adds it; the SQL files it names are in `supabase/`.

## Fences (as ruled)

- The real project's `ergon_warehouse` tables (12 real entries) are **metadata and counts only**: no statement here selects a row's content from `lines` or `entries`, and none of the requests below returns one. Counts (`count(*)`, `Prefer: count=exact`) and catalog reads (`pg_catalog`, `information_schema`) are the only reads.
- No destructive statement is run against real data. `drop` appears only in the rollbacks, which run only if Nox decides to undo.
- No credential is in this file. `$TOKEN` (Nox's Management API token) and `$REF` (the project ref) come from Nox's shell. The publishable key and the minted keys are Nox's to supply.
- Nothing is seeded into the real project.

## How requests are sent

Every SQL goes to `POST https://api.supabase.com/v1/projects/$REF/database/query` (body `{"query": "<sql>"}`, success is **HTTP 201**) or, for read-only steps, to the read-only twin `POST .../database/query/read-only` (same body; it runs as `supabase_read_only_user`, so a write is refused by the database, not by our discipline; "all entity references must be schema qualified", which every query below is, and which the suite tests).

```bash
MGMT="https://api.supabase.com/v1/projects/$REF"
rw() { jq -Rs '{query: .}' "$1" | curl -sS -w '\nHTTP %{http_code}\n' -X POST "$MGMT/database/query"           -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @-; }
ro() { jq -Rs '{query: .}' "$1" | curl -sS -w '\nHTTP %{http_code}\n' -X POST "$MGMT/database/query/read-only" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @-; }
```

## At a glance

| # | Step | Route | Writes? | Touches real rows? | Rollback |
|---|---|---|---|---|---|
| 0 | Backup: catalog snapshot, restore statements, counts, current API schema list | read-only + `GET /postgrest` | no | counts only | none needed |
| 1 | Pre-flight: compare the snapshot to the contract | none (reads step 0) | no | no | none needed |
| 2a | Add `entries.updated_by` | `/database/query` | yes (catalog) | no row touched | `hosted-rollback.sql` PART A |
| 2b | Apply the migration (one transaction) | `/database/query` | yes (catalog) | no row touched (one server-side check scan, see 2b) | `hosted-rollback.sql` PART B + step-0 restore statements |
| 3 | Verify | read-only | no | counts only | none needed |
| 4 | Expose the schema to the Data API | `PATCH /postgrest` | yes (API config) | no | `PATCH` the saved value back |
| 5 | Mint test keys | `/database/query` | yes (our own `access_keys`) | no | revoke or delete the key row |
| 6 | Smoke test with the publishable key | REST, `HEAD`/refusals | no | counts only | none needed |
| 7 | No seeding of the real project | read-only check | no | counts only | none needed |
| 8 | Keep-alive | Vercel cron, `HEAD` count | no | counts only | remove the cron |

Order matters: 0, 1, 2a, 2b, 3, 4, 5, 6, 7, 8. Stop at the first surprise and use that step's rollback (or none, for read-only steps).

---

## Step 0. Backup (first, read-only)

Why this shape: the migration never writes, rewrites, updates or deletes a row of `lines` or `entries` (tested byte for byte, including physical identity), so the thing a rollback must restore is the **catalog** (columns, constraints, grants, policies, RLS, replica identity, realtime membership, API schema list), not row data. Row content is not backed up here because the fence forbids reading it and nothing in this pack writes to it. If the owner wants a row-level backup anyway, that is the project's own backup (Dashboard, Database, Backups) and is the owner's call; 0a says what the project has.

```bash
# 0a. what backups the project has (metadata only)
curl -sS "$MGMT/database/backups" -H "Authorization: Bearer $TOKEN" | jq '{pitr_enabled, walg_enabled, backups: (.backups | length)}'
# 0b. the full structure snapshot (catalog only; no row, no count)
ro supabase/inspect.sql                > snapshot-inspect.json
# 0c. the "put it back" statements, generated from the CURRENT grants, RLS flags, replica identity, schema usage and realtime membership
ro supabase/hosted-restore-generator.sql > snapshot-restore.json
# 0d. counts only
cat > counts.sql <<'SQL'
select (select count(*) from ergon_warehouse.lines) as lines, (select count(*) from ergon_warehouse.entries) as entries;
SQL
ro counts.sql                          > snapshot-counts.json
# 0e. the API's exposed schemas. The GET response also contains jwt_secret: take ONLY db_schema, never print or save the whole body.
curl -sS "$MGMT/postgrest" -H "Authorization: Bearer $TOKEN" | jq -r '.db_schema' > snapshot-db_schema.txt
```

Expect: HTTP 201 on 0b to 0d; 0b is a list of `section|item|detail` rows (the `api-exposed-schemas` row is informational); 0c is about 15 statements (`grant ...`, `alter table ... row level security`, `replica identity`, `grant|revoke usage on schema ...`, `alter publication ... drop table ...` for each table that is not in realtime yet); 0d is one row, expected `{"lines": 19?, "entries": 12}` (lines is whatever the project has); 0e is a comma list such as `public,graphql_public`.

Save all five files together (Nox's machine). They are the rollback's input. They contain no row content.

**Order rule (Nox, 2 Nov 19:15, hard):** 0c runs inside step 0, and all five snapshot files are saved and verified (present, non-empty, 0b parses, 0c holds its statement groups) **before 2a runs**. A restore file generated after any change voids the rollback, because it would record the changed grants, not the original ones.

Rollback: none (nothing was written).

## Step 1. Pre-flight (read the step-0 snapshot, plus one read-only all-grantees check)

Go only if `snapshot-inspect.json` matches the contract (`docs/DATA-CONTRACT.md`): `lines` = id uuid, code text, sort_order smallint, created_at timestamptz (all NOT NULL); `entries` = id, line_id uuid, title text, details text (nullable), photo_metadata jsonb NOT NULL, revision bigint, created_at, updated_at timestamptz, tags text[] NOT NULL; RLS on for both; **no policies**; neither table in `supabase_realtime`; the hosted keys, uniques, FK RESTRICT and CHECKs listed; each table row ends `has_primary_key=true`. If a column is missing or has another type, stop: the migration would refuse anyway and change nothing.

Also note in the snapshot: whether `pgcrypto` is installed in `extensions` (the migration creates it there if missing; the rollback leaves it).

**Unknown grantees stop the apply (Nox, 2 Nov 19:15).** The migration revokes every privilege on `lines`, `entries` and `access_keys` from `PUBLIC`, `anon` and `authenticated`, which also removes access any other role was getting through `PUBLIC`. If any grantee other than the table owner, `PUBLIC`, `anon`, `authenticated` or `service_role` holds a privilege on either table, stop and ask before 2a. The inspect output's grant section only lists `PUBLIC`, `anon` and `authenticated`, so it could never show such a grantee; this check lists every grantee in the tables' ACLs:

```bash
ro supabase/hosted-grantee-check.sql > snapshot-grantees.json     # read-only, catalog only
```

Expect HTTP 201 and only rows with `"expected": true` (the owner, `PUBLIC` if it holds anything, `anon`, `authenticated`, and `service_role` if it holds anything, for each of `lines` and `entries`). Any row with `"expected": false` stops the apply: the migration would neither touch nor restore that role's grant. Save `snapshot-grantees.json` with the other snapshot files.

```sql
select c.relname,
       case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
       string_agg(a.privilege_type, ', ' order by a.privilege_type)                          as privileges,
       (a.grantee = 0 or a.grantee = c.relowner
        or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role')) as expected
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
 where n.nspname = 'ergon_warehouse' and c.relname in ('lines', 'entries') and c.relkind = 'r'
 group by c.relname, a.grantee, c.relowner
 order by c.relname, 2;
```

Rollback: none.

## Step 2a. Add `entries.updated_by` (smallest change first)

```bash
cat > step2a.sql <<'SQL'
begin;
alter table ergon_warehouse.entries add column if not exists updated_by text not null default '';
commit;
SQL
rw step2a.sql
```

**Step 2a is also the probe of the endpoint's response shape (Nox, 2 Nov 19:15).** If its response is not the expected success shape (HTTP 201, body `[]`), stop before 2b and report the actual response. A different body with no error would still be a success of the statement, but nothing has seen this endpoint's live answer for DDL yet, so the first call is treated as the probe.

Expect HTTP 201, body `[]`. A constant default is stored in the catalog: no table rewrite, no row touched, existing rows read `''`. Check (read-only): `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'ergon_warehouse' and table_name = 'entries' and column_name = 'updated_by';` returns `updated_by | text | NO | ''::text`.

Rollback (PART A of `supabase/hosted-rollback.sql`): `begin; alter table ergon_warehouse.entries drop column if exists updated_by; commit;`. This drops only the new column and what was recorded in it since; do not roll back once the board is in use.

## Step 2b. Apply the migration (one transaction)

```bash
( echo 'begin;'; cat supabase/migrations/20261102090000_ergon_warehouse.sql; echo 'commit;' ) > step2b.sql
rw step2b.sql
```

Expect HTTP 201, body `[]`; success is no error. It is idempotent and non-destructive (the suite proves, on a database shaped like the hosted one, that the rows, their physical identity and the table files are unchanged, and that a second apply changes nothing). It adds: the additive columns (`lines.is_test`; `entries.initials`, `status`, `is_test`, with constant defaults), one `NOT VALID`, never validated `entries_status_check`, the private `access_keys` table, the key-gated functions, RLS and `SELECT`-only grants and two policies, `REPLICA IDENTITY FULL`, and realtime membership. It also revokes the wide grants the live tables carry today (that is why step 0c saved them).

No validation scan runs against existing rows (Nox ruling, 2 Nov 18:49). The `entries_status_check` constraint is added `NOT VALID` and is never validated: it is enforced on every new insert and every update, and the migration reads no row of `entries` at all. The `status` column is created by this same migration with the constant default `'open'`, so there was nothing for a retroactive scan to find. The suite measures this: the `entries` table's own scan counters (`seq_scan`, `seq_tup_read`, `idx_scan`, `idx_tup_fetch`) are identical before and after the apply.

Rollback: send `supabase/hosted-rollback.sql` PART B with the step-0c restore statements pasted where the file says so (grants, RLS flags, replica identity, schema usage, realtime membership), as one transaction, then PART A if `updated_by` is to go too. The suite proves this: on a hosted-shaped database, apply then rollback gives a byte-identical `inspect.sql` output and an identical row fingerprint, and the migration can be applied again afterwards.
What it destroys: values written into `initials`, `status`, `is_test`, `updated_by` since the apply, and minted key hashes. Never a `lines` or `entries` row. `pgcrypto` stays installed.

## Step 3. Verify (read-only)

Send the verify query printed in `docs/DATA-LAYER.md` step 4 through `ro`, then these two additions, then the counts again:

```sql
select (select convalidated from pg_catalog.pg_constraint where conname = 'entries_status_check'
          and conrelid = 'ergon_warehouse.entries'::regclass) as status_check_validated_expect_false;
select (select count(*) from ergon_warehouse.lines) as lines, (select count(*) from ergon_warehouse.entries) as entries;
```

Expect HTTP 201 and `true, 2, 2, true, "board_token,check_key,remove_entry,save_entry", 0, 2, true` for the first (as a JSON object with those columns), `false` for the second (the status check is `NOT VALID` by design, see step 2b), and the third **equal to `snapshot-counts.json`** (an apply that changed a count would be a stop).

Rollback: none.

## Step 4. Expose the schema to the Data API

**Precondition: the owner's decision to cut over (adopted, Nox 2 Nov).** This step is the real-data cutover for reading, not plumbing. The migration's policies are `for select to anon, authenticated using (true)`, so once `ergon_warehouse` is in `db_schema`, anyone holding the project URL and the publishable key (which ships in the front-end bundle) can read every column of every real entry. Do not run it until the owner has decided cutover and that decision is on record. *Record: decided by the owner at 21:38 ET, 2 Nov; executed by Nox.*

```bash
CUR=$(cat snapshot-db_schema.txt)                         # step 0e, e.g. public,graphql_public
case ",$CUR," in *,ergon_warehouse,*) echo "already exposed: nothing to do";; *)
  NEW="$CUR,ergon_warehouse"
  # settings other than db_schema must come out unchanged: snapshot them first, WITHOUT jwt_secret
  curl -sS "$MGMT/postgrest" -H "Authorization: Bearer $TOKEN" | jq -S 'del(.jwt_secret)' > postgrest-before.json
  curl -sS -w '\nHTTP %{http_code}\n' -X PATCH "$MGMT/postgrest" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
       -d "$(jq -n --arg s "$NEW" '{db_schema: $s}')"       # ONLY db_schema is sent
  curl -sS "$MGMT/postgrest" -H "Authorization: Bearer $TOKEN" | jq -S 'del(.jwt_secret)' > postgrest-after.json
  diff postgrest-before.json postgrest-after.json           # expect exactly one changed line: db_schema
esac
```

Expect HTTP 200 with a JSON body of the updated settings (`db_schema`, `max_rows`, `db_extra_search_path`, `db_pool` and the pool timeouts; this response does not carry `jwt_secret`); the `diff` shows `db_schema` changing from the old list to the old list plus `,ergon_warehouse`, and nothing else. If the REST API still answers `PGRST106`/`404` for the schema a moment later, reload the schema cache with `select pg_notify('pgrst', 'reload schema');` through `rw`.

Rollback: send the saved list back, `PATCH` with `{"db_schema": "<contents of snapshot-db_schema.txt>"}`, then diff the settings again.

**How this call was verified (and what was not).**
- Verified against the published, versioned OpenAPI document of the Management API (`https://api.supabase.com/api/v1-json`, "Supabase API (v1) 1.0.0", fetched while preparing this pack, no credential used): `PATCH /v1/projects/{ref}/postgrest` (operation `v1-update-postgrest-service-config`) exists; security is a bearer token; the JSON body fields are all optional: `db_schema` (string), `db_extra_search_path` (string), `max_rows` (integer 0 to 1,000,000), `db_pool` (0 to 1000), `db_pool_acquisition_timeout` (0 to 60), `db_pool_max_lifetime` (0 to 3600), `db_pool_max_idletime` (0 to 60); the 200 response carries the same fields. `GET` on the same path returns those fields **plus `jwt_secret`**, which is why every `GET` above is piped through `jq` to take only `db_schema` or to `del(.jwt_secret)`.
- `db_schema` is a single string, so the list is read, appended to and written back whole (appending, never replacing, as the earlier note said); the string form is the PostgREST `db-schemas` setting, comma separated.
- Verified for the read-only twin the same way: `POST .../database/query/read-only` and `.../database/query` take `{query, parameters?}` (the write route also accepts `read_only`) and answer 201.
- Verified locally: every read-only query in this pack runs as `supabase_read_only_user` with an empty `search_path` (the suite's test `(i)`).
- An unauthenticated probe of the live host with a dummy project ref answered HTTP 401 "No access token provided" for these routes **and for a made-up path**, so it shows only that the host is live and wants a token; it is not evidence that the route exists. The Supabase CLI I have installed carries the `db_schema` field name, which is consistent with the spec but is not a wire capture.
- **Not verified (needs the live call, by Nox):** that omitting the other fields leaves them unchanged (the spec marks them optional and says nothing about omitted fields; the before/after `diff` above is the check), the exact current `db_schema` value of the real project, and whether PostgREST restarts or just reloads on the change.

## Step 5. Mint keys: real keys for a named employee, one at a time

On this project a valid key can call `save_entry` and `remove_entry`, which write and delete real entries, so these are production keys, not test keys. Mint for a named employee, one at a time, with the shortest lifetime that does the job. (Before the cutover the key path was proven without exposing anything: see "Interim key proof" below.)

**Lesson (Nox, 2 Nov): the plaintext key exists exactly once.** `ops/keys.mjs mint` prints it once and nothing stores it. A script that mints and then dies before it uses the key leaves an orphan nobody can ever present, which must be revoked untested (this happened once during the cutover: a REST timeout killed the runner after the mint). Any automated mint must capture the plaintext inside the same process that uses it, or the key is born dead.

On a trusted machine: `node ops/keys.mjs mint --subject "<employee>" --ttl 8h` (no `--db`). It prints the plaintext key once, to Nox's terminal only, and the SQL, which contains the key's sha256 and no plaintext. Nox runs that SQL with `rw`. Expect HTTP 201 and one row: the new key's uuid.

The key is invisible plumbing for the employee: it goes only to that person's agent, which opens the board as `<app url>#key=ergk_...` (URL fragment, never the query string). Never commit, paste or log it. Nothing on the board's screen mentions it.

Rollback: `node ops/keys.mjs revoke <id>` prints the SQL (sets `revoked_at`); or `delete from ergon_warehouse.access_keys where id = '<id>';` (our own private table; not real data).

## Step 6. Smoke test with the publishable key (no data written, counts only)

```bash
URL="https://$REF.supabase.co"   # and PK = the project's publishable key, from Nox
# counts only: HEAD with Prefer: count=exact returns a Content-Range header and no body
curl -sS -I -X HEAD "$URL/rest/v1/lines?select=id"   -H "apikey: $PK" -H "Accept-Profile: ergon_warehouse" -H "Prefer: count=exact" | grep -i -E '^HTTP|content-range'
curl -sS -I -X HEAD "$URL/rest/v1/entries?select=id" -H "apikey: $PK" -H "Accept-Profile: ergon_warehouse" -H "Prefer: count=exact" | grep -i -E '^HTTP|content-range'
# a wrong key is refused and writes nothing
curl -sS -X POST "$URL/rest/v1/rpc/save_entry" -H "apikey: $PK" -H "Content-Profile: ergon_warehouse" -H 'Content-Type: application/json' -d '{"p_key":"ergk_bogus","p_entry":{"title":"x"}}'
# a minted key is recognised (reads our own access_keys metadata only)
curl -sS -X POST "$URL/rest/v1/rpc/check_key" -H "apikey: $PK" -H "Content-Profile: ergon_warehouse" -H 'Content-Type: application/json' -d "{\"p_key\":\"$MINTED\"}"
# writes and the issuer functions are refused for the publishable key (expect 401/403/404, nothing created)
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$URL/rest/v1/lines"   -H "apikey: $PK" -H "Content-Profile: ergon_warehouse" -H 'Content-Type: application/json' -d '{}'
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$URL/rest/v1/rpc/mint_access_key" -H "apikey: $PK" -H "Content-Profile: ergon_warehouse" -H 'Content-Type: application/json' -d '{}'   # weak: see the note below
# the issuer grant, tested properly (optional, Nox runs it): the RIGHT signature with an INVALID hash. The function validates the hash before any insert, so this cannot write whatever the grant is.
# Expect HTTP 401 with code 42501 "permission denied for function mint_access_key". HTTP 400 with code P0001 ("key hash must be 64 lowercase hex characters") would mean anon CAN execute it: a defect, stop.
curl -sS -w '\n%{http_code}\n' -X POST "$URL/rest/v1/rpc/mint_access_key" -H "apikey: $PK" -H "Content-Profile: ergon_warehouse" -H 'Content-Type: application/json' -d '{"p_key_hash":"not-a-hash","p_key_prefix":"ergk_AAAA","p_subject":"probe","p_expires_at":"2099-01-01T00:00:00Z","p_issued_by":""}'
```

Expect: both `HEAD`s `HTTP 200` with `Content-Range: <first>-<last>/<n>` whose total `<n>` equals `snapshot-counts.json` (observed at the cutover and by the L5 checker: `0-18/19` for lines and `0-11/12` for entries; the `*/<n>` form appears only for an empty result) (this replaces the earlier "GET lines A..S", which read row content); the bogus call `{"ok":false,"error":"key_invalid"}`; `check_key` `{"ok":true,"subject":"<employee>","expires_at":"..."}`; both refusals 401, 403 or 404. If the HEADs return `PGRST106`, step 4 has not taken effect yet (see its reload note). Observed at the cutover: the first `HEAD` after the schema change timed out at 30 s while PostgREST warmed up and the retry answered at once, so a timeout right after step 4 means wait and retry before concluding anything.

Note (L5 checker, 3 Nov): the `POST {}` above answers 404 `PGRST202` because no function matches an empty signature, which says nothing about the grant; only the right-signature probe tests it. On a local stack the probe answers 401 `42501` as shipped and, with `execute` temporarily granted to `anon`, 400 `P0001` with no row inserted. I was not allowed to run it against the real project (the permission classifier refused a call to a write function there), so it was Nox's to run, and he did on 3 Nov: HTTP 401, code 42501 "permission denied for function mint_access_key" on the real project, i.e. the issuer grant is not exposed to anon (verified-denied). Nox then called `revoke_access_key` on the real project with the publishable anon key and the nil UUID (matches no row, cannot write): HTTP 401, code 42501, "permission denied for function revoke_access_key". So all three key-management functions (`mint_access_key`, `list_access_keys`, `revoke_access_key`) are verified-denied to anon on the real project; the checker's `GET list_access_keys` answered 42501, which shows that function is not executable by anon.

Optional, Nox's call: `POST .../rpc/board_token` returns `{l,f,e,u,r,i}`: the line count, a hash of the lines' ids and codes, the entry count, the newest `updated_at`, the sum of revisions and a hash sum of ids. These are aggregates, not row content, but `u` is a real timestamp; leave it out if the fence is read strictly.

Rollback: none (nothing was written). Revoke the minted key from step 5 if it was only for the test.

## Step 7. No seeding of the real project

No request. `scripts/seed-test.mjs` refuses on any non-test row, and nothing of the showcase (TEST rows, showcase keys) belongs here: the showcase is a second project. Check, read-only, that nothing test-shaped is in the real tables: `select (select count(*) from ergon_warehouse.lines where is_test) as test_lines, (select count(*) from ergon_warehouse.entries where is_test) as test_entries;` expects `0, 0`. Give the app the project URL and the publishable key only, never the service-role key.

Rollback: none.

## Step 8. Keep-alive

**Preconditions (adopted, Nox 2 Nov).** (1) Plan check, still OPEN: no plan or subscription field is visible on the project through the Management API surfaces available (the project list and the project object), so the plan has to be read from the Dashboard billing page. A paid project does not pause and this step is then unnecessary. (2) Vercel environment: the cron needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the real project's URL and publishable key, never the service-role key) set in the Vercel project, which is the deployed app pointing at real data. Both ride with the L4 deploy and its operations document, not before it.

`api/keepalive.js` (the daily Vercel cron in `vercel.json`) now sends the same count-only `HEAD` as step 6 (`Prefer: count=exact`) and returns only a status; before this pack it read one line id. A free project pauses after about 7 idle days; the daily call prevents that. The long-term owned form of this (an owned scheduler, or a paid plan) is the owner's call.

Rollback: remove the cron entry from `vercel.json`.


## Interim key proof (run before the cutover, Nox, 2 Nov)

The key path was proven with nothing exposed and no real row read or written, through the **write** SQL route (`rw`). Correction to this pack's earlier suggestion: `check_key` through the **read-only** SQL route is permission-denied by design (error 42501): execute on the key functions is granted to `anon` and `authenticated` only, `PUBLIC` is revoked, and the read-only role is neither. So `check_key` has to go through `rw` (it still writes nothing to real data). Result: mint (via `ops/keys.mjs`, SQL run by Nox), `check_key` returned `ok: true` with the proof subject and expiry, revoke, then `check_key` returned `key_invalid`. Two proof keys exist (the first one's plaintext was lost with its runner before its check, so it was revoked untested); `access_keys` held exactly two rows, both subject `nox-interim-proof`, both revoked.

## Execution record (Nox, via the Management API; branch `transport/hosted-apply-20261102`, tip `135d206`, migration sha256 `990fa67981e10fbdae1f8cf5354e4f32a126afbaab800f3fd29dd2cec4374392` verified before anything ran; the branch has since been deleted)

- Step 0: PITR off, WAL-G on, 0 listed backups; inspect 38 rows; restore generator 11 statements (no table-grant statements); counts lines 19 / entries 12; `db_schema` `public,graphql_public`.
- Step 1: GO. The all-grantees check was clear: the only grantee on either table was the owner `postgres`, so the migration's revokes were no-ops.
- Steps 2a and 2b: HTTP 201, body `[]` (the response shape is now observed, not assumed). Counts unchanged; designed defaults present; `entries_status_check` `convalidated = false` as designed.
- Step 3 and step 7's check: exact match on every expectation; `is_test` counts 0 / 0.
- Step 4 (owner's cutover decision, 21:38 ET): `db_schema` changed to `public,graphql_public,ergon_warehouse`; the before/after settings diff showed `db_schema` as the only changed field (the PATCH with only `db_schema` leaves the other settings unchanged: observed, no longer an open point).
- Step 5: one orphaned key (revoked untested) and one smoke key (full cycle); all keys revoked. `access_keys` final state: 4 rows, all revoked (2 `nox-interim-proof`, 2 under the owner's name). No live key outstanding; the owner's working key is minted at the L4 deploy through the app flow.
- Step 6: all pass through the real REST path with the publishable key: `HEAD` lines 200, total 19; `HEAD` entries 200, total 12; bogus key `key_invalid`; a minted key's `check_key` `ok: true`; `POST /lines` refused 401; `POST rpc/mint_access_key` refused 404 (not exposed to anon). Counts after: 19 / 12, nothing written. The optional `board_token` call was left out, as ruled.
- Step 8: open, with the L4 deploy (plan check and Vercel environment, see its preconditions).

---

## What this pack did not do

- I did not run anything against any hosted project: every test here ran on a local Supabase stack whose tables were shaped like the hosted ones. The hosted apply itself was Nox's, recorded in the execution record above.
- It cannot see the real project's current grants, policies or exposed-schema list; step 0 captures them first, and the rollback is generated from what it finds.
- The Management API's `/database/query` routes are marked experimental or beta in the published spec; a change there would show up as a non-201 answer at step 0.
