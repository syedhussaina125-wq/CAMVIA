-- Replace all student policies so no permissive legacy ALL/SELECT policy can
-- grant rows outside the caller's organization and school.

do $$
declare
  active_policy record;
begin
  for active_policy in
    select policy.schemaname, policy.tablename, policy.policyname
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'students'
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

create or replace function public.can_access_student(target_student_id uuid)
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
    join public.students as student
      on student.id = target_student_id
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.organization_id = student.organization_id
      and requester.school_id = student.school_id
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
          from public.teacher_class_assignments as assignment
          where assignment.user_id = requester.id
            and assignment.active = true
            and assignment.school_id = student.school_id
            and assignment.campus_id = student.campus_id
            and assignment.class_name = student.class_name
            and assignment.section = student.section
        )
      )
  );
$function$;

create or replace function public.can_manage_student_scope(
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

revoke all on function public.can_access_student(uuid) from public, anon;
revoke all on function public.can_manage_student_scope(uuid, uuid) from public, anon;
grant execute on function public.can_access_student(uuid) to authenticated;
grant execute on function public.can_manage_student_scope(uuid, uuid) to authenticated;

create policy students_read_accessible_scope
on public.students
for select
to authenticated
using (public.can_access_student(id));

create policy students_insert_same_school_admin
on public.students
for insert
to authenticated
with check (
  public.can_manage_student_scope(organization_id, school_id)
);

create policy students_update_same_school_admin
on public.students
for update
to authenticated
using (
  public.can_manage_student_scope(organization_id, school_id)
)
with check (
  public.can_manage_student_scope(organization_id, school_id)
);
