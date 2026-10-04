-- Migration sequence number only; this remains Phase 11 RLS hardening.
-- Replace guardian policies so no role-only permissive policy can expose a
-- guardian row from another organization or school.

do $$
declare
  active_policy record;
begin
  for active_policy in
    select policy.schemaname, policy.tablename, policy.policyname
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'guardians'
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

create or replace function public.can_access_guardian(target_guardian_id uuid)
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
    join public.guardians as guardian
      on guardian.id = target_guardian_id
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.organization_id = guardian.organization_id
      and requester.school_id = guardian.school_id
      and (
        requester.role in ('ADMIN', 'PRINCIPAL', 'FINANCE')
        or exists (
          select 1
          from public.user_roles as assigned_role
          where assigned_role.user_id = requester.id
            and assigned_role.role in ('ADMIN', 'PRINCIPAL', 'FINANCE')
        )
        or exists (
          select 1
          from public.student_guardians as relation
          join public.students as student
            on student.id = relation.student_id
          join public.teacher_class_assignments as assignment
            on assignment.user_id = requester.id
            and assignment.active = true
            and assignment.school_id = student.school_id
            and assignment.campus_id = student.campus_id
            and assignment.class_name = student.class_name
            and assignment.section = student.section
          where relation.guardian_id = guardian.id
            and student.organization_id = guardian.organization_id
            and student.school_id = guardian.school_id
            and student.campus_id = guardian.campus_id
        )
      )
  );
$function$;

create or replace function public.can_manage_guardian_scope(
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

revoke all on function public.can_access_guardian(uuid) from public, anon;
revoke all on function public.can_manage_guardian_scope(uuid, uuid) from public, anon;
grant execute on function public.can_access_guardian(uuid) to authenticated;
grant execute on function public.can_manage_guardian_scope(uuid, uuid) to authenticated;

create policy guardians_read_accessible_scope
on public.guardians
for select
to authenticated
using (public.can_access_guardian(id));

create policy guardians_insert_same_school_admin
on public.guardians
for insert
to authenticated
with check (
  public.can_manage_guardian_scope(organization_id, school_id)
);

create policy guardians_delete_same_school_admin
on public.guardians
for delete
to authenticated
using (
  public.can_manage_guardian_scope(organization_id, school_id)
);

create policy guardians_update_same_school_admin
on public.guardians
for update
to authenticated
using (
  public.can_manage_guardian_scope(organization_id, school_id)
)
with check (
  public.can_manage_guardian_scope(organization_id, school_id)
);
