-- (a) RLS on every table; (b) anon/authenticated are read-only on lines/entries, have no access to
-- access_keys, and cannot execute the issuer functions. Also: no passcode object exists anywhere.
select pg_temp.ok(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ergon_warehouse' and c.relkind in ('r','p')) = 3,
  'expected exactly the three tables lines, entries, access_keys');
select pg_temp.ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ergon_warehouse' and c.relkind in ('r','p') and not c.relrowsecurity),
  'every table in ergon_warehouse must have relrowsecurity = true');

do $$
declare r text; q text; res text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    -- allowed
    foreach q in array array[
      'select count(*) from ergon_warehouse.lines',
      'select count(*) from ergon_warehouse.entries',
      'select ergon_warehouse.check_key(null)',
      'select ergon_warehouse.save_entry(null, ''{}'')',
      'select ergon_warehouse.remove_entry(null, null)',
      'select ergon_warehouse.board_token()'
    ] loop
      res := pg_temp.try_as(r, q);
      if res <> 'ok' then raise exception 'ASSERT FAILED: % should be allowed for %, got %', q, r, res; end if;
    end loop;
    -- denied (insufficient_privilege)
    foreach q in array array[
      'insert into ergon_warehouse.lines (id, code, sort_order, created_at) values (gen_random_uuid(), ''ZZ'', 1, now())',
      'update ergon_warehouse.lines set code = code',
      'delete from ergon_warehouse.lines',
      'insert into ergon_warehouse.entries (id, line_id, title, photo_metadata, revision, created_at, updated_at, tags) select gen_random_uuid(), id, ''x'', ''[]'', 1, now(), now(), ''{}'' from ergon_warehouse.lines',
      'update ergon_warehouse.entries set title = title',
      'delete from ergon_warehouse.entries',
      'select * from ergon_warehouse.access_keys',
      'select key_hash from ergon_warehouse.access_keys',
      'insert into ergon_warehouse.access_keys (key_hash, key_prefix, subject, expires_at) values (repeat(''a'', 64), ''ergk_aaaa'', ''x'', now() + interval ''1 day'')',
      'update ergon_warehouse.access_keys set revoked_at = null',
      'delete from ergon_warehouse.access_keys',
      'select ergon_warehouse.mint_access_key(repeat(''a'', 64), ''ergk_aaaa'', ''x'', now() + interval ''1 day'', '''')',
      'select ergon_warehouse.revoke_access_key(gen_random_uuid())',
      'select * from ergon_warehouse.list_access_keys()',
      'select * from ergon_warehouse._resolve_key(''x'')'
    ] loop
      res := pg_temp.try_as(r, q);
      if res <> '42501' then raise exception 'ASSERT FAILED: % must be denied for % (42501), got %', q, r, res; end if;
    end loop;
  end loop;
end $$;

-- Only SELECT is granted on lines/entries, nothing on access_keys.
select pg_temp.ok(
  not exists (
    select 1 from (values ('anon'), ('authenticated')) ro(r),
                  (values ('lines'), ('entries'), ('access_keys')) t(n)
    where has_table_privilege(ro.r, 'ergon_warehouse.' || t.n, 'insert,update,delete,truncate,references,trigger')
       or (t.n = 'access_keys' and has_table_privilege(ro.r, 'ergon_warehouse.' || t.n, 'select'))
       or (t.n in ('lines', 'entries') and not has_table_privilege(ro.r, 'ergon_warehouse.' || t.n, 'select'))),
  'privilege matrix for anon/authenticated');
select pg_temp.ok(
  (select count(*) from pg_policies where schemaname = 'ergon_warehouse'
     and tablename in ('lines','entries') and cmd = 'SELECT' and qual = 'true'
     and roles @> array['anon','authenticated']::name[]) = 2,
  'SELECT policy using (true) for anon+authenticated on lines and entries');
select pg_temp.ok(
  not exists (select 1 from pg_policies where schemaname = 'ergon_warehouse' and tablename = 'access_keys'),
  'access_keys has no policies');
-- PUBLIC executes nothing; API roles execute exactly check_key / save_entry / remove_entry.
select pg_temp.ok(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'ergon_warehouse' and has_function_privilege('public', p.oid, 'execute')),
  'PUBLIC has no EXECUTE on schema functions');
select pg_temp.ok(
  (select string_agg(distinct p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ergon_warehouse' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))
  = 'board_token,check_key,remove_entry,save_entry',
  'API roles can execute exactly board_token, check_key, save_entry, remove_entry');
select pg_temp.ok(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ergon_warehouse' and p.proname in ('mint_access_key', 'revoke_access_key', 'list_access_keys')
      and p.prosecdef and has_function_privilege('service_role', p.oid, 'execute')) = 3,
  'issuer functions are executable by service_role');
-- no passcode machinery anywhere in the application schemas
select pg_temp.ok(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('ergon_warehouse', 'public') and p.proname ~* '(passcode|edit_gate|gate_failures|throttle|_check_gate)'),
  'no passcode/gate function exists');
select pg_temp.ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname in ('ergon_warehouse', 'public') and c.relname ~* '(passcode|edit_gate|gate_failures)'),
  'no passcode/gate relation exists');
select pg_temp.ok(
  not exists (select 1 from information_schema.columns
              where table_schema in ('ergon_warehouse', 'public') and column_name ~* '(passcode|edit_gate|gate_failure)'),
  'no passcode column exists');
