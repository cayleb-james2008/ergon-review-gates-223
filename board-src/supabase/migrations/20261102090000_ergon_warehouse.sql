-- ergon_warehouse: warehouse lines board data layer (see docs/DATA-CONTRACT.md).
-- The hosted tables already exist (live shape and constraints = ground truth), so on an existing table
-- this file only ADDS: additive columns (lines.is_test; entries.initials/status/is_test/updated_by), one
-- NOT VALID entries_status_check, grants, policies, replica identity and realtime membership. It never
-- drops, re-creates, truncates, rewrites, updates or deletes rows of `lines` / `entries`, and adds no
-- key, index, trigger or other constraint to them. A fresh database gets both tables created to mirror
-- the hosted ones (same keys, uniques, FK, CHECKs, index; no column defaults).
-- Idempotent: safe to apply repeatedly. Send it as ONE transaction (begin; ...; commit;).

create schema if not exists ergon_warehouse;

-- pgcrypto must live in the `extensions` schema (functions call extensions.crypt).
do $$
begin
  if not exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto' and n.nspname = 'extensions'
  ) then
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
  end if;
  if not exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto' and n.nspname = 'extensions'
  ) then
    raise exception 'pgcrypto must be installed in schema "extensions" (it is installed elsewhere)';
  end if;
end $$;

-- ---------------------------------------------------------------- tables

-- Fresh database only: create each table when absent, mirroring hosted (names, keys, FK, CHECKs, index).
-- An existing table is never touched here.
do $$
begin
  if to_regclass('ergon_warehouse.lines') is null then
    create table ergon_warehouse.lines (
      id         uuid        not null,
      code       text        not null,
      sort_order smallint    not null,
      created_at timestamptz not null,
      constraint lines_pkey            primary key (id),
      constraint lines_code_key        unique (code),
      constraint lines_sort_order_key  unique (sort_order),
      constraint lines_code_check      check (code ~ '^[A-S]$'),
      constraint lines_sort_order_check check (sort_order between 1 and 19)
    );
  end if;
  if to_regclass('ergon_warehouse.entries') is null then
    create table ergon_warehouse.entries (
      id             uuid        not null,
      line_id        uuid        not null,
      title          text,
      details        text,
      photo_metadata jsonb       not null,
      revision       bigint      not null,
      created_at     timestamptz not null,
      updated_at     timestamptz not null,
      tags           text[]      not null,
      constraint entries_pkey primary key (id),
      constraint entries_line_id_fkey foreign key (line_id) references ergon_warehouse.lines (id) on delete restrict,
      constraint entries_photo_metadata_check check (jsonb_typeof(photo_metadata) = 'array'),
      constraint entries_revision_check check (revision > 0)
    );
    create index entries_line_id_idx on ergon_warehouse.entries (line_id);
  end if;
end $$;

-- Additive columns (no-ops once present; existing rows get the default, no rewrite).
alter table ergon_warehouse.lines
  add column if not exists is_test boolean not null default false;
alter table ergon_warehouse.entries
  add column if not exists initials   text not null default '',
  add column if not exists status     text not null default 'open',
  add column if not exists is_test    boolean not null default false,
  -- who last wrote the row: filled ONLY by save_entry from the validated key's subject, never from client text
  add column if not exists updated_by text not null default '';

-- The functions depend on these columns and types. Fail loudly (nothing changed) rather than guess.
do $$
declare r record; v_found text;
begin
  for r in select * from (values
      ('lines','id','uuid'), ('lines','code','text'), ('lines','is_test','boolean'),
      ('entries','id','uuid'), ('entries','line_id','uuid'), ('entries','title','text'),
      ('entries','details','text'), ('entries','photo_metadata','jsonb'), ('entries','tags','text[]'),
      ('entries','initials','text'), ('entries','status','text'), ('entries','is_test','boolean'), ('entries','updated_by','text'),
      ('entries','created_at','timestamp with time zone'), ('entries','updated_at','timestamp with time zone'),
      ('lines','created_at','timestamp with time zone'), ('lines','sort_order','smallint'),
      ('entries','revision','bigint')) v(t, c, ty)
  loop
    select format_type(a.atttypid, a.atttypmod) into v_found
      from pg_attribute a
     where a.attrelid = ('ergon_warehouse.' || r.t)::regclass and a.attname = r.c and not a.attisdropped;
    if v_found is null then
      raise exception 'ergon_warehouse.%.% is missing; the data layer expects the live shape (see docs/DATA-CONTRACT.md)', r.t, r.c;
    elsif v_found <> r.ty and not (r.c in ('sort_order', 'revision') and v_found in ('smallint', 'integer', 'bigint')) then
      raise exception 'ergon_warehouse.%.% is % but the data layer needs %; nothing was changed', r.t, r.c, v_found, r.ty;
    end if;
  end loop;
