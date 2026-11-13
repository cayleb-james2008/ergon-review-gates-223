-- Shared helpers for the SQL test files (prepended by run.mjs; not run on its own).
-- Every helper lives in pg_temp, so nothing is left behind in the database.
-- Plaintext test keys exist only in this session (a temp table); the database only ever gets their sha256.
create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $f$
begin
  if c is not true then raise exception 'ASSERT FAILED: %', msg; end if;
end $f$;

-- Run q as role r; returns 'ok' or the SQLSTATE of the error.
create function pg_temp.try_as(r text, q text) returns text language plpgsql as $f$
declare res text;
begin
  execute format('set local role %I', r);
  begin
    execute q;
    res := 'ok';
  exception when others then
    res := sqlstate;
  end;
  reset role;
  return res;
end $f$;

-- Run q (a query returning one jsonb value) as role r.
create function pg_temp.call_as(r text, q text) returns jsonb language plpgsql as $f$
declare res jsonb;
begin
  execute format('set local role %I', r);
  execute q into res;
  reset role;
  return res;
end $f$;

create function pg_temp.save(k text, e jsonb) returns jsonb language sql as $f$
  select pg_temp.call_as('anon', format('select ergon_warehouse.save_entry(%L, %L::jsonb)', k, e));
$f$;
create function pg_temp.remove(k text, id uuid) returns jsonb language sql as $f$
  select pg_temp.call_as('anon', format('select ergon_warehouse.remove_entry(%L, %L::uuid)', k, id));
$f$;
create function pg_temp.check_k(k text) returns jsonb language sql as $f$
  select pg_temp.call_as('anon', format('select ergon_warehouse.check_key(%L)', k));
$f$;

-- A fresh random key in the real format (ergk_ + 43 base64url chars).
create function pg_temp.newkey() returns text language sql as $f$
  select 'ergk_' || translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
$f$;
create function pg_temp.sha(k text) returns text language sql as $f$
  select encode(extensions.digest(k, 'sha256'), 'hex');
$f$;
-- Mint through the real issuer function (as the connected superuser/owner); returns the plaintext key.
create function pg_temp.mint(subject text, secs int default 3600) returns text language plpgsql as $f$
declare k text := pg_temp.newkey();
begin
  perform ergon_warehouse.mint_access_key(pg_temp.sha(k), left(k, 9), subject, now() + make_interval(secs => secs), 'sql-test');
  return k;
end $f$;
-- Direct INSERT (bypasses mint's validation) for states mint refuses: expired keys, other-app keys.
create function pg_temp.raw_key(subject text, expires timestamptz, app text default 'rhl-warehouse-board') returns text language plpgsql as $f$
declare k text := pg_temp.newkey();
begin
  insert into ergon_warehouse.access_keys (key_hash, key_prefix, app, subject, issued_by, created_at, expires_at)
  values (pg_temp.sha(k), left(k, 9), app, subject, 'sql-test', now() - interval '2 days', expires);
  return k;
end $f$;
