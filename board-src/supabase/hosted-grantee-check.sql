-- READ-ONLY all-grantees check for the hosted apply (docs/HOSTED-APPLY-PACK.md, step 1; Nox, 2 Nov 19:15).
-- Lists EVERY grantee in relacl of ergon_warehouse.lines and ergon_warehouse.entries (catalog only: no row, no count) and flags whether it is expected.
-- Expected grantees: the table owner, PUBLIC, anon, authenticated, service_role. Any row with expected = false STOPS the apply before step 2a:
-- the migration revokes from PUBLIC, anon and authenticated only, and an unknown role's own grant would neither be touched nor restored by the rollback.
select c.relname,
       case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
       string_agg(a.privilege_type, ', ' order by a.privilege_type)                          as privileges,
       (a.grantee = 0 or a.grantee = c.relowner
        or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role')) as expected
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
 where n.nspname = 'ergon_warehouse' and c.relname in ('lines', 'entries') and c.relkind = 'r'
 group by c.relname, a.grantee, c.relowner
 order by c.relname, 2;
