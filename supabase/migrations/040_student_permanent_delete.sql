begin;

do $schema_preflight$
declare
  missing_relations text[];
begin
  select pg_catalog.array_agg(required_relation.name order by required_relation.name)
  into missing_relations
  from pg_catalog.unnest(array[
    'public.profiles',
    'public.schools',
    'public.students',
    'public.attendance_records',
    'public.attendance_sessions',
    'public.fee_invoices',
    'public.fee_invoice_items',
    'public.fee_payments',
    'public.communication_messages',
    'public.communication_recipients',
    'public.communication_events',
    'public.student_guardians',
    'public.guardians',
    'public.admission_applications',
    'public.user_management_audit'
  ]) as required_relation(name)
  where not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = pg_catalog.to_regclass(required_relation.name)::oid
      and relation.relkind in ('r', 'p')
  );

  if missing_relations is not null then
    raise exception '040_student_permanent_delete.sql requires existing tables: %.',
      pg_catalog.array_to_string(missing_relations, ', ');
  end if;
end;
$schema_preflight$;

-- Some deployed schema versions do not have this optional audit table.
-- When present, retain its UUIDs as historical references without FK blockers.
do $audit_history$
declare
  audit_table_oid oid := pg_catalog.to_regclass('public.attendance_trash_audit')::oid;
  audit_constraint record;
begin
  if audit_table_oid is not null then
    if not exists (
      select 1
      from pg_catalog.pg_class as relation
      where relation.oid = audit_table_oid
        and relation.relkind in ('r', 'p')
    ) then
      raise exception 'public.attendance_trash_audit exists but is not a table.';
    end if;

    if (
      select count(*)
      from pg_catalog.pg_attribute as column_info
      where column_info.attrelid = audit_table_oid
        and column_info.attname in ('attendance_record_id', 'attendance_session_id')
        and column_info.attnum > 0
        and not column_info.attisdropped
    ) <> 2 then
      raise exception 'public.attendance_trash_audit has an unexpected schema.';
    end if;

    for audit_constraint in
      select constraint_info.conname
      from pg_catalog.pg_constraint as constraint_info
      where constraint_info.conrelid = audit_table_oid
        and constraint_info.contype = 'f'
        and constraint_info.confrelid in (
          pg_catalog.to_regclass('public.attendance_records')::oid,
          pg_catalog.to_regclass('public.attendance_sessions')::oid
        )
    loop
      execute pg_catalog.format(
        'alter table public.attendance_trash_audit drop constraint %I',
        audit_constraint.conname
      );
    end loop;

    execute 'comment on column public.attendance_trash_audit.attendance_record_id is ''Historical UUID reference; intentionally not a foreign key so audit history survives permanent deletion.''';
    execute 'comment on column public.attendance_trash_audit.attendance_session_id is ''Historical UUID reference; intentionally not a foreign key so audit history survives permanent deletion.''';
  end if;
end;
$audit_history$;

do $migration$
begin
  if pg_catalog.to_regprocedure('public.permanently_delete_trash_item(text,uuid)') is not null
    and pg_catalog.to_regprocedure('public.permanently_delete_trash_item_legacy(text,uuid)') is null
  then
    execute 'alter function public.permanently_delete_trash_item(text, uuid) rename to permanently_delete_trash_item_legacy';
  end if;

  if pg_catalog.to_regprocedure('public.permanently_delete_trash_item_legacy(text,uuid)') is null then
    raise exception 'Apply 038_trash_permanent_delete.sql before 040_student_permanent_delete.sql.';
  end if;
end;
$migration$;

revoke all on function public.permanently_delete_trash_item_legacy(text, uuid)
  from public, anon, authenticated;

