-- Issuer functions (run as the connected owner): mint validation, hash-only storage, revoke, list.
create temp table k as select pg_temp.newkey() as key;
select pg_temp.ok(length((select key from k)) = 48 and (select key from k) ~ '^ergk_[A-Za-z0-9_-]{43}$', 'test key has the contract format (48 chars)');

-- bad input is refused with a clear error (the issuer functions may raise)
create function pg_temp.raises(q text) returns text language plpgsql as $f$
begin execute q; return 'no error'; exception when others then return sqlerrm; end $f$;
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, ''TEST x'', now() + interval ''1 hour'')', 'nothex', 'ergk_abcd')) ~ 'hash', 'bad hash refused');
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, ''TEST x'', now() + interval ''1 hour'')', upper(pg_temp.sha('a')), 'ergk_abcd')) ~ 'hash', 'upper-case hex refused');
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, ''TEST x'', now() + interval ''1 hour'')', repeat('a', 63), 'ergk_abcd')) ~ 'hash', '63-char hash refused');
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, ''TEST x'', now() + interval ''1 hour'')', pg_temp.sha('b'), 'short')) ~ 'prefix', 'wrong prefix length refused');
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, ''TEST x'', now() - interval ''1 minute'')', pg_temp.sha('c'), 'ergk_abcd')) ~ 'future', 'past expiry refused');
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, ''TEST x'', null)', pg_temp.sha('c'), 'ergk_abcd')) ~ 'future', 'null expiry refused');
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, ''TEST x'', now() + interval ''30 days 1 minute'')', pg_temp.sha('d'), 'ergk_abcd')) ~ '30 days', 'expiry beyond 30 days refused');
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, '''', now() + interval ''1 hour'')', pg_temp.sha('e'), 'ergk_abcd')) ~ 'subject', 'empty subject refused');
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, ''   '', now() + interval ''1 hour'')', pg_temp.sha('e'), 'ergk_abcd')) ~ 'subject', 'blank subject refused');
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, %L, now() + interval ''1 hour'')', pg_temp.sha('f'), 'ergk_abcd', 'TEST ' || repeat('s', 76))) ~ 'subject', '81-char subject refused');
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, %L, now() + interval ''1 hour'')', pg_temp.sha('g'), 'ergk_abcd', 'TEST ' || repeat('s', 75))) = 'no error', '80-char subject accepted');
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, ''TEST edge'', now() + interval ''29 days 23 hours'')', pg_temp.sha('h'), 'ergk_abcd')) = 'no error', 'just under 30 days accepted');
select pg_temp.ok(pg_temp.raises(format('select ergon_warehouse.mint_access_key(%L, %L, ''TEST dup'', now() + interval ''1 hour'')', pg_temp.sha('h'), 'ergk_abcd')) ~ 'unique|duplicate', 'duplicate hash refused');
select pg_temp.ok((select count(*) from ergon_warehouse.access_keys where subject = 'TEST x') = 0, 'refused mints stored nothing');

-- only the hash is stored
select ergon_warehouse.mint_access_key(pg_temp.sha((select key from k)), left((select key from k), 9), 'TEST Hash', now() + interval '2 hours', 'sql-test');
select pg_temp.ok((select count(*) from ergon_warehouse.access_keys k2 where to_jsonb(k2)::text like '%' || (select key from k) || '%') = 0, 'no column holds the plaintext key');
select pg_temp.ok((select count(*) from ergon_warehouse.access_keys k2 where to_jsonb(k2)::text like '%' || substr((select key from k), 6) || '%') = 0, 'no column holds the key body');
select pg_temp.ok((select key_hash = pg_temp.sha((select key from k)) and char_length(key_prefix) = 9 and key_prefix = left((select key from k), 9)
                   from ergon_warehouse.access_keys where subject = 'TEST Hash'), 'stored: sha256 hex of the full key, 9-char prefix');
select pg_temp.ok((select (app, issued_by, revoked_at is null, last_used_at is null) = ('rhl-warehouse-board', 'sql-test', true, true)
                   from ergon_warehouse.access_keys where subject = 'TEST Hash'), 'defaults: app, issued_by, not revoked, never used');
select pg_temp.ok((select expires_at > now() + interval '1 hour 59 minutes' and expires_at < now() + interval '2 hours 1 minute' from ergon_warehouse.access_keys where subject = 'TEST Hash'), 'expiry stored');

-- revoke / list
select pg_temp.ok(ergon_warehouse.revoke_access_key((select id from ergon_warehouse.access_keys where subject = 'TEST Hash')), 'revoke returns true');
create temp table r1 as select revoked_at from ergon_warehouse.access_keys where subject = 'TEST Hash';
select pg_temp.ok(ergon_warehouse.revoke_access_key((select id from ergon_warehouse.access_keys where subject = 'TEST Hash')), 'revoke is idempotent (true again)');
select pg_temp.ok((select revoked_at from ergon_warehouse.access_keys where subject = 'TEST Hash') = (select revoked_at from r1), 'second revoke keeps the first revoked_at');
select pg_temp.ok(ergon_warehouse.revoke_access_key(gen_random_uuid()) = false, 'revoke of an unknown id returns false');
select pg_temp.ok((select count(*) from ergon_warehouse.list_access_keys() where subject = 'TEST Hash' and revoked_at is not null and key_prefix = left((select key from k), 9)) = 1, 'list shows the key, revoked, with its prefix');
select pg_temp.ok(not exists (select 1 from pg_proc p, unnest(p.proargnames) n
                              where p.proname = 'list_access_keys' and p.pronamespace = 'ergon_warehouse'::regnamespace and n ~* 'hash'), 'list_access_keys never exposes the hash');
select pg_temp.ok((select string_agg(n, ',') from pg_proc p, unnest(p.proargnames) n where p.proname = 'list_access_keys' and p.pronamespace = 'ergon_warehouse'::regnamespace)
                  = 'id,key_prefix,subject,issued_by,created_at,expires_at,revoked_at,last_used_at', 'list_access_keys columns');
delete from ergon_warehouse.access_keys where subject like 'TEST %';
