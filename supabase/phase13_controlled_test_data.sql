-- Controlled Phase 13 fee fixtures only.
-- Run manually after 014_live_fees.sql and the Phase 11 controlled test data.
-- Creates paid, partial, overdue, unpaid, and School B isolation invoices.

begin;

do $$
begin
  if not exists (
    select 1 from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where auth_user.email = 'finance@test.edupulse.local'
      and profile.role = 'FINANCE'
      and profile.status = 'ACTIVE'
      and profile.organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and profile.school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
  ) or not exists (
    select 1 from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where auth_user.email = 'admin@test.edupulse.local'
      and profile.role = 'ADMIN'
      and profile.status = 'ACTIVE'
      and profile.organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
      and profile.school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
  ) then
    raise exception 'Required active School A Finance/Admin profiles are missing or mis-scoped.';
  end if;

  if (
    select count(*)
    from public.students as student
    where student.id in (
      'a1100000-0000-4000-8000-000000000101'::uuid,
      'a1100000-0000-4000-8000-000000000102'::uuid,
      'a1100000-0000-4000-8000-000000000103'::uuid,
      'a1100000-0000-4000-8000-000000000104'::uuid,
      'b1100000-0000-4000-8000-000000000101'::uuid
    )
  ) <> 5 then
    raise exception 'Required Phase 11 student fixtures are missing.';
  end if;
end;
$$;

insert into public.fee_invoices (
  id, organization_id, school_id, campus_id, student_id,
  fee_period, due_date, created_by
)
values
  (
    'a1300000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000011',
    'a1100000-0000-4000-8000-000000000021',
    'a1100000-0000-4000-8000-000000000101',
    (date_trunc('month', current_date) - interval '1 month')::date,
    current_date - 32,
    (select id from public.profiles where email = 'admin@test.edupulse.local')
  ),
  (
    'a1300000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000011',
    'a1100000-0000-4000-8000-000000000021',
    'a1100000-0000-4000-8000-000000000102',
    date_trunc('month', current_date)::date,
    current_date + 11,
    (select id from public.profiles where email = 'admin@test.edupulse.local')
  ),
  (
    'a1300000-0000-4000-8000-000000000003',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000011',
    'a1100000-0000-4000-8000-000000000022',
    'a1100000-0000-4000-8000-000000000103',
    date_trunc('month', current_date)::date,
    current_date + 11,
    (select id from public.profiles where email = 'admin@test.edupulse.local')
  ),
  (
    'a1300000-0000-4000-8000-000000000004',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000011',
    'a1100000-0000-4000-8000-000000000022',
    'a1100000-0000-4000-8000-000000000104',
    (date_trunc('month', current_date) - interval '2 months')::date,
    current_date - 64,
    (select id from public.profiles where email = 'admin@test.edupulse.local')
  ),
  (
    'b1300000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000011',
    'b1100000-0000-4000-8000-000000000021',
    'b1100000-0000-4000-8000-000000000101',
    (date_trunc('month', current_date) - interval '2 months')::date,
    current_date - 64,
    (select id from public.profiles where email = 'admin@test.edupulse.local')
  )
on conflict (id) do update
set organization_id = excluded.organization_id,
    school_id = excluded.school_id,
    campus_id = excluded.campus_id,
    student_id = excluded.student_id,
    fee_period = excluded.fee_period,
    due_date = excluded.due_date;

insert into public.fee_invoice_items (id, invoice_id, label, amount)
values
  ('a1310000-0000-4000-8000-000000000001', 'a1300000-0000-4000-8000-000000000001', 'Tuition Fee', 18000),
  ('a1310000-0000-4000-8000-000000000002', 'a1300000-0000-4000-8000-000000000001', 'Transport Fee', 5000),
  ('a1310000-0000-4000-8000-000000000003', 'a1300000-0000-4000-8000-000000000001', 'Lab Fee', 2000),
  ('a1310000-0000-4000-8000-000000000004', 'a1300000-0000-4000-8000-000000000002', 'Tuition Fee', 18000),
  ('a1310000-0000-4000-8000-000000000005', 'a1300000-0000-4000-8000-000000000002', 'Transport Fee', 5000),
  ('a1310000-0000-4000-8000-000000000006', 'a1300000-0000-4000-8000-000000000002', 'Lab Fee', 2000),
  ('a1310000-0000-4000-8000-000000000007', 'a1300000-0000-4000-8000-000000000003', 'Tuition Fee', 18000),
  ('a1310000-0000-4000-8000-000000000008', 'a1300000-0000-4000-8000-000000000003', 'Transport Fee', 5000),
  ('a1310000-0000-4000-8000-000000000009', 'a1300000-0000-4000-8000-000000000003', 'Lab Fee', 2000),
  ('a1310000-0000-4000-8000-000000000010', 'a1300000-0000-4000-8000-000000000004', 'Tuition Fee', 18000),
  ('a1310000-0000-4000-8000-000000000011', 'a1300000-0000-4000-8000-000000000004', 'Transport Fee', 5000),
  ('a1310000-0000-4000-8000-000000000012', 'a1300000-0000-4000-8000-000000000004', 'Lab Fee', 2000),
  ('b1310000-0000-4000-8000-000000000001', 'b1300000-0000-4000-8000-000000000001', 'Tuition Fee', 18000),
  ('b1310000-0000-4000-8000-000000000002', 'b1300000-0000-4000-8000-000000000001', 'Transport Fee', 5000),
  ('b1310000-0000-4000-8000-000000000003', 'b1300000-0000-4000-8000-000000000001', 'Lab Fee', 2000)
on conflict (id) do update
set invoice_id = excluded.invoice_id,
    label = excluded.label,
    amount = excluded.amount;

insert into public.fee_payments (
  id, invoice_id, student_id, amount, payment_date, payment_method,
  reference, note, idempotency_key, received_by
)
values
  (
    'a1320000-0000-4000-8000-000000000001',
    'a1300000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000101',
    10000, current_date - 20, 'Bank Transfer', 'EP13-PARTIAL-001',
    'Controlled partial payment', 'phase13-seed-payment-001',
    (select id from public.profiles where email = 'finance@test.edupulse.local')
  ),
  (
    'a1320000-0000-4000-8000-000000000002',
    'a1300000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000102',
    25000, current_date, 'Cash', 'EP13-PAID-002',
    'Controlled paid invoice', 'phase13-seed-payment-002',
    (select id from public.profiles where email = 'finance@test.edupulse.local')
  ),
  (
    'a1320000-0000-4000-8000-000000000003',
    'a1300000-0000-4000-8000-000000000003',
    'a1100000-0000-4000-8000-000000000103',
    5000, current_date, 'Card', 'EP13-PARTIAL-003',
    'Controlled current partial payment', 'phase13-seed-payment-003',
    (select id from public.profiles where email = 'finance@test.edupulse.local')
  )
on conflict (id) do update
set invoice_id = excluded.invoice_id,
    student_id = excluded.student_id,
    amount = excluded.amount,
    payment_date = excluded.payment_date,
    payment_method = excluded.payment_method,
    reference = excluded.reference,
    note = excluded.note,
    idempotency_key = excluded.idempotency_key,
    received_by = excluded.received_by;

commit;
