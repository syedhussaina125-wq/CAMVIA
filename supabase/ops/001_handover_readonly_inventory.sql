-- CAMVIA final handover: read-only discovery only.
-- Run in Supabase SQL Editor as an authorized database operator.
-- This file contains SELECT statements only; it does not modify any data or schema.
-- Do not share student/guardian row contents. The queries below return metadata and counts.

-- 1) Tenant inventory: identify the intended organization, every school, and its campuses.
select
  organization.id as organization_id,
  organization.name as organization_name,
  organization.status as organization_status,
  school.id as school_id,
  school.name as school_name,
  school.short_name as school_short_name,
  school.status as school_status,
  campus.id as campus_id,
  campus.name as campus_name,
  campus.code as campus_code,
  campus.status as campus_status
from public.organizations as organization
left join public.schools as school
  on school.organization_id = organization.id
left join public.campuses as campus
  on campus.school_id = school.id
order by organization.name, school.name, campus.name;

-- 2) Live schema inventory for operational, Trash, alert, audit, and workflow relations.
select
  namespace.nspname as schema_name,
  relation.relname as relation_name,
  case relation.relkind
    when 'r' then 'table'
    when 'p' then 'partitioned table'
    when 'v' then 'view'
    when 'm' then 'materialized view'
    when 'f' then 'foreign table'
    else relation.relkind::text
  end as relation_kind,
  attribute.attnum as ordinal_position,
  attribute.attname as column_name,
  pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as data_type,
  not attribute.attnotnull as is_nullable,
  pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) as column_default
from pg_catalog.pg_class as relation
join pg_catalog.pg_namespace as namespace
  on namespace.oid = relation.relnamespace
join pg_catalog.pg_attribute as attribute
  on attribute.attrelid = relation.oid
left join pg_catalog.pg_attrdef as default_value
  on default_value.adrelid = relation.oid
  and default_value.adnum = attribute.attnum
where namespace.nspname = 'public'
  and relation.relkind in ('r', 'p', 'v', 'm', 'f')
  and attribute.attnum > 0
  and not attribute.attisdropped
  and relation.relname ~* '(student|guardian|attendance|fee|communication|admission|registration|trash|alert|activity|audit|workflow|teacher_class)'
order by relation.relname, attribute.attnum;

-- 3) Foreign keys touching the operational relations; use this to review delete dependency order.
select
  child_namespace.nspname as child_schema,
  child.relname as child_table,
  constraint_row.conname as foreign_key_name,
  parent_namespace.nspname as parent_schema,
  parent.relname as parent_table,
  pg_catalog.pg_get_constraintdef(constraint_row.oid, true) as foreign_key_definition,
  case constraint_row.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else constraint_row.confdeltype::text
  end as on_delete
from pg_catalog.pg_constraint as constraint_row
join pg_catalog.pg_class as child
  on child.oid = constraint_row.conrelid
join pg_catalog.pg_namespace as child_namespace
  on child_namespace.oid = child.relnamespace
join pg_catalog.pg_class as parent
  on parent.oid = constraint_row.confrelid
join pg_catalog.pg_namespace as parent_namespace
  on parent_namespace.oid = parent.relnamespace
where constraint_row.contype = 'f'
  and child_namespace.nspname = 'public'
  and parent_namespace.nspname = 'public'
  and (
    child.relname ~* '(student|guardian|attendance|fee|communication|admission|registration|trash|alert|activity|audit|workflow|teacher_class)'
    or parent.relname ~* '(student|guardian|attendance|fee|communication|admission|registration|trash|alert|activity|audit|workflow|teacher_class)'
  )
order by child.relname, constraint_row.conname;

-- 4) Protected-table RLS state, policy definitions, and effective table privileges.
select
  relation.relname as table_name,
  relation.relrowsecurity as rls_enabled,
  relation.relforcerowsecurity as force_rls,
  policy.policyname,
  policy.permissive,
  policy.roles,
  policy.cmd as policy_command,
  policy.qual as using_expression,
  policy.with_check as check_expression,
  pg_catalog.has_table_privilege('anon', relation.oid, 'SELECT') as anon_has_select_grant,
  pg_catalog.has_table_privilege('anon', relation.oid, 'INSERT') as anon_has_insert_grant,
  pg_catalog.has_table_privilege('authenticated', relation.oid, 'SELECT') as authenticated_has_select_grant,
  pg_catalog.has_table_privilege('authenticated', relation.oid, 'INSERT') as authenticated_has_insert_grant,
  pg_catalog.has_table_privilege('authenticated', relation.oid, 'UPDATE') as authenticated_has_update_grant,
  pg_catalog.has_table_privilege('authenticated', relation.oid, 'DELETE') as authenticated_has_delete_grant
from pg_catalog.pg_class as relation
join pg_catalog.pg_namespace as namespace
  on namespace.oid = relation.relnamespace
left join pg_catalog.pg_policies as policy
  on policy.schemaname = namespace.nspname
  and policy.tablename = relation.relname
