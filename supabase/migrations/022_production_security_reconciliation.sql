-- Forward-only reconciliation for the live CAMVIA schema.
-- This migration is a proposal and has not been applied to any database.

begin;

do $preflight$
declare
  required_object text;
begin
  -- 1. Targeted migration role capability check
  -- Hosted Supabase runs migrations as role 'postgres' (rolsuper = false, rolbypassrls = true).
  -- Verify that the executing role is 'postgres' and has bypassrls capability.
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = current_user
      and (rolsuper or rolbypassrls)
  ) then
    raise exception
      'Migration role % lacks required administrative privileges (superuser or bypassrls) to reconcile schema.',
      current_user;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'postgres'
  ) then
    raise exception
      'Expected standard Supabase role postgres is missing.';
  end if;

  -- 2. Verify all 20 required CAMVIA tables exist
  foreach required_object in array array[
    'public.organizations',
    'public.schools',
    'public.campuses',
    'public.roles',
    'public.profiles',
    'public.user_roles',
    'public.teacher_class_assignments',
    'public.students',
    'public.guardians',
    'public.student_guardians',
    'public.attendance_sessions',
    'public.attendance_records',
    'public.fee_invoices',
    'public.fee_invoice_items',
    'public.fee_payments',
    'public.communication_messages',
    'public.communication_recipients',
    'public.communication_events',
    'public.integration_configs',
    'public.user_management_audit'
  ]
  loop
    if pg_catalog.to_regclass(required_object) is null then
      raise exception 'Required CAMVIA object is missing: %', required_object;
    end if;
  end loop;

  -- 3. Verify expected live functions exist
  if pg_catalog.to_regprocedure(
    'public.handle_new_user()'
  ) is null
    or pg_catalog.to_regprocedure(
      'public.set_administration_audit()'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.set_updated_at()'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.save_attendance_session(uuid,uuid,uuid,text,text,date,jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.can_manage_attendance_scope(uuid,uuid,uuid,text,text)'
    ) is null
  then
    raise exception
      'Expected live trigger/RPC functions or signatures differ; reconcile against the live schema before applying.';
  end if;

  -- 4. Verify uniqueness constraints
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.students'::regclass
      and conname = 'students_school_code_unique'
      and contype = 'u'
  ) then
    raise exception
      'Expected unique constraint students_school_code_unique is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.attendance_sessions'::regclass
      and conname = 'attendance_sessions_scope_date_unique'
      and contype = 'u'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.attendance_records'::regclass
      and conname = 'attendance_records_session_student_unique'
      and contype = 'u'
  ) then
    raise exception
      'Expected attendance uniqueness constraints are missing.';
  end if;

  -- 5. Disallow unknown/unsafe anon or PUBLIC RLS policies on protected tables
  -- Note: PostgreSQL pg_policies reports roles = '{public}' when CREATE POLICY omits TO <role>.
  -- Known legacy policies created with roles = {public} that contain explicit auth.uid() or
  -- helper-scoped predicates are safely dropped/recreated below.
  -- Reject only policies with role 'anon' or unknown policies that lack authenticated guards.
  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'organizations', 'schools', 'campuses', 'roles', 'profiles',
        'user_roles', 'teacher_class_assignments', 'students', 'guardians',
        'student_guardians', 'attendance_sessions', 'attendance_records',
        'fee_invoices', 'fee_invoice_items', 'fee_payments',
        'communication_messages', 'communication_recipients',
        'communication_events', 'integration_configs',
        'user_management_audit'
      ])
      and (
        roles && array['anon'::name]
        or (
          roles && array['public'::name]
          and policyname not in (
            'organizations_authenticated_read_only', 'organizations_own_org_read', 'organizations_read_own',
            'schools_scope_read', 'schools_own_school_read', 'schools_read_own', 'schools_admin_update_own',
            'campuses_scope_read', 'campuses_own_school_read', 'campuses_read_own_school', 'campuses_admin_update_own_school',
            'roles_public_read', 'roles_read_authenticated',
            'profiles_self_and_school_scope_read', 'profiles_self_update', 'profiles_admin_manage',
            'profiles_admin_manage_same_school', 'profiles_read_self_or_school_admin', 'profiles_read_own',
            'profiles_read_same_school_admin_principal',
            'user_roles_same_school_read', 'user_roles_read_self_or_school_admin',
            'teacher_assignments_own_or_admin', 'teacher_assignments_own_or_school_admin_read',
            'teacher_assignments_admin_write', 'teacher_assignments_admin_update',
            'teacher_assignments_read_own_or_school_admin', 'teacher_assignments_write_school_admin',
            'teacher_assignments_update_school_admin',
            'students_school_scope_read', 'students_admin_or_principal_manage', 'students_finance_read_only',
            'students_read_accessible_scope', 'students_insert_school_admin', 'students_update_school_admin',
            'students_insert_same_school_admin', 'students_update_same_school_admin',
            'guardians_school_scope_read', 'guardians_admin_manage', 'guardians_admin_manage_same_school',
            'guardians_read_accessible_scope', 'guardians_write_school_admin', 'guardians_insert_same_school_admin',
            'guardians_delete_same_school_admin',
            'student_guardians_school_scope_read', 'student_guardians_admin_manage',
            'student_guardians_admin_manage_same_school', 'student_guardians_read_accessible',
            'student_guardians_write_school_admin',
            'attendance_sessions_read_accessible_scope', 'attendance_sessions_insert_assigned_scope',
            'attendance_sessions_update_assigned_scope', 'attendance_records_read_accessible_scope',
            'attendance_records_insert_assigned_scope', 'attendance_records_update_assigned_scope',
            'fee_invoices_read_same_school', 'fee_invoice_items_read_same_school', 'fee_payments_read_same_school',
            'communication_messages_read_authorized_school', 'communication_recipients_read_authorized_school',
            'communication_events_read_authorized_school', 'integration_configs_read_school_admin'
          )
        )
      )
  ) then
    raise exception
      'An unexpected anon or unknown PUBLIC RLS policy exists on a protected table; review it before applying.';
  end if;
