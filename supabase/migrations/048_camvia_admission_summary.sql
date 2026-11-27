begin;

create or replace function public.get_camvia_admission_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor_school_id uuid;
  summary jsonb;
begin
  select profile.school_id
  into actor_school_id
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'An active school administrator is required to view admission summaries.'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'pending', count(*) filter (where application.status = 'PENDING'),
    'approved', count(*) filter (where application.status = 'APPROVED'),
    'rejected', count(*) filter (where application.status = 'REJECTED')
  )
  into summary
  from public.admission_applications as application
  where application.school_id = actor_school_id;

  return coalesce(summary, jsonb_build_object(
    'total', 0,
    'pending', 0,
    'approved', 0,
    'rejected', 0
  ));
end;
$function$;

revoke all on function public.get_camvia_admission_summary() from public, anon, authenticated;
grant execute on function public.get_camvia_admission_summary() to authenticated;

commit;
