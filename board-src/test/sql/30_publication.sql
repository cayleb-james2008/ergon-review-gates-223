-- (e) lines and entries are in publication supabase_realtime; the private table is not.
select pg_temp.ok(
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'ergon_warehouse'
      and tablename in ('lines', 'entries')) = 2,
  'lines and entries are in supabase_realtime');
select pg_temp.ok(
  not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'ergon_warehouse'
      and tablename = 'access_keys'),
  'access_keys is not published');
