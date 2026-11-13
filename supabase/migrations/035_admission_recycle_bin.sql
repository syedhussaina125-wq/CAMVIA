begin;

alter table public.admission_applications
  add column if not exists rejected_by uuid references public.profiles(id) on delete set null,
  add column if not exists rejected_at timestamptz;

update public.admission_applications
set rejected_by = reviewed_by,
    rejected_at = reviewed_at
where status = 'REJECTED'
  and rejected_at is null;

alter table public.admission_application_events
  drop constraint if exists admission_application_events_event_type_check;

alter table public.admission_application_events
  add constraint admission_application_events_event_type_check
  check (event_type in ('SUBMITTED', 'EDITED', 'APPROVED', 'REJECTED', 'RESTORED_TO_PENDING'));

create index if not exists admission_applications_rejected_school_date_idx
  on public.admission_applications (school_id, rejected_at desc)
  where status = 'REJECTED';

create or replace function public.list_admission_applications()
returns table (
  id uuid,
  application_reference text,
  student_name text,
  date_of_birth date,
  gender text,
  applying_class text,
  preferred_section text,
  guardian_name text,
  guardian_relationship text,
  guardian_phone text,
  whatsapp_phone text,
  guardian_email text,
  guardian_address text,
  secondary_guardian_name text,
  secondary_guardian_relationship text,
  secondary_guardian_phone text,
  secondary_guardian_email text,
  status text,
  submitted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  created_student_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can review admissions.'
      using errcode = '42501';
  end if;

  return query
  select application.id, application.application_reference, application.student_name,
    application.date_of_birth, application.gender, application.applying_class,
    application.preferred_section, application.guardian_name, application.guardian_relationship,
    application.guardian_phone, application.whatsapp_phone, application.guardian_email,
    application.guardian_address, application.secondary_guardian_name,
    application.secondary_guardian_relationship, application.secondary_guardian_phone,
    application.secondary_guardian_email, application.status, application.submitted_at,
    application.reviewed_by, application.reviewed_at, application.approved_by,
    application.approved_at, application.rejection_reason, application.created_student_id
  from public.admission_applications as application
  where application.school_id = actor.school_id
    and application.status = 'PENDING'
  order by application.submitted_at desc;
end;
$function$;

create or replace function public.reject_admission_application(
  p_application_id uuid,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
  target public.admission_applications%rowtype;
  reason text := nullif(btrim(p_rejection_reason), '');
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can reject admissions.'
      using errcode = '42501';
  end if;

  if reason is null or length(reason) > 500 then
    raise exception 'A rejection reason of 1 to 500 characters is required.'
      using errcode = '22023';
  end if;

  select application.* into target
  from public.admission_applications as application
  where application.id = p_application_id
    and application.school_id = actor.school_id
    and application.status = 'PENDING'
  for update;

  if not found then
    raise exception 'This application is no longer pending.'
      using errcode = '42501';
  end if;

  update public.admission_applications
  set status = 'REJECTED',
      reviewed_by = actor.id,
      reviewed_at = now(),
      rejected_by = actor.id,
      rejected_at = now(),
      rejection_reason = reason
  where id = target.id;

  insert into public.admission_application_events (application_id, actor_id, event_type, details)
  values (target.id, actor.id, 'REJECTED', jsonb_build_object('reason', reason));
end;
$function$;

create or replace function public.get_rejected_admission_trash()
returns table (
  id uuid,
  application_reference text,
  student_name text,
  applying_class text,
  guardian_name text,
  guardian_phone text,
  submitted_at timestamptz,
  rejected_at timestamptz,
  rejected_by_name text,
  rejection_reason text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can view rejected admissions.'
      using errcode = '42501';
  end if;

  return query
  select application.id, application.application_reference, application.student_name,
    application.applying_class, application.guardian_name, application.guardian_phone,
    application.submitted_at, application.rejected_at,
    coalesce(profile.full_name, 'School Administrator'), application.rejection_reason
  from public.admission_applications as application
  left join public.profiles as profile on profile.id = application.rejected_by
  where application.school_id = actor.school_id
    and application.status = 'REJECTED'
  order by application.rejected_at desc nulls last, application.submitted_at desc;
end;
$function$;

create or replace function public.restore_rejected_admission_to_pending(
  p_application_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
  target public.admission_applications%rowtype;
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can restore rejected admissions.'
      using errcode = '42501';
  end if;

  select application.* into target
  from public.admission_applications as application
  where application.id = p_application_id
    and application.school_id = actor.school_id
    and application.status = 'REJECTED'
  for update;

  if not found then
    raise exception 'This rejected application is no longer available.'
      using errcode = '42501';
  end if;

  update public.admission_applications
  set status = 'PENDING',
      reviewed_by = null,
      reviewed_at = null
  where id = target.id;

  insert into public.admission_application_events (application_id, actor_id, event_type, details)
  values (
    target.id,
    actor.id,
    'RESTORED_TO_PENDING',
    jsonb_build_object(
      'previous_rejected_by', target.rejected_by,
      'previous_rejected_at', target.rejected_at,
      'previous_rejection_reason', target.rejection_reason
    )
  );
end;
$function$;

revoke all on function public.get_rejected_admission_trash() from public, anon;
revoke all on function public.restore_rejected_admission_to_pending(uuid) from public, anon;
grant execute on function public.get_rejected_admission_trash() to authenticated;
grant execute on function public.restore_rejected_admission_to_pending(uuid) to authenticated;

commit;