end $$;

-- The only constraint added to an existing table: the status check, NOT VALID by design. A NOT VALID check is enforced on every new
-- insert and every update; it is never validated here, so no scan of the existing rows runs (this migration reads no entry row).
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'ergon_warehouse.entries'::regclass and conname = 'entries_status_check') then
    alter table ergon_warehouse.entries
      add constraint entries_status_check check (status in ('open','hold','ready','done')) not valid;
  end if;
end $$;

-- Private table (new; RLS on, no policies, no grants to API roles). Only the sha256 of a key is stored;
-- the plaintext key is minted outside the database and never enters it.
create table if not exists ergon_warehouse.access_keys (
  id           uuid        not null default gen_random_uuid(),
  key_hash     text        not null,
  key_prefix   text        not null,
  app          text        not null default 'rhl-warehouse-board',
  subject      text        not null,
  issued_by    text        not null default '',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  constraint access_keys_pkey primary key (id),
  constraint access_keys_key_hash_key unique (key_hash)
);

-- ---------------------------------------------------------------- functions

-- Private helper: resolve a presented key. Never raises. status: ok | key_invalid | key_expired.
-- Unknown, revoked and wrong-app keys are all key_invalid (no oracle); a known, unrevoked key past
-- expires_at is key_expired.
create or replace function ergon_warehouse._resolve_key(
  p_key text, out o_status text, out o_id uuid, out o_subject text, out o_expires timestamptz)
language plpgsql security definer set search_path = '' as $$
declare k record;
begin
  o_status := 'key_invalid';
  if p_key is null or char_length(p_key) not between 1 and 200 then return; end if;
  select a.id, a.subject, a.expires_at, a.revoked_at, a.app into k
    from ergon_warehouse.access_keys a
   where a.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex') limit 1;
  if not found or k.revoked_at is not null or k.app <> 'rhl-warehouse-board' then return; end if;
  o_id := k.id; o_subject := k.subject; o_expires := k.expires_at;
  o_status := case when k.expires_at <= now() then 'key_expired' else 'ok' end;
end $$;

