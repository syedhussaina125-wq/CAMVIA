begin;

-- Keep the existing authenticated class-scope checks while allowing direct saves
-- to update finalized sessions through the student-keyed attendance upsert.
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
as $function$
declare
  saved_session_id uuid;
  expected_student_count integer;
  submitted_row_count integer;
  submitted_student_count integer;
  saved_student_count integer;
  school_timezone text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to save attendance.'
      using errcode = '42501';
  end if;

  if target_attendance_date is null
    or nullif(btrim(target_class_name), '') is null
    or nullif(btrim(target_section), '') is null
    or target_records is null
    or jsonb_typeof(target_records) <> 'array'
  then
    raise exception 'The attendance submission is invalid.'
      using errcode = '22023';
  end if;

  if not public.can_manage_attendance_scope(
    target_organization_id,
    target_school_id,
    target_campus_id,
    target_class_name,
    target_section
  )
  then
    raise exception 'The attendance scope is invalid.'
      using errcode = '42501';
  end if;

  select case
      when exists (
        select 1
        from pg_catalog.pg_timezone_names as valid_timezone
        where valid_timezone.name = nullif(btrim(school.timezone), '')
      )
        then btrim(school.timezone)
      else 'UTC'
    end
    into school_timezone
  from public.schools as school
  where school.id = target_school_id
    and school.organization_id = target_organization_id;

  if target_attendance_date > (pg_catalog.now() at time zone coalesce(school_timezone, 'UTC'))::date then
    raise exception 'Attendance date cannot be recorded in the future.'
      using errcode = '22023';
  end if;

  select count(*)::integer
    into expected_student_count
  from public.students as student
  where student.organization_id = target_organization_id
    and student.school_id = target_school_id
    and student.campus_id = target_campus_id
    and student.class_name = target_class_name
    and student.section = target_section
    and student.status = 'ACTIVE'
    and student.deleted_at is null;

  select count(*)::integer, count(distinct submitted.student_id)::integer
    into submitted_row_count, submitted_student_count
  from jsonb_to_recordset(target_records)
    as submitted(student_id uuid, status text, note text);

  if expected_student_count = 0
    or submitted_row_count = 0
    or submitted_row_count <> submitted_student_count
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
        and student.status = 'ACTIVE'
        and student.deleted_at is null
      where student.id is null
        or submitted.student_id is null
        or submitted.status is null
        or submitted.status not in ('PRESENT', 'ABSENT', 'LATE')
    )
  then
    raise exception 'Attendance changes must include one valid status per changed active student in the assigned class.'
      using errcode = '22023';
  end if;

  insert into public.attendance_sessions (
    organization_id, school_id, campus_id, class_name, section,
    attendance_date, created_by, updated_by, status
  )
  values (
    target_organization_id, target_school_id, target_campus_id,
    target_class_name, target_section, target_attendance_date,
    auth.uid(), auth.uid(), 'IN_PROGRESS'
  )
  on conflict (
    organization_id, school_id, campus_id, class_name, section,
    attendance_date
  )
  do update set
    updated_by = auth.uid(),
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

  select count(*)::integer
    into saved_student_count
  from public.attendance_records as record
  join public.students as student
    on student.id = record.student_id
    and student.organization_id = target_organization_id
    and student.school_id = target_school_id
    and student.campus_id = target_campus_id
    and student.class_name = target_class_name
    and student.section = target_section
    and student.status = 'ACTIVE'
    and student.deleted_at is null
  where record.attendance_session_id = saved_session_id;

  update public.attendance_sessions
  set status = case
        when saved_student_count = expected_student_count then 'COMPLETED'
        else 'IN_PROGRESS'
      end,
      updated_by = auth.uid(),
      updated_at = pg_catalog.now()
  where id = saved_session_id;

  return saved_session_id;
end;
$function$;

alter function public.save_attendance_session(uuid, uuid, uuid, text, text, date, jsonb) owner to postgres;
revoke all on function public.save_attendance_session(uuid, uuid, uuid, text, text, date, jsonb) from public, anon;
grant execute on function public.save_attendance_session(uuid, uuid, uuid, text, text, date, jsonb) to authenticated;

commit;
