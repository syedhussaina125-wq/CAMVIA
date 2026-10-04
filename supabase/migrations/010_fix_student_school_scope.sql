do $$
declare
  active_policy record;
begin
  for active_policy in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'students'
      and cmd in ('SELECT', 'ALL', 'INSERT', 'UPDATE')
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

create policy students_read_accessible_scope
on public.students
for select
to authenticated
using (public.can_access_student(id));

create policy students_insert_school_admin
on public.students
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and school_id = public.current_user_school_id()
  and (
    public.current_user_has_role('ADMIN')
    or public.current_user_has_role('PRINCIPAL')
  )
);

create policy students_update_school_admin
on public.students
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and school_id = public.current_user_school_id()
  and (
    public.current_user_has_role('ADMIN')
    or public.current_user_has_role('PRINCIPAL')
  )
)
with check (
  organization_id = public.current_user_organization_id()
  and school_id = public.current_user_school_id()
  and (
    public.current_user_has_role('ADMIN')
    or public.current_user_has_role('PRINCIPAL')
  )
);
