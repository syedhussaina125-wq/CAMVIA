-- Controlled Phase 11 RLS test fixtures only.
-- Run manually in the Supabase SQL Editor after the six Auth users exist.
-- No passwords, Auth users, or privileged client credentials are created here.
--
-- This script intentionally fails if any required Auth account is missing or
-- already linked to a different organization/school, avoiding partial or
-- silently mis-scoped test setup.

begin;

create temporary table phase11_test_users on commit drop as
select
  u.id,
  u.email,
  case u.email
    when 'admin@test.edupulse.local' then 'Test Admin'
    when 'principal@test.edupulse.local' then 'Test Principal'
    when 'finance@test.edupulse.local' then 'Test Finance'
    when 'teachera@test.edupulse.local' then 'Test Teacher A'
    when 'teacherb@test.edupulse.local' then 'Test Teacher B'
    when 'inactive@test.edupulse.local' then 'Inactive Test Teacher'
  end as full_name,
  case u.email
    when 'admin@test.edupulse.local' then 'ADMIN'
    when 'principal@test.edupulse.local' then 'PRINCIPAL'
    when 'finance@test.edupulse.local' then 'FINANCE'
    else 'TEACHER'
  end as role,
  (u.email = 'inactive@test.edupulse.local') as is_inactive
from auth.users as u
where u.email = any (array[
  'admin@test.edupulse.local',
  'principal@test.edupulse.local',
  'finance@test.edupulse.local',
  'teachera@test.edupulse.local',
  'teacherb@test.edupulse.local',
  'inactive@test.edupulse.local'
]);

do $$
declare
  found_users integer;
  required_users constant integer := 6;
  conflicting_profiles integer;
  conflicting_fixture_ids integer;
begin
  select count(*) into found_users from phase11_test_users;
  if found_users <> required_users then
    raise exception 'Expected all 6 test Auth users; found %', found_users;
  end if;

  select count(*)
  into conflicting_profiles
  from public.profiles as p
  join phase11_test_users as test_user on test_user.id = p.id
  where (p.organization_id is not null
         and p.organization_id <> 'a1100000-0000-4000-8000-000000000001'::uuid)
     or (p.school_id is not null
         and p.school_id <> 'a1100000-0000-4000-8000-000000000011'::uuid)
     or (p.campus_id is not null
         and p.campus_id not in (
           'a1100000-0000-4000-8000-000000000021'::uuid,
           'a1100000-0000-4000-8000-000000000022'::uuid
         ))
     or (p.role <> 'TEACHER' and p.role <> test_user.role);

  if conflicting_profiles > 0 then
    raise exception 'One or more test profiles are linked to another tenant/scope or have a non-provisional role; inspect and resolve them before rerunning.';
  end if;

  select count(*) into conflicting_fixture_ids
  from public.organizations as org
  where org.id = 'a1100000-0000-4000-8000-000000000001'::uuid
    and org.name <> 'EduPulse Phase 11 Test Organization A';

  select conflicting_fixture_ids + count(*) into conflicting_fixture_ids
  from public.organizations as org
  where org.id = 'b1100000-0000-4000-8000-000000000001'::uuid
    and org.name <> 'EduPulse Phase 11 Test Organization B';

  select conflicting_fixture_ids + count(*) into conflicting_fixture_ids
  from public.schools as school
  where (school.id = 'a1100000-0000-4000-8000-000000000011'::uuid
         and school.name <> 'EduPulse Phase 11 Test School A')
     or (school.id = 'b1100000-0000-4000-8000-000000000011'::uuid
         and school.name <> 'EduPulse Phase 11 Test School B');

  if conflicting_fixture_ids > 0 then
    raise exception 'A fixed Phase 11 test fixture ID already belongs to unrelated data; no fixtures were changed.';
  end if;
end;
$$;

insert into public.organizations (id, name, status)
values
  ('a1100000-0000-4000-8000-000000000001', 'EduPulse Phase 11 Test Organization A', 'ACTIVE'),
  ('b1100000-0000-4000-8000-000000000001', 'EduPulse Phase 11 Test Organization B', 'ACTIVE')
on conflict (id) do update
set name = excluded.name, status = excluded.status;

insert into public.schools (
  id, organization_id, name, short_name, email, phone, address, country, timezone, academic_year, status
)
values
  ('a1100000-0000-4000-8000-000000000011', 'a1100000-0000-4000-8000-000000000001',
   'EduPulse Phase 11 Test School A', 'EPTEST-A', null, null, 'Test Campus Address A', 'Test', 'UTC', '2026-2027', 'ACTIVE'),
  ('b1100000-0000-4000-8000-000000000011', 'b1100000-0000-4000-8000-000000000001',
   'EduPulse Phase 11 Test School B', 'EPTEST-B', null, null, 'Test Campus Address B', 'Test', 'UTC', '2026-2027', 'ACTIVE')
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    short_name = excluded.short_name,
    status = excluded.status;

