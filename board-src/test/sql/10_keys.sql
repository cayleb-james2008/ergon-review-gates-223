-- Key-gated writes, called as role anon. Each top-level statement is its own transaction.
-- Uses the seeded empty TEST line E (the runner seeds before this file).
create temp table ta as select id from ergon_warehouse.lines where code = 'E' and is_test;
select pg_temp.ok((select count(*) from ta) = 1, 'seeded TEST line E must exist (run via run.mjs)');
select pg_temp.ok((select count(*) from ergon_warehouse.entries where line_id = (select id from ta)) = 0, 'line E must start empty');

create temp table tk as
  select pg_temp.mint('TEST Ada') as valid, pg_temp.mint('TEST Bob') as to_revoke,
         pg_temp.raw_key('TEST Cyd', now() - interval '1 hour') as expired,
         pg_temp.raw_key('TEST Dee', now() + interval '1 day', 'some-other-app') as wrong_app;
select pg_temp.ok((select count(*) from ergon_warehouse.access_keys where subject like 'TEST %') >= 4, 'four test keys exist');

-- no / unknown / malformed key => key_invalid, nothing written, never an exception
select pg_temp.ok(pg_temp.save(k, '{"line_code":"E","title":"TEST nokey"}') = '{"ok": false, "error": "key_invalid"}'::jsonb, 'save_entry with key ' || coalesce(left(k, 3), 'NULL') || ' => key_invalid')
from (values (null::text), (''), ('ergk_not-a-real-key'), (repeat('x', 500)), (pg_temp.newkey())) v(k);
select pg_temp.ok(pg_temp.remove(null, gen_random_uuid()) = '{"ok": false, "error": "key_invalid"}'::jsonb, 'remove_entry without key => key_invalid');
select pg_temp.ok(pg_temp.check_k(null) = '{"ok": false, "error": "key_invalid"}'::jsonb, 'check_key without key => key_invalid');
select pg_temp.ok((select count(*) from ergon_warehouse.entries where line_id = (select id from ta)) = 0, 'nothing written without a valid key');
-- the full key text is hashed: a modified key (case / whitespace / truncation) is unknown
select pg_temp.ok(pg_temp.check_k(v)->>'error' = 'key_invalid', 'altered key is key_invalid')
from (select valid || ' ' v from tk union all select upper(valid) from tk union all select left(valid, 20) from tk) a;

-- valid key
select pg_temp.ok(pg_temp.check_k((select valid from tk))->>'subject' = 'TEST Ada' and (pg_temp.check_k((select valid from tk))->>'expires_at') is not null, 'check_key returns subject and expires_at');
select pg_temp.ok((select last_used_at is null from ergon_warehouse.access_keys where key_hash = pg_temp.sha((select valid from tk))), 'check_key does not count as use (last_used_at still null)');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"a0000000-0000-4000-8000-000000000001","line_code":"E","title":"TEST First","details":"n1","initials":"AB","status":"hold","ignored":3}') ->> 'ok' = 'true', 'valid key inserts');
select pg_temp.ok((select (title, details, initials, status, is_test, revision, photo_metadata, tags) = ('TEST First','n1','AB','hold',true,1,'[]'::jsonb,'{}'::text[])
                   from ergon_warehouse.entries where id = 'a0000000-0000-4000-8000-000000000001'), 'stored values incl. revision 1, photo_metadata [], tags {}');
select pg_temp.ok((select last_used_at is not null and last_used_at >= created_at from ergon_warehouse.access_keys where key_hash = pg_temp.sha((select valid from tk))), 'last_used_at set by a successful write');
select pg_temp.ok((pg_temp.call_as('anon', 'select to_jsonb(count(*)) from ergon_warehouse.entries where id = ''a0000000-0000-4000-8000-000000000001''')) = '1'::jsonb, 'anon can read the new row');

-- same id again: update in place, one row, revision + 1, untouched fields kept
select pg_temp.ok((pg_temp.save((select valid from tk), '{"id":"a0000000-0000-4000-8000-000000000001","line_code":"E","title":"TEST First v2"}')) -> 'entry' ->> 'title' = 'TEST First v2', 'update returns new value');
select pg_temp.ok((select count(*) from ergon_warehouse.entries where id = 'a0000000-0000-4000-8000-000000000001') = 1, 'still exactly one row after same-id re-save');
select pg_temp.ok((select (title, details, initials, status, revision) = ('TEST First v2','n1','AB','hold',2)
                   from ergon_warehouse.entries where id = 'a0000000-0000-4000-8000-000000000001'), 'unspecified fields preserved, revision 2');
