begin;

create or replace function public.get_unified_trash_records(
  p_record_type text default 'ALL'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor_id uuid := auth.uid();
  actor public.profiles%rowtype;
  normalized_type text := upper(btrim(coalesce(p_record_type, 'ALL')));
  items jsonb := '[]'::jsonb;
  extra_items jsonb := '[]'::jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor
  from public.profiles
  where id = actor_id
    and status = 'ACTIVE'
    and role = 'ADMIN'
    and organization_id is not null
    and school_id is not null;

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

revoke all on function public.get_unified_trash_records(text) from public, anon;
grant execute on function public.get_unified_trash_records(text) to authenticated;

commit;