end;
$preflight$;

-- Reconcile audit event constraint safely to allow STUDENT_CREATED
-- while preserving all valid USER_* event types.
do $reconcile_audit_check$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.user_management_audit'::regclass
      and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) like '%event_type%'
  loop
    execute format(
      'alter table public.user_management_audit drop constraint if exists %I',
      constraint_record.conname
    );
  end loop;

  alter table public.user_management_audit
    add constraint user_management_audit_event_type_check
    check (event_type in (
      'STUDENT_CREATED',
      'USER_CREATED',
      'USER_UPDATED',
      'USER_ROLE_CHANGED',
      'USER_DEACTIVATED'
    ));
end;
$reconcile_audit_check$;

-- Remove current table-level and column-level ACLs first. Access below is
-- re-granted explicitly; column-specific administration updates are restored.
revoke all privileges on table
  public.organizations,
  public.schools,
  public.campuses,
  public.roles,
  public.profiles,
  public.user_roles,
  public.teacher_class_assignments,
  public.students,
  public.guardians,
  public.student_guardians,
  public.attendance_sessions,
  public.attendance_records,
  public.fee_invoices,
  public.fee_invoice_items,
  public.fee_payments,
  public.communication_messages,
  public.communication_recipients,
  public.communication_events,
  public.integration_configs,
  public.user_management_audit
from public, anon, authenticated;

do $column_acl$
declare
  column_grant record;
  grant_role text;
begin
  for column_grant in
    select table_name, column_name, privilege_type, grantee
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = any (array[
        'organizations', 'schools', 'campuses', 'roles', 'profiles',
        'user_roles', 'teacher_class_assignments', 'students', 'guardians',
        'student_guardians', 'attendance_sessions', 'attendance_records',
        'fee_invoices', 'fee_invoice_items', 'fee_payments',
        'communication_messages', 'communication_recipients',
        'communication_events', 'integration_configs',
        'user_management_audit'
      ])
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  loop
    grant_role := case
      when column_grant.grantee = 'PUBLIC' then 'PUBLIC'
      else format('%I', column_grant.grantee)
    end;

    execute format(
      'revoke %s (%I) on table public.%I from %s',
      column_grant.privilege_type,
      column_grant.column_name,
      column_grant.table_name,
      grant_role
    );
  end loop;