select pg_temp.ok((select updated_at > created_at from ergon_warehouse.entries where id = 'a0000000-0000-4000-8000-000000000001'), 'updated_at set by the function');
select pg_temp.ok((pg_temp.save((select valid from tk), '{"id":"a0000000-0000-4000-8000-000000000001","status":"done"}')->'entry'->>'revision') = '3', 'entry JSON carries the new revision');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"a0000000-0000-4000-8000-000000000001","line_code":"E","title":"TEST First v2"}') ->> 'ok' = 'true', 'identical re-save ok');
select pg_temp.ok((select count(*) from ergon_warehouse.entries where id = 'a0000000-0000-4000-8000-000000000001') = 1, 'identical re-save creates no duplicate');
-- attribution (updated_by): the validated key's subject, on insert and on every update, never client text
select pg_temp.ok((select updated_by = 'TEST Ada' from ergon_warehouse.entries where id = 'a0000000-0000-4000-8000-000000000001'), 'updated_by = the inserting key subject (carried through Ada''s updates)');
select pg_temp.ok(pg_temp.save((select to_revoke from tk), '{"id":"a0000000-0000-4000-8000-000000000001","details":"edited by Bob"}')->'entry'->>'updated_by' = 'TEST Bob', 'update by a different employee returns their subject');
select pg_temp.ok((select (updated_by, details) = ('TEST Bob', 'edited by Bob') from ergon_warehouse.entries where id = 'a0000000-0000-4000-8000-000000000001'), 'stored updated_by follows the last writer (Bob)');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"a0000000-0000-4000-8000-000000000001","details":"n1"}')->'entry'->>'updated_by' = 'TEST Ada', 'and back to Ada on her next update');
-- client-supplied identity is ignored, on insert and on update, whatever the field is called
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"a0000000-0000-4000-8000-0000000000f1","line_code":"E","title":"TEST forge","updated_by":"TEST Mallory","updatedBy":"TEST Mallory","subject":"TEST Mallory","initials":"MM"}')->'entry'->>'updated_by' = 'TEST Ada', 'insert: forged updated_by/updatedBy/subject ignored');
select pg_temp.ok((select updated_by = 'TEST Ada' from ergon_warehouse.entries where id = 'a0000000-0000-4000-8000-0000000000f1'), 'insert: stored value is the key subject');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"a0000000-0000-4000-8000-0000000000f1","title":"TEST forge 2","updated_by":"TEST Mallory","updated_by_name":"TEST Mallory"}')->'entry'->>'updated_by' = 'TEST Ada', 'update: forged updated_by ignored');
select pg_temp.ok(pg_temp.save((select to_revoke from tk), '{"id":"a0000000-0000-4000-8000-0000000000f1","title":"TEST forge 3","updated_by":"TEST Ada"}')->'entry'->>'updated_by' = 'TEST Bob', 'update by Bob claiming to be Ada is still stored as Bob');
select pg_temp.ok((select updated_by = 'TEST Bob' from ergon_warehouse.entries where id = 'a0000000-0000-4000-8000-0000000000f1'), 'stored value is Bob');
select pg_temp.ok(pg_temp.save((select valid from tk), jsonb_build_object('line_id', (select id from ta), 'title', 'TEST By Id'))->'entry'->>'id' is not null, 'insert by line_id with generated id');
select pg_temp.ok(pg_temp.save((select valid from tk), jsonb_build_object('line_code','E','title',repeat('x',120),'details',repeat('y',240),'initials','ABCDEF')) ->> 'ok' = 'true', 'max lengths accepted');
select pg_temp.ok((pg_temp.save((select valid from tk), '{"id":"a0000000-0000-4000-8000-000000000002","line_code":"E"}')->'entry'->>'title') is null, 'insert without title ok (NULL)');

