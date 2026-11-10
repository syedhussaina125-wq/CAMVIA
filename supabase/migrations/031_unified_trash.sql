begin;

alter table public.attendance_records
  add column if not exists trashed_at timestamptz null,
  add column if not exists trashed_by uuid null references public.profiles(id),
  add column if not exists trash_reason text null;

create index if not exists attendance_records_trashed_session_idx
  on public.attendance_records (attendance_session_id, trashed_at)
  where trashed_at is not null;

create table if not exists public.attendance_trash_audit (
  id uuid primary key default gen_random_uuid(),
  attendance_session_id uuid not null references public.attendance_sessions(id) on delete restrict,
  attendance_record_id uuid not null references public.attendance_records(id) on delete restrict,
  actor_id uuid not null references public.profiles(id),
  action text not null check (action in ('TRASHED', 'RESTORED')),
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.attendance_trash_audit enable row level security;

create or replace function public.prevent_editing_trashed_attendance()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if old.trashed_at is not null
    and new.trashed_at is not null
    and (new.status is distinct from old.status or new.note is distinct from old.note) then
    raise exception 'Attendance is in Trash. Restore it before editing.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists attendance_records_prevent_trashed_edit on public.attendance_records;
create trigger attendance_records_prevent_trashed_edit
before update on public.attendance_records
for each row execute function public.prevent_editing_trashed_attendance();

create or replace function public.trash_attendance_session(
  p_session_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor public.profiles%rowtype;
  target public.attendance_sessions%rowtype;
  normalized_reason text := btrim(coalesce(p_reason, ''));
  changed_count integer;
begin
  select * into actor from public.profiles
  where id = auth.uid() and status = 'ACTIVE' and role = 'ADMIN';
  if not found then
    raise exception 'Only administrators can move attendance to Trash.' using errcode = '42501';
  end if;
  if normalized_reason = '' or length(normalized_reason) > 500 then
    raise exception 'Enter a reason of 1 to 500 characters.' using errcode = '22023';
  end if;

  select * into target from public.attendance_sessions
  where id = p_session_id
    and organization_id = actor.organization_id
    and school_id = actor.school_id
  for update;
  if not found then
    raise exception 'Attendance session not found in your authorized school scope.' using errcode = '42501';
  end if;

  with changed as (
    update public.attendance_records
    set trashed_at = pg_catalog.now(),
        trashed_by = actor.id,
        trash_reason = normalized_reason,
        updated_at = pg_catalog.now()
    where attendance_session_id = target.id and trashed_at is null
    returning id
  )
  insert into public.attendance_trash_audit (
    attendance_session_id, attendance_record_id, actor_id, action, reason
  )
  select target.id, changed.id, actor.id, 'TRASHED', normalized_reason from changed;
  get diagnostics changed_count = row_count;

  if changed_count = 0 then
    raise exception 'No active attendance records were found for this session.' using errcode = '22023';
  end if;

  return jsonb_build_object('success', true, 'records_moved', changed_count);
end;
$function$;

create or replace function public.restore_trashed_attendance_session(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor public.profiles%rowtype;
  target public.attendance_sessions%rowtype;
  changed_count integer;
begin
  select * into actor from public.profiles
  where id = auth.uid() and status = 'ACTIVE' and role = 'ADMIN';
  if not found then
    raise exception 'Only administrators can restore attendance from Trash.' using errcode = '42501';
  end if;

  select * into target from public.attendance_sessions
  where id = p_session_id
    and organization_id = actor.organization_id
    and school_id = actor.school_id
  for update;
  if not found then
    raise exception 'Attendance session not found in your authorized school scope.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.attendance_records
    where attendance_session_id = target.id
      and trashed_at is not null
      and trashed_at > pg_catalog.now() - interval '30 days'
  ) then
    raise exception 'The 30-day recovery period has ended or no trashed records remain.' using errcode = '22023';
  end if;

  with changed as (
    update public.attendance_records
    set trashed_at = null, trashed_by = null, trash_reason = null, updated_at = pg_catalog.now()
    where attendance_session_id = target.id
      and trashed_at is not null
      and trashed_at > pg_catalog.now() - interval '30 days'
    returning id
  )
  insert into public.attendance_trash_audit (
    attendance_session_id, attendance_record_id, actor_id, action, reason
  )
  select target.id, changed.id, actor.id, 'RESTORED', 'Restored within the recovery period'
  from changed;
  get diagnostics changed_count = row_count;

  return jsonb_build_object('success', true, 'records_restored', changed_count);
end;
$function$;

create or replace function public.get_unified_trash_records(
  p_record_type text default 'ALL'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor public.profiles%rowtype;
  normalized_type text := upper(btrim(coalesce(p_record_type, 'ALL')));
  items jsonb := '[]'::jsonb;
  extra_items jsonb := '[]'::jsonb;
begin
  select * into actor from public.profiles
  where id = auth.uid() and status = 'ACTIVE' and role = 'ADMIN';
  if not found then
    raise exception 'Only administrators can view the Trash directory.' using errcode = '42501';
  end if;

  items := public.get_trashed_records(normalized_type);

  select coalesce(jsonb_agg(item order by item->>'deleted_at' desc), '[]'::jsonb)
  into extra_items
  from (
    select jsonb_build_object(
      'id', s.id, 'record_type', 'STUDENT_ARCHIVED',
      'name', concat_ws(' ', s.first_name, s.last_name), 'identifier', s.student_code,
      'detail', concat_ws(' · ', concat_ws('-', s.class_name, s.section), 'Archived'),
      'deleted_at', s.archived_at, 'deleted_by', s.archived_by,
      'deleted_by_name', coalesce(p.full_name, 'School Administrator'),
      'delete_reason', s.archive_reason, 'purge_after', null,
      'days_remaining', null, 'is_tombstoned', false, 'restorable', false
    ) as item
    from public.students s
    left join public.profiles p on p.id = s.archived_by
    where normalized_type in ('ALL', 'STUDENTS', 'STUDENT')
      and s.organization_id = actor.organization_id and s.school_id = actor.school_id
      and s.archived_at is not null and s.deleted_at is null

    union all

    select jsonb_build_object(
      'id', g.id, 'record_type', 'GUARDIAN_ARCHIVED',
      'name', concat_ws(' ', g.first_name, g.last_name),
      'identifier', coalesce(g.phone, g.email, 'Guardian'),
      'detail', concat_ws(' · ', coalesce(g.relationship, 'Guardian'), 'Archived'),
      'deleted_at', g.archived_at, 'deleted_by', g.archived_by,
      'deleted_by_name', coalesce(p.full_name, 'School Administrator'),
      'delete_reason', g.archive_reason, 'purge_after', null,
      'days_remaining', null, 'is_tombstoned', false, 'restorable', false
    ) as item
    from public.guardians g
    left join public.profiles p on p.id = g.archived_by
    where normalized_type in ('ALL', 'GUARDIANS', 'GUARDIAN')
      and g.organization_id = actor.organization_id and g.school_id = actor.school_id
      and g.archived_at is not null and g.deleted_at is null

    union all

    select jsonb_build_object(
      'id', session.id, 'record_type', 'ATTENDANCE_SESSION',
      'name', concat_ws('-', session.class_name, session.section, to_char(session.attendance_date, 'Mon DD, YYYY')),
      'identifier', concat_ws(' · ', session.class_name, session.section),
      'detail', count(record.id)::text || ' attendance records',
      'deleted_at', max(record.trashed_at), 'deleted_by', (array_agg(record.trashed_by order by record.trashed_at desc))[1],
      'deleted_by_name', coalesce(max(profile.full_name), 'School Administrator'),
      'delete_reason', max(record.trash_reason), 'purge_after', max(record.trashed_at) + interval '30 days',
      'days_remaining', greatest(0, ceil(extract(epoch from (max(record.trashed_at) + interval '30 days' - pg_catalog.now())) / 86400)),
      'is_tombstoned', false,
      'restorable', max(record.trashed_at) > pg_catalog.now() - interval '30 days'
    ) as item
    from public.attendance_sessions session
    join public.attendance_records record on record.attendance_session_id = session.id
    left join public.profiles profile on profile.id = record.trashed_by
    where normalized_type in ('ALL', 'ATTENDANCE')
      and session.organization_id = actor.organization_id and session.school_id = actor.school_id
      and record.trashed_at is not null
    group by session.id, session.class_name, session.section, session.attendance_date

    union all

    select jsonb_build_object(
      'id', invoice.id, 'record_type', 'CANCELLED_INVOICE',
      'name', concat_ws(' ', student.first_name, student.last_name),
      'identifier', student.student_code,
      'detail', concat_ws(' · ', to_char(invoice.fee_period, 'Mon YYYY'),
        'PKR ' || to_char(coalesce(total.amount, 0), 'FM999,999,999,990.00')),
      'deleted_at', invoice.voided_at, 'deleted_by', invoice.voided_by,
      'deleted_by_name', coalesce(profile.full_name, 'School Finance'),
      'delete_reason', invoice.void_reason, 'purge_after', null,
      'days_remaining', null, 'is_tombstoned', false, 'restorable', false
    ) as item
    from public.fee_invoices invoice
    join public.students student on student.id = invoice.student_id
    left join public.profiles profile on profile.id = invoice.voided_by
    left join lateral (
      select sum(item.amount) as amount
      from public.fee_invoice_items item
      where item.invoice_id = invoice.id
    ) total on true
    where normalized_type in ('ALL', 'FEES')
      and invoice.organization_id = actor.organization_id and invoice.school_id = actor.school_id
      and invoice.voided_at is not null

    union all

    select jsonb_build_object(
      'id', payment.id, 'record_type', 'CANCELLED_PAYMENT',
      'name', concat_ws(' ', student.first_name, student.last_name),
      'identifier', student.student_code,
      'detail', concat_ws(' · ', to_char(payment.payment_date, 'Mon DD, YYYY'),
        'PKR ' || to_char(payment.amount, 'FM999,999,999,990.00'), payment.payment_method),
      'deleted_at', payment.voided_at, 'deleted_by', payment.voided_by,
      'deleted_by_name', coalesce(profile.full_name, 'School Finance'),
      'delete_reason', payment.void_reason, 'purge_after', null,
      'days_remaining', null, 'is_tombstoned', false, 'restorable', false
    ) as item
    from public.fee_payments payment
    join public.fee_invoices invoice on invoice.id = payment.invoice_id
    join public.students student on student.id = payment.student_id
    left join public.profiles profile on profile.id = payment.voided_by
    where normalized_type in ('ALL', 'FEES')
      and invoice.organization_id = actor.organization_id and invoice.school_id = actor.school_id
      and payment.voided_at is not null
  ) records;

  return items || extra_items;
end;
$function$;

revoke all on function public.trash_attendance_session(uuid, text) from public, anon;
revoke all on function public.restore_trashed_attendance_session(uuid) from public, anon;
revoke all on function public.get_unified_trash_records(text) from public, anon;
grant execute on function public.trash_attendance_session(uuid, text) to authenticated;
grant execute on function public.restore_trashed_attendance_session(uuid) to authenticated;
grant execute on function public.get_unified_trash_records(text) to authenticated;

commit;
