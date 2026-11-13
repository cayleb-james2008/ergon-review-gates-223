-- board_token(): the cheap change probe. Called as role anon (it is SECURITY INVOKER: RLS applies).
-- Uses the seeded TEST line E and the seeded empty TEST line S (the runner seeds before this file).
create temp table ta as select id from ergon_warehouse.lines where code = 'E' and is_test;
select pg_temp.ok((select count(*) from ta) = 1, 'seeded TEST line E must exist (run via run.mjs)');
select pg_temp.ok((select count(*) from ergon_warehouse.entries where line_id = (select id from ta)) = 0, 'line E must start empty');
create temp table k as select pg_temp.mint('TEST Tok') as key;
create function pg_temp.tok() returns jsonb language sql as $f$ select pg_temp.call_as('anon', 'select ergon_warehouse.board_token()') $f$;
create temp table tok (n int, t jsonb);

-- shape, size, stability, visibility
insert into tok select 0, pg_temp.tok();
insert into tok select 1, pg_temp.tok();
select pg_temp.ok((select t from tok where n = 0) = (select t from tok where n = 1), 'token is stable when nothing changed');
select pg_temp.ok((select array_agg(k order by k) from jsonb_object_keys((select t from tok where n = 0)) k) = array['e','f','i','l','r','u'], 'token keys l, f, e, u, r, i');
select pg_temp.ok(length((select t::text from tok where n = 0)) < 200, 'token is tiny (< 200 bytes)');
select pg_temp.ok((select t->>'l' from tok where n = 0) = (select count(*)::text from ergon_warehouse.lines), 'l = number of lines');
select pg_temp.ok(pg_temp.tok() = ergon_warehouse.board_token(), 'anon sees the same token as the owner (policy using (true))');
select pg_temp.ok(pg_temp.call_as('authenticated', 'select ergon_warehouse.board_token()') = ergon_warehouse.board_token(), 'authenticated sees the same token');
select pg_temp.ok(pg_temp.try_as('anon', 'select ergon_warehouse.board_token()') = 'ok' and pg_temp.try_as('authenticated', 'select ergon_warehouse.board_token()') = 'ok', 'anon and authenticated can execute it');
select pg_temp.ok(not has_function_privilege('public', 'ergon_warehouse.board_token()', 'execute'), 'EXECUTE is revoked from PUBLIC');
select pg_temp.ok(not (select prosecdef from pg_proc where oid = 'ergon_warehouse.board_token()'::regprocedure) and (select provolatile = 's' from pg_proc where oid = 'ergon_warehouse.board_token()'::regprocedure)
                  and (select array_to_string(proconfig, ',') from pg_proc where oid = 'ergon_warehouse.board_token()'::regprocedure) = 'search_path=""', 'security invoker, stable, empty search_path');

-- insert: e + 1, r + 1, u set, i changes
select pg_temp.ok(pg_temp.save((select key from k), '{"id":"d0000000-0000-4000-8000-000000000001","line_code":"E","title":"TEST tok one"}')->>'ok' = 'true', 'insert');
insert into tok select 2, pg_temp.tok();
select pg_temp.ok((select (b.t->>'e')::int = (a.t->>'e')::int + 1 and (b.t->>'r')::int = (a.t->>'r')::int + 1 and b.t->>'u' is distinct from a.t->>'u' and b.t->>'i' <> a.t->>'i' and b.t <> a.t
                   from tok a, tok b where a.n = 1 and b.n = 2), 'insert: e+1, r+1, u and i change');

-- update (revision bump): r + 1 and u change, e unchanged
select pg_temp.ok(pg_temp.save((select key from k), '{"id":"d0000000-0000-4000-8000-000000000001","title":"TEST tok two","expected_revision":1}')->'entry'->>'revision' = '2', 'update');
insert into tok select 3, pg_temp.tok();
select pg_temp.ok((select (b.t->>'e') = (a.t->>'e') and (b.t->>'r')::int = (a.t->>'r')::int + 1 and b.t->>'u' > a.t->>'u' and b.t <> a.t
                   from tok a, tok b where a.n = 2 and b.n = 3), 'update: r+1, u moves forward, e unchanged');

