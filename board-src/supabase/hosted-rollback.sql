-- ROLLBACK of the hosted apply (docs/HOSTED-APPLY-PACK.md). Two parts, run in this order, each as one transaction (begin ... commit):
--   PART B undoes step 2b (the migration) and keeps entries.updated_by; PART A undoes step 2a (drops entries.updated_by).
-- Between them, and before PART B, send the statements the restore generator printed in step 0 (grants, RLS, replica identity, schema usage, realtime).
-- WHAT A ROLLBACK DESTROYS: values written into the added columns (initials, status, is_test, updated_by) and the minted keys' hashes (access_keys);
-- rows of lines/entries themselves are never touched. Do not roll back once the board is in use without exporting those first.
-- pgcrypto is left installed (it is harmless; the pre-flight says whether the migration had to create it).

-- ===== PART B: undo the migration (step 2b) =====
begin;
drop policy if exists lines_select_all   on ergon_warehouse.lines;
drop policy if exists entries_select_all on ergon_warehouse.entries;
drop function if exists ergon_warehouse.board_token();
drop function if exists ergon_warehouse.list_access_keys();
drop function if exists ergon_warehouse.revoke_access_key(uuid);
drop function if exists ergon_warehouse.mint_access_key(text, text, text, timestamptz, text);
drop function if exists ergon_warehouse.remove_entry(text, uuid);
drop function if exists ergon_warehouse.save_entry(text, jsonb);
drop function if exists ergon_warehouse.check_key(text);
drop function if exists ergon_warehouse._resolve_key(text);
drop table    if exists ergon_warehouse.access_keys;
alter table ergon_warehouse.entries drop constraint if exists entries_status_check;
alter table ergon_warehouse.entries drop column if exists initials, drop column if exists status, drop column if exists is_test;
alter table ergon_warehouse.lines   drop column if exists is_test;
-- then, still in this transaction, paste the step-0 restore statements (grants, RLS, replica identity, schema usage, realtime membership).
commit;

-- ===== PART A: undo step 2a =====
begin;
alter table ergon_warehouse.entries drop column if exists updated_by;
commit;
