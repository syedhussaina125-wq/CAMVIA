begin;

create or replace function public.approve_admission_application(
  p_application_id uuid,
  p_campus_id uuid,
  p_roll_number text,
  p_section text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
  target public.admission_applications%rowtype;
  v_student_id uuid;
  student_first_name text;
  student_last_name text;
  guardian_first_name text;
  guardian_last_name text;
  primary_guardian_id uuid;
  secondary_guardian_id uuid;
  secondary_guardian_first_name text;
  secondary_guardian_last_name text;
  section_name text := nullif(btrim(p_section), '');
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can approve admissions.'
      using errcode = '42501';
  end if;

  select application.* into target
  from public.admission_applications as application
  where application.id = p_application_id
    and application.school_id = actor.school_id
    and application.status = 'PENDING'
  for update;

  if not found then
    raise exception 'This application is no longer pending.'
      using errcode = '42501';
  end if;

  if nullif(btrim(target.student_name), '') is null
    or target.date_of_birth >= current_date
    or nullif(btrim(target.applying_class), '') is null
    or nullif(btrim(target.guardian_name), '') is null
    or nullif(btrim(target.guardian_relationship), '') is null
    or target.guardian_phone !~ '^[0-9]{8,15}$'
    or length(coalesce(target.guardian_address, '')) > 300
    or (target.secondary_guardian_name is not null
      and (target.secondary_guardian_relationship is null
        or length(target.secondary_guardian_name) > 160
        or length(target.secondary_guardian_relationship) > 60))
    or (target.secondary_guardian_name is null and (
      target.secondary_guardian_relationship is not null
      or target.secondary_guardian_phone is not null
      or target.secondary_guardian_email is not null
    ))
    or (target.secondary_guardian_phone is not null
      and target.secondary_guardian_phone !~ '^[0-9]{8,15}$')
    or section_name is null
    or length(section_name) > 40
  then
    raise exception 'Complete the student and guardian details before approval.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.campuses as campus
    where campus.id = p_campus_id
      and campus.organization_id = actor.organization_id
      and campus.school_id = actor.school_id
      and campus.status = 'ACTIVE'
  ) then
    raise exception 'Select an active campus in your school.'
      using errcode = '42501';
  end if;

  student_first_name := split_part(btrim(target.student_name), ' ', 1);
  student_last_name := nullif(btrim(substr(btrim(target.student_name), length(student_first_name) + 1)), '');
  guardian_first_name := split_part(btrim(target.guardian_name), ' ', 1);
  guardian_last_name := nullif(btrim(substr(btrim(target.guardian_name), length(guardian_first_name) + 1)), '');

  v_student_id := public.create_student(
    p_campus_id,
    target.application_reference,
    student_first_name,
    coalesce(student_last_name, student_first_name),
    target.applying_class,
    section_name,
    p_roll_number,
    target.date_of_birth,
    target.gender,
    guardian_first_name,
    coalesce(guardian_last_name, guardian_first_name),
    target.guardian_phone,
    target.guardian_email,
    target.guardian_relationship
  );

  select relation.guardian_id into primary_guardian_id
  from public.student_guardians as relation
  where relation.student_id = v_student_id
    and relation.is_primary
  limit 1;

  if primary_guardian_id is null then
    raise exception 'The primary guardian could not be linked to the new student.'
      using errcode = '23503';
  end if;

  update public.guardians
  set address = target.guardian_address
  where id = primary_guardian_id;

  if target.secondary_guardian_name is not null then
    secondary_guardian_first_name := split_part(target.secondary_guardian_name, ' ', 1);
    secondary_guardian_last_name := nullif(btrim(substr(target.secondary_guardian_name, length(secondary_guardian_first_name) + 1)), '');

    insert into public.guardians (
      organization_id, school_id, campus_id, first_name, last_name,
      relationship, phone, email
    )
    values (
      actor.organization_id, actor.school_id, p_campus_id,
      secondary_guardian_first_name, coalesce(secondary_guardian_last_name, secondary_guardian_first_name),
      target.secondary_guardian_relationship, target.secondary_guardian_phone,
      target.secondary_guardian_email
    )
    returning id into secondary_guardian_id;

    insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
    values (v_student_id, secondary_guardian_id, target.secondary_guardian_relationship, false);
  end if;

  update public.admission_applications
  set status = 'APPROVED',
    preferred_section = section_name,
    reviewed_by = actor.id,
    reviewed_at = now(),
    approved_by = actor.id,
    approved_at = now(),
    created_student_id = v_student_id
  where id = target.id;

  insert into public.admission_application_events (application_id, actor_id, event_type, details)
  values (
    target.id, actor.id, 'APPROVED',
    jsonb_build_object(
      'created_student_id', v_student_id,
      'campus_id', p_campus_id,
      'secondary_guardian_linked', secondary_guardian_id is not null
    )
  );

  return v_student_id;
end;
$function$;

commit;