-- refused writes (bad key, conflict, invalid) leave the token untouched
select pg_temp.save('ergk_nope', '{"id":"d0000000-0000-4000-8000-000000000001","title":"TEST nope"}');
select pg_temp.save((select key from k), '{"id":"d0000000-0000-4000-8000-000000000001","title":"TEST stale","expected_revision":1}');
select pg_temp.save((select key from k), '{"id":"d0000000-0000-4000-8000-000000000001","status":"bogus"}');
select pg_temp.save((select key from k), '{"id":"d0000000-0000-4000-8000-0000000000aa","title":"TEST ghost","expected_revision":1}');
select pg_temp.ok(pg_temp.tok() = (select t from tok where n = 3), 'refused writes do not change the token');

-- delete: e - 1
select pg_temp.ok(pg_temp.remove((select key from k), 'd0000000-0000-4000-8000-000000000001')->>'ok' = 'true', 'delete');
insert into tok select 4, pg_temp.tok();
select pg_temp.ok((select (b.t->>'e')::int = (a.t->>'e')::int - 1 and (b.t->>'r')::int = (a.t->>'r')::int - 2 and b.t <> a.t from tok a, tok b where a.n = 3 and b.n = 4), 'delete: e-1, r down by the row''s revision');
select pg_temp.ok((select t from tok where n = 4) = (select t from tok where n = 0), 'back to the first token once the board is back to its first state');

-- a delete plus an insert in the same instant (one transaction): e, u and r stay equal, the id hash still moves the token
do $$
declare a jsonb; b jsonb; kk text := (select key from k);
begin
  perform ergon_warehouse.save_entry(kk, '{"id":"d0000000-0000-4000-8000-000000000011","line_code":"E","title":"TEST same instant 1"}');
  a := ergon_warehouse.board_token();
  perform ergon_warehouse.remove_entry(kk, 'd0000000-0000-4000-8000-000000000011');
  perform ergon_warehouse.save_entry(kk, '{"id":"d0000000-0000-4000-8000-000000000012","line_code":"E","title":"TEST same instant 2"}');
  b := ergon_warehouse.board_token();
  if a->>'e' <> b->>'e' or a->>'r' <> b->>'r' or a->>'u' <> b->>'u' then
    raise exception 'ASSERT FAILED: scenario precondition (e, r, u identical) not met: % vs %', a, b;
  end if;
  if a = b then raise exception 'ASSERT FAILED: delete + insert in the same instant did not change the token (%)', a; end if;
end $$;
delete from ergon_warehouse.entries where id = 'd0000000-0000-4000-8000-000000000012';

-- line change: removing / re-adding a line moves l and the token
insert into tok select 5, pg_temp.tok();
delete from ergon_warehouse.lines where code = 'S' and is_test and not exists (select 1 from ergon_warehouse.entries e where e.line_id = lines.id);
insert into tok select 6, pg_temp.tok();
select pg_temp.ok((select (b.t->>'l')::int = (a.t->>'l')::int - 1 and b.t <> a.t from tok a, tok b where a.n = 5 and b.n = 6), 'removing a line changes l and the token');
insert into ergon_warehouse.lines (id, code, sort_order, created_at, is_test) values (gen_random_uuid(), 'S', 19, now(), true);
-- same count, new id: delete and re-create one unused test line; the count marker l stays, the fingerprint f moves
insert into tok select 7, pg_temp.tok();
delete from ergon_warehouse.lines where code = 'S' and is_test and not exists (select 1 from ergon_warehouse.entries e where e.line_id = lines.id);
insert into ergon_warehouse.lines (id, code, sort_order, created_at, is_test) values (gen_random_uuid(), 'S', 19, now(), true);
select pg_temp.ok((select b.t->>'l' = a.t->>'l' and b.t->>'f' <> a.t->>'f' and b.t <> a.t from tok a, (select pg_temp.tok() t) b where a.n = 7), 'a line re-created at the same count moves f (and the token) while l stays');
select pg_temp.ok((select (b.t->>'l')::int = (a.t->>'l')::int + 1 and b.t <> a.t from tok a, (select pg_temp.tok() t) b where a.n = 6), 're-adding a line moves l again');

delete from ergon_warehouse.entries where line_id = (select id from ta);
delete from ergon_warehouse.access_keys where subject like 'TEST %';