-- validation => invalid, nothing written
create temp table before_n as select count(*) n from ergon_warehouse.entries;
select pg_temp.ok(pg_temp.save((select valid from tk), e)->>'error' = 'invalid', 'invalid: ' || why)
from (values
  ('status',         jsonb_build_object('line_code','E','status','bogus')),
  ('status type',    jsonb_build_object('line_code','E','status',5)),
  ('title 121',      jsonb_build_object('line_code','E','title',repeat('x',121))),
  ('details 241',    jsonb_build_object('line_code','E','details',repeat('y',241))),
  ('initials 7',     jsonb_build_object('line_code','E','initials','ABCDEFG')),
  ('unknown line',   jsonb_build_object('line_code','Z','title','TEST x')),
  ('unknown line id',jsonb_build_object('line_id', gen_random_uuid(), 'title','TEST x')),
  ('no line',        jsonb_build_object('title','TEST x')),
  ('bad id',         jsonb_build_object('id','not-a-uuid','line_code','E')),
  ('control char',   jsonb_build_object('line_code','E','title','TEST ' || chr(7))),
  ('newline in details', jsonb_build_object('line_code','E','details','a' || chr(10) || 'b')),
  ('C1 control',     jsonb_build_object('line_code','E','title','TEST ' || chr(133))),
  ('array body',     '[]'::jsonb),
  ('number body',    '5'::jsonb)
) v(why, e);
select pg_temp.ok(pg_temp.save((select valid from tk), null)->>'error' = 'invalid', 'invalid: null body');
select pg_temp.ok((select count(*) from ergon_warehouse.entries) = (select n from before_n), 'invalid saves wrote nothing');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"a0000000-0000-4000-8000-000000000001","status":"bogus","title":"TEST Changed"}')->>'error' = 'invalid', 'invalid update rejected');
select pg_temp.ok((select (title, revision) = ('TEST First v2', 6) from ergon_warehouse.entries where id = 'a0000000-0000-4000-8000-000000000001'), 'invalid update changed nothing (revision untouched)');

-- remove_entry
select pg_temp.ok(pg_temp.remove((select valid from tk), 'a0000000-0000-4000-8000-000000000001') ->> 'ok' = 'true', 'remove ok');
select pg_temp.ok((select count(*) from ergon_warehouse.entries where id = 'a0000000-0000-4000-8000-000000000001') = 0, 'row gone');
select pg_temp.ok(pg_temp.remove((select valid from tk), 'a0000000-0000-4000-8000-000000000001') = '{"ok": false, "error": "not_found"}'::jsonb, 'second remove => not_found');
select pg_temp.ok(pg_temp.remove((select valid from tk), gen_random_uuid())->>'error' = 'not_found', 'unknown id => not_found');
select pg_temp.ok(pg_temp.call_as('anon', format('select ergon_warehouse.remove_entry(%L, null)', (select valid from tk)))->>'error' = 'not_found', 'null id => not_found');

