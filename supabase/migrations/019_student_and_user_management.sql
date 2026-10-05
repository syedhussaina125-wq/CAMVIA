begin;

create table if not exists public.user_management_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  target_id uuid not null,
  event_type text not null check (event_type in (
    'STUDENT_CREATED',
    'USER_CREATED',
    'USER_UPDATED',
    'USER_ROLE_CHANGED',
    'USER_DEACTIVATED'
  )),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists user_management_audit_actor_time_idx
  on public.user_management_audit (actor_id, occurred_at desc);

alter table public.user_management_audit enable row level security;

revoke all on public.user_management_audit from public, anon, authenticated;
grant insert on public.user_management_audit to service_role;

create or replace function public.get_current_admin_scope()
returns table (
  actor_id uuid,
  organization_id uuid,
  school_id uuid
)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
  select profile.id, profile.organization_id, profile.school_id
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;
$function$;

revoke all on function public.get_current_admin_scope() from public, anon;
grant execute on function public.get_current_admin_scope() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    status,
    role
  )
  values (
    new.id,
    new.email,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    'INACTIVE',
    'TEACHER'
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'TEACHER')
  on conflict (user_id, role) do nothing;

  return new;
end;
$function$;

create or replace function public.update_school_user(
  target_user_id uuid,
  target_full_name text,
  target_role text,
  target_status text,
  target_campus_id uuid,
  target_assignment_scopes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
  target public.profiles%rowtype;
  assignment_count integer;
  active_admin_count integer;
  scope jsonb;
  assignment_campus_id uuid;
  assignment_class_name text;
  assignment_section text;
  normalized_full_name text;
  normalized_role text;
  normalized_status text;
begin
  select profile.*
  into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can manage users.'
      using errcode = '42501';
  end if;

  normalized_full_name := nullif(btrim(target_full_name), '');
  normalized_role := upper(btrim(target_role));
  normalized_status := upper(btrim(target_status));

  if normalized_full_name is null or length(normalized_full_name) > 160 then
    raise exception 'Enter a valid full name.'
      using errcode = '22023';
  end if;

  if normalized_role not in ('ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER')
    or normalized_status not in ('ACTIVE', 'INACTIVE')
  then
    raise exception 'Select a supported role and status.'
      using errcode = '22023';
  end if;

  if target_assignment_scopes is null or jsonb_typeof(target_assignment_scopes) <> 'array' then
    raise exception 'Teacher assignments must be supplied as a list.'
      using errcode = '22023';
  end if;

  if normalized_role <> 'TEACHER' and jsonb_array_length(target_assignment_scopes) > 0 then
    raise exception 'Only teacher accounts can have class assignments.'
      using errcode = '22023';
  end if;

  select profile.*
  into target
  from public.profiles as profile
  where profile.id = target_user_id
    and profile.organization_id = actor.organization_id
    and profile.school_id = actor.school_id
  for update;

  if not found then
    raise exception 'The selected user is outside your school.'
      using errcode = '42501';
  end if;

  if target.id = actor.id
    and (normalized_role <> target.role or normalized_status <> target.status)
  then
    raise exception 'You cannot change your own role or account status.'
      using errcode = '42501';
  end if;

  if target_campus_id is not null and not exists (
    select 1
    from public.campuses as campus
    where campus.id = target_campus_id
      and campus.organization_id = actor.organization_id
      and campus.school_id = actor.school_id
      and campus.status = 'ACTIVE'
  ) then
    raise exception 'The selected campus is outside the active school scope.'
      using errcode = '42501';
  end if;

  for scope in select value from jsonb_array_elements(target_assignment_scopes)
  loop
    assignment_campus_id := nullif(scope->>'campus_id', '')::uuid;
    assignment_class_name := nullif(btrim(scope->>'class_name'), '');
    assignment_section := nullif(btrim(scope->>'section'), '');

    if assignment_campus_id is null
      or assignment_class_name is null
      or assignment_section is null
      or length(assignment_class_name) > 100
      or length(assignment_section) > 40
      or not exists (
        select 1
        from public.campuses as campus
        where campus.id = assignment_campus_id
          and campus.organization_id = actor.organization_id
          and campus.school_id = actor.school_id
          and campus.status = 'ACTIVE'
      )
    then
      raise exception 'A teacher assignment is invalid or outside the active school scope.'
        using errcode = '42501';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(target_assignment_scopes) as item(value)
    group by
      item.value->>'campus_id',
      btrim(item.value->>'class_name'),
      btrim(item.value->>'section')
    having count(*) > 1
  ) then
    raise exception 'Teacher assignment scopes must not contain duplicates.'
      using errcode = '22023';
  end if;

  assignment_count := jsonb_array_length(target_assignment_scopes);
  if normalized_role = 'TEACHER' and normalized_status = 'ACTIVE' and assignment_count = 0 then
    raise exception 'Assign at least one class and section before activating a teacher.'
      using errcode = '22023';
  end if;

  if target.role = 'ADMIN'
    and target.status = 'ACTIVE'
    and (normalized_role <> 'ADMIN' or normalized_status <> 'ACTIVE')
  then
    perform pg_advisory_xact_lock(hashtextextended(actor.school_id::text, 0));

    select count(*)::integer
    into active_admin_count
    from public.profiles as profile
    where profile.organization_id = actor.organization_id
      and profile.school_id = actor.school_id
      and profile.role = 'ADMIN'
      and profile.status = 'ACTIVE';

    if active_admin_count <= 1 then
      raise exception 'The last active school administrator cannot be demoted or deactivated.'
        using errcode = '42501';
    end if;
  end if;

  update public.profiles
  set full_name = normalized_full_name,
      role = normalized_role,
      status = normalized_status,
      campus_id = target_campus_id
  where id = target.id;

  delete from public.user_roles
  where user_id = target.id;

  insert into public.user_roles (user_id, role)
  values (target.id, normalized_role);

  update public.teacher_class_assignments
  set active = false
  where user_id = target.id
    and active;

  for scope in select value from jsonb_array_elements(target_assignment_scopes)
  loop
    assignment_campus_id := (scope->>'campus_id')::uuid;
    assignment_class_name := btrim(scope->>'class_name');
    assignment_section := btrim(scope->>'section');

    insert into public.teacher_class_assignments (
      user_id,
      school_id,
      campus_id,
      class_name,
      section,
      active
    )
    values (
      target.id,
      actor.school_id,
      assignment_campus_id,
      assignment_class_name,
      assignment_section,
      normalized_role = 'TEACHER' and normalized_status = 'ACTIVE'
    )
    on conflict (user_id, school_id, campus_id, class_name, section)
    do update set active = excluded.active;
  end loop;

  if target.role <> normalized_role then
    insert into public.user_management_audit (actor_id, target_id, event_type, details)
    values (
      actor.id,
      target.id,
      'USER_ROLE_CHANGED',
      jsonb_build_object('from_role', target.role, 'to_role', normalized_role)
    );
  end if;

  if target.status = 'ACTIVE' and normalized_status = 'INACTIVE' then
    insert into public.user_management_audit (actor_id, target_id, event_type, details)
    values (actor.id, target.id, 'USER_DEACTIVATED', '{}'::jsonb);
  elsif target.full_name <> normalized_full_name
    or target.status <> normalized_status
    or target.campus_id is distinct from target_campus_id
    or target.role <> normalized_role
    or target_assignment_scopes <> '[]'::jsonb
  then
    insert into public.user_management_audit (actor_id, target_id, event_type, details)
    values (
      actor.id,
      target.id,
      'USER_UPDATED',
      jsonb_build_object('role', normalized_role, 'status', normalized_status, 'campus_id', target_campus_id)
    );
  end if;

  return jsonb_build_object(
    'id', target.id,
    'full_name', normalized_full_name,
    'role', normalized_role,
    'status', normalized_status,
    'campus_id', target_campus_id
  );
