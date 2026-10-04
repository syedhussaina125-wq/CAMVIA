-- Controlled Phase 14 communication fixtures only.
-- Run manually after migration 015 and the Phase 11/13 controlled fixtures.
-- Reuses existing Auth identities; this script creates no Auth users or credentials.

begin;

do $$
begin
  if not exists (
    select 1
    from public.profiles
    where email = 'admin@test.edupulse.local'
      and role = 'ADMIN'
      and status = 'ACTIVE'
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
  ) or not exists (
    select 1
    from public.profiles
    where email = 'principal@test.edupulse.local'
      and role = 'PRINCIPAL'
      and status = 'ACTIVE'
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
  ) or not exists (
    select 1
    from public.profiles
    where email = 'finance@test.edupulse.local'
      and role = 'FINANCE'
      and status = 'ACTIVE'
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
  ) or not exists (
    select 1
    from public.profiles
    where email = 'teachera@test.edupulse.local'
      and role = 'TEACHER'
      and status = 'ACTIVE'
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
  ) or not exists (
    select 1
    from public.profiles
    where email = 'teacherb@test.edupulse.local'
      and role = 'TEACHER'
      and status = 'ACTIVE'
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
  ) or not exists (
    select 1
    from public.profiles
    where email = 'inactive@test.edupulse.local'
      and status = 'INACTIVE'
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
  ) then
    raise exception 'Required Phase 11 School A controlled profiles are missing or mis-scoped.';
  end if;

  if not exists (
    select 1
    from public.students as student
    join public.student_guardians as link on link.student_id = student.id
    join public.guardians as guardian on guardian.id = link.guardian_id
    where student.id = 'a1100000-0000-4000-8000-000000000101'::uuid
      and student.organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and student.school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and student.campus_id = 'a1100000-0000-4000-8000-000000000021'::uuid
      and student.class_name = 'Grade 8'
      and student.section = 'A'
      and guardian.id = 'a1100000-0000-4000-8000-000000000201'::uuid
      and guardian.organization_id = student.organization_id
      and guardian.school_id = student.school_id
      and guardian.campus_id = student.campus_id
  ) or not exists (
    select 1
    from public.students as student
    join public.student_guardians as link on link.student_id = student.id
    join public.guardians as guardian on guardian.id = link.guardian_id
    where student.id = 'a1100000-0000-4000-8000-000000000103'::uuid
      and student.organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and student.school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and student.campus_id = 'a1100000-0000-4000-8000-000000000022'::uuid
      and student.class_name = 'Grade 9'
      and student.section = 'B'
      and guardian.id = 'a1100000-0000-4000-8000-000000000203'::uuid
      and guardian.organization_id = student.organization_id
      and guardian.school_id = student.school_id
      and guardian.campus_id = student.campus_id
  ) or not exists (
    select 1
    from public.students as student
    join public.student_guardians as link on link.student_id = student.id
    join public.guardians as guardian on guardian.id = link.guardian_id
    where student.id = 'a1100000-0000-4000-8000-000000000102'::uuid
      and guardian.id = 'a1100000-0000-4000-8000-000000000202'::uuid
      and guardian.organization_id = student.organization_id
      and guardian.school_id = student.school_id
      and guardian.campus_id = student.campus_id
  ) or not exists (
    select 1
    from public.students as student
    join public.student_guardians as link on link.student_id = student.id
    join public.guardians as guardian on guardian.id = link.guardian_id
    where student.id = 'b1100000-0000-4000-8000-000000000101'::uuid
      and student.organization_id = 'b1100000-0000-4000-8000-000000000001'::uuid
      and student.school_id = 'b1100000-0000-4000-8000-000000000011'::uuid
      and student.campus_id = 'b1100000-0000-4000-8000-000000000021'::uuid
      and guardian.id = 'b1100000-0000-4000-8000-000000000201'::uuid
      and guardian.organization_id = student.organization_id
      and guardian.school_id = student.school_id
      and guardian.campus_id = student.campus_id
  ) then
    raise exception 'One or more required Phase 11 student/guardian fixtures are missing or cross-scoped.';
  end if;

  if not exists (
    select 1
    from public.fee_invoices
    where id = 'a1300000-0000-4000-8000-000000000001'::uuid
      and student_id = 'a1100000-0000-4000-8000-000000000101'::uuid
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and campus_id = 'a1100000-0000-4000-8000-000000000021'::uuid
  ) then
    raise exception 'The Phase 13 School A invoice required for the Finance reminder is missing or mis-scoped.';
  end if;
