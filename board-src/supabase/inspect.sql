-- READ-ONLY structure inspector for schema ergon_warehouse.
-- Run in the Supabase SQL editor (or psql). One statement, one result set.
-- Reads only pg_catalog / information_schema: it never selects from lines, entries,
-- access_keys or any other data table (no rows, no counts).
with
tbl as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         pg_get_userbyid(c.relowner) as owner, c.relowner, c.relreplident, c.relacl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'ergon_warehouse' and c.relkind in ('r', 'p', 'v', 'm')
),
rows_ as (
  select 10 as ord, 'schema' as section, 'ergon_warehouse' as item,
         case when exists (select 1 from pg_namespace where nspname = 'ergon_warehouse')
              then 'exists' else 'MISSING' end as detail
  union all
  select 20, 'table', relname,
         'kind=' || relkind::text || ' owner=' || owner
         || ' rls_enabled=' || relrowsecurity || ' rls_forced=' || relforcerowsecurity
         || ' replica_identity=' || relreplident::text
         || ' has_primary_key=' || exists (select 1 from pg_constraint k where k.conrelid = tbl.oid and k.contype = 'p')::text
  from tbl
  union all
  select 30, 'column', t.relname || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod)
         || case when a.attnotnull then ' NOT NULL' else ' null' end
         || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
         || ' (#' || a.attnum || ')'
  from tbl t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all
  select 40, 'constraint', t.relname || '.' || c.conname, pg_get_constraintdef(c.oid)
         || case when c.convalidated then '' else '  [NOT VALID]' end
  from tbl t join pg_constraint c on c.conrelid = t.oid
  union all
  select 45, 'index', t.relname, pg_get_indexdef(i.indexrelid)
  from tbl t join pg_index i on i.indrelid = t.oid
  union all
  select 50, 'trigger', t.relname || '.' || g.tgname, pg_get_triggerdef(g.oid)
  from tbl t join pg_trigger g on g.tgrelid = t.oid and not g.tgisinternal
  union all
  select 60, 'policy', p.tablename || '.' || p.policyname,
         p.cmd || ' roles=' || p.roles::text || ' permissive=' || p.permissive
         || ' using=' || coalesce(p.qual, '-') || ' check=' || coalesce(p.with_check, '-')
  from pg_policies p where p.schemaname = 'ergon_warehouse'
  union all
  select 70, 'grant', t.relname,
         case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
         || ': ' || a.privilege_type
  from tbl t
  cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner)::aclitem[])) a
  where a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated')
  union all
  select 71, 'grant-check', t.relname || ' / ' || r.rolname,
         'select=' || has_table_privilege(r.rolname, t.oid, 'select')
         || ' insert=' || has_table_privilege(r.rolname, t.oid, 'insert')
         || ' update=' || has_table_privilege(r.rolname, t.oid, 'update')
         || ' delete=' || has_table_privilege(r.rolname, t.oid, 'delete')
  from tbl t join pg_roles r on r.rolname in ('anon', 'authenticated')
  union all
  select 80, 'function', p.oid::regprocedure::text,
         'security_definer=' || p.prosecdef || ' config=' || coalesce(p.proconfig::text, '-')
         || ' exec_anon=' || has_function_privilege('anon', p.oid, 'execute')
         || ' exec_authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
         || ' exec_public=' || coalesce((select bool_or(a.grantee = 0)
                from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)::aclitem[])) a), false)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'ergon_warehouse'
  union all
  select 90, 'publication', pt.pubname || ': ' || pt.tablename,
         coalesce(pt.attnames::text, 'all columns')
  from pg_publication_tables pt where pt.schemaname = 'ergon_warehouse'
  union all
  select 91, 'publication-exists', 'supabase_realtime',
         case when exists (select 1 from pg_publication where pubname = 'supabase_realtime')
              then 'exists' else 'MISSING' end
  union all
  select 100, 'api-exposed-schemas', 'authenticator ' || coalesce(r.rolname, '?'), s.cfg
  from (select 1) x
  left join pg_roles r on r.rolname = 'authenticator'
  left join lateral (
    select string_agg(c, ' | ') as cfg
    from pg_db_role_setting ds, unnest(ds.setconfig) c
    where ds.setrole = r.oid and c like 'pgrst.%'
  ) s on true
  union all
  select 110, 'extension', e.extname, 'schema=' || n.nspname || ' version=' || e.extversion
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname in ('pgcrypto', 'pg_graphql', 'supabase_vault')
)
select section, item, detail from rows_ order by ord, item, detail;
