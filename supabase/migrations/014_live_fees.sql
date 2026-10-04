begin;

create table if not exists public.fee_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete cascade,
  fee_period date not null,
  due_date date not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_invoices_period_month check (fee_period = date_trunc('month', fee_period)::date),
  constraint fee_invoices_student_period_unique unique (student_id, fee_period)
);

create table if not exists public.fee_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.fee_invoices(id) on delete cascade,
  label text not null check (length(btrim(label)) > 0),
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.fee_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.fee_invoices(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  payment_date date not null,
  payment_method text not null
    check (payment_method in ('Cash', 'Bank Transfer', 'Card', 'Online')),
  reference text not null default '',
  note text not null default '',
  idempotency_key text not null unique check (length(btrim(idempotency_key)) > 0),
  received_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index if not exists fee_payments_invoice_reference_unique
  on public.fee_payments (invoice_id, lower(btrim(reference)))
  where btrim(reference) <> '';

create index if not exists fee_invoices_school_period_idx
  on public.fee_invoices (organization_id, school_id, fee_period desc);

create index if not exists fee_invoices_student_period_idx
  on public.fee_invoices (student_id, fee_period desc);

create index if not exists fee_invoice_items_invoice_idx
  on public.fee_invoice_items (invoice_id);

create index if not exists fee_payments_invoice_date_idx
  on public.fee_payments (invoice_id, payment_date desc, created_at desc);

drop trigger if exists fee_invoices_set_updated_at on public.fee_invoices;
create trigger fee_invoices_set_updated_at
before update on public.fee_invoices
for each row
execute function public.set_updated_at();

alter table public.fee_invoices enable row level security;
alter table public.fee_invoice_items enable row level security;
alter table public.fee_payments enable row level security;

create or replace function public.can_access_fee_scope(
  target_organization_id uuid,
  target_school_id uuid,
  target_campus_id uuid,
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
    from public.profiles as requester
    join public.schools as school
      on school.id = target_school_id
      and school.organization_id = target_organization_id
    join public.campuses as campus
      on campus.id = target_campus_id
      and campus.school_id = school.id
      and campus.organization_id = school.organization_id
    join public.students as student
      on student.id = target_student_id
      and student.organization_id = school.organization_id
      and student.school_id = school.id
      and student.campus_id = campus.id
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.organization_id = school.organization_id
      and requester.school_id = school.id
      and requester.role in ('ADMIN', 'PRINCIPAL', 'FINANCE')
  );
$function$;

create or replace function public.can_manage_fee_scope(
  target_organization_id uuid,
  target_school_id uuid,
  target_campus_id uuid,
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
    from public.profiles as requester
    join public.schools as school
      on school.id = target_school_id
      and school.organization_id = target_organization_id
    join public.campuses as campus
      on campus.id = target_campus_id
      and campus.school_id = school.id
      and campus.organization_id = school.organization_id
    join public.students as student
      on student.id = target_student_id
      and student.organization_id = school.organization_id
      and student.school_id = school.id
      and student.campus_id = campus.id
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.organization_id = school.organization_id
      and requester.school_id = school.id
      and requester.role in ('ADMIN', 'FINANCE')
  );
$function$;

create or replace function public.can_access_fee_invoice(
  target_invoice_id uuid,
  target_student_id uuid default null
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
    from public.fee_invoices as invoice
    where invoice.id = target_invoice_id
      and (target_student_id is null or invoice.student_id = target_student_id)
      and public.can_access_fee_scope(
        invoice.organization_id,
        invoice.school_id,
        invoice.campus_id,
        invoice.student_id
      )
  );
$function$;

create or replace function public.can_manage_fee_invoice(
  target_invoice_id uuid,
  target_student_id uuid default null
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
    from public.fee_invoices as invoice
    where invoice.id = target_invoice_id
      and (target_student_id is null or invoice.student_id = target_student_id)
      and public.can_manage_fee_scope(
        invoice.organization_id,
        invoice.school_id,
        invoice.campus_id,
        invoice.student_id
      )
  );
$function$;

create or replace function public.record_fee_payment(
  target_invoice_id uuid,
  target_student_id uuid,
  target_amount numeric,
  target_payment_date date,
  target_payment_method text,
  target_reference text,
  target_note text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor_id uuid := auth.uid();
  invoice_row public.fee_invoices%rowtype;
  existing_payment public.fee_payments%rowtype;
  invoice_total numeric(12, 2);
  total_paid numeric(12, 2);
  saved_payment_id uuid;
  normalized_reference text := btrim(coalesce(target_reference, ''));
  normalized_note text := btrim(coalesce(target_note, ''));
begin
  if actor_id is null then
    raise exception 'Authentication is required to record a fee payment.'
      using errcode = '42501';
  end if;

  if target_idempotency_key is null or length(btrim(target_idempotency_key)) = 0 then
    raise exception 'A payment idempotency key is required.'
      using errcode = '22023';
  end if;

  select invoice.*
  into invoice_row
  from public.fee_invoices as invoice
  where invoice.id = target_invoice_id
    and invoice.student_id = target_student_id
  for update;

  if not found or not public.can_manage_fee_invoice(target_invoice_id, target_student_id) then
    raise exception 'The fee invoice is outside your authorized scope or does not belong to this student.'
      using errcode = '42501';
  end if;

  select payment.*
  into existing_payment
  from public.fee_payments as payment
  where payment.idempotency_key = target_idempotency_key;

  if found then
    if existing_payment.invoice_id = target_invoice_id
      and existing_payment.student_id = target_student_id
      and existing_payment.amount = target_amount
      and existing_payment.payment_date = target_payment_date
      and existing_payment.payment_method = target_payment_method
      and existing_payment.reference = normalized_reference
      and existing_payment.note = normalized_note
    then
      return existing_payment.id;
    end if;
    raise exception 'This payment idempotency key was already used for a different payment.'
      using errcode = '23505';
  end if;

  if target_amount is null
    or target_amount <= 0
    or target_amount <> round(target_amount, 2)
    or target_payment_date is null
    or target_payment_date > current_date
    or target_payment_method is null
    or target_payment_method not in ('Cash', 'Bank Transfer', 'Card', 'Online')
  then
    raise exception 'Payment amount, date, or method is invalid.'
      using errcode = '22023';
  end if;

  select coalesce(sum(item.amount), 0)::numeric(12, 2)
  into invoice_total
  from public.fee_invoice_items as item
  where item.invoice_id = target_invoice_id;

  select coalesce(sum(payment.amount), 0)::numeric(12, 2)
  into total_paid
  from public.fee_payments as payment
  where payment.invoice_id = target_invoice_id;

  if invoice_total <= 0 then
    raise exception 'The fee invoice has no payable line items.'
      using errcode = '22023';
  end if;

  if target_amount > invoice_total - total_paid then
    raise exception 'Payment amount cannot exceed the current outstanding balance.'
      using errcode = '22023';
  end if;

  if normalized_reference <> '' and exists (
    select 1
    from public.fee_payments as payment
    where payment.invoice_id = target_invoice_id
      and lower(btrim(payment.reference)) = lower(normalized_reference)
  ) then
    raise exception 'A payment with this reference is already recorded for the invoice.'
      using errcode = '23505';
  end if;

  insert into public.fee_payments (
    invoice_id,
    student_id,
    amount,
    payment_date,
    payment_method,
    reference,
    note,
    idempotency_key,
    received_by
  )
  values (
    target_invoice_id,
    target_student_id,
    target_amount,
    target_payment_date,
    target_payment_method,
    normalized_reference,
    normalized_note,
    target_idempotency_key,
    actor_id
  )
  returning id into saved_payment_id;

  update public.fee_invoices
  set updated_at = now()
  where id = target_invoice_id;

  return saved_payment_id;
end;
$function$;

revoke all on function public.can_access_fee_scope(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.can_manage_fee_scope(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.can_access_fee_invoice(uuid, uuid) from public, anon;
revoke all on function public.can_manage_fee_invoice(uuid, uuid) from public, anon;
revoke all on function public.record_fee_payment(uuid, uuid, numeric, date, text, text, text, text) from public, anon;
grant execute on function public.can_access_fee_scope(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.can_manage_fee_scope(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.can_access_fee_invoice(uuid, uuid) to authenticated;
grant execute on function public.can_manage_fee_invoice(uuid, uuid) to authenticated;
grant execute on function public.record_fee_payment(uuid, uuid, numeric, date, text, text, text, text) to authenticated;

revoke all on public.fee_invoices from public, anon;
revoke all on public.fee_invoice_items from public, anon;
revoke all on public.fee_payments from public, anon;
revoke all on public.fee_invoices from authenticated;
revoke all on public.fee_invoice_items from authenticated;
revoke all on public.fee_payments from authenticated;
grant select on public.fee_invoices to authenticated;
grant select on public.fee_invoice_items to authenticated;
grant select on public.fee_payments to authenticated;

drop policy if exists fee_invoices_read_same_school on public.fee_invoices;
drop policy if exists fee_invoice_items_read_same_school on public.fee_invoice_items;
drop policy if exists fee_payments_read_same_school on public.fee_payments;

create policy fee_invoices_read_same_school
on public.fee_invoices
for select
to authenticated
using (public.can_access_fee_invoice(id, student_id));

create policy fee_invoice_items_read_same_school
on public.fee_invoice_items
for select
to authenticated
using (public.can_access_fee_invoice(invoice_id));

create policy fee_payments_read_same_school
on public.fee_payments
for select
to authenticated
using (public.can_access_fee_invoice(invoice_id, student_id));

commit;