-- optimistic concurrency (expected_revision): edits are checked, creates keep the idempotent upsert
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"c0000000-0000-4000-8000-000000000001","line_code":"E","title":"TEST oc"}')->'entry'->>'revision' = '1', 'create (no expected_revision) -> revision 1');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"c0000000-0000-4000-8000-000000000001","title":"TEST oc edit","expected_revision":1}') -> 'entry' ->> 'revision' = '2', 'edit with the right expected_revision succeeds (revision + 1)');
select pg_temp.ok((select (title, revision, updated_by) = ('TEST oc edit', 2, 'TEST Ada') from ergon_warehouse.entries where id = 'c0000000-0000-4000-8000-000000000001'), 'edit stored; updated_by from the key');
select pg_temp.ok(pg_temp.save((select to_revoke from tk), '{"id":"c0000000-0000-4000-8000-000000000001","title":"TEST oc stale","expected_revision":1}') = '{"ok": false, "error": "conflict", "revision": 2}'::jsonb, 'stale expected_revision -> conflict with the current revision');
select pg_temp.ok((select (title, revision, updated_by) = ('TEST oc edit', 2, 'TEST Ada') from ergon_warehouse.entries where id = 'c0000000-0000-4000-8000-000000000001'), 'conflict changed nothing (title, revision, updated_by)');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"c0000000-0000-4000-8000-000000000001","title":"TEST oc ahead","expected_revision":3}')->>'error' = 'conflict', 'expected_revision ahead of the stored one is a conflict too');
-- the same check covers moving an entry to another line (seeded empty TEST line I)
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"c0000000-0000-4000-8000-000000000001","line_code":"I","expected_revision":1}')->>'error' = 'conflict', 'stale line move -> conflict');
select pg_temp.ok((select line_id = (select id from ta) from ergon_warehouse.entries where id = 'c0000000-0000-4000-8000-000000000001'), 'stale move did not move the entry');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"c0000000-0000-4000-8000-000000000001","line_code":"I","expected_revision":2}')->'entry'->>'revision' = '3', 'line move with the right expected_revision succeeds');
select pg_temp.ok((select line_id = (select id from ergon_warehouse.lines where code = 'I') from ergon_warehouse.entries where id = 'c0000000-0000-4000-8000-000000000001'), 'entry now on line I');
-- an edit of a row that was deleted meanwhile is not_found and nothing is recreated
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"c0000000-0000-4000-8000-000000000002","line_code":"E","title":"TEST oc gone"}')->>'ok' = 'true', 'create the row that will be deleted');
select pg_temp.ok(pg_temp.remove((select to_revoke from tk), 'c0000000-0000-4000-8000-000000000002')->>'ok' = 'true', 'another tab deletes it');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"c0000000-0000-4000-8000-000000000002","line_code":"E","title":"TEST oc zombie","expected_revision":1}') = '{"ok": false, "error": "not_found"}'::jsonb, 'edit of a deleted row -> not_found');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"c0000000-0000-4000-8000-000000000002","title":"TEST oc zombie","expected_revision":1}') = '{"ok": false, "error": "not_found"}'::jsonb, 'edit of a deleted row without a line -> not_found');
select pg_temp.ok((select count(*) from ergon_warehouse.entries where id = 'c0000000-0000-4000-8000-000000000002') = 0, 'the deleted row was not recreated');
-- creates without expected_revision keep the idempotent upsert by client id (retry safety)
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"c0000000-0000-4000-8000-000000000001","line_code":"I","title":"TEST oc retry"}')->>'ok' = 'true', 'same id without expected_revision still upserts');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"c0000000-0000-4000-8000-000000000001","line_code":"I","title":"TEST oc retry"}')->>'ok' = 'true', 'and again');
select pg_temp.ok((select count(*) from ergon_warehouse.entries where id = 'c0000000-0000-4000-8000-000000000001') = 1, 'one row after repeated creates with the same id');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"id":"c0000000-0000-4000-8000-000000000003","line_code":"E","title":"TEST oc null","expected_revision":null}')->>'ok' = 'true', 'expected_revision: null is treated as absent (a create)');
-- invalid expected_revision
select pg_temp.ok(pg_temp.save((select valid from tk), jsonb_build_object('id','c0000000-0000-4000-8000-000000000001','title','TEST oc bad','expected_revision', e))->>'error' = 'invalid', 'invalid expected_revision ' || e::text)
from (values ('0'::jsonb), ('-1'), ('1.5'), ('"2"'), ('true'), ('[1]'), ('{}'), ('1e300')) v(e);
select pg_temp.ok(pg_temp.save((select valid from tk), '{"title":"TEST oc noid","line_code":"E","expected_revision":1}')->>'error' = 'invalid', 'expected_revision without an id -> invalid');
select pg_temp.ok((select (title) = ('TEST oc retry') from ergon_warehouse.entries where id = 'c0000000-0000-4000-8000-000000000001'), 'invalid expected_revision changed nothing');
delete from ergon_warehouse.entries where id in ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003');

-- revoked key: key_invalid everywhere (same answer as unknown), no write
select pg_temp.ok(pg_temp.save((select to_revoke from tk), '{"line_code":"E","title":"TEST before revoke"}')->>'ok' = 'true', 'the soon-revoked key works first');
select pg_temp.ok(ergon_warehouse.revoke_access_key((select id from ergon_warehouse.access_keys where key_hash = pg_temp.sha((select to_revoke from tk)))), 'revoke_access_key returns true');
select pg_temp.ok(pg_temp.save((select to_revoke from tk), '{"line_code":"E","title":"TEST after revoke"}') = '{"ok": false, "error": "key_invalid"}'::jsonb, 'revoked key => key_invalid (save)');
select pg_temp.ok(pg_temp.remove((select to_revoke from tk), gen_random_uuid())->>'error' = 'key_invalid', 'revoked key => key_invalid (remove)');
select pg_temp.ok(pg_temp.check_k((select to_revoke from tk))->>'error' = 'key_invalid', 'revoked key => key_invalid (check)');
select pg_temp.ok((select count(*) from ergon_warehouse.entries where title = 'TEST after revoke') = 0, 'nothing written by a revoked key');
select pg_temp.ok((select (revoked_at is not null) from ergon_warehouse.access_keys where key_hash = pg_temp.sha((select to_revoke from tk))), 'revoked_at set');
select pg_temp.ok(pg_temp.save((select valid from tk), '{"line_code":"E","title":"TEST other key still fine"}')->>'ok' = 'true', 'revoking one key leaves the others working');

