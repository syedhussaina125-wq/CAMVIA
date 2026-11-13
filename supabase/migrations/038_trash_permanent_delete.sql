begin;

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
declare
  actor public.profiles%rowtype;
  student public.students%rowtype;
  guardian public.guardians%rowtype;
  application public.admission_applications%rowtype;
  v_now timestamptz := pg_catalog.now();
  v_event_history jsonb;
  v_guardian_phones text[];
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can permanently delete Trash records.'
      using errcode = '42501';
  end if;

  if p_record_type = 'STUDENT' then
    select target.* into student
    from public.students as target
    where target.id = p_record_id
      and target.organization_id = actor.organization_id
      and target.school_id = actor.school_id
    for update;

    if not found or student.deleted_at is null or student.is_tombstoned then
      return jsonb_build_object(
        'success', false,
        'message', 'This student is not eligible for permanent deletion.'
      );
    end if;

    if exists (
      select 1 from public.fee_invoices invoice where invoice.student_id = student.id
      union all
      select 1 from public.fee_payments payment where payment.student_id = student.id
      union all
      select 1 from public.attendance_records attendance where attendance.student_id = student.id
      union all
      select 1
      from public.communication_messages message
      where message.student_id = student.id
        and (
          message.status <> 'DRAFT'
          or exists (
            select 1 from public.communication_events event
            where event.message_id = message.id
          )
        )
      union all
      select 1
      from public.admission_applications application_record
      where application_record.created_student_id = student.id
    ) then
      return jsonb_build_object(
        'success', false,
        'message', 'This record cannot be permanently deleted because it has protected history.'
      );
    end if;

    insert into public.user_management_audit (actor_id, target_id, event_type, details)
    values (
      actor.id,
      student.id,
      'RECORD_PERMANENTLY_DELETED',
      jsonb_build_object(
        'record_type', 'STUDENT',
        'action', 'PERMANENT_DELETE',
        'student_id', student.id,
        'student_code', student.student_code,
        'reason', 'Admin-requested permanent deletion; protected history checks passed.',
        'occurred_at', v_now
      )
    );

    delete from public.communication_recipients recipient
    where recipient.student_id = student.id;
    delete from public.communication_messages message
    where message.student_id = student.id;
    delete from public.student_guardians link
    where link.student_id = student.id;
    delete from public.students target
    where target.id = student.id;

    return jsonb_build_object('success', true);
  end if;

  if p_record_type = 'GUARDIAN' then
    select target.* into guardian
    from public.guardians as target
    where target.id = p_record_id
      and target.organization_id = actor.organization_id
      and target.school_id = actor.school_id
    for update;

    if not found or guardian.deleted_at is null or guardian.is_tombstoned then
      return jsonb_build_object(
        'success', false,
        'message', 'This guardian is not eligible for permanent deletion.'
      );
    end if;

    if guardian.purge_after is null or guardian.purge_after > v_now then
      return jsonb_build_object(
        'success', false,
        'message', 'This record is still within its 30-day recovery period.'
      );
    end if;

    if exists (
      select 1
      from public.student_guardians link
      join public.students linked_student on linked_student.id = link.student_id
      where link.guardian_id = guardian.id
        and linked_student.deleted_at is null
        and linked_student.status = 'ACTIVE'
    ) then
      return jsonb_build_object(
        'success', false,
        'message', 'This guardian is still linked to an active student.'
      );
    end if;

    if exists (
      select 1 from public.student_guardians link where link.guardian_id = guardian.id
      union all
      select 1 from public.communication_recipients recipient
      where recipient.guardian_id = guardian.id
    ) then
      return jsonb_build_object(
        'success', false,
        'message', 'This record cannot be permanently deleted because it has protected history.'
      );
    end if;

    insert into public.user_management_audit (actor_id, target_id, event_type, details)
    values (
      actor.id,
      guardian.id,
      'RECORD_PERMANENTLY_DELETED',
      jsonb_build_object(
        'record_type', 'GUARDIAN',
        'action', 'PERMANENT_DELETE',
        'reason', 'Admin-requested deletion after the 30-day recovery period; protected history checks passed.',
        'occurred_at', v_now
      )
    );

    delete from public.guardians target
    where target.id = guardian.id;

    return jsonb_build_object('success', true);
  end if;

  if p_record_type = 'REJECTED_ADMISSION' then
    select target.* into application
    from public.admission_applications as target
    where target.id = p_record_id
      and target.school_id = actor.school_id
    for update;

    if not found or application.status <> 'REJECTED' then
      return jsonb_build_object(
        'success', false,
        'message', 'This rejected application is no longer available for permanent deletion.'
      );
    end if;

    if application.created_student_id is not null then
      if exists (
        select 1 from public.students linked_student
        where linked_student.id = application.created_student_id
          and linked_student.organization_id = actor.organization_id
          and linked_student.school_id = actor.school_id
          and linked_student.deleted_at is null
          and linked_student.status = 'ACTIVE'
      ) then
        return jsonb_build_object(
          'success', false,
          'message', 'This application cannot be permanently deleted because it is linked to an active student record.'
        );
      end if;

      return jsonb_build_object(
        'success', false,
        'message', 'This record cannot be permanently deleted because it has protected history.'
      );
    end if;

    v_guardian_phones := array_remove(array[
      nullif(regexp_replace(coalesce(application.guardian_phone, ''), '[^0-9]', '', 'g'), ''),
      nullif(regexp_replace(coalesce(application.whatsapp_phone, ''), '[^0-9]', '', 'g'), ''),
      nullif(regexp_replace(coalesce(application.secondary_guardian_phone, ''), '[^0-9]', '', 'g'), '')
    ], null);

    if cardinality(v_guardian_phones) > 0 and exists (
      select 1
      from public.student_guardians link
      join public.guardians linked_guardian on linked_guardian.id = link.guardian_id
      join public.students linked_student on linked_student.id = link.student_id
      where linked_guardian.organization_id = actor.organization_id
        and linked_guardian.school_id = actor.school_id
        and regexp_replace(coalesce(linked_guardian.phone, ''), '[^0-9]', '', 'g')
          = any(v_guardian_phones)
        and linked_student.deleted_at is null
        and linked_student.status = 'ACTIVE'
    ) then
      return jsonb_build_object(
        'success', false,
        'message', 'This guardian is still linked to an active student.'
      );
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'event_id', event.id,
          'actor_id', event.actor_id,
          'event_type', event.event_type,
          'details', event.details,
          'occurred_at', event.occurred_at
        )
        order by event.occurred_at, event.id
      ),
      '[]'::jsonb
    )
    into v_event_history
    from public.admission_application_events as event
    where event.application_id = application.id;

    insert into public.user_management_audit (actor_id, target_id, event_type, details)
    values (
      actor.id,
      application.id,
      'RECORD_PERMANENTLY_DELETED',
      jsonb_build_object(
        'record_type', 'REJECTED_ADMISSION',
        'action', 'PERMANENT_DELETE',
        'application_reference', application.application_reference,
        'source', application.source,
        'status', application.status,
        'submitted_at', application.submitted_at,
        'rejected_at', application.rejected_at,
        'rejected_by', application.rejected_by,
        'rejection_reason', application.rejection_reason,
        'admission_event_history', v_event_history,
        'reason', 'Admin-requested deletion; application event history retained in the audit record.',
        'occurred_at', v_now
      )
    );

    delete from public.admission_application_events event
    where event.application_id = application.id;
    delete from public.admission_applications target
    where target.id = application.id;

    return jsonb_build_object('success', true);
  end if;

  if p_record_type = 'COMMUNICATION_DRAFT' then
    perform 1
    from public.communication_messages as target
    where target.id = p_record_id
      and target.organization_id = actor.organization_id
      and target.school_id = actor.school_id
      and target.deleted_at is not null
      and not target.is_tombstoned
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'message', 'This communication record is not eligible for permanent deletion.'
      );
    end if;

    if not exists (
      select 1
      from public.communication_messages as target
      where target.id = p_record_id
        and target.purge_after is not null
        and target.purge_after <= v_now
    ) then
      return jsonb_build_object(
        'success', false,
        'message', 'This record is still within its 30-day recovery period.'
      );
    end if;

    if exists (
      select 1
      from public.communication_events as event
      where event.message_id = p_record_id
    ) then
      return jsonb_build_object(
        'success', false,
        'message', 'This communication record cannot be permanently deleted because it has protected audit history.'
      );
    end if;

    insert into public.user_management_audit (actor_id, target_id, event_type, details)
    values (
      actor.id,
      p_record_id,
      'RECORD_PERMANENTLY_DELETED',
      jsonb_build_object(
        'record_type', 'COMMUNICATION_DRAFT',
        'action', 'PERMANENT_DELETE',
        'reason', 'Admin-requested deletion after the 30-day recovery period; no communication event history was found.',
        'occurred_at', v_now
      )
    );

    delete from public.communication_recipients recipient
    where recipient.message_id = p_record_id;
    delete from public.communication_messages target
    where target.id = p_record_id;

    return jsonb_build_object('success', true);
  end if;

  return jsonb_build_object(
    'success', false,
    'message', 'Permanent deletion is not available for this record type.'
  );
end;
$function$;

revoke all on function public.permanently_delete_trash_item(text, uuid) from public, anon;
grant execute on function public.permanently_delete_trash_item(text, uuid) to authenticated;

commit;