create or replace function ergon_warehouse.check_key(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from ergon_warehouse._resolve_key(p_key);
  if r.o_status <> 'ok' then return jsonb_build_object('ok', false, 'error', r.o_status); end if;
  return jsonb_build_object('ok', true, 'subject', r.o_subject, 'expires_at', r.o_expires);
end $$;

create or replace function ergon_warehouse.save_entry(p_key text, p_entry jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r          record;
  v_id       uuid;
  v_lid      uuid;
  v_lid2     uuid;
  v_code     text;
  v_ltest    boolean;
  v_exists   boolean := false;
  v_exp      numeric;      -- expected_revision (an EDIT when present)
  v_rev      bigint;
  v_title    text;
  v_details  text;
  v_initials text;
  v_status   text;
  v_out      jsonb;
  c_bad constant jsonb := jsonb_build_object('ok', false, 'error', 'invalid');
  c_ctl constant text  := '[\x01-\x1f\x7f-\x9f]';
begin
  select * into r from ergon_warehouse._resolve_key(p_key);
  if r.o_status <> 'ok' then return jsonb_build_object('ok', false, 'error', r.o_status); end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then return c_bad; end if;
  perform pg_advisory_xact_lock(727002);   -- serialise entry writes (the id upsert cannot race)

  -- id (optional)
  if coalesce(jsonb_typeof(p_entry->'id'), 'null') <> 'null' then
    if jsonb_typeof(p_entry->'id') <> 'string' then return c_bad; end if;
    begin v_id := (p_entry->>'id')::uuid;
    exception when invalid_text_representation then return c_bad; end;
  end if;

  -- expected_revision (optional): present => this is an EDIT of a known revision (optimistic concurrency).
  -- Absent => a create / idempotent upsert by client id, exactly as before.
  if coalesce(jsonb_typeof(p_entry->'expected_revision'), 'null') <> 'null' then
    if jsonb_typeof(p_entry->'expected_revision') <> 'number' then return c_bad; end if;
    v_exp := (p_entry->>'expected_revision')::numeric;
    if v_exp <> trunc(v_exp) or v_exp < 1 or v_exp > 9007199254740991 then return c_bad; end if;
    if v_id is null then return c_bad; end if;      -- an edit must name the row
  end if;

  -- existing row?
  if v_id is not null then
    select true, e.line_id, e.title, e.details, e.initials, e.status, e.revision
      into v_exists, v_lid, v_title, v_details, v_initials, v_status, v_rev
      from ergon_warehouse.entries e where e.id = v_id limit 1 for update;
    v_exists := coalesce(v_exists, false);
  end if;

  if v_exp is not null then
    if not v_exists then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;   -- never recreate
    if v_rev <> v_exp::bigint then return jsonb_build_object('ok', false, 'error', 'conflict', 'revision', v_rev); end if;
  end if;

  -- line: line_id and/or line_code
  if coalesce(jsonb_typeof(p_entry->'line_id'), 'null') <> 'null' then
    if jsonb_typeof(p_entry->'line_id') <> 'string' then return c_bad; end if;
    begin v_lid2 := (p_entry->>'line_id')::uuid;
    exception when invalid_text_representation then return c_bad; end;
    select l.id into v_lid2 from ergon_warehouse.lines l where l.id = v_lid2 limit 1;
    if v_lid2 is null then return c_bad; end if;
    v_lid := v_lid2;
  end if;
  if coalesce(jsonb_typeof(p_entry->'line_code'), 'null') <> 'null' then
    if jsonb_typeof(p_entry->'line_code') <> 'string' then return c_bad; end if;
    select l.id into v_lid2 from ergon_warehouse.lines l
      where l.code = p_entry->>'line_code' order by l.sort_order, l.id limit 1;
    if v_lid2 is null then return c_bad; end if;
    if jsonb_typeof(p_entry->'line_id') = 'string' and v_lid2 <> v_lid then return c_bad; end if;
    v_lid := v_lid2;
  end if;
  if v_lid is null then return c_bad; end if;     -- new rows need a line
  select l.code, l.is_test into v_code, v_ltest from ergon_warehouse.lines l where l.id = v_lid limit 1;
  if v_code is null and v_ltest is null then return c_bad; end if;

  -- text fields (trimmed; absent/null keeps the current value, or the default on insert)
  if coalesce(jsonb_typeof(p_entry->'title'), 'null') <> 'null' then
    if jsonb_typeof(p_entry->'title') <> 'string' then return c_bad; end if;
    v_title := btrim(p_entry->>'title');
    if char_length(v_title) > 120 or v_title ~ c_ctl then return c_bad; end if;
  end if;
  if coalesce(jsonb_typeof(p_entry->'details'), 'null') <> 'null' then
    if jsonb_typeof(p_entry->'details') <> 'string' then return c_bad; end if;
    v_details := btrim(p_entry->>'details');
    if char_length(v_details) > 240 or v_details ~ c_ctl then return c_bad; end if;
  end if;
  if coalesce(jsonb_typeof(p_entry->'initials'), 'null') <> 'null' then
    if jsonb_typeof(p_entry->'initials') <> 'string' then return c_bad; end if;
    v_initials := btrim(p_entry->>'initials');
    if char_length(v_initials) > 6 or v_initials ~ c_ctl then return c_bad; end if;
  end if;
  if coalesce(jsonb_typeof(p_entry->'status'), 'null') <> 'null' then
    if jsonb_typeof(p_entry->'status') <> 'string' then return c_bad; end if;
    v_status := p_entry->>'status';
    if v_status not in ('open', 'hold', 'ready', 'done') then return c_bad; end if;
  end if;

  if v_exists then
    update ergon_warehouse.entries
       set line_id    = v_lid,
           title      = v_title,
           details    = v_details,
           initials   = coalesce(v_initials, initials),
           status     = coalesce(v_status, status),
           revision   = revision + 1,
           updated_at = now(),
           updated_by = r.o_subject      -- from the validated key, never from p_entry
     where id = v_id;
  else
    v_id := coalesce(v_id, gen_random_uuid());
    -- every NOT NULL column is set explicitly: the live table has no defaults we can rely on
    -- (photo_metadata is an empty ARRAY: arrays are the live column's convention)
    insert into ergon_warehouse.entries
      (id, line_id, title, details, photo_metadata, revision, created_at, updated_at, tags, initials, status, is_test, updated_by)
    values
      (v_id, v_lid, v_title, v_details, '[]'::jsonb, 1, now(), now(), '{}'::text[],
       coalesce(v_initials, ''), coalesce(v_status, 'open'), coalesce(v_ltest, false), r.o_subject);
  end if;

  update ergon_warehouse.access_keys set last_used_at = now() where id = r.o_id;

  select jsonb_build_object(
           'id', e.id, 'line_id', e.line_id, 'line_code', v_code,
           'title', e.title, 'details', e.details, 'initials', e.initials,
           'status', e.status, 'revision', e.revision, 'updated_by', e.updated_by, 'photo_metadata', e.photo_metadata,
           'tags', to_jsonb(e.tags), 'is_test', e.is_test,
           'created_at', e.created_at, 'updated_at', e.updated_at)
    into v_out from ergon_warehouse.entries e where e.id = v_id limit 1;
  return jsonb_build_object('ok', true, 'entry', v_out);
end $$;

create or replace function ergon_warehouse.remove_entry(p_key text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_del uuid;
begin
  select * into r from ergon_warehouse._resolve_key(p_key);
  if r.o_status <> 'ok' then return jsonb_build_object('ok', false, 'error', r.o_status); end if;
  delete from ergon_warehouse.entries where id = p_id returning id into v_del;
  if v_del is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update ergon_warehouse.access_keys set last_used_at = now() where id = r.o_id;
  return jsonb_build_object('ok', true, 'id', v_del);
end $$;

-- Cheap change probe for pollers: one tiny jsonb that changes whenever any line or entry changes, so a
-- viewer can skip re-reading the whole board while the token is unchanged. SECURITY INVOKER on purpose:
-- it sees exactly what the calling role can SELECT (RLS applies), so it reveals nothing a SELECT would not.
--   l = number of lines, e = number of entries, u = max(entries.updated_at) (UTC text, null if none),
--   r = sum(entries.revision), f = sum of a hash of each line's id, code and sort order (a line re-created or renumbered at
--   the same count still moves it), i = sum of a hash of the entry ids (so a delete plus an insert in the same
--   instant, which can leave e, u and r equal, still changes the token).
-- A function only: no new table. Rollback = drop function ergon_warehouse.board_token();
create or replace function ergon_warehouse.board_token()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('l', (select count(*) from ergon_warehouse.lines),
                            'f', (select coalesce(sum(hashtext(id::text || code || sort_order::text)::bigint), 0) from ergon_warehouse.lines),
                            'e', e.n, 'u', e.u, 'r', e.r, 'i', e.i)
    from (select count(*) as n,
                 to_char(max(updated_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as u,
                 coalesce(sum(revision), 0) as r,
                 coalesce(sum(hashtext(id::text)::bigint), 0) as i
            from ergon_warehouse.entries) e;
$$;

-- Issuer side. PRIVILEGED: executable by postgres / service_role only. Called by the agent's key tool
-- (or ops/keys.mjs); they send only the sha256 hash, never the plaintext key. These may raise on bad input.
create or replace function ergon_warehouse.mint_access_key(
  p_key_hash text, p_key_prefix text, p_subject text, p_expires_at timestamptz, p_issued_by text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'key hash must be 64 lowercase hex characters (sha256 of the key)';
  end if;
  if p_key_prefix is null or char_length(p_key_prefix) <> 9 then
    raise exception 'key prefix must be the first 9 characters of the key';
  end if;
  if p_subject is null or char_length(btrim(p_subject)) not between 1 and 80 then
    raise exception 'subject must be 1 to 80 characters';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'expiry must be in the future';
  end if;
  if p_expires_at > now() + interval '30 days' then
    raise exception 'expiry must be at most 30 days from now';
  end if;
  if char_length(coalesce(p_issued_by, '')) > 80 then
    raise exception 'issued_by must be at most 80 characters';
  end if;
  insert into ergon_warehouse.access_keys (key_hash, key_prefix, subject, issued_by, expires_at)
    values (p_key_hash, p_key_prefix, btrim(p_subject), coalesce(p_issued_by, ''), p_expires_at)
    returning id into v_id;
  return v_id;
end $$;

create or replace function ergon_warehouse.revoke_access_key(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update ergon_warehouse.access_keys set revoked_at = coalesce(revoked_at, now())
   where id = p_id returning id into v_id;
  return v_id is not null;
end $$;

create or replace function ergon_warehouse.list_access_keys()
returns table (id uuid, key_prefix text, subject text, issued_by text, created_at timestamptz,
               expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz)
language sql security definer set search_path = '' as $$
  select a.id, a.key_prefix, a.subject, a.issued_by, a.created_at, a.expires_at, a.revoked_at, a.last_used_at
    from ergon_warehouse.access_keys a order by a.created_at desc, a.id;
$$;

-- ---------------------------------------------------------------- privileges

alter table ergon_warehouse.lines         enable row level security;
alter table ergon_warehouse.entries       enable row level security;
alter table ergon_warehouse.access_keys   enable row level security;

revoke all on ergon_warehouse.lines, ergon_warehouse.entries, ergon_warehouse.access_keys
  from public, anon, authenticated;
grant usage on schema ergon_warehouse to anon, authenticated;
grant select on ergon_warehouse.lines, ergon_warehouse.entries to anon, authenticated;

drop policy if exists lines_select_all on ergon_warehouse.lines;
create policy lines_select_all on ergon_warehouse.lines
  for select to anon, authenticated using (true);
drop policy if exists entries_select_all on ergon_warehouse.entries;
create policy entries_select_all on ergon_warehouse.entries
  for select to anon, authenticated using (true);

revoke all on function
  ergon_warehouse._resolve_key(text),
  ergon_warehouse.check_key(text), ergon_warehouse.save_entry(text, jsonb),
  ergon_warehouse.remove_entry(text, uuid), ergon_warehouse.board_token(),
  ergon_warehouse.mint_access_key(text, text, text, timestamptz, text),
  ergon_warehouse.revoke_access_key(uuid), ergon_warehouse.list_access_keys()
  from public, anon, authenticated;
grant execute on function
  ergon_warehouse.check_key(text), ergon_warehouse.save_entry(text, jsonb),
  ergon_warehouse.remove_entry(text, uuid), ergon_warehouse.board_token()
  to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema ergon_warehouse to service_role;
    grant execute on function
      ergon_warehouse.mint_access_key(text, text, text, timestamptz, text),
      ergon_warehouse.revoke_access_key(uuid), ergon_warehouse.list_access_keys()
      to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------- realtime

-- REPLICA IDENTITY FULL is a table option (no row is touched): events then carry the whole old row.
alter table ergon_warehouse.lines   replica identity full;
alter table ergon_warehouse.entries replica identity full;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['lines', 'entries'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'ergon_warehouse' and tablename = t) then
        execute format('alter publication supabase_realtime add table ergon_warehouse.%I', t);
      end if;
    end loop;
  else
    raise notice 'publication supabase_realtime not found; realtime membership skipped';
  end if;
end $$;
