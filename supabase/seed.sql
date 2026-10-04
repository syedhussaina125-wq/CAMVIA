-- Demo seed for local Supabase development only.
-- This seed is intentionally minimal and does not expose any service role secrets.

insert into public.organizations (id, name, status)
values ('11111111-1111-4111-8111-111111111111', 'Beaconhouse School Group', 'ACTIVE')
on conflict (id) do nothing;

insert into public.schools (id, organization_id, name, short_name, email, phone, address, country, timezone, academic_year, status)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Beaconhouse School',
  'Beaconhouse',
  'admin@beaconhouse.edu',
  '+92 21 111 111 111',
  'Karachi, Pakistan',
  'Pakistan',
  'PKT (UTC+5)',
  '2026-2027',
  'ACTIVE'
)
on conflict (id) do nothing;

insert into public.campuses (id, organization_id, school_id, name, code, address, status)
values (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'Main Campus',
  'MAIN',
  'Karachi',
  'ACTIVE'
)
on conflict (id) do nothing;

insert into public.roles (name, description)
values
  ('ADMIN', 'School owner and system administrator'),
  ('PRINCIPAL', 'Academic lead for the school'),
  ('FINANCE', 'Finance and collections access'),
  ('TEACHER', 'Classroom teacher access')
on conflict (name) do nothing;

-- The actual user rows are inserted by the auth.users trigger when Supabase Auth creates accounts.
-- Use admin-created accounts only, no public signup.