insert into public.campuses (id, organization_id, school_id, name, code, address, status)
values
  ('a1100000-0000-4000-8000-000000000021', 'a1100000-0000-4000-8000-000000000001',
   'a1100000-0000-4000-8000-000000000011', 'Test Campus A1', 'TEST-A1', 'Test Campus A1', 'ACTIVE'),
  ('a1100000-0000-4000-8000-000000000022', 'a1100000-0000-4000-8000-000000000001',
   'a1100000-0000-4000-8000-000000000011', 'Test Campus A2', 'TEST-A2', 'Test Campus A2', 'ACTIVE'),
  ('b1100000-0000-4000-8000-000000000021', 'b1100000-0000-4000-8000-000000000001',
   'b1100000-0000-4000-8000-000000000011', 'Test Campus B1', 'TEST-B1', 'Test Campus B1', 'ACTIVE')
on conflict (id) do update
set organization_id = excluded.organization_id,
    school_id = excluded.school_id,
    name = excluded.name,
    code = excluded.code,
    address = excluded.address,
    status = excluded.status;

insert into public.roles (name, description)
values
  ('ADMIN', 'School owner and system administrator'),
  ('PRINCIPAL', 'Academic lead for the school'),
  ('FINANCE', 'Finance and collections access'),
  ('TEACHER', 'Classroom teacher access')
on conflict (name) do update
set description = excluded.description;