end;
$$;

-- The School B row is a negative-control tenant fixture. Phase 11 creates
-- School A test users only, so the existing School A Admin is the seed actor;
-- this does not create an Auth user or a cross-school recipient relationship.
insert into public.communication_messages (
  id, organization_id, school_id, campus_id, student_id, created_by,
  message_type, channel, body, source_type, source_id, status,
  requires_approval, submitted_at, approved_by, approved_at,
  rejected_by, rejected_at, rejection_reason, sent_by, sent_at,
  created_at, updated_at
)
values
  (
    'a1400000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000011',
    'a1100000-0000-4000-8000-000000000021',
    'a1100000-0000-4000-8000-000000000101',
    (select id from public.profiles where email = 'teachera@test.edupulse.local'),
    'Attendance Reminder', 'WhatsApp',
    'Controlled test: please review the attendance follow-up for the Grade 8/A student.',
    'STUDENT', 'a1100000-0000-4000-8000-000000000101',
    'AWAITING_APPROVAL', true, '2026-10-04 09:00:00+00',
    null, null, null, null, '', null, null,
    '2026-10-04 08:55:00+00', '2026-10-04 09:00:00+00'
  ),
  (
    'a1400000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000011',
    'a1100000-0000-4000-8000-000000000022',
    'a1100000-0000-4000-8000-000000000103',
    (select id from public.profiles where email = 'teacherb@test.edupulse.local'),
    'Follow-up', 'Email',
    'Controlled test: please review the Grade 9/B classroom follow-up.',
    'STUDENT', 'a1100000-0000-4000-8000-000000000103',
    'APPROVED', true, '2026-10-04 09:10:00+00',
    (select id from public.profiles where email = 'principal@test.edupulse.local'),
    '2026-10-04 09:15:00+00', null, null, '', null, null,
    '2026-10-04 09:05:00+00', '2026-10-04 09:15:00+00'
  ),
  (
    'a1400000-0000-4000-8000-000000000003',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000011',
    'a1100000-0000-4000-8000-000000000021',
    'a1100000-0000-4000-8000-000000000102',
    (select id from public.profiles where email = 'admin@test.edupulse.local'),
    'General Notice', 'SMS',
    'Controlled test: general same-school message retained as a draft.',
    'STUDENT', 'a1100000-0000-4000-8000-000000000102',
    'DRAFT', true, null, null, null, null, null, '', null, null,
    '2026-10-04 09:20:00+00', '2026-10-04 09:20:00+00'
  ),
  (
    'a1400000-0000-4000-8000-000000000004',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000011',
    'a1100000-0000-4000-8000-000000000021',
    'a1100000-0000-4000-8000-000000000101',
    (select id from public.profiles where email = 'teachera@test.edupulse.local'),
    'Follow-up', 'WhatsApp',
    'Controlled test: rejected follow-up retained for revision.',
    'STUDENT', 'a1100000-0000-4000-8000-000000000101',
    'REJECTED', true, '2026-10-04 09:25:00+00',
    null, null,
    (select id from public.profiles where email = 'principal@test.edupulse.local'),
    '2026-10-04 09:30:00+00', 'Please revise the wording before resubmission.',
    null, null, '2026-10-04 09:22:00+00', '2026-10-04 09:30:00+00'
  ),
  (
    'a1400000-0000-4000-8000-000000000005',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000011',
    'a1100000-0000-4000-8000-000000000021',
    'a1100000-0000-4000-8000-000000000101',
    (select id from public.profiles where email = 'finance@test.edupulse.local'),
    'Fee Reminder', 'Email',
    'Controlled test: review the outstanding balance linked to this fee invoice.',
    'FEE', 'a1300000-0000-4000-8000-000000000001',
    'AWAITING_APPROVAL', true, '2026-10-04 09:35:00+00',
    null, null, null, null, '', null, null,
    '2026-10-04 09:32:00+00', '2026-10-04 09:35:00+00'
  ),
  (
    'b1400000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000011',
    'b1100000-0000-4000-8000-000000000021',
    'b1100000-0000-4000-8000-000000000101',
    (select id from public.profiles where email = 'admin@test.edupulse.local'),
    'General Notice', 'Email',
    'Controlled School B negative-control message; not visible to School A.',
    'STUDENT', 'b1100000-0000-4000-8000-000000000101',
    'DRAFT', true, null, null, null, null, null, '', null, null,
    '2026-10-04 09:40:00+00', '2026-10-04 09:40:00+00'
  )