-- expired key: key_expired, no write, last_used_at untouched
select pg_temp.ok(pg_temp.save((select expired from tk), '{"line_code":"E","title":"TEST expired"}') = '{"ok": false, "error": "key_expired"}'::jsonb, 'expired key => key_expired (save)');
select pg_temp.ok(pg_temp.remove((select expired from tk), gen_random_uuid())->>'error' = 'key_expired', 'expired key => key_expired (remove)');
select pg_temp.ok(pg_temp.check_k((select expired from tk))->>'error' = 'key_expired', 'expired key => key_expired (check)');
select pg_temp.ok((select count(*) from ergon_warehouse.entries where title = 'TEST expired') = 0, 'nothing written by an expired key');
select pg_temp.ok((select last_used_at is null from ergon_warehouse.access_keys where key_hash = pg_temp.sha((select expired from tk))), 'expired key never used');
-- refused writes (revoked / expired / no key) change nothing, in particular not updated_by or revision
create temp table snap as select id, updated_by, revision, title from ergon_warehouse.entries where id = 'a0000000-0000-4000-8000-0000000000f1';
select pg_temp.ok(pg_temp.save(k, '{"id":"a0000000-0000-4000-8000-0000000000f1","title":"TEST hijack","updated_by":"TEST Mallory"}')->>'error' in ('key_invalid', 'key_expired'), 'refused: ' || n)
from (values ('revoked key', (select to_revoke from tk)), ('expired key', (select expired from tk)), ('no key', null::text), ('wrong-app key', (select wrong_app from tk))) v(n, k);
-- the key is checked before expected_revision: a refused key never learns whether the row exists or what its revision is
select pg_temp.ok(pg_temp.save(k, jsonb_build_object('id', (select id from snap), 'title', 'TEST hijack', 'expected_revision', (select revision from snap)))->>'error' in ('key_invalid', 'key_expired'), 'refused before the revision check: ' || n)
from (values ('revoked key', (select to_revoke from tk)), ('expired key', (select expired from tk)), ('no key', null::text), ('wrong-app key', (select wrong_app from tk))) v(n, k);
select pg_temp.ok(pg_temp.save(k, '{"id":"c0000000-0000-4000-8000-0000000000ff","title":"x","expected_revision":1}')->>'error' in ('key_invalid', 'key_expired'), 'refused key gets no not_found oracle: ' || n)
from (values ('revoked key', (select to_revoke from tk)), ('expired key', (select expired from tk)), ('no key', null::text)) v(n, k);
select pg_temp.ok((select (e.updated_by, e.revision, e.title) = (s.updated_by, s.revision, s.title) from ergon_warehouse.entries e join snap s using (id)), 'updated_by, revision and title unchanged after refused writes');
-- a key that is both revoked and expired is indistinguishable from an unknown one
update ergon_warehouse.access_keys set revoked_at = now() where key_hash = pg_temp.sha((select expired from tk));
select pg_temp.ok(pg_temp.check_k((select expired from tk))->>'error' = 'key_invalid', 'revoked beats expired => key_invalid');

-- wrong-app key: key_invalid
select pg_temp.ok(pg_temp.save((select wrong_app from tk), '{"line_code":"E","title":"TEST wrong app"}') = '{"ok": false, "error": "key_invalid"}'::jsonb, 'wrong-app key => key_invalid (save)');
select pg_temp.ok(pg_temp.check_k((select wrong_app from tk))->>'error' = 'key_invalid', 'wrong-app key => key_invalid (check)');
select pg_temp.ok((select count(*) from ergon_warehouse.entries where title = 'TEST wrong app') = 0, 'nothing written by a wrong-app key');

-- a key expiring between two calls: works now, key_expired after expiry is reached
update ergon_warehouse.access_keys set expires_at = now() - interval '1 second' where key_hash = pg_temp.sha((select valid from tk));
select pg_temp.ok(pg_temp.save((select valid from tk), '{"line_code":"E","title":"TEST just expired"}')->>'error' = 'key_expired', 'key that has just passed expires_at is refused');

-- cleanup (entries before lines is not needed: line E stays)
delete from ergon_warehouse.entries where line_id = (select id from ta);
delete from ergon_warehouse.access_keys where subject like 'TEST %';
