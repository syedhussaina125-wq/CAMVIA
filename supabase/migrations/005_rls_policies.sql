create or replace function public.user_has_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'ACTIVE'
      and (
        p.role = required_role
        or exists (
          select 1
          from public.user_roles ur
          where ur.user_id = p.id and ur.role = required_role
        )
      )
  );
$$;

create or replace function public.same_org_school_for_user(target_organization_id uuid, target_school_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'ACTIVE'
      and p.organization_id = target_organization_id
      and p.school_id = target_school_id
  );
$$;

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

create policy "organizations_authenticated_read_only"
on public.organizations
for select
using (auth.uid() is not null and public.user_has_role('ADMIN'));

create policy "schools_scope_read"
on public.schools
for select
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'ACTIVE'
      and p.organization_id = schools.organization_id
  )
);

create policy "campuses_scope_read"
on public.campuses
for select
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'ACTIVE'
      and p.organization_id = campuses.organization_id
      and (
        p.school_id = campuses.school_id or p.role in ('ADMIN','PRINCIPAL')
      )
  )
);

create policy "roles_public_read"
on public.roles
for select
using (auth.uid() is not null);

create policy "profiles_self_and_school_scope_read"
on public.profiles
for select
using (
  id = auth.uid()
  or (
    exists (
      select 1
      from public.profiles requester
      where requester.id = auth.uid()
        and requester.status = 'ACTIVE'
        and requester.organization_id = profiles.organization_id
    )
  )
);

create policy "profiles_self_update"
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "profiles_admin_manage"
on public.profiles
for all
using (public.user_has_role('ADMIN'))
with check (public.user_has_role('ADMIN'));

create policy "user_roles_same_school_read"
on public.user_roles
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'ACTIVE'
      and p.organization_id = (
        select profiles.organization_id from public.profiles where profiles.id = user_roles.user_id
      )
  )
);

create policy "teacher_assignments_own_or_admin"
on public.teacher_class_assignments
for select
using (
  user_id = auth.uid()
  or public.user_has_role('ADMIN')
  or public.user_has_role('PRINCIPAL')
);

create policy "teacher_assignments_admin_write"
on public.teacher_class_assignments
for insert
with check (public.user_has_role('ADMIN') or public.user_has_role('PRINCIPAL'));

create policy "teacher_assignments_admin_update"
on public.teacher_class_assignments
for update
using (public.user_has_role('ADMIN') or public.user_has_role('PRINCIPAL'))
with check (public.user_has_role('ADMIN') or public.user_has_role('PRINCIPAL'));

create policy "students_school_scope_read"
on public.students
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'ACTIVE'
      and p.organization_id = students.organization_id
      and (
        p.role in ('ADMIN', 'PRINCIPAL', 'FINANCE')
        or p.school_id = students.school_id
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
  )
);

create policy "students_admin_or_principal_manage"
on public.students
for all
using (public.user_has_role('ADMIN') or public.user_has_role('PRINCIPAL'))
with check (public.user_has_role('ADMIN') or public.user_has_role('PRINCIPAL'));

create policy "students_finance_read_only"
on public.students
for select
using (
  public.user_has_role('FINANCE')
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'ACTIVE'
      and p.organization_id = students.organization_id
      and p.school_id = students.school_id
  )
);

create policy "guardians_school_scope_read"
on public.guardians
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'ACTIVE'
      and p.organization_id = guardians.organization_id
      and (
        p.role in ('ADMIN', 'PRINCIPAL', 'FINANCE')
        or p.school_id = guardians.school_id
        or exists (
          select 1
          from public.student_guardians sg
          join public.students s on s.id = sg.student_id
          join public.teacher_class_assignments tca on tca.user_id = auth.uid()
          where sg.guardian_id = guardians.id
            and s.school_id = guardians.school_id
            and s.campus_id = guardians.campus_id
            and tca.active = true
            and tca.school_id = s.school_id
            and tca.class_name = s.class_name
            and tca.section = s.section
        )
      )
  )
);

create policy "guardians_admin_manage"
on public.guardians
for all
using (public.user_has_role('ADMIN') or public.user_has_role('PRINCIPAL'))
with check (public.user_has_role('ADMIN') or public.user_has_role('PRINCIPAL'));

create policy "student_guardians_school_scope_read"
on public.student_guardians
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'ACTIVE'
      and exists (
        select 1
        from public.students s
        where s.id = student_guardians.student_id
          and s.organization_id = p.organization_id
          and (
            p.role in ('ADMIN', 'PRINCIPAL', 'FINANCE')
            or p.school_id = s.school_id
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
  )
);

create policy "student_guardians_admin_manage"
on public.student_guardians
for all
using (public.user_has_role('ADMIN') or public.user_has_role('PRINCIPAL'))
with check (public.user_has_role('ADMIN') or public.user_has_role('PRINCIPAL'));
