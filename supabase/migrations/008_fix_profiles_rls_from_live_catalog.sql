do $$
declare
  active_policy record;
begin
  for active_policy in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and cmd in ('SELECT', 'ALL')
  loop
    execute format(
      'drop policy %I on %I.%I',
      active_policy.policyname,
      active_policy.schemaname,
      active_policy.tablename
    );
  end loop;
end;
$$;

create or replace function public.same_org_school_for_user(
  target_organization_id uuid,
  target_school_id uuid
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
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.organization_id = target_organization_id
      and requester.school_id = target_school_id
  );
$function$;

create or replace function public.user_has_role(required_role text)
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
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and (
        requester.role = required_role
        or exists (
          select 1
          from public.user_roles as assigned_role
          where assigned_role.user_id = requester.id
            and assigned_role.role = required_role
        )
      )
  );
$function$;

create or replace function public.can_read_profile(target_profile_id uuid)
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
    join public.profiles as target
      on target.id = target_profile_id
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and target.organization_id = requester.organization_id
      and target.school_id = requester.school_id
      and (
        requester.role in ('ADMIN', 'PRINCIPAL')
        or exists (
          select 1
          from public.user_roles as assigned_role
          where assigned_role.user_id = requester.id
            and assigned_role.role in ('ADMIN', 'PRINCIPAL')
        )
      )
  );
$function$;

revoke all on function public.same_org_school_for_user(uuid, uuid) from public, anon;
revoke all on function public.user_has_role(text) from public, anon;
revoke all on function public.can_read_profile(uuid) from public, anon;

grant execute on function public.same_org_school_for_user(uuid, uuid) to authenticated;
grant execute on function public.user_has_role(text) to authenticated;
grant execute on function public.can_read_profile(uuid) to authenticated;

create policy profiles_read_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy profiles_read_same_school_admin_principal
on public.profiles
for select
to authenticated
using (public.can_read_profile(id));