end;
$function$;

revoke all on function public.update_school_user(uuid, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.update_school_user(uuid, text, text, text, uuid, jsonb) to authenticated;

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
  select profile.*
  into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role in ('ADMIN', 'TEACHER');

  if not found then
    raise exception 'Only active administrators and teachers can create students.'
      using errcode = '42501';
  end if;

  if actor.organization_id is null or actor.school_id is null then
    raise exception 'The account is not assigned to a school.'
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

  if not exists (
    select 1
    from public.campuses as campus
    where campus.id = target_campus_id
      and campus.organization_id = actor.organization_id
      and campus.school_id = actor.school_id
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

  insert into public.students (
    organization_id,
    school_id,
    campus_id,
    student_code,
    first_name,
    last_name,
    class_name,
    section,
    roll_number,
    date_of_birth,
    gender
  )
  values (
    actor.organization_id,
    actor.school_id,
    target_campus_id,
    btrim(target_student_code),
    btrim(target_first_name),
    btrim(target_last_name),
    btrim(target_class_name),
    btrim(target_section),
    nullif(btrim(target_roll_number), ''),
    target_date_of_birth,
    nullif(btrim(target_gender), '')
  )
  returning id into created_student_id;

  if nullif(btrim(target_guardian_first_name), '') is not null
    or nullif(btrim(target_guardian_last_name), '') is not null
    or nullif(btrim(target_guardian_phone), '') is not null
    or nullif(btrim(target_guardian_email), '') is not null
  then
    if nullif(btrim(target_guardian_first_name), '') is null
      or nullif(btrim(target_guardian_last_name), '') is null
    then
      raise exception 'Provide both guardian first and last names.'
        using errcode = '22023';
    end if;

    insert into public.guardians (
      organization_id,
      school_id,
      campus_id,
      first_name,
      last_name,
      relationship,
      phone,
      email
    )
    values (
      actor.organization_id,
      actor.school_id,
      target_campus_id,
      btrim(target_guardian_first_name),
      btrim(target_guardian_last_name),
      nullif(btrim(target_guardian_relationship), ''),
      nullif(btrim(target_guardian_phone), ''),
      nullif(btrim(target_guardian_email), '')
    )
    returning id into created_guardian_id;

    insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
    values (
      created_student_id,
      created_guardian_id,
      nullif(btrim(target_guardian_relationship), ''),
      true
    );
  end if;

  insert into public.user_management_audit (actor_id, target_id, event_type, details)
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

revoke all on function public.create_student(
  uuid, text, text, text, text, text, text, date, text, text, text, text, text, text
) from public, anon;
grant execute on function public.create_student(
  uuid, text, text, text, text, text, text, date, text, text, text, text, text, text
) to authenticated;

drop policy if exists students_insert_same_school_admin on public.students;
drop policy if exists students_insert_school_admin on public.students;
drop policy if exists students_insert_scoped on public.students;

revoke insert, update, delete on public.students from public, anon, authenticated;
grant select on public.students to authenticated;

commit;