where namespace.nspname = 'public'
  and relation.relkind in ('r', 'p')
  and relation.relname = any (array[
    'organizations', 'schools', 'campuses', 'profiles', 'user_roles',
    'teacher_class_assignments', 'students', 'guardians', 'student_guardians',
    'attendance_sessions', 'attendance_records', 'attendance_trash_audit',
    'fee_invoices', 'fee_invoice_items', 'fee_payments',
    'communication_messages', 'communication_recipients', 'communication_events',
    'admission_applications', 'admission_application_events',
    'school_registration_links', 'user_management_audit'
  ])
order by relation.relname, policy.policyname;

-- 5) Relevant security-definer RPC signatures and grants; check public functions remain narrow.
select
  namespace.nspname as schema_name,
  function_row.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(function_row.oid) as arguments,
  function_row.prosecdef as security_definer,
  function_row.proconfig as function_settings,
  pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE') as anon_can_execute,
  pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE') as authenticated_can_execute
from pg_catalog.pg_proc as function_row
join pg_catalog.pg_namespace as namespace
  on namespace.oid = function_row.pronamespace
where namespace.nspname = 'public'
  and function_row.proname ~* '(attendance|student|guardian|fee|communication|admission|registration|trash|alert)'
order by function_row.proname, pg_catalog.pg_get_function_identity_arguments(function_row.oid);

-- 6) Exact per-school counts for physical operational tables.
-- After query 1 identifies the intended school, replace NULL below with its school UUID.
-- If the UUID is left NULL, this query deliberately reports "SCHOOL ID REQUIRED" and no counts.
-- Child tables are scoped through their immediate FK to a parent table with school_id.
-- Tables without a direct or such FK scope are marked for manual review and are not counted.
with parameters as (
  select null::uuid as target_school_id
),
operational_tables as (
  select
    relation.oid as relation_oid,
    namespace.nspname as schema_name,
    relation.relname as table_name,
    exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = relation.oid
        and attribute.attname = 'school_id'
        and attribute.attnum > 0
        and not attribute.attisdropped
    ) as has_school_id
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p')
    and relation.relname ~* '(student|guardian|attendance|fee|communication|admission|registration|trash|alert|activity|audit|workflow|teacher_class)'
),
foreign_key_scope as (
  select
    child.oid as child_oid,
    string_agg(
      pg_catalog.format(
        'exists (select 1 from %I.%I as parent_scope where %s and parent_scope.school_id = %L::uuid)',
        parent_namespace.nspname,
        parent.relname,
        (
          select string_agg(
            pg_catalog.format('table_scope.%I = parent_scope.%I', child_column.attname, parent_column.attname),
            ' and ' order by child_key.ordinality
          )
          from unnest(foreign_key.conkey) with ordinality as child_key(attnum, ordinality)
          join unnest(foreign_key.confkey) with ordinality as parent_key(attnum, ordinality)
            on parent_key.ordinality = child_key.ordinality
          join pg_catalog.pg_attribute as child_column
            on child_column.attrelid = child.oid
            and child_column.attnum = child_key.attnum
          join pg_catalog.pg_attribute as parent_column
            on parent_column.attrelid = parent.oid
            and parent_column.attnum = parent_key.attnum
        ),
        parameters.target_school_id
      ),
      ' or '
    ) as predicate
  from pg_catalog.pg_constraint as foreign_key
  join pg_catalog.pg_class as child
    on child.oid = foreign_key.conrelid
  join pg_catalog.pg_class as parent
    on parent.oid = foreign_key.confrelid
  join pg_catalog.pg_namespace as parent_namespace
    on parent_namespace.oid = parent.relnamespace
  cross join parameters
  where foreign_key.contype = 'f'
    and exists (
      select 1
      from pg_catalog.pg_attribute as school_column
      where school_column.attrelid = parent.oid
        and school_column.attname = 'school_id'
        and school_column.attnum > 0
        and not school_column.attisdropped
    )
  group by child.oid
),
scoped_tables as (
  select
    operational_tables.*,
    case
      when operational_tables.has_school_id
        then pg_catalog.format('table_scope.school_id = %L::uuid', parameters.target_school_id)
      else foreign_key_scope.predicate
    end as scope_predicate,
    case
      when operational_tables.has_school_id then 'direct school_id'
      when foreign_key_scope.predicate is not null then 'one-hop FK to school-scoped table'
      else 'manual review: no direct school_id or one-hop FK scope'
    end as scope_method,
    parameters.target_school_id
  from operational_tables
  cross join parameters
  left join foreign_key_scope
    on foreign_key_scope.child_oid = operational_tables.relation_oid
)
select
  scoped_tables.schema_name,
  scoped_tables.table_name,
  scoped_tables.scope_method,
  case
    when scoped_tables.target_school_id is null then 'SCHOOL ID REQUIRED'
    when scoped_tables.scope_predicate is null then 'NOT COUNTED: REVIEW SCOPE'
    else 'COUNTED'
  end as inspection_status,
  case
    when scoped_tables.target_school_id is null or scoped_tables.scope_predicate is null then null
    else (
      pg_catalog.xpath(
        '/table/row/row_count/text()',
        pg_catalog.query_to_xml(
          pg_catalog.format(
            'select count(*) as row_count from %I.%I as table_scope where %s',
            scoped_tables.schema_name,
            scoped_tables.table_name,
            scoped_tables.scope_predicate
          ),
          false,
          false,
          ''
        )
      )
    )[1]::text::bigint
  end as exact_row_count
from scoped_tables
order by scoped_tables.table_name;