create or replace function public._permanently_delete_trashed_student(
  p_student_id uuid,
  p_confirmation text,
  p_test_handover boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
  student public.students%rowtype;
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := pg_catalog.now();
  v_payment_count bigint := 0;
  v_payment_amount_total numeric(12, 2) := 0;
  v_voided_payment_count bigint := 0;
  v_attendance_record_count bigint := 0;
  v_attendance_session_count bigint := 0;
  v_communication_message_count bigint := 0;
  v_communication_recipient_count bigint := 0;
  v_communication_event_count bigint := 0;
  v_fee_invoice_count bigint := 0;
  v_fee_invoice_item_count bigint := 0;
  v_student_guardian_link_count bigint := 0;
  v_guardian_count bigint := 0;
  v_admission_unlinked_count bigint := 0;
  v_deleted_count bigint := 0;
  v_attendance_session_ids uuid[] := array[]::uuid[];
  v_guardian_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to permanently delete a student.'
      using errcode = '42501';
  end if;

  if p_test_handover then
    if p_confirmation is distinct from 'PURGE TEST/HANDOVER' then
      return jsonb_build_object(
        'success', false,
        'message', 'Type PURGE TEST/HANDOVER to confirm the exceptional test/handover purge.'
      );
    end if;

    if normalized_reason is null or length(normalized_reason) < 10 or length(normalized_reason) > 500 then
      return jsonb_build_object(
        'success', false,
        'message', 'Provide a test/handover purge reason of 10 to 500 characters.'
      );
    end if;
  elsif p_confirmation is distinct from 'DELETE' then
    return jsonb_build_object(
      'success', false,
      'message', 'Type DELETE in the Trash confirmation to permanently delete this student.'
    );
  end if;

  select profile.* into actor
  from public.profiles as profile
  join public.schools as school
    on school.id = profile.school_id
    and school.organization_id = profile.organization_id
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can permanently delete a student.'
      using errcode = '42501';
  end if;

  select target.* into student
  from public.students as target
  join public.schools as school
    on school.id = target.school_id
    and school.organization_id = target.organization_id
  where target.id = p_student_id
    and target.organization_id = actor.organization_id
    and target.school_id = actor.school_id
  for update of target;

  if not found then
    return jsonb_build_object(
      'success', false,
      'message', 'The student was not found in your school and organization.'
    );
  end if;

  if student.deleted_at is null or student.is_tombstoned then
    return jsonb_build_object(
      'success', false,
      'message', 'This student must be in Trash and not tombstoned before permanent deletion.'
    );
  end if;

  if exists (
    select 1
    from public.attendance_records as record
    join public.attendance_sessions as session
      on session.id = record.attendance_session_id
    where record.student_id = student.id
      and (
        session.organization_id is distinct from student.organization_id
        or session.school_id is distinct from student.school_id
      )
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'Cannot permanently delete this student: an attendance record points to a session outside the student''s school. No data was removed; resolve the data-integrity issue first.'
    );
  end if;

  if exists (
    select 1
    from public.fee_invoices as invoice
    where invoice.student_id = student.id
      and (
        invoice.organization_id is distinct from student.organization_id
        or invoice.school_id is distinct from student.school_id
      )
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'Cannot permanently delete this student: a fee invoice is outside the student''s school or organization. No data was removed; resolve the data-integrity issue first.'
    );
  end if;

  if exists (
    select 1
    from public.fee_payments as payment
    left join public.fee_invoices as invoice
      on invoice.id = payment.invoice_id
    where (payment.student_id = student.id or invoice.student_id = student.id)
      and (
        payment.student_id is distinct from student.id
        or invoice.student_id is distinct from student.id
        or invoice.organization_id is distinct from student.organization_id
        or invoice.school_id is distinct from student.school_id
      )
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'Cannot permanently delete this student: a fee payment is linked to a different student or school. No data was removed; resolve the data-integrity issue first.'
    );
  end if;

  if exists (
    select 1
    from public.communication_messages as message
    where message.student_id = student.id
      and (
        message.organization_id is distinct from student.organization_id
        or message.school_id is distinct from student.school_id
      )
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'Cannot permanently delete this student: a communication message is outside the student''s school or organization. No data was removed; resolve the data-integrity issue first.'
    );
  end if;

  if exists (
    select 1
    from public.communication_recipients as recipient
    left join public.communication_messages as message
      on message.id = recipient.message_id
    where (recipient.student_id = student.id and message.student_id is distinct from student.id)
      or (message.student_id = student.id and recipient.student_id is distinct from student.id)
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'Cannot permanently delete this student: a communication recipient is linked to a different student or message. No data was removed; resolve the data-integrity issue first.'
    );
  end if;

  if exists (
    select 1
    from public.student_guardians as link
    join public.guardians as guardian
      on guardian.id = link.guardian_id
    where link.student_id = student.id
      and (
        guardian.organization_id is distinct from student.organization_id
        or guardian.school_id is distinct from student.school_id
      )
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'Cannot permanently delete this student: a guardian link points outside the student''s school or organization. No data was removed; resolve the data-integrity issue first.'
    );
  end if;

  if exists (
    select 1
    from public.admission_applications as application
    where application.created_student_id = student.id
      and application.school_id is distinct from student.school_id
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'Cannot permanently delete this student: an admission application in another school references the student. No data was removed; resolve the data-integrity issue first.'
    );
  end if;

  select count(*)::bigint,
    coalesce(sum(payment.amount), 0)::numeric(12, 2),
    (count(*) filter (where payment.voided_at is not null))::bigint
  into v_payment_count, v_payment_amount_total, v_voided_payment_count
  from public.fee_payments as payment
  join public.fee_invoices as invoice
    on invoice.id = payment.invoice_id
  where payment.student_id = student.id
    or invoice.student_id = student.id;

  if v_payment_count > 0 and not p_test_handover then
    return jsonb_build_object(
      'success', false,
      'message', pg_catalog.format(
        'Cannot permanently delete this student: %s fee payment record(s) totaling %s remain. Normal deletion preserves payment history; resolve the records through Finance. Use the exceptional test/handover purge only for confirmed non-production data.',
        v_payment_count,
        pg_catalog.to_char(v_payment_amount_total, 'FM999,999,999,990.00')
      )
    );
  end if;

  select coalesce(pg_catalog.array_agg(distinct record.attendance_session_id), array[]::uuid[])
  into v_attendance_session_ids
  from public.attendance_records as record
  where record.student_id = student.id;

  select coalesce(pg_catalog.array_agg(distinct link.guardian_id), array[]::uuid[])
  into v_guardian_ids
  from public.student_guardians as link
  where link.student_id = student.id;

  select count(*)::bigint
  into v_attendance_record_count
  from public.attendance_records as record
  where record.student_id = student.id;

  select count(distinct session.id)::bigint
  into v_attendance_session_count
  from public.attendance_sessions as session
  where session.id = any(v_attendance_session_ids)
    and not exists (
      select 1
      from public.attendance_records as other_record
      where other_record.attendance_session_id = session.id
        and other_record.student_id <> student.id
    );

  select count(*)::bigint
  into v_communication_message_count
  from public.communication_messages as message
  where message.student_id = student.id;

  select count(*)::bigint
  into v_communication_recipient_count
  from public.communication_recipients as recipient
  where recipient.student_id = student.id;

  select count(*)::bigint
  into v_communication_event_count
  from public.communication_events as event
  join public.communication_messages as message
    on message.id = event.message_id
  where message.student_id = student.id;

  select count(*)::bigint
  into v_fee_invoice_count
  from public.fee_invoices as invoice
  where invoice.student_id = student.id;

  select count(*)::bigint
  into v_fee_invoice_item_count
  from public.fee_invoice_items as item
  join public.fee_invoices as invoice
    on invoice.id = item.invoice_id
  where invoice.student_id = student.id;

  select count(*)::bigint
  into v_student_guardian_link_count
  from public.student_guardians as link
  where link.student_id = student.id;

  select count(*)::bigint
  into v_guardian_count
  from public.guardians as guardian
  where guardian.id = any(v_guardian_ids)
    and guardian.organization_id = student.organization_id
    and guardian.school_id = student.school_id
    and not exists (
      select 1
      from public.student_guardians as other_link
      where other_link.guardian_id = guardian.id
        and other_link.student_id <> student.id
    )
    and not exists (
      select 1
      from public.communication_recipients as other_recipient
      where other_recipient.guardian_id = guardian.id
        and other_recipient.student_id <> student.id
    );

  insert into public.user_management_audit (actor_id, target_id, event_type, details)
  values (
    actor.id,
    student.id,
    'RECORD_PERMANENTLY_DELETED',
    jsonb_build_object(
      'record_type', 'STUDENT',
      'action', case when p_test_handover then 'TEST_HANDOVER_PURGE' else 'PERMANENT_DELETE' end,
      'student_id', student.id,
      'student_code', student.student_code,
      'reason', coalesce(normalized_reason, 'Admin-requested permanent deletion.'),
      'deleted_data', jsonb_build_object(
        'attendance_records', v_attendance_record_count,
        'attendance_sessions', v_attendance_session_count,
        'communication_recipients', v_communication_recipient_count,
        'communication_events', v_communication_event_count,
        'communication_messages', v_communication_message_count,
        'fee_payments', v_payment_count,
        'fee_payment_amount_total', v_payment_amount_total,
        'voided_fee_payments', v_voided_payment_count,
        'fee_invoice_items', v_fee_invoice_item_count,
        'fee_invoices', v_fee_invoice_count,
        'student_guardian_links', v_student_guardian_link_count,
        'unshared_guardians', v_guardian_count
      ),
      'admission_history_preserved', true,
      'occurred_at', v_now
    )
  );

  update public.admission_applications as application
  set created_student_id = null
  where application.created_student_id = student.id
    and application.school_id = student.school_id;
  get diagnostics v_admission_unlinked_count = row_count;

  delete from public.communication_recipients as recipient
  where recipient.student_id = student.id;

  delete from public.communication_events as event
  using public.communication_messages as message
  where event.message_id = message.id
    and message.student_id = student.id;

  delete from public.communication_messages as message
  where message.student_id = student.id
    and message.organization_id = student.organization_id
    and message.school_id = student.school_id;

  delete from public.attendance_records as record
  where record.student_id = student.id;

  delete from public.attendance_sessions as session
  where session.id = any(v_attendance_session_ids)
    and session.organization_id = student.organization_id
    and session.school_id = student.school_id
    and not exists (
      select 1
      from public.attendance_records as other_record
      where other_record.attendance_session_id = session.id
    );

  delete from public.fee_payments as payment
  where payment.student_id = student.id
    or exists (
      select 1
      from public.fee_invoices as invoice
      where invoice.id = payment.invoice_id
        and invoice.student_id = student.id
        and invoice.organization_id = student.organization_id
        and invoice.school_id = student.school_id
    );

  delete from public.fee_invoice_items as item
  using public.fee_invoices as invoice
  where item.invoice_id = invoice.id
    and invoice.student_id = student.id
    and invoice.organization_id = student.organization_id
    and invoice.school_id = student.school_id;

  delete from public.fee_invoices as invoice
  where invoice.student_id = student.id
    and invoice.organization_id = student.organization_id
    and invoice.school_id = student.school_id;

  delete from public.student_guardians as link
  where link.student_id = student.id;

  delete from public.guardians as guardian
  where guardian.id = any(v_guardian_ids)
    and guardian.organization_id = student.organization_id
    and guardian.school_id = student.school_id
    and not exists (
      select 1
      from public.student_guardians as other_link
      where other_link.guardian_id = guardian.id
    )
    and not exists (
      select 1
      from public.communication_recipients as other_recipient
      where other_recipient.guardian_id = guardian.id
    );

  delete from public.students as target
  where target.id = student.id
    and target.organization_id = actor.organization_id
    and target.school_id = actor.school_id
    and target.deleted_at is not null
    and not target.is_tombstoned;
  get diagnostics v_deleted_count = row_count;

  if v_deleted_count <> 1 then
    raise exception 'Student permanent deletion did not remove exactly one eligible student; the transaction was rolled back.';
  end if;

  return jsonb_build_object(
    'success', true,
    'admission_applications_unlinked', v_admission_unlinked_count
  );
end;
$function$;

create or replace function public.permanently_delete_trashed_student(
  p_student_id uuid,
  p_confirmation text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
  select public._permanently_delete_trashed_student(
    p_student_id,
    p_confirmation,
    false,
    null
  );
$function$;

create or replace function public.purge_test_handover_student(
  p_student_id uuid,
  p_confirmation text,
  p_reason text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
  select public._permanently_delete_trashed_student(
    p_student_id,
    p_confirmation,
    true,
    p_reason
  );
$function$;

create or replace function public.permanently_delete_trash_item(
  p_record_type text,
  p_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
begin
  if p_record_type = 'STUDENT' then
    return jsonb_build_object(
      'success', false,
      'message', 'Use the confirmed student permanent-delete action in Trash.'
    );
  end if;

  return public.permanently_delete_trash_item_legacy(p_record_type, p_record_id);
end;
$function$;

revoke all on function public._permanently_delete_trashed_student(uuid, text, boolean, text)
  from public, anon, authenticated;
revoke all on function public.permanently_delete_trashed_student(uuid, text)
  from public, anon;
revoke all on function public.purge_test_handover_student(uuid, text, text)
  from public, anon;
revoke all on function public.permanently_delete_trash_item(text, uuid)
  from public, anon;

grant execute on function public.permanently_delete_trashed_student(uuid, text)
  to authenticated;
grant execute on function public.purge_test_handover_student(uuid, text, text)
  to authenticated;
grant execute on function public.permanently_delete_trash_item(text, uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