on conflict (id) do update
set organization_id = excluded.organization_id,
    school_id = excluded.school_id,
    campus_id = excluded.campus_id,
    student_id = excluded.student_id,
    created_by = excluded.created_by,
    message_type = excluded.message_type,
    channel = excluded.channel,
    body = excluded.body,
    source_type = excluded.source_type,
    source_id = excluded.source_id,
    status = excluded.status,
    requires_approval = excluded.requires_approval,
    submitted_at = excluded.submitted_at,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    rejected_by = excluded.rejected_by,
    rejected_at = excluded.rejected_at,
    rejection_reason = excluded.rejection_reason,
    sent_by = excluded.sent_by,
    sent_at = excluded.sent_at,
    updated_at = excluded.updated_at;

insert into public.communication_recipients (id, message_id, student_id, guardian_id, created_at)
values
  ('a1410000-0000-4000-8000-000000000001', 'a1400000-0000-4000-8000-000000000001',
   'a1100000-0000-4000-8000-000000000101', 'a1100000-0000-4000-8000-000000000201',
   '2026-10-04 08:55:00+00'),
  ('a1410000-0000-4000-8000-000000000002', 'a1400000-0000-4000-8000-000000000002',
   'a1100000-0000-4000-8000-000000000103', 'a1100000-0000-4000-8000-000000000203',
   '2026-10-04 09:05:00+00'),
  ('a1410000-0000-4000-8000-000000000003', 'a1400000-0000-4000-8000-000000000003',
   'a1100000-0000-4000-8000-000000000102', 'a1100000-0000-4000-8000-000000000202',
   '2026-10-04 09:20:00+00'),
  ('a1410000-0000-4000-8000-000000000004', 'a1400000-0000-4000-8000-000000000004',
   'a1100000-0000-4000-8000-000000000101', 'a1100000-0000-4000-8000-000000000201',
   '2026-10-04 09:22:00+00'),
  ('a1410000-0000-4000-8000-000000000005', 'a1400000-0000-4000-8000-000000000005',
   'a1100000-0000-4000-8000-000000000101', 'a1100000-0000-4000-8000-000000000201',
   '2026-10-04 09:32:00+00'),
  ('b1410000-0000-4000-8000-000000000001', 'b1400000-0000-4000-8000-000000000001',
   'b1100000-0000-4000-8000-000000000101', 'b1100000-0000-4000-8000-000000000201',
   '2026-10-04 09:40:00+00')
on conflict (id) do update
set message_id = excluded.message_id,
    student_id = excluded.student_id,
    guardian_id = excluded.guardian_id,
    created_at = excluded.created_at;

insert into public.communication_events (id, message_id, actor_id, action, created_at)
values
  ('a1420000-0000-4000-8000-000000000001', 'a1400000-0000-4000-8000-000000000001',
   (select id from public.profiles where email = 'teachera@test.edupulse.local'), 'Created',
   '2026-10-04 08:55:00+00'),
  ('a1420000-0000-4000-8000-000000000002', 'a1400000-0000-4000-8000-000000000001',
   (select id from public.profiles where email = 'teachera@test.edupulse.local'), 'Submitted',
   '2026-10-04 09:00:00+00'),
  ('a1420000-0000-4000-8000-000000000003', 'a1400000-0000-4000-8000-000000000002',
   (select id from public.profiles where email = 'teacherb@test.edupulse.local'), 'Created',
   '2026-10-04 09:05:00+00'),
  ('a1420000-0000-4000-8000-000000000004', 'a1400000-0000-4000-8000-000000000002',
   (select id from public.profiles where email = 'teacherb@test.edupulse.local'), 'Submitted',
   '2026-10-04 09:10:00+00'),
  ('a1420000-0000-4000-8000-000000000005', 'a1400000-0000-4000-8000-000000000002',
   (select id from public.profiles where email = 'principal@test.edupulse.local'), 'Approved',
   '2026-10-04 09:15:00+00'),
  ('a1420000-0000-4000-8000-000000000006', 'a1400000-0000-4000-8000-000000000003',
   (select id from public.profiles where email = 'admin@test.edupulse.local'), 'Created',
   '2026-10-04 09:20:00+00'),
  ('a1420000-0000-4000-8000-000000000007', 'a1400000-0000-4000-8000-000000000004',
   (select id from public.profiles where email = 'teachera@test.edupulse.local'), 'Created',
   '2026-10-04 09:22:00+00'),
  ('a1420000-0000-4000-8000-000000000008', 'a1400000-0000-4000-8000-000000000004',
   (select id from public.profiles where email = 'teachera@test.edupulse.local'), 'Submitted',
   '2026-10-04 09:25:00+00'),
  ('a1420000-0000-4000-8000-000000000009', 'a1400000-0000-4000-8000-000000000004',
   (select id from public.profiles where email = 'principal@test.edupulse.local'), 'Rejected',
   '2026-10-04 09:30:00+00'),
  ('a1420000-0000-4000-8000-000000000010', 'a1400000-0000-4000-8000-000000000005',
   (select id from public.profiles where email = 'finance@test.edupulse.local'), 'Created',
   '2026-10-04 09:32:00+00'),
  ('a1420000-0000-4000-8000-000000000011', 'a1400000-0000-4000-8000-000000000005',
   (select id from public.profiles where email = 'finance@test.edupulse.local'), 'Submitted',
   '2026-10-04 09:35:00+00'),
  ('b1420000-0000-4000-8000-000000000001', 'b1400000-0000-4000-8000-000000000001',
   (select id from public.profiles where email = 'admin@test.edupulse.local'), 'Created',
   '2026-10-04 09:40:00+00')
