do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'organizations',
        'schools',
        'campuses',
        'roles',
        'profiles',
        'user_roles',
        'teacher_class_assignments',
        'students',
        'guardians',
        'student_guardians'
      ])
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

drop function if exists public.same_org_school_for_user(uuid, uuid);
drop function if exists public.current_user_organization_id();
drop function if exists public.current_user_school_id();
drop function if exists public.user_has_role(text);
drop function if exists public.current_user_role();
drop function if exists public.current_user_campus_id();
drop function if exists public.current_user_has_role(text);
drop function if exists public.can_view_profile(uuid);
drop function if exists public.can_access_student(uuid);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select p.role
  from public.profiles as p
  where p.id = auth.uid()
    and p.status = 'ACTIVE'
  limit 1;
$$;

create or replace function public.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select p.organization_id
  from public.profiles as p
  where p.id = auth.uid()
    and p.status = 'ACTIVE'
  limit 1;
$$;

create or replace function public.current_user_school_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select p.school_id
  from public.profiles as p
  where p.id = auth.uid()
    and p.status = 'ACTIVE'
  limit 1;
$$;

create or replace function public.current_user_campus_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select p.campus_id
  from public.profiles as p
  where p.id = auth.uid()
    and p.status = 'ACTIVE'
  limit 1;
$$;

create or replace function public.current_user_has_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = auth.uid()
      and p.status = 'ACTIVE'
      and (
        p.role = required_role
        or exists (
          select 1
          from public.user_roles as ur
          where ur.user_id = p.id
            and ur.role = required_role
        )
      )
  );
$$;

create or replace function public.can_view_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles as requester
    join public.profiles as target
      on target.id = target_user_id
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and target.organization_id = requester.organization_id
      and target.school_id = requester.school_id
      and (
        requester.role in ('ADMIN', 'PRINCIPAL')
        or exists (
          select 1
          from public.user_roles as ur
          where ur.user_id = requester.id
            and ur.role in ('ADMIN', 'PRINCIPAL')
        )
      )
  );
$$;

create or replace function public.can_access_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles as requester
    join public.students as student
      on student.id = target_student_id
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and student.organization_id = requester.organization_id
      and student.school_id = requester.school_id
      and (
        requester.role in ('ADMIN', 'PRINCIPAL', 'FINANCE')
        or exists (
          select 1
          from public.user_roles as ur
          where ur.user_id = requester.id
            and ur.role in ('ADMIN', 'PRINCIPAL', 'FINANCE')
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
$$;

revoke all on function public.current_user_role() from public, anon;
revoke all on function public.current_user_organization_id() from public, anon;
revoke all on function public.current_user_school_id() from public, anon;
revoke all on function public.current_user_campus_id() from public, anon;
revoke all on function public.current_user_has_role(text) from public, anon;
revoke all on function public.can_view_profile(uuid) from public, anon;
revoke all on function public.can_access_student(uuid) from public, anon;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_organization_id() to authenticated;
grant execute on function public.current_user_school_id() to authenticated;
grant execute on function public.current_user_campus_id() to authenticated;
grant execute on function public.current_user_has_role(text) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.can_access_student(uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.schools enable row level security;
alter table public.campuses enable row level security;
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.teacher_class_assignments enable row level security;
alter table public.students enable row level security;
alter table public.guardians enable row level security;
alter table public.student_guardians enable row level security;

create policy organizations_read_own
on public.organizations
for select
to authenticated
using (id = public.current_user_organization_id());

create policy schools_read_own
on public.schools
for select
to authenticated
using (
  id = public.current_user_school_id()
  and organization_id = public.current_user_organization_id()
);

create policy campuses_read_own_school
on public.campuses
for select
to authenticated
using (
  school_id = public.current_user_school_id()
  and organization_id = public.current_user_organization_id()
);

create policy roles_read_authenticated
on public.roles
for select
to authenticated
using (true);

create policy profiles_read_self_or_school_admin
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.can_view_profile(id)
);

create policy user_roles_read_self_or_school_admin
on public.user_roles
for select
to authenticated
using (
  user_id = auth.uid()
  or public.can_view_profile(user_id)
);

create policy teacher_assignments_read_own_or_school_admin
on public.teacher_class_assignments
for select
to authenticated
using (
  user_id = auth.uid()
  or (
    school_id = public.current_user_school_id()
    and (
      public.current_user_has_role('ADMIN')
      or public.current_user_has_role('PRINCIPAL')
    )
  )
);

create policy teacher_assignments_write_school_admin
on public.teacher_class_assignments
for insert
to authenticated
with check (
  school_id = public.current_user_school_id()
  and (
    public.current_user_has_role('ADMIN')
    or public.current_user_has_role('PRINCIPAL')
  )
);

create policy teacher_assignments_update_school_admin
on public.teacher_class_assignments
for update
to authenticated
using (
  school_id = public.current_user_school_id()
  and (
    public.current_user_has_role('ADMIN')
    or public.current_user_has_role('PRINCIPAL')
  )
)
with check (
  school_id = public.current_user_school_id()
  and (
    public.current_user_has_role('ADMIN')
    or public.current_user_has_role('PRINCIPAL')
  )
);

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

create policy guardians_read_accessible_scope
on public.guardians
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and school_id = public.current_user_school_id()
  and (
    public.current_user_has_role('ADMIN')
    or public.current_user_has_role('PRINCIPAL')
    or public.current_user_has_role('FINANCE')
    or exists (
      select 1
      from public.student_guardians as relation
      where relation.guardian_id = guardians.id
        and public.can_access_student(relation.student_id)
    )
  )
);

create policy guardians_write_school_admin
on public.guardians
for all
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
  public.current_user_has_role('ADMIN')
  and public.can_access_student(student_id)
)
with check (
  public.current_user_has_role('ADMIN')
  and public.can_access_student(student_id)
);