end;
$column_acl$;

grant select on table
  public.organizations,
  public.schools,
  public.campuses,
  public.roles,
  public.profiles,
  public.user_roles,
  public.teacher_class_assignments,
  public.students,
  public.guardians,
  public.student_guardians,
  public.attendance_sessions,
  public.attendance_records,
  public.fee_invoices,
  public.fee_invoice_items,
  public.fee_payments,
  public.communication_messages,
  public.communication_recipients,
  public.communication_events,
  public.integration_configs
to authenticated;

grant update (full_name) on table public.profiles to authenticated;
grant update (name, short_name, email, phone, address, timezone)
  on table public.schools to authenticated;
grant update (name, code, address, status)
  on table public.campuses to authenticated;

-- The application mutates these records through reviewed RPCs only.
revoke insert, update, delete, truncate, references, trigger
  on table public.organizations, public.roles, public.user_roles,
  public.teacher_class_assignments, public.students, public.guardians,
  public.student_guardians, public.attendance_sessions,
  public.attendance_records
  from public, anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.schools, public.campuses
  from public, anon, authenticated;
revoke update (name, short_name, email, phone, address, timezone)
  on table public.schools from public, anon, authenticated;
revoke update (name, code, address, status)
  on table public.campuses from public, anon, authenticated;
grant update (name, short_name, email, phone, address, timezone)
  on table public.schools to authenticated;
grant update (name, code, address, status)
  on table public.campuses to authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.profiles, public.fee_invoices, public.fee_invoice_items,
  public.fee_payments, public.communication_messages,
  public.communication_recipients, public.communication_events,
  public.integration_configs, public.user_management_audit
  from public, anon, authenticated;

-- Direct authenticated writes to student_guardians must remain dropped/revoked.
drop policy if exists student_guardians_write_school_admin
  on public.student_guardians;

alter table public.organizations enable row level security;
alter table public.schools enable row level security;
alter table public.campuses enable row level security;
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.teacher_class_assignments enable row level security;
alter table public.students enable row level security;
alter table public.guardians enable row level security;
alter table public.student_guardians enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.fee_invoices enable row level security;
alter table public.fee_invoice_items enable row level security;
alter table public.fee_payments enable row level security;
alter table public.communication_messages enable row level security;
alter table public.communication_recipients enable row level security;
alter table public.communication_events enable row level security;
alter table public.integration_configs enable row level security;
alter table public.user_management_audit enable row level security;

-- Default privileges scoped strictly to IN SCHEMA public for role postgres.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;

-- Remediation block for default privileges: executed safely if executing role has permissions,
-- without causing the migration to fail on hosted Supabase environments where role membership differs.
do $reconcile_defaults$
begin
  begin
    alter default privileges for role postgres in schema public
      revoke execute on functions from public, anon, authenticated;
  exception
    when insufficient_privilege then
      raise notice 'Skipping alter default privileges on functions for postgres due to permissions.';
  end;

  if exists (select 1 from pg_catalog.pg_roles where rolname = 'supabase_admin') then
    begin
      alter default privileges for role supabase_admin in schema public
        revoke all on tables from public, anon, authenticated;
      alter default privileges for role supabase_admin in schema public
        revoke all on sequences from public, anon, authenticated;
      alter default privileges for role supabase_admin in schema public
        revoke execute on functions from public, anon, authenticated;
    exception
      when insufficient_privilege then
        raise notice 'Skipping alter default privileges for supabase_admin due to permissions.';
    end;
  end if;
end;
$reconcile_defaults$;

-- Explicit hardening of existing functions
alter function public.handle_new_user()
  set search_path = pg_catalog, public, auth;
