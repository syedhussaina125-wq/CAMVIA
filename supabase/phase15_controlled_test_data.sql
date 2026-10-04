-- Controlled Phase 15 alert-source fixtures only.
-- Run manually after 016_live_alerts.sql and Phase 11, 13, and 14 controlled fixtures.
-- Seeds its own recent attendance history; reuses the Phase 13 fee and Phase 14 communication fixtures.

begin;

do $$
begin
  if not exists (
    select 1 from public.profiles
    where email = 'admin@test.edupulse.local'
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and status = 'ACTIVE'
      and role = 'ADMIN'
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
    raise exception 'Required active Phase 11 School A test profiles are missing or mis-scoped.';
  end if;

  if not exists (
    select 1 from public.students
    where id = 'a1100000-0000-4000-8000-000000000102'::uuid
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and campus_id = 'a1100000-0000-4000-8000-000000000021'::uuid
      and class_name = 'Grade 8' and section = 'A'
  ) or not exists (
    select 1 from public.students
    where id = 'a1100000-0000-4000-8000-000000000103'::uuid
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and campus_id = 'a1100000-0000-4000-8000-000000000022'::uuid
      and class_name = 'Grade 9' and section = 'B'
  ) or not exists (
    select 1 from public.students
    where id = 'b1100000-0000-4000-8000-000000000101'::uuid
      and organization_id = 'b1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'b1100000-0000-4000-8000-000000000011'::uuid
  ) then
    raise exception 'Required Grade 8/A, Grade 9/B, or School B student fixtures are missing.';
  end if;

  if not exists (
    select 1 from public.fee_invoices
    where id = 'a1300000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
  ) then
    raise exception 'The Phase 13 School A overdue invoice fixture is missing.';
  end if;

  if not exists (
    select 1
    from public.fee_invoices as invoice
    where invoice.id = 'a1300000-0000-4000-8000-000000000001'::uuid
      and coalesce((
        select sum(item.amount)
        from public.fee_invoice_items as item
        where item.invoice_id = invoice.id
      ), 0) > coalesce((
        select sum(payment.amount)
        from public.fee_payments as payment
        where payment.invoice_id = invoice.id
      ), 0)
  ) then
    raise exception 'The Phase 13 invoice does not currently produce an outstanding-fee alert.';
  end if;

  if not exists (
    select 1 from public.communication_messages
    where school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and status = 'AWAITING_APPROVAL'
  ) then
    raise exception 'A Phase 14 School A approval fixture is required for the live approval alert.';
  end if;
end;
$$;

with test_scopes (
  organization_id, school_id, campus_id, class_name, section, student_id, actor_email
) as (
  values
    (
      'a1100000-0000-4000-8000-000000000001'::uuid,
      'a1100000-0000-4000-8000-000000000011'::uuid,
      'a1100000-0000-4000-8000-000000000021'::uuid,
      'Grade 8'::text, 'A'::text,
      'a1100000-0000-4000-8000-000000000102'::uuid,
      'teachera@test.edupulse.local'::text
    ),
    (
      'a1100000-0000-4000-8000-000000000001'::uuid,
      'a1100000-0000-4000-8000-000000000011'::uuid,
      'a1100000-0000-4000-8000-000000000022'::uuid,
      'Grade 9'::text, 'B'::text,
      'a1100000-0000-4000-8000-000000000103'::uuid,
      'teacherb@test.edupulse.local'::text
    ),
    (
      'b1100000-0000-4000-8000-000000000001'::uuid,
      'b1100000-0000-4000-8000-000000000011'::uuid,
      'b1100000-0000-4000-8000-000000000021'::uuid,
      'Grade 8'::text, 'A'::text,
      'b1100000-0000-4000-8000-000000000101'::uuid,
      'admin@test.edupulse.local'::text
    )
)
insert into public.attendance_sessions (
  id, organization_id, school_id, campus_id, class_name, section,
  attendance_date, created_by, updated_by, status
)
select
  md5(concat(
    'phase15-attendance-session:',
    scope.school_id::text, ':', scope.campus_id::text, ':',
    scope.class_name, ':', scope.section, ':', (current_date - offsets.day_offset)::text
  ))::uuid,
  scope.organization_id,
  scope.school_id,
  scope.campus_id,
  scope.class_name,
  scope.section,
  current_date - offsets.day_offset,
  actor.id,
  actor.id,
  'COMPLETED'
from test_scopes as scope
cross join generate_series(0, 2) as offsets(day_offset)
join public.profiles as actor on actor.email = scope.actor_email
on conflict (organization_id, school_id, campus_id, class_name, section, attendance_date)
do update set
  created_by = excluded.created_by,
  updated_by = excluded.updated_by,
  status = excluded.status;

insert into public.attendance_records (
  attendance_session_id, student_id, status, note, marked_by
)
select
  session.id,
  scope.student_id,
  'ABSENT',
  'Controlled Phase 15 attendance alert fixture.',
  session.created_by
from public.attendance_sessions as session
join (
  values
    (
      'a1100000-0000-4000-8000-000000000001'::uuid,
      'a1100000-0000-4000-8000-000000000011'::uuid,
      'a1100000-0000-4000-8000-000000000021'::uuid,
      'Grade 8'::text, 'A'::text,
      'a1100000-0000-4000-8000-000000000102'::uuid
    ),
    (
      'a1100000-0000-4000-8000-000000000001'::uuid,
      'a1100000-0000-4000-8000-000000000011'::uuid,
      'a1100000-0000-4000-8000-000000000022'::uuid,
      'Grade 9'::text, 'B'::text,
      'a1100000-0000-4000-8000-000000000103'::uuid
    ),
    (
      'b1100000-0000-4000-8000-000000000001'::uuid,
      'b1100000-0000-4000-8000-000000000011'::uuid,
      'b1100000-0000-4000-8000-000000000021'::uuid,
      'Grade 8'::text, 'A'::text,
      'b1100000-0000-4000-8000-000000000101'::uuid
    )
) as scope (organization_id, school_id, campus_id, class_name, section, student_id)
  on scope.organization_id = session.organization_id
  and scope.school_id = session.school_id
  and scope.campus_id = session.campus_id
  and scope.class_name = session.class_name
  and scope.section = session.section
join public.students as student
  on student.id = scope.student_id
  and student.organization_id = session.organization_id
  and student.school_id = session.school_id
  and student.campus_id = session.campus_id
  and student.class_name = session.class_name
  and student.section = session.section
where session.attendance_date between current_date - 2 and current_date
on conflict (attendance_session_id, student_id)
do update set
  status = excluded.status,
  note = excluded.note,
  marked_by = excluded.marked_by;

commit;

-- Source and derived-view validations. RLS intentionally limits each result to the caller:
-- Admin/Principal can see School A; Teacher A/B see only their assigned class; School B is
-- visible only to a School B identity.
select
  expected.label as validation,
  count(distinct session.attendance_date) = 3
    and bool_and(record.status = 'ABSENT') as passed,
  count(distinct session.attendance_date) as visible_absent_dates
from (
  values
    (
      'Teacher A Grade 8/A'::text,
      'a1100000-0000-4000-8000-000000000011'::uuid,
      'a1100000-0000-4000-8000-000000000021'::uuid,
      'Grade 8'::text, 'A'::text,
      'a1100000-0000-4000-8000-000000000102'::uuid
    ),
    (
      'Teacher B Grade 9/B'::text,
      'a1100000-0000-4000-8000-000000000011'::uuid,
      'a1100000-0000-4000-8000-000000000022'::uuid,
      'Grade 9'::text, 'B'::text,
      'a1100000-0000-4000-8000-000000000103'::uuid
    ),
    (
      'School B negative control'::text,
      'b1100000-0000-4000-8000-000000000011'::uuid,
      'b1100000-0000-4000-8000-000000000021'::uuid,
      'Grade 8'::text, 'A'::text,
      'b1100000-0000-4000-8000-000000000101'::uuid
    )
) as expected (label, school_id, campus_id, class_name, section, student_id)
join public.attendance_sessions as session
  on session.school_id = expected.school_id
  and session.campus_id = expected.campus_id
  and session.class_name = expected.class_name
  and session.section = expected.section
  and session.attendance_date between current_date - 2 and current_date
join public.attendance_records as record
  on record.attendance_session_id = session.id
  and record.student_id = expected.student_id
group by expected.label
order by expected.label;

-- Teacher A/B return their own derived attendance alert only; other scopes are suppressed by RLS.
select
  id, source_type, source_id, student_id, class_name, section, priority, status
from public.live_alerts
where id in (
  'attendance-absence-a1100000-0000-4000-8000-000000000102',
  'attendance-absence-a1100000-0000-4000-8000-000000000103',
  'attendance-absence-b1100000-0000-4000-8000-000000000101'
)
order by id;

-- Run as Admin/Principal to validate the School A fee alert and approval alert.
select
  'fee alert source' as validation,
  exists (
    select 1 from public.live_alerts
    where source_type = 'FEE'
      and source_id = 'a1300000-0000-4000-8000-000000000001'
  ) as passed;

select
  'communication approval source' as validation,
  exists (
    select 1 from public.live_alerts
    where source_type = 'COMMUNICATION'
      and status = 'IN_REVIEW'
  ) as passed;

-- School B negative control is visible only in a caller authorized for School B.
select id, organization_id, school_id, source_type, source_id, student_id
from public.live_alerts
where school_id = 'b1100000-0000-4000-8000-000000000011'::uuid;