on conflict (id) do update
set message_id = excluded.message_id,
    actor_id = excluded.actor_id,
    action = excluded.action,
    created_at = excluded.created_at;

commit;

-- Validation: deterministic School A fixture rows exist.
select id, status, message_type, student_id, school_id
from public.communication_messages
where id in (
  'a1400000-0000-4000-8000-000000000001'::uuid,
  'a1400000-0000-4000-8000-000000000002'::uuid,
  'a1400000-0000-4000-8000-000000000003'::uuid,
  'a1400000-0000-4000-8000-000000000004'::uuid,
  'a1400000-0000-4000-8000-000000000005'::uuid
)
order by id;

-- Validation: Teacher A's fixture recipient is Grade 8/A only.
select message.id, student.class_name, student.section, recipient.guardian_id
from public.communication_messages as message
join public.communication_recipients as recipient on recipient.message_id = message.id
join public.students as student on student.id = recipient.student_id
where message.id = 'a1400000-0000-4000-8000-000000000001'::uuid;

-- Validation: Teacher B's fixture recipient is Grade 9/B only.
select message.id, student.class_name, student.section, recipient.guardian_id
from public.communication_messages as message
join public.communication_recipients as recipient on recipient.message_id = message.id
join public.students as student on student.id = recipient.student_id
where message.id = 'a1400000-0000-4000-8000-000000000002'::uuid;

-- Validation: School B negative-control row exists and targets its own student.
select message.id, message.organization_id, message.school_id,
       student.id as student_id, guardian.id as guardian_id
from public.communication_messages as message
join public.communication_recipients as recipient on recipient.message_id = message.id
join public.students as student on student.id = recipient.student_id
join public.guardians as guardian on guardian.id = recipient.guardian_id
where message.id = 'b1400000-0000-4000-8000-000000000001'::uuid;

-- Validation: supported approval workflow states are present.
select status, count(*) as fixture_count
from public.communication_messages
where id in (
  'a1400000-0000-4000-8000-000000000001'::uuid,
  'a1400000-0000-4000-8000-000000000002'::uuid,
  'a1400000-0000-4000-8000-000000000003'::uuid,
  'a1400000-0000-4000-8000-000000000004'::uuid,
  'a1400000-0000-4000-8000-000000000005'::uuid
)
group by status
order by status;

-- Validation: zero recipient rows may connect a message/student/guardian across tenants.
select count(*) as cross_school_recipient_count
from public.communication_recipients as recipient
join public.communication_messages as message on message.id = recipient.message_id
join public.students as student on student.id = recipient.student_id
join public.guardians as guardian on guardian.id = recipient.guardian_id
where message.organization_id <> student.organization_id
   or message.school_id <> student.school_id
   or message.campus_id <> student.campus_id
   or guardian.organization_id <> student.organization_id
   or guardian.school_id <> student.school_id
   or guardian.campus_id <> student.campus_id;