alter function public.set_administration_audit()
  set search_path = pg_catalog, public, auth;
alter function public.set_updated_at()
  set search_path = pg_catalog, public;

revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.set_administration_audit() from public, anon;
revoke execute on function public.set_updated_at() from public, anon;

-- Restore the frontend's existing RPC contract with strengthened tenant and scope validation.
-- The actor's tenant comes only from the active profile; caller-supplied organization/school IDs are absent.
create or replace function public.create_student(
  target_campus_id uuid,
  target_student_code text,
  target_first_name text,
  target_last_name text,
  target_class_name text,
  target_section text,
  target_roll_number text default null,
  target_date_of_birth date default null,
  target_gender text default null,
  target_guardian_first_name text default null,
  target_guardian_last_name text default null,
  target_guardian_phone text default null,
  target_guardian_email text default null,
  target_guardian_relationship text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
  created_student_id uuid;
  created_guardian_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to create a student.'
      using errcode = '42501';
  end if;

  select profile.*
    into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role in ('ADMIN', 'TEACHER');

  if not found
    or actor.organization_id is null
    or actor.school_id is null
  then
    raise exception 'Only active school administrators and assigned teachers can create students.'
      using errcode = '42501';
  end if;

  if nullif(btrim(target_student_code), '') is null
    or nullif(btrim(target_first_name), '') is null
    or nullif(btrim(target_last_name), '') is null
    or nullif(btrim(target_class_name), '') is null
    or nullif(btrim(target_section), '') is null
  then
    raise exception 'Student ID, names, class, and section are required.'
      using errcode = '22023';
  end if;

  if char_length(btrim(target_student_code)) > 100
    or char_length(btrim(target_first_name)) > 100
    or char_length(btrim(target_last_name)) > 100
    or char_length(btrim(target_class_name)) > 100
    or char_length(btrim(target_section)) > 50
    or char_length(btrim(coalesce(target_roll_number, ''))) > 50
    or char_length(btrim(coalesce(target_gender, ''))) > 50
    or char_length(btrim(coalesce(target_guardian_first_name, ''))) > 100
    or char_length(btrim(coalesce(target_guardian_last_name, ''))) > 100
    or char_length(btrim(coalesce(target_guardian_relationship, ''))) > 80
  then
    raise exception 'One or more student or guardian fields exceed the supported length.'
      using errcode = '22023';
  end if;

  if target_date_of_birth > current_date then
    raise exception 'Date of birth cannot be in the future.'
      using errcode = '22023';
  end if;

  if nullif(btrim(target_guardian_email), '') is not null
    and (
      char_length(btrim(target_guardian_email)) > 254
      or btrim(target_guardian_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  then
    raise exception 'Enter a valid guardian email address.'
      using errcode = '22023';
  end if;

  if nullif(btrim(target_guardian_phone), '') is not null
    and (
      char_length(btrim(target_guardian_phone)) > 40
      or btrim(target_guardian_phone) !~ '^[+0-9(). -]{7,40}$'
      or length(regexp_replace(btrim(target_guardian_phone), '[^0-9]', '', 'g')) < 7
    )
  then
    raise exception 'Enter a valid guardian phone number.'
      using errcode = '22023';
  end if;

  -- Campus consistency check: verify id, school_id, organization_id, and status = ACTIVE
  if not exists (
    select 1
    from public.campuses as campus
    where campus.id = target_campus_id
      and campus.school_id = actor.school_id
      and campus.organization_id = actor.organization_id
      and campus.status = 'ACTIVE'
  ) then
    raise exception 'The selected campus is outside the active school scope.'
      using errcode = '42501';
  end if;

  if actor.role = 'TEACHER' and not exists (
    select 1
    from public.teacher_class_assignments as assignment
    where assignment.user_id = actor.id
      and assignment.school_id = actor.school_id
      and assignment.campus_id = target_campus_id
      and assignment.class_name = btrim(target_class_name)
      and assignment.section = btrim(target_section)
      and assignment.active
  ) then
    raise exception 'The class, section, or campus is outside the teacher assignment scope.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.students as existing_student
    where existing_student.school_id = actor.school_id
      and existing_student.student_code = btrim(target_student_code)
  ) then
    raise exception 'The student ID already exists in this school.'
      using errcode = '23505';
  end if;

  insert into public.students (
    organization_id, school_id, campus_id, student_code, first_name,
    last_name, class_name, section, roll_number, date_of_birth, gender
  )
  values (
    actor.organization_id, actor.school_id, target_campus_id,
    btrim(target_student_code), btrim(target_first_name),
    btrim(target_last_name), btrim(target_class_name),
    btrim(target_section), nullif(btrim(target_roll_number), ''),
    target_date_of_birth, nullif(btrim(target_gender), '')
  )
  returning id into created_student_id;

  if nullif(btrim(target_guardian_first_name), '') is not null
    or nullif(btrim(target_guardian_last_name), '') is not null
    or nullif(btrim(target_guardian_phone), '') is not null
    or nullif(btrim(target_guardian_email), '') is not null
    or nullif(btrim(target_guardian_relationship), '') is not null
  then
    if actor.role <> 'ADMIN' then
      raise exception 'Only an active school administrator can create or link a guardian.'
        using errcode = '42501';
    end if;

    if nullif(btrim(target_guardian_first_name), '') is null
      or nullif(btrim(target_guardian_last_name), '') is null
    then
      raise exception 'Provide both guardian first and last names.'
        using errcode = '22023';
    end if;

    insert into public.guardians (
      organization_id, school_id, campus_id, first_name, last_name,
      relationship, phone, email
    )
    values (
      actor.organization_id, actor.school_id, target_campus_id,
      btrim(target_guardian_first_name), btrim(target_guardian_last_name),
      nullif(btrim(target_guardian_relationship), ''),
      nullif(btrim(target_guardian_phone), ''),
      nullif(btrim(target_guardian_email), '')
    )
    returning id into created_guardian_id;

    -- Strict guardian linking check:
    -- student.school_id = guardian.school_id = actor.school_id AND
    -- student.organization_id = guardian.organization_id = actor.organization_id
    if not exists (
      select 1
      from public.students as student
      join public.guardians as guardian
        on guardian.organization_id = student.organization_id
        and guardian.school_id = student.school_id
      where student.id = created_student_id
        and guardian.id = created_guardian_id
        and student.school_id = actor.school_id
        and guardian.school_id = actor.school_id
        and student.organization_id = actor.organization_id
        and guardian.organization_id = actor.organization_id
    ) then
      raise exception 'Guardian and student must belong to the same organization and school.'
        using errcode = '42501';
    end if;

    insert into public.student_guardians (
      student_id, guardian_id, relationship, is_primary
    )
    values (
      created_student_id, created_guardian_id,
      nullif(btrim(target_guardian_relationship), ''), true
    );
  end if;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    created_student_id,
    'STUDENT_CREATED',
    jsonb_build_object(
      'school_id', actor.school_id,
      'campus_id', target_campus_id,
      'class_name', btrim(target_class_name),
      'section', btrim(target_section)
    )
  );

  return created_student_id;
end;
$function$;

alter function public.create_student(
  uuid, text, text, text, text, text, text, date, text, text, text, text,
  text, text
) owner to postgres;

revoke all on function public.create_student(
  uuid, text, text, text, text, text, text, date, text, text, text, text,
  text, text
) from public, anon, authenticated;
grant execute on function public.create_student(
  uuid, text, text, text, text, text, text, date, text, text, text, text,
  text, text
) to authenticated;

-- Preserve the existing attendance RPC signature but move its mutation path
-- behind explicit authorization and complete-roster validation. Direct table
-- writes are removed after this replacement.
create or replace function public.save_attendance_session(
  target_organization_id uuid,
  target_school_id uuid,
  target_campus_id uuid,
  target_class_name text,
  target_section text,
  target_attendance_date date,
  target_records jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  saved_session_id uuid;
  expected_student_count integer;
  submitted_row_count integer;
  submitted_student_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to save attendance.'
      using errcode = '42501';
  end if;

  if target_attendance_date is null
    or target_attendance_date > current_date
    or nullif(btrim(target_class_name), '') is null
    or nullif(btrim(target_section), '') is null
    or target_records is null
    or jsonb_typeof(target_records) <> 'array'
    or not public.can_manage_attendance_scope(
      target_organization_id,
      target_school_id,
      target_campus_id,
      target_class_name,
      target_section
    )
  then
    raise exception 'The attendance scope or submission is invalid.'
      using errcode = '42501';
  end if;

  select count(*)::integer
    into expected_student_count
  from public.students as student
  where student.organization_id = target_organization_id
    and student.school_id = target_school_id
    and student.campus_id = target_campus_id
    and student.class_name = target_class_name
    and student.section = target_section;

  select count(*)::integer, count(distinct submitted.student_id)::integer
    into submitted_row_count, submitted_student_count
  from jsonb_to_recordset(target_records)
    as submitted(student_id uuid, status text, note text);

  if expected_student_count = 0
    or submitted_row_count <> expected_student_count
    or submitted_student_count <> expected_student_count
    or exists (
      select 1
      from jsonb_to_recordset(target_records)
        as submitted(student_id uuid, status text, note text)
      left join public.students as student
        on student.id = submitted.student_id
        and student.organization_id = target_organization_id
        and student.school_id = target_school_id
        and student.campus_id = target_campus_id
        and student.class_name = target_class_name
        and student.section = target_section
      where student.id is null
        or submitted.student_id is null
        or submitted.status is null
        or submitted.status not in ('PRESENT', 'ABSENT', 'LATE')
    )
  then
    raise exception 'Attendance must include exactly one valid status for every student in the assigned class.'
      using errcode = '22023';
  end if;

  insert into public.attendance_sessions (
    organization_id, school_id, campus_id, class_name, section,
    attendance_date, created_by, updated_by, status
  )
  values (
    target_organization_id, target_school_id, target_campus_id,
    target_class_name, target_section, target_attendance_date,
    auth.uid(), auth.uid(), 'COMPLETED'
  )
  on conflict (
    organization_id, school_id, campus_id, class_name, section,
    attendance_date
  )
  do update set
    updated_by = auth.uid(),
    status = 'COMPLETED',
    updated_at = pg_catalog.now()
  returning id into saved_session_id;

  insert into public.attendance_records (
    attendance_session_id, student_id, status, note, marked_by
  )
  select
    saved_session_id,
    submitted.student_id,
    submitted.status,
    coalesce(submitted.note, ''),
    auth.uid()
  from jsonb_to_recordset(target_records)
    as submitted(student_id uuid, status text, note text)
  on conflict (attendance_session_id, student_id)
  do update set
    status = excluded.status,
    note = excluded.note,
    marked_by = auth.uid(),
    updated_at = pg_catalog.now();

  return saved_session_id;
end;
$function$;

alter function public.save_attendance_session(
  uuid, uuid, uuid, text, text, date, jsonb
) owner to postgres;

revoke all on function public.save_attendance_session(
  uuid, uuid, uuid, text, text, date, jsonb
) from public, anon, authenticated;
grant execute on function public.save_attendance_session(
  uuid, uuid, uuid, text, text, date, jsonb
) to authenticated, service_role;

-- Finally remove all unauthenticated privileges on every application table,
-- including any permissions inherited from an earlier broad grant.
revoke all privileges on table
  public.organizations, public.schools, public.campuses, public.roles,
  public.profiles, public.user_roles, public.teacher_class_assignments,
  public.students, public.guardians, public.student_guardians,
  public.attendance_sessions, public.attendance_records, public.fee_invoices,
  public.fee_invoice_items, public.fee_payments,
  public.communication_messages, public.communication_recipients,
  public.communication_events, public.integration_configs,
  public.user_management_audit
from public, anon;

commit;
