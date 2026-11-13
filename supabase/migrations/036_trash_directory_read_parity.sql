begin;

create or replace function public.get_trashed_records(
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
  norm_type text := upper(btrim(coalesce(p_record_type, 'ALL')));
  result jsonb := '[]'::jsonb;
  student_items jsonb := '[]'::jsonb;
  guardian_items jsonb := '[]'::jsonb;
  comm_items jsonb := '[]'::jsonb;
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
    raise exception 'Only an active school administrator can view Trash.' using errcode = '42501';
  end if;

  if norm_type in ('ALL', 'STUDENTS', 'STUDENT') then
    select coalesce(jsonb_agg(item order by item->>'deleted_at' desc), '[]'::jsonb)
    into student_items
    from (
      select jsonb_build_object(
        'id', student.id,
        'record_type', 'STUDENT',
        'name', concat_ws(' ', student.first_name, student.last_name),
        'identifier', student.student_code,
        'detail', concat_ws(
          ' · ',
          concat_ws('-', student.class_name, student.section),
          campus.name,
          case when student.roll_number is not null then 'Roll ' || student.roll_number end
        ),
        'deleted_at', student.deleted_at,
        'deleted_by', student.deleted_by,
        'deleted_by_name', coalesce(profile.full_name, 'School Administrator'),
        'delete_reason', student.delete_reason,
        'purge_after', student.purge_after,
        'days_remaining', case
          when student.purge_after is null then null
          else greatest(0, ceil(extract(epoch from (student.purge_after - pg_catalog.now())) / 86400))
        end,
        'is_tombstoned', student.is_tombstoned,
        'restorable', not student.is_tombstoned
          and (student.purge_after is null or student.purge_after > pg_catalog.now())
      ) as item
      from public.students as student
      left join public.profiles as profile on profile.id = student.deleted_by
      left join public.campuses as campus on campus.id = student.campus_id
      where student.organization_id = actor.organization_id
        and student.school_id = actor.school_id
        and student.deleted_at is not null
        and not student.is_tombstoned
    ) as trashed_students;
  end if;

  if norm_type in ('ALL', 'GUARDIANS', 'GUARDIAN') then
    select coalesce(jsonb_agg(item order by item->>'deleted_at' desc), '[]'::jsonb)
    into guardian_items
    from (
      select jsonb_build_object(
        'id', guardian.id,
        'record_type', 'GUARDIAN',
        'name', concat_ws(' ', guardian.first_name, guardian.last_name),
        'identifier', coalesce(guardian.phone, guardian.email, 'Guardian'),
        'detail', concat_ws(' · ', guardian.relationship, guardian.phone),
        'deleted_at', guardian.deleted_at,
        'deleted_by', guardian.deleted_by,
        'deleted_by_name', coalesce(profile.full_name, 'School Administrator'),
        'delete_reason', guardian.delete_reason,
        'purge_after', guardian.purge_after,
        'days_remaining', case
          when guardian.purge_after is null then null
          else greatest(0, ceil(extract(epoch from (guardian.purge_after - pg_catalog.now())) / 86400))
        end,
        'is_tombstoned', guardian.is_tombstoned,
        'restorable', not guardian.is_tombstoned
          and (guardian.purge_after is null or guardian.purge_after > pg_catalog.now())
      ) as item
      from public.guardians as guardian
      left join public.profiles as profile on profile.id = guardian.deleted_by
      where guardian.organization_id = actor.organization_id
        and guardian.school_id = actor.school_id
        and guardian.deleted_at is not null
        and not guardian.is_tombstoned
    ) as trashed_guardians;
  end if;

  if norm_type in ('ALL', 'COMMUNICATIONS', 'COMMUNICATION', 'DRAFTS', 'DRAFT') then
    select coalesce(jsonb_agg(item order by item->>'deleted_at' desc), '[]'::jsonb)
    into comm_items
    from (
      select jsonb_build_object(
        'id', message.id,
        'record_type', 'COMMUNICATION_DRAFT',
        'name', message.message_type || ' (' || message.channel || ')',
        'identifier', substring(message.id::text from 1 for 8),
        'detail', substring(message.body from 1 for 60)
          || case when length(message.body) > 60 then '…' else '' end,
        'deleted_at', message.deleted_at,
        'deleted_by', message.deleted_by,
        'deleted_by_name', coalesce(profile.full_name, 'School Staff'),
        'delete_reason', message.delete_reason,
        'purge_after', message.purge_after,
        'days_remaining', case
          when message.purge_after is null then null
          else greatest(0, ceil(extract(epoch from (message.purge_after - pg_catalog.now())) / 86400))
        end,
        'is_tombstoned', message.is_tombstoned,
        'restorable', not message.is_tombstoned
          and (message.purge_after is null or message.purge_after > pg_catalog.now())
      ) as item
      from public.communication_messages as message
      left join public.profiles as profile on profile.id = message.deleted_by
      where message.organization_id = actor.organization_id
        and message.school_id = actor.school_id
        and message.deleted_at is not null
        and not message.is_tombstoned
    ) as trashed_communications;
  end if;

  result := student_items || guardian_items || comm_items;
  return result;
end;
$function$;

revoke all on function public.get_trashed_records(text) from public, anon;
grant execute on function public.get_trashed_records(text) to authenticated;

commit;
