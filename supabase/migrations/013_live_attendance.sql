begin;

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  class_name text not null,
  section text not null,
  attendance_date date not null,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  status text not null default 'COMPLETED'
    check (status in ('IN_PROGRESS', 'COMPLETED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_sessions_scope_date_unique
    unique (organization_id, school_id, campus_id, class_name, section, attendance_date)
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  attendance_session_id uuid not null
    references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null check (status in ('PRESENT', 'ABSENT', 'LATE')),
  note text not null default '',
  marked_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_records_session_student_unique
    unique (attendance_session_id, student_id)
);

create index if not exists attendance_sessions_scope_date_idx
  on public.attendance_sessions (organization_id, school_id, campus_id, attendance_date desc);

create index if not exists attendance_records_student_idx
  on public.attendance_records (student_id, attendance_session_id);

drop trigger if exists attendance_sessions_set_updated_at on public.attendance_sessions;
create trigger attendance_sessions_set_updated_at
before update on public.attendance_sessions
for each row
execute function public.set_updated_at();

drop trigger if exists attendance_records_set_updated_at on public.attendance_records;
create trigger attendance_records_set_updated_at
before update on public.attendance_records
for each row
execute function public.set_updated_at();

alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;

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
              and assignment.class_name = target_class_name
              and assignment.section = target_section
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
              and assignment.class_name = target_class_name
              and assignment.section = target_section
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
      and student.class_name = attendance_session.class_name
      and student.section = attendance_session.section
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
      and student.class_name = attendance_session.class_name
      and student.section = attendance_session.section
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

revoke all on public.attendance_sessions from public, anon;
revoke all on public.attendance_records from public, anon;
grant select, insert, update on public.attendance_sessions to authenticated;
grant select, insert, update on public.attendance_records to authenticated;

drop policy if exists attendance_sessions_read_accessible_scope on public.attendance_sessions;
drop policy if exists attendance_sessions_insert_assigned_scope on public.attendance_sessions;
drop policy if exists attendance_sessions_update_assigned_scope on public.attendance_sessions;
drop policy if exists attendance_records_read_accessible_scope on public.attendance_records;
drop policy if exists attendance_records_insert_assigned_scope on public.attendance_records;
drop policy if exists attendance_records_update_assigned_scope on public.attendance_records;

create policy attendance_sessions_read_accessible_scope
on public.attendance_sessions
for select
to authenticated
using (
  public.can_access_attendance_scope(
    organization_id,
    school_id,
    campus_id,
    class_name,
    section
  )
);

create policy attendance_sessions_insert_assigned_scope
on public.attendance_sessions
for insert
to authenticated
with check (
  created_by = auth.uid()
  and updated_by = auth.uid()
  and status = 'COMPLETED'
  and public.can_manage_attendance_scope(
    organization_id,
    school_id,
    campus_id,
    class_name,
    section
  )
);

create policy attendance_sessions_update_assigned_scope
on public.attendance_sessions
for update
to authenticated
using (
  public.can_manage_attendance_scope(
    organization_id,
    school_id,
    campus_id,
    class_name,
    section
  )
)
with check (
  updated_by = auth.uid()
  and status = 'COMPLETED'
  and public.can_manage_attendance_scope(
    organization_id,
    school_id,
    campus_id,
    class_name,
    section
  )
);

create policy attendance_records_read_accessible_scope
on public.attendance_records
for select
to authenticated
using (public.can_access_attendance_record(attendance_session_id, student_id));

create policy attendance_records_insert_assigned_scope
on public.attendance_records
for insert
to authenticated
with check (
  marked_by = auth.uid()
  and public.can_manage_attendance_record(attendance_session_id, student_id)
);

create policy attendance_records_update_assigned_scope
on public.attendance_records
for update
to authenticated
using (public.can_manage_attendance_record(attendance_session_id, student_id))
with check (
  marked_by = auth.uid()
  and public.can_manage_attendance_record(attendance_session_id, student_id)
);

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
security invoker
set search_path = pg_catalog, public, auth
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
    raise exception 'This class is outside your authorized attendance scope or the submission is invalid.'
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
  from jsonb_to_recordset(target_records) as submitted(student_id uuid, status text, note text);

  if expected_student_count = 0
    or submitted_row_count <> expected_student_count
    or submitted_student_count <> expected_student_count
    or exists (
      select 1
      from jsonb_to_recordset(target_records) as submitted(student_id uuid, status text, note text)
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
    organization_id,
    school_id,
    campus_id,
    class_name,
    section,
    attendance_date,
    created_by,
    updated_by,
    status
  )
  values (
    target_organization_id,
    target_school_id,
    target_campus_id,
    target_class_name,
    target_section,
    target_attendance_date,
    auth.uid(),
    auth.uid(),
    'COMPLETED'
  )
  on conflict (organization_id, school_id, campus_id, class_name, section, attendance_date)
  do update set
    updated_by = auth.uid(),
    status = 'COMPLETED',
    updated_at = now()
  returning id into saved_session_id;

  insert into public.attendance_records (
    attendance_session_id,
    student_id,
    status,
    note,
    marked_by
  )
  select
    saved_session_id,
    submitted.student_id,
    submitted.status,
    coalesce(submitted.note, ''),
    auth.uid()
  from jsonb_to_recordset(target_records) as submitted(student_id uuid, status text, note text)
  on conflict (attendance_session_id, student_id)
  do update set
    status = excluded.status,
    note = excluded.note,
    marked_by = auth.uid(),
    updated_at = now();

  return saved_session_id;
end;
$function$;

revoke all on function public.save_attendance_session(uuid, uuid, uuid, text, text, date, jsonb) from public, anon;
grant execute on function public.save_attendance_session(uuid, uuid, uuid, text, text, date, jsonb) to authenticated;

commit;