do $$
begin
  if not exists (
    select 1 from public.schools
    where id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'Required School A fixture is missing or linked to the wrong organization.';
  end if;

  if not exists (
    select 1 from public.schools
    where id = 'b1100000-0000-4000-8000-000000000011'::uuid
      and organization_id = 'b1100000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'Required School B fixture is missing or linked to the wrong organization.';
  end if;

  if not exists (
    select 1 from public.campuses
    where id = 'a1100000-0000-4000-8000-000000000021'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
  ) or not exists (
    select 1 from public.campuses
    where id = 'a1100000-0000-4000-8000-000000000022'::uuid
      and school_id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
  ) or not exists (
    select 1 from public.campuses
    where id = 'b1100000-0000-4000-8000-000000000021'::uuid
      and school_id = 'b1100000-0000-4000-8000-000000000011'::uuid
      and organization_id = 'b1100000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'One or more test campuses are missing or do not match their school and organization.';
  end if;
end;
$$;

-- The Auth trigger may have created provisional TEACHER profiles. Update only
-- these explicitly named controlled test identities to their intended scope.
insert into public.profiles (
  id, organization_id, school_id, campus_id, full_name, email, status, role
)
select
  test_user.id,
  'a1100000-0000-4000-8000-000000000001'::uuid,
  'a1100000-0000-4000-8000-000000000011'::uuid,
  case
    when test_user.email = 'teacherb@test.edupulse.local'
      then 'a1100000-0000-4000-8000-000000000022'::uuid
    else 'a1100000-0000-4000-8000-000000000021'::uuid
  end,
  test_user.full_name,
  test_user.email,
  case when test_user.is_inactive then 'INACTIVE' else 'ACTIVE' end,
  test_user.role
from phase11_test_users as test_user
on conflict (id) do update
set organization_id = excluded.organization_id,
    school_id = excluded.school_id,
    campus_id = excluded.campus_id,
    full_name = excluded.full_name,
    email = excluded.email,
    status = excluded.status,
    role = excluded.role;

delete from public.user_roles as user_role
using phase11_test_users as test_user
where user_role.user_id = test_user.id;

insert into public.user_roles (user_id, role)
select test_user.id, test_user.role
from phase11_test_users as test_user
on conflict (user_id, role) do nothing;

insert into public.teacher_class_assignments (
  id, user_id, school_id, campus_id, class_name, section, active
)
select
  'a1100000-0000-4000-8000-000000000031'::uuid,
  test_user.id,
  'a1100000-0000-4000-8000-000000000011'::uuid,
  'a1100000-0000-4000-8000-000000000021'::uuid,
  'Grade 8', 'A', true
from phase11_test_users as test_user
where test_user.email = 'teachera@test.edupulse.local'
on conflict (user_id, school_id, campus_id, class_name, section) do update
set active = excluded.active;

insert into public.teacher_class_assignments (
  id, user_id, school_id, campus_id, class_name, section, active
)
select
  'a1100000-0000-4000-8000-000000000032'::uuid,
  test_user.id,
  'a1100000-0000-4000-8000-000000000011'::uuid,
  'a1100000-0000-4000-8000-000000000022'::uuid,
  'Grade 9', 'B', true
from phase11_test_users as test_user
where test_user.email = 'teacherb@test.edupulse.local'
on conflict (user_id, school_id, campus_id, class_name, section) do update
set active = excluded.active;

insert into public.students (
  id, organization_id, school_id, campus_id, student_code, first_name, last_name,
  class_name, section, roll_number, date_of_birth, gender, status
)
values
  ('a1100000-0000-4000-8000-000000000101', 'a1100000-0000-4000-8000-000000000001',
   'a1100000-0000-4000-8000-000000000011', 'a1100000-0000-4000-8000-000000000021',
   'EP11-A8-001', 'Amina', 'Test', 'Grade 8', 'A', '01', '2013-03-12', 'Female', 'ACTIVE'),
  ('a1100000-0000-4000-8000-000000000102', 'a1100000-0000-4000-8000-000000000001',
   'a1100000-0000-4000-8000-000000000011', 'a1100000-0000-4000-8000-000000000021',
   'EP11-A8-002', 'Bilal', 'Test', 'Grade 8', 'A', '02', '2013-08-04', 'Male', 'ACTIVE'),
  ('a1100000-0000-4000-8000-000000000103', 'a1100000-0000-4000-8000-000000000001',
   'a1100000-0000-4000-8000-000000000011', 'a1100000-0000-4000-8000-000000000022',
   'EP11-A9-001', 'Hana', 'Test', 'Grade 9', 'B', '01', '2012-11-21', 'Female', 'ACTIVE'),
  ('a1100000-0000-4000-8000-000000000104', 'a1100000-0000-4000-8000-000000000001',
   'a1100000-0000-4000-8000-000000000011', 'a1100000-0000-4000-8000-000000000022',
   'EP11-A8-003', 'Outside', 'Campus', 'Grade 8', 'A', '03', '2013-05-18', 'Prefer not to say', 'ACTIVE'),
  ('b1100000-0000-4000-8000-000000000101', 'b1100000-0000-4000-8000-000000000001',
   'b1100000-0000-4000-8000-000000000011', 'b1100000-0000-4000-8000-000000000021',
   'EP11-B8-001', 'School', 'BTest', 'Grade 8', 'A', '01', '2013-09-09', 'Female', 'ACTIVE')
on conflict (id) do update
set organization_id = excluded.organization_id,
    school_id = excluded.school_id,
    campus_id = excluded.campus_id,
    student_code = excluded.student_code,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    class_name = excluded.class_name,
    section = excluded.section,
    roll_number = excluded.roll_number,
    date_of_birth = excluded.date_of_birth,
    gender = excluded.gender,
    status = excluded.status;

insert into public.guardians (
  id, organization_id, school_id, campus_id, first_name, last_name,
  relationship, phone, email, address
)
values
  ('a1100000-0000-4000-8000-000000000201', 'a1100000-0000-4000-8000-000000000001',
   'a1100000-0000-4000-8000-000000000011', 'a1100000-0000-4000-8000-000000000021',
   'Guardian', 'Amina', 'Parent', '+1-555-0101', 'guardian.amina@example.invalid', 'Test Address A1'),
  ('a1100000-0000-4000-8000-000000000202', 'a1100000-0000-4000-8000-000000000001',
   'a1100000-0000-4000-8000-000000000011', 'a1100000-0000-4000-8000-000000000021',
   'Guardian', 'Bilal', 'Parent', '+1-555-0102', 'guardian.bilal@example.invalid', 'Test Address A1'),
  ('a1100000-0000-4000-8000-000000000203', 'a1100000-0000-4000-8000-000000000001',
   'a1100000-0000-4000-8000-000000000011', 'a1100000-0000-4000-8000-000000000022',
   'Guardian', 'Hana', 'Parent', '+1-555-0103', 'guardian.hana@example.invalid', 'Test Address A2'),
  ('b1100000-0000-4000-8000-000000000201', 'b1100000-0000-4000-8000-000000000001',
   'b1100000-0000-4000-8000-000000000011', 'b1100000-0000-4000-8000-000000000021',
   'Guardian', 'School B', 'Parent', '+1-555-0201', 'guardian.schoolb@example.invalid', 'Test Address B1')
on conflict (id) do update
set organization_id = excluded.organization_id,
    school_id = excluded.school_id,
    campus_id = excluded.campus_id,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    relationship = excluded.relationship,
    phone = excluded.phone,
    email = excluded.email,
    address = excluded.address;

insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
values
  ('a1100000-0000-4000-8000-000000000101', 'a1100000-0000-4000-8000-000000000201', 'Parent', true),
  ('a1100000-0000-4000-8000-000000000102', 'a1100000-0000-4000-8000-000000000202', 'Parent', true),
  ('a1100000-0000-4000-8000-000000000103', 'a1100000-0000-4000-8000-000000000203', 'Parent', true),
  ('b1100000-0000-4000-8000-000000000101', 'b1100000-0000-4000-8000-000000000201', 'Parent', true)
on conflict (student_id, guardian_id) do update
set relationship = excluded.relationship,
    is_primary = excluded.is_primary;

commit;
