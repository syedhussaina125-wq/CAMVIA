-- Migration 044: Student Duplicate Prevention
-- Enforces consistent duplicate prevention across active and trashed students within the school scope:
-- 1. Student ID / student_code match -> 'Student ID already exists.'
-- 2. Roll number match within same class + section (when roll number provided) -> 'Roll number already exists in <class>-<section>.'
-- 3. Likely duplicate student identity (first name, last name, DOB, class, section) -> 'Possible duplicate student found. Review before creating.'
-- Preserves verified schema relations:
--   - public.students (11 columns + soft delete/archival metadata)
--   - public.guardians (8 columns + audit)
--   - public.student_guardians (student_id, guardian_id, relationship, is_primary)
--   - public.user_management_audit (STUDENT_CREATED event)

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

  -- DUPLICATE RULE 1: Student ID / student_code matches active or trashed student in same school
  if exists (
    select 1
    from public.students as existing_student
    where existing_student.school_id = actor.school_id
      and lower(btrim(existing_student.student_code)) = lower(btrim(target_student_code))
  ) then
    raise exception 'Student ID already exists.'
      using errcode = '23505';
  end if;

  -- DUPLICATE RULE 2: Roll number matches within same class + section (when roll number provided)
  if nullif(btrim(target_roll_number), '') is not null and exists (
    select 1
    from public.students as existing_student
    where existing_student.school_id = actor.school_id
      and lower(btrim(existing_student.class_name)) = lower(btrim(target_class_name))
      and lower(btrim(existing_student.section)) = lower(btrim(target_section))
      and lower(btrim(coalesce(existing_student.roll_number, ''))) = lower(btrim(target_roll_number))
  ) then
    raise exception 'Roll number already exists in %-%', btrim(target_class_name), btrim(target_section)
      using errcode = '23505';
  end if;

  -- DUPLICATE RULE 3: Likely duplicate student identity (first name, last name, DOB, class, section)
  if target_date_of_birth is not null and exists (
    select 1
    from public.students as existing_student
    where existing_student.school_id = actor.school_id
      and lower(btrim(existing_student.first_name)) = lower(btrim(target_first_name))
      and lower(btrim(existing_student.last_name)) = lower(btrim(target_last_name))
      and existing_student.date_of_birth = target_date_of_birth
      and lower(btrim(existing_student.class_name)) = lower(btrim(target_class_name))
      and lower(btrim(existing_student.section)) = lower(btrim(target_section))
  ) then
    raise exception 'Possible duplicate student found. Review before creating.'
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
