begin;

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
  action_at timestamptz := pg_catalog.now();
  changed_count integer;
  changed_ids uuid[];
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
    set trashed_at = action_at,
        trashed_by = actor.id,
        trash_reason = normalized_reason,
        updated_at = action_at
    where attendance_session_id = target.id and trashed_at is null
    returning id
  )
  select count(*)::integer, coalesce(array_agg(id), '{}'::uuid[])
  into changed_count, changed_ids
  from changed;

  if changed_count = 0 then
    raise exception 'No active attendance records were found for this session.' using errcode = '22023';
  end if;

  if pg_catalog.to_regclass('public.attendance_trash_audit') is not null then
    execute
      'insert into public.attendance_trash_audit ' ||
      '(attendance_session_id, attendance_record_id, actor_id, action, reason) ' ||
      'select $1, changed.record_id, $2, ''TRASHED'', $3 ' ||
      'from unnest($4::uuid[]) as changed(record_id)'
    using target.id, actor.id, normalized_reason, changed_ids;
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
  changed_ids uuid[];
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
  select count(*)::integer, coalesce(array_agg(id), '{}'::uuid[])
  into changed_count, changed_ids
  from changed;

  if pg_catalog.to_regclass('public.attendance_trash_audit') is not null then
    execute
      'insert into public.attendance_trash_audit ' ||
      '(attendance_session_id, attendance_record_id, actor_id, action, reason) ' ||
      'select $1, changed.record_id, $2, ''RESTORED'', ' ||
      '''Restored within the recovery period'' ' ||
      'from unnest($3::uuid[]) as changed(record_id)'
    using target.id, actor.id, changed_ids;
  end if;

  return jsonb_build_object('success', true, 'records_restored', changed_count);
end;
$function$;

revoke all on function public.trash_attendance_session(uuid, text) from public, anon;
revoke all on function public.restore_trashed_attendance_session(uuid) from public, anon;
grant execute on function public.trash_attendance_session(uuid, text) to authenticated;
grant execute on function public.restore_trashed_attendance_session(uuid) to authenticated;

commit;
