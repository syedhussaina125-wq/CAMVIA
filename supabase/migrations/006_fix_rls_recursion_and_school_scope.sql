create or replace function public.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.organization_id
  from public.profiles p
  where p.id = auth.uid()
    and p.status = 'ACTIVE'
  limit 1;
$$;

create or replace function public.current_user_school_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.school_id
  from public.profiles p
  where p.id = auth.uid()
    and p.status = 'ACTIVE'
  limit 1;
$$;

drop policy if exists "organizations_authenticated_read_only" on public.organizations;
create policy "organizations_own_org_read"
on public.organizations
for select
using (id = public.current_user_organization_id());

drop policy if exists "schools_scope_read" on public.schools;
create policy "schools_own_school_read"
on public.schools
for select
using (
  id = public.current_user_school_id()
  and organization_id = public.current_user_organization_id()
);

drop policy if exists "campuses_scope_read" on public.campuses;
create policy "campuses_own_school_read"
on public.campuses
for select
using (
  school_id = public.current_user_school_id()
  and organization_id = public.current_user_organization_id()
);

drop policy if exists "profiles_self_and_school_scope_read" on public.profiles;
create policy "profiles_self_and_school_scope_read"
on public.profiles
for select
using (
  id = auth.uid()
  or (
    school_id = public.current_user_school_id()
    and organization_id = public.current_user_organization_id()
  )
);

drop policy if exists "profiles_self_update" on public.profiles;
drop policy if exists "profiles_admin_manage" on public.profiles;
create policy "profiles_admin_manage_same_school"
on public.profiles
for all
using (
  public.user_has_role('ADMIN')
  and school_id = public.current_user_school_id()
  and organization_id = public.current_user_organization_id()
)
with check (
  public.user_has_role('ADMIN')
  and school_id = public.current_user_school_id()
  and organization_id = public.current_user_organization_id()
);

drop policy if exists "user_roles_same_school_read" on public.user_roles;
create policy "user_roles_same_school_read"
on public.user_roles
for select
using (
  exists (
    select 1
    from public.profiles target
    where target.id = user_roles.user_id
      and target.school_id = public.current_user_school_id()
      and target.organization_id = public.current_user_organization_id()
  )
);

drop policy if exists "teacher_assignments_own_or_admin" on public.teacher_class_assignments;
create policy "teacher_assignments_own_or_school_admin_read"
on public.teacher_class_assignments
for select
using (
  user_id = auth.uid()
  or (
    school_id = public.current_user_school_id()
    and (
      public.user_has_role('ADMIN')
      or public.user_has_role('PRINCIPAL')
    )
  )
);

drop policy if exists "teacher_assignments_admin_write" on public.teacher_class_assignments;
create policy "teacher_assignments_admin_write"
on public.teacher_class_assignments
for insert
with check (
  school_id = public.current_user_school_id()
  and (
    public.user_has_role('ADMIN')
    or public.user_has_role('PRINCIPAL')
  )
);

drop policy if exists "teacher_assignments_admin_update" on public.teacher_class_assignments;
create policy "teacher_assignments_admin_update"
on public.teacher_class_assignments
for update
using (
  school_id = public.current_user_school_id()
  and (
    public.user_has_role('ADMIN')
    or public.user_has_role('PRINCIPAL')
  )
)
with check (
  school_id = public.current_user_school_id()
  and (
    public.user_has_role('ADMIN')
    or public.user_has_role('PRINCIPAL')
  )
);

drop policy if exists "students_school_scope_read" on public.students;
create policy "students_school_scope_read"
on public.students
for select
using (
  organization_id = public.current_user_organization_id()
  and school_id = public.current_user_school_id()
  and (
    public.user_has_role('ADMIN')
    or public.user_has_role('PRINCIPAL')
    or public.user_has_role('FINANCE')
    or exists (
      select 1
      from public.teacher_class_assignments tca
      where tca.user_id = auth.uid()
        and tca.active = true
        and tca.school_id = students.school_id
        and tca.campus_id = students.campus_id
        and tca.class_name = students.class_name
        and tca.section = students.section
    )
  )
);

drop policy if exists "students_admin_or_principal_manage" on public.students;
create policy "students_admin_or_principal_manage"
on public.students
for all
using (
  organization_id = public.current_user_organization_id()
  and school_id = public.current_user_school_id()
  and (
    public.user_has_role('ADMIN')
    or public.user_has_role('PRINCIPAL')
  )
)
with check (
  organization_id = public.current_user_organization_id()
  and school_id = public.current_user_school_id()
  and (
    public.user_has_role('ADMIN')
    or public.user_has_role('PRINCIPAL')
  )
);

drop policy if exists "students_finance_read_only" on public.students;

drop policy if exists "guardians_school_scope_read" on public.guardians;
create policy "guardians_school_scope_read"
on public.guardians
for select
using (
  organization_id = public.current_user_organization_id()
  and school_id = public.current_user_school_id()
  and (
    public.user_has_role('ADMIN')
    or public.user_has_role('PRINCIPAL')
    or public.user_has_role('FINANCE')
    or exists (
      select 1
      from public.student_guardians sg
      join public.students s on s.id = sg.student_id
      join public.teacher_class_assignments tca
        on tca.user_id = auth.uid()
        and tca.active = true
        and tca.school_id = s.school_id
        and tca.campus_id = s.campus_id
        and tca.class_name = s.class_name
        and tca.section = s.section
      where sg.guardian_id = guardians.id
        and s.organization_id = guardians.organization_id
        and s.school_id = guardians.school_id
        and s.campus_id = guardians.campus_id
    )
  )
);

drop policy if exists "guardians_admin_manage" on public.guardians;
create policy "guardians_admin_manage_same_school"
on public.guardians
for all
using (
  organization_id = public.current_user_organization_id()
  and school_id = public.current_user_school_id()
  and (
    public.user_has_role('ADMIN')
    or public.user_has_role('PRINCIPAL')
  )
)
with check (
  organization_id = public.current_user_organization_id()
  and school_id = public.current_user_school_id()
  and (
    public.user_has_role('ADMIN')
    or public.user_has_role('PRINCIPAL')
  )
);

drop policy if exists "student_guardians_school_scope_read" on public.student_guardians;
create policy "student_guardians_school_scope_read"
on public.student_guardians
for select
using (
  exists (
    select 1
    from public.students s
    where s.id = student_guardians.student_id
      and s.organization_id = public.current_user_organization_id()
      and s.school_id = public.current_user_school_id()
      and (
        public.user_has_role('ADMIN')
        or public.user_has_role('PRINCIPAL')
        or public.user_has_role('FINANCE')
        or exists (
          select 1
          from public.teacher_class_assignments tca
          where tca.user_id = auth.uid()
            and tca.active = true
            and tca.school_id = s.school_id
            and tca.campus_id = s.campus_id
            and tca.class_name = s.class_name
            and tca.section = s.section
        )
      )
  )
);

drop policy if exists "student_guardians_admin_manage" on public.student_guardians;
create policy "student_guardians_admin_manage_same_school"
on public.student_guardians
for all
using (
  public.user_has_role('ADMIN')
  and exists (
    select 1
    from public.students s
    where s.id = student_guardians.student_id
      and s.organization_id = public.current_user_organization_id()
      and s.school_id = public.current_user_school_id()
  )
)
with check (
  public.user_has_role('ADMIN')
  and exists (
    select 1
    from public.students s
    where s.id = student_guardians.student_id
      and s.organization_id = public.current_user_organization_id()
      and s.school_id = public.current_user_school_id()
  )
);
