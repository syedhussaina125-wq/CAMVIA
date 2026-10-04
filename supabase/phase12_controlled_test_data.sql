-- Controlled Phase 12 attendance fixtures only.
-- Run manually after 013_live_attendance.sql and the Phase 11 test fixtures.
-- School B attendance is a negative-control row for School A isolation tests.

begin;

do $$
begin
  if not exists (
    select 1 from public.profiles
    where email = 'admin@test.edupulse.local'
      and id = (select id from auth.users where email = 'admin@test.edupulse.local')
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and status = 'ACTIVE'
  ) or not exists (
    select 1 from public.profiles
    where email = 'teachera@test.edupulse.local'
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and status = 'ACTIVE'
      and role = 'TEACHER'
  ) or not exists (
    select 1 from public.profiles
    where email = 'teacherb@test.edupulse.local'
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and status = 'ACTIVE'
      and role = 'TEACHER'
  ) then
    raise exception 'Required active Phase 11 attendance test profiles are missing or mis-scoped.';
  end if;

  if not exists (
    select 1 from public.students
    where id = 'a1100000-0000-4000-8000-000000000101'::uuid
      and campus_id = 'a1100000-0000-4000-8000-000000000021'::uuid
      and class_name = 'Grade 8' and section = 'A'
  ) or not exists (
    select 1 from public.students
    where id = 'a1100000-0000-4000-8000-000000000102'::uuid
      and campus_id = 'a1100000-0000-4000-8000-000000000021'::uuid
      and class_name = 'Grade 8' and section = 'A'
  ) or not exists (
    select 1 from public.students
    where id = 'a1100000-0000-4000-8000-000000000103'::uuid
      and campus_id = 'a1100000-0000-4000-8000-000000000022'::uuid
      and class_name = 'Grade 9' and section = 'B'
  ) or not exists (
    select 1 from public.students
    where id = 'b1100000-0000-4000-8000-000000000101'::uuid
      and school_id = 'b1100000-0000-4000-8000-000000000011'::uuid
      and campus_id = 'b1100000-0000-4000-8000-000000000021'::uuid
      and class_name = 'Grade 8' and section = 'A'
  ) then
    raise exception 'One or more Phase 11 test students are missing or mis-scoped.';
  end if;
end;
$$;

insert into public.attendance_sessions (
  id, organization_id, school_id, campus_id, class_name, section,
  attendance_date, created_by, updated_by, status
)
values
  (
    'c1200000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000011',
    'a1100000-0000-4000-8000-000000000021',
    'Grade 8', 'A', current_date,
    (select id from public.profiles where email = 'teachera@test.edupulse.local'),
    (select id from public.profiles where email = 'teachera@test.edupulse.local'),
    'COMPLETED'
  ),
  (
    'c1200000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000011',
    'a1100000-0000-4000-8000-000000000022',
    'Grade 9', 'B', current_date,
    (select id from public.profiles where email = 'teacherb@test.edupulse.local'),
    (select id from public.profiles where email = 'teacherb@test.edupulse.local'),
    'COMPLETED'
  ),
  (
    -- Negative-control School B row; existing controlled Auth users belong to School A.
    'c1200000-0000-4000-8000-000000000003',
    'b1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000011',
    'b1100000-0000-4000-8000-000000000021',
    'Grade 8', 'A', current_date,
    (select id from public.profiles where email = 'admin@test.edupulse.local'),
    (select id from public.profiles where email = 'admin@test.edupulse.local'),
    'COMPLETED'
  )
on conflict (organization_id, school_id, campus_id, class_name, section, attendance_date)
do update set
  updated_by = excluded.updated_by,
  status = excluded.status;

insert into public.attendance_records (
  attendance_session_id, student_id, status, note, marked_by
)
select
  attendance_session.id,
  student.id,
  case student.id
    when 'a1100000-0000-4000-8000-000000000102'::uuid then 'ABSENT'
    when 'a1100000-0000-4000-8000-000000000103'::uuid then 'LATE'
    else 'PRESENT'
  end,
  '',
  case student.id
    when 'a1100000-0000-4000-8000-000000000103'::uuid
      then (select id from public.profiles where email = 'teacherb@test.edupulse.local')
    when 'b1100000-0000-4000-8000-000000000101'::uuid
      then (select id from public.profiles where email = 'admin@test.edupulse.local')
    else (select id from public.profiles where email = 'teachera@test.edupulse.local')
  end
from public.attendance_sessions as attendance_session
join public.students as student
  on student.organization_id = attendance_session.organization_id
  and student.school_id = attendance_session.school_id
  and student.campus_id = attendance_session.campus_id
  and student.class_name = attendance_session.class_name
  and student.section = attendance_session.section
where attendance_session.attendance_date = current_date
  and (
    (
      attendance_session.organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and attendance_session.school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and attendance_session.campus_id = 'a1100000-0000-4000-8000-000000000021'::uuid
      and attendance_session.class_name = 'Grade 8'
      and attendance_session.section = 'A'
    )
    or (
      attendance_session.organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and attendance_session.school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and attendance_session.campus_id = 'a1100000-0000-4000-8000-000000000022'::uuid
      and attendance_session.class_name = 'Grade 9'
      and attendance_session.section = 'B'
    )
    or (
      attendance_session.organization_id = 'b1100000-0000-4000-8000-000000000001'::uuid
      and attendance_session.school_id = 'b1100000-0000-4000-8000-000000000011'::uuid
      and attendance_session.campus_id = 'b1100000-0000-4000-8000-000000000021'::uuid
      and attendance_session.class_name = 'Grade 8'
      and attendance_session.section = 'A'
    )
  )
on conflict (attendance_session_id, student_id) do update
set status = excluded.status,
    note = excluded.note,
    marked_by = excluded.marked_by;

commit;
