-- READ-ONLY generator of the "put it back" statements for the hosted apply (docs/HOSTED-APPLY-PACK.md, step 0).
-- Run it BEFORE anything is changed and save the output next to the inspect.sql output: it is the rollback's input.
-- Reads only pg_catalog (ACLs, replica identity, RLS flags, publication membership): never a row or a count of any data table.
-- Output: one statement per row, in a safe order. Safe through /database/query/read-only (every entity is schema-qualified).
with
t as (
  select c.oid, c.relname, c.relowner, c.relreplident, c.relrowsecurity, c.relforcerowsecurity, c.relacl
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ergon_warehouse' and c.relname in ('lines', 'entries') and c.relkind = 'r'
),
acl as (
  select t.relname, a.grantee, a.privilege_type, a.is_grantable
    from t cross join lateral pg_catalog.aclexplode(coalesce(t.relacl, pg_catalog.acldefault('r', t.relowner))) a
   where a.grantee <> t.relowner
),
grants as (
  select 10 as ord, format('grant %s on ergon_warehouse.%I to %s%s;', string_agg(privilege_type, ', ' order by privilege_type), relname,
         case when grantee = 0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(grantee)) end,
         case when bool_or(is_grantable) then ' with grant option' else '' end) as stmt
    from acl group by relname, grantee
),
rls as (
  select 20, format('alter table ergon_warehouse.%I %s row level security;', relname, case when relrowsecurity then 'enable' else 'disable' end) from t
  union all
  select 21, format('alter table ergon_warehouse.%I %s row level security;', relname, case when relforcerowsecurity then 'force' else 'no force' end) from t
),
repl as (
  select 30, format('alter table ergon_warehouse.%I replica identity %s;', relname,
         case relreplident when 'd' then 'default' when 'f' then 'full' when 'n' then 'nothing' else 'default /* was an index: set it by hand */' end) from t
),
schema_usage as (
  select 40, format('%s usage on schema ergon_warehouse %s %s;',
         case when pg_catalog.has_schema_privilege(r.name, 'ergon_warehouse', 'usage') then 'grant' else 'revoke' end,
         case when pg_catalog.has_schema_privilege(r.name, 'ergon_warehouse', 'usage') then 'to' else 'from' end, r.name)
    from (values ('anon'), ('authenticated')) r(name)
  union all
  select 41, format('%s usage on schema ergon_warehouse %s service_role;',
         case when pg_catalog.has_schema_privilege('service_role', 'ergon_warehouse', 'usage') then 'grant' else 'revoke' end,
         case when pg_catalog.has_schema_privilege('service_role', 'ergon_warehouse', 'usage') then 'to' else 'from' end)
   where exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role')
),
pub as (
  select 50, format('alter publication supabase_realtime %s table ergon_warehouse.%I;',
         case when exists (select 1 from pg_catalog.pg_publication_tables p where p.pubname = 'supabase_realtime' and p.schemaname = 'ergon_warehouse' and p.tablename = t.relname) then 'add' else 'drop' end, relname)
    from t
)
select ord, stmt from (
  select ord, stmt from grants
  union all select * from rls union all select * from repl union all select * from schema_usage union all select * from pub
) s(ord, stmt) order by ord, stmt;
