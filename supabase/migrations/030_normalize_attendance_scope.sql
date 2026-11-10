begin;

create or replace function public.can_access_attendance_scope(
  target_organization_id uuid,
  target_school_id uuid,
  target_campus_id uuid,
  target_class_name text,
  target_section text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
  select exists (
    select 1
    from public.profiles as requester
    join public.schools as school
      on school.id = target_school_id
      and school.organization_id = target_organization_id
    join public.campuses as campus
      on campus.id = target_campus_id
      and campus.school_id = school.id
      and campus.organization_id = school.organization_id
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.organization_id = target_organization_id
      and requester.school_id = target_school_id
      and (
        requester.role in ('ADMIN', 'PRINCIPAL')
        or requester.role = 'FINANCE'
        or exists (
          select 1
          from public.user_roles as assigned_role
          where assigned_role.user_id = requester.id
            and assigned_role.role in ('ADMIN', 'PRINCIPAL', 'FINANCE')
        )
        or (
          requester.role = 'TEACHER'
          and exists (
            select 1
            from public.teacher_class_assignments as assignment
            where assignment.user_id = requester.id
              and assignment.active = true
              and assignment.school_id = target_school_id
              and assignment.campus_id = target_campus_id
              and lower(btrim(regexp_replace(assignment.class_name, '[[:space:]]+', ' ', 'g')))
                = lower(btrim(regexp_replace(target_class_name, '[[:space:]]+', ' ', 'g')))
              and lower(btrim(regexp_replace(assignment.section, '[[:space:]]+', ' ', 'g')))
                = lower(btrim(regexp_replace(target_section, '[[:space:]]+', ' ', 'g')))
          )
        )
      )
  );
$function$;

create or replace function public.can_manage_attendance_scope(
  target_organization_id uuid,
  target_school_id uuid,
  target_campus_id uuid,
  target_class_name text,
  target_section text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
  select public.can_access_attendance_scope(
    target_organization_id,
    target_school_id,
    target_campus_id,
    target_class_name,
    target_section
  )
  and exists (
    select 1
    from public.profiles as requester
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.organization_id = target_organization_id
      and requester.school_id = target_school_id
      and (
        requester.role in ('ADMIN', 'PRINCIPAL')
        or exists (
          select 1
          from public.user_roles as assigned_role
          where assigned_role.user_id = requester.id
            and assigned_role.role in ('ADMIN', 'PRINCIPAL')
        )
        or (
          requester.role = 'TEACHER'
          and exists (
            select 1
            from public.teacher_class_assignments as assignment
            where assignment.user_id = requester.id
              and assignment.active = true
              and assignment.school_id = target_school_id
              and assignment.campus_id = target_campus_id
              and lower(btrim(regexp_replace(assignment.class_name, '[[:space:]]+', ' ', 'g')))
                = lower(btrim(regexp_replace(target_class_name, '[[:space:]]+', ' ', 'g')))
              and lower(btrim(regexp_replace(assignment.section, '[[:space:]]+', ' ', 'g')))
                = lower(btrim(regexp_replace(target_section, '[[:space:]]+', ' ', 'g')))
          )
        )
      )
  );
$function$;

create or replace function public.can_access_attendance_record(
  target_session_id uuid,
  target_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
  select exists (
    select 1
    from public.attendance_sessions as attendance_session
    join public.students as student
      on student.id = target_student_id
      and student.organization_id = attendance_session.organization_id
      and student.school_id = attendance_session.school_id
      and student.campus_id = attendance_session.campus_id
      and lower(btrim(regexp_replace(student.class_name, '[[:space:]]+', ' ', 'g')))
        = lower(btrim(regexp_replace(attendance_session.class_name, '[[:space:]]+', ' ', 'g')))
      and lower(btrim(regexp_replace(student.section, '[[:space:]]+', ' ', 'g')))
        = lower(btrim(regexp_replace(attendance_session.section, '[[:space:]]+', ' ', 'g')))
    where attendance_session.id = target_session_id
      and public.can_access_attendance_scope(
        attendance_session.organization_id,
        attendance_session.school_id,
        attendance_session.campus_id,
        attendance_session.class_name,
        attendance_session.section
      )
  );
$function$;

create or replace function public.can_manage_attendance_record(
  target_session_id uuid,
  target_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
  select exists (
    select 1
    from public.attendance_sessions as attendance_session
    join public.students as student
      on student.id = target_student_id
      and student.organization_id = attendance_session.organization_id
      and student.school_id = attendance_session.school_id
      and student.campus_id = attendance_session.campus_id
      and lower(btrim(regexp_replace(student.class_name, '[[:space:]]+', ' ', 'g')))
        = lower(btrim(regexp_replace(attendance_session.class_name, '[[:space:]]+', ' ', 'g')))
      and lower(btrim(regexp_replace(student.section, '[[:space:]]+', ' ', 'g')))
        = lower(btrim(regexp_replace(attendance_session.section, '[[:space:]]+', ' ', 'g')))
    where attendance_session.id = target_session_id
      and public.can_manage_attendance_scope(
        attendance_session.organization_id,
        attendance_session.school_id,
        attendance_session.campus_id,
        attendance_session.class_name,
        attendance_session.section
      )
  );
$function$;

revoke all on function public.can_access_attendance_scope(uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.can_manage_attendance_scope(uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.can_access_attendance_record(uuid, uuid) from public, anon;
revoke all on function public.can_manage_attendance_record(uuid, uuid) from public, anon;
grant execute on function public.can_access_attendance_scope(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.can_manage_attendance_scope(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.can_access_attendance_record(uuid, uuid) to authenticated;
grant execute on function public.can_manage_attendance_record(uuid, uuid) to authenticated;

commit;
