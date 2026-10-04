begin;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('guardians', 'student_guardians')
  loop
    execute format(
      'drop policy %I on %I.%I',
      existing_policy.policyname,
      existing_policy.schemaname,
      existing_policy.tablename
    );
  end loop;
end;
$$;

create policy guardians_read_accessible_scope
on public.guardians
for select
to authenticated
using (public.can_access_guardian(id));

create policy guardians_insert_same_school_admin
on public.guardians
for insert
to authenticated
with check (public.can_manage_guardian_scope(organization_id, school_id));

create policy guardians_update_same_school_admin
on public.guardians
for update
to authenticated
using (public.can_manage_guardian_scope(organization_id, school_id))
with check (public.can_manage_guardian_scope(organization_id, school_id));

create policy guardians_delete_same_school_admin
on public.guardians
for delete
to authenticated
using (public.can_manage_guardian_scope(organization_id, school_id));

create policy student_guardians_read_accessible
on public.student_guardians
for select
to authenticated
using (public.can_access_student(student_id));

create policy student_guardians_write_school_admin
on public.student_guardians
for all
to authenticated
using (
  public.user_has_role('ADMIN'::text)
  and public.can_access_student(student_id)
)
with check (
  public.user_has_role('ADMIN'::text)
  and public.can_access_student(student_id)
);

commit;
