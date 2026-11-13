begin;

create sequence if not exists public.admission_application_reference_seq;

create table if not exists public.school_registration_links (
  school_id uuid primary key references public.schools(id) on delete cascade,
  registration_token text not null unique default
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admission_applications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  application_reference text not null unique,
  submission_key uuid not null unique,
  source text not null default 'PARENT_REGISTRATION'
    check (source = 'PARENT_REGISTRATION'),
  student_name text not null,
  date_of_birth date not null,
  gender text,
  applying_class text not null,
  preferred_section text,
  guardian_name text not null,
  guardian_relationship text not null,
  guardian_phone text not null,
  whatsapp_phone text,
  guardian_email text,
  guardian_address text,
  secondary_guardian_name text,
  secondary_guardian_relationship text,
  secondary_guardian_phone text,
  secondary_guardian_email text,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_student_id uuid references public.students(id) on delete set null
);

create table if not exists public.admission_application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.admission_applications(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('SUBMITTED', 'EDITED', 'APPROVED', 'REJECTED')),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists admission_applications_school_status_date_idx
  on public.admission_applications (school_id, status, submitted_at desc);
create index if not exists admission_applications_school_phone_date_idx
  on public.admission_applications (school_id, guardian_phone, submitted_at desc);
create index if not exists admission_application_events_application_time_idx
  on public.admission_application_events (application_id, occurred_at);

alter table public.school_registration_links enable row level security;
alter table public.admission_applications enable row level security;
alter table public.admission_application_events enable row level security;

revoke all on public.school_registration_links from public, anon, authenticated;
revoke all on public.admission_applications from public, anon, authenticated;
revoke all on public.admission_application_events from public, anon, authenticated;
revoke all on sequence public.admission_application_reference_seq from public, anon, authenticated;

create or replace function public.get_school_registration_link()
returns table (registration_token text, enabled boolean, school_name text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can manage registration links.'
      using errcode = '42501';
  end if;

  return query
  select link.registration_token, link.enabled, school.name
  from public.school_registration_links as link
  join public.schools as school on school.id = link.school_id
  where link.school_id = actor.school_id;
end;
$function$;

create or replace function public.create_school_registration_link()
returns table (registration_token text, enabled boolean, school_name text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can create a registration link.'
      using errcode = '42501';
  end if;

  insert into public.school_registration_links (school_id, enabled)
  values (actor.school_id, true)
  on conflict (school_id) do nothing;

  return query
  select link.registration_token, link.enabled, school.name
  from public.school_registration_links as link
  join public.schools as school on school.id = link.school_id
  where link.school_id = actor.school_id;
end;
$function$;

create or replace function public.set_school_registration_enabled(p_enabled boolean)
returns table (registration_token text, enabled boolean, school_name text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can manage registration links.'
      using errcode = '42501';
  end if;

  update public.school_registration_links as link
  set enabled = p_enabled, updated_at = now()
  where link.school_id = actor.school_id;

  return query
  select link.registration_token, link.enabled, school.name
  from public.school_registration_links as link
  join public.schools as school on school.id = link.school_id
  where link.school_id = actor.school_id;
end;
$function$;

drop function if exists public.lookup_public_registration(text);

create function public.lookup_public_registration(p_registration_token text)
returns table (school_name text, registration_enabled boolean)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
  select case when link.enabled then school.name else null end, link.enabled
  from public.school_registration_links as link
  join public.schools as school on school.id = link.school_id
  join public.organizations as organization on organization.id = school.organization_id
  where link.registration_token = p_registration_token
    and school.status = 'ACTIVE'
    and organization.status = 'ACTIVE';
$function$;

create or replace function public.submit_public_registration(
  p_registration_token text,
  p_submission_key uuid,
  p_student_name text,
  p_date_of_birth date,
  p_gender text,
  p_applying_class text,
  p_preferred_section text,
  p_guardian_name text,
  p_guardian_relationship text,
  p_guardian_phone text,
  p_whatsapp_phone text,
  p_guardian_email text,
  p_guardian_address text,
  p_secondary_guardian_name text,
  p_secondary_guardian_relationship text,
  p_secondary_guardian_phone text,
  p_secondary_guardian_email text,
  p_honeypot text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  target_school_id uuid;
  existing_reference text;
  created_application_id uuid;
  application_ref text;
  student_name_value text := nullif(btrim(p_student_name), '');
  guardian_name_value text := nullif(btrim(p_guardian_name), '');
  phone_digits text := regexp_replace(coalesce(p_guardian_phone, ''), '[^0-9]', '', 'g');
  whatsapp_digits text := regexp_replace(coalesce(p_whatsapp_phone, ''), '[^0-9]', '', 'g');
  secondary_phone_digits text := regexp_replace(coalesce(p_secondary_guardian_phone, ''), '[^0-9]', '', 'g');
  normalized_phone text;
  normalized_whatsapp text;
  normalized_secondary_phone text;
  secondary_name_value text := nullif(btrim(p_secondary_guardian_name), '');
  secondary_relationship_value text := nullif(btrim(p_secondary_guardian_relationship), '');
begin
  select link.school_id into target_school_id
  from public.school_registration_links as link
  join public.schools as school on school.id = link.school_id
  join public.organizations as organization on organization.id = school.organization_id
  where link.registration_token = p_registration_token
    and link.enabled
    and school.status = 'ACTIVE'
    and organization.status = 'ACTIVE';

  if target_school_id is null then
    raise exception 'This registration link is invalid or no longer active.'
      using errcode = '22023';
  end if;

  if p_submission_key is null then
    raise exception 'A valid submission key is required.'
      using errcode = '22023';
  end if;

  normalized_phone := case
    when left(phone_digits, 2) = '00' then nullif(substr(phone_digits, 3), '')
    when left(phone_digits, 1) = '0' then nullif('92' || substr(phone_digits, 2), '')
    when length(phone_digits) = 10 and left(phone_digits, 1) = '3' then '92' || phone_digits
    else nullif(phone_digits, '')
  end;
  normalized_whatsapp := case
    when left(whatsapp_digits, 2) = '00' then nullif(substr(whatsapp_digits, 3), '')
    when left(whatsapp_digits, 1) = '0' then nullif('92' || substr(whatsapp_digits, 2), '')
    when length(whatsapp_digits) = 10 and left(whatsapp_digits, 1) = '3' then '92' || whatsapp_digits
    else nullif(whatsapp_digits, '')
  end;
  normalized_secondary_phone := case
    when left(secondary_phone_digits, 2) = '00' then nullif(substr(secondary_phone_digits, 3), '')
    when left(secondary_phone_digits, 1) = '0' then nullif('92' || substr(secondary_phone_digits, 2), '')
    when length(secondary_phone_digits) = 10 and left(secondary_phone_digits, 1) = '3' then '92' || secondary_phone_digits
    else nullif(secondary_phone_digits, '')
  end;

  select application.application_reference into existing_reference
  from public.admission_applications as application
  where application.submission_key = p_submission_key
    and application.school_id = target_school_id;

  if existing_reference is not null then
    return existing_reference;
  end if;

  if coalesce(p_honeypot, '') <> '' then
    raise exception 'We could not submit the registration. Please try again.'
      using errcode = '22023';
  end if;

  if student_name_value is null
    or length(student_name_value) > 160
    or p_date_of_birth is null
    or p_date_of_birth >= current_date
    or nullif(btrim(p_applying_class), '') is null
    or length(btrim(p_applying_class)) > 100
    or length(coalesce(btrim(p_preferred_section), '')) > 40
    or guardian_name_value is null
    or length(guardian_name_value) > 160
    or nullif(btrim(p_guardian_relationship), '') is null
    or length(btrim(p_guardian_relationship)) > 60
    or normalized_phone is null
    or normalized_phone !~ '^[0-9]{8,15}$'
    or (normalized_whatsapp is not null and normalized_whatsapp !~ '^[0-9]{8,15}$')
    or length(coalesce(btrim(p_gender), '')) > 30
    or length(coalesce(btrim(p_guardian_address), '')) > 300
    or length(coalesce(secondary_name_value, '')) > 160
    or length(coalesce(secondary_relationship_value, '')) > 60
    or (secondary_name_value is not null and secondary_relationship_value is null)
    or (secondary_name_value is null and (
      secondary_relationship_value is not null
      or normalized_secondary_phone is not null
      or nullif(btrim(p_secondary_guardian_email), '') is not null
    ))
    or (normalized_secondary_phone is not null and normalized_secondary_phone !~ '^[0-9]{8,15}$')
    or (nullif(btrim(p_guardian_email), '') is not null
      and (length(btrim(p_guardian_email)) > 254
        or btrim(p_guardian_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    or (nullif(btrim(p_secondary_guardian_email), '') is not null
      and (length(btrim(p_secondary_guardian_email)) > 254
        or btrim(p_secondary_guardian_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
  then
    raise exception 'Please complete the required fields with valid information.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.admission_applications as application
    where application.school_id = target_school_id
      and application.guardian_phone = normalized_phone
      and application.submitted_at > now() - interval '30 seconds'
  ) then
    raise exception 'Please wait a moment before submitting another registration.'
      using errcode = '23505';
  end if;

  application_ref := 'REG-' || to_char(current_date, 'YYYY') || '-'
    || lpad(nextval('public.admission_application_reference_seq')::text, 6, '0');

  insert into public.admission_applications (
    school_id, application_reference, submission_key, student_name, date_of_birth,
    gender, applying_class, preferred_section, guardian_name, guardian_relationship,
    guardian_phone, whatsapp_phone, guardian_email, guardian_address,
    secondary_guardian_name, secondary_guardian_relationship, secondary_guardian_phone,
    secondary_guardian_email
  )
  values (
    target_school_id, application_ref, p_submission_key, student_name_value, p_date_of_birth,
    nullif(btrim(p_gender), ''), btrim(p_applying_class), nullif(btrim(p_preferred_section), ''),
    guardian_name_value, btrim(p_guardian_relationship), normalized_phone, normalized_whatsapp,
    nullif(lower(btrim(p_guardian_email)), ''), nullif(btrim(p_guardian_address), ''),
    secondary_name_value, secondary_relationship_value, normalized_secondary_phone,
    nullif(lower(btrim(p_secondary_guardian_email)), '')
  )
  returning id into created_application_id;

  insert into public.admission_application_events (application_id, event_type, details)
  values (created_application_id, 'SUBMITTED', jsonb_build_object('source', 'PARENT_REGISTRATION'));

  return application_ref;
end;
$function$;

create or replace function public.list_admission_applications()
returns table (
  id uuid,
  application_reference text,
  student_name text,
  date_of_birth date,
  gender text,
  applying_class text,
  preferred_section text,
  guardian_name text,
  guardian_relationship text,
  guardian_phone text,
  whatsapp_phone text,
  guardian_email text,
  guardian_address text,
  secondary_guardian_name text,
  secondary_guardian_relationship text,
  secondary_guardian_phone text,
  secondary_guardian_email text,
  status text,
  submitted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  created_student_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can review admissions.'
      using errcode = '42501';
  end if;

  return query
  select application.id, application.application_reference, application.student_name,
    application.date_of_birth, application.gender, application.applying_class,
    application.preferred_section, application.guardian_name, application.guardian_relationship,
    application.guardian_phone, application.whatsapp_phone, application.guardian_email,
    application.guardian_address, application.secondary_guardian_name,
    application.secondary_guardian_relationship, application.secondary_guardian_phone,
    application.secondary_guardian_email,
    application.status, application.submitted_at, application.reviewed_by,
    application.reviewed_at, application.approved_by, application.approved_at,
    application.rejection_reason, application.created_student_id
  from public.admission_applications as application
  where application.school_id = actor.school_id
  order by case application.status when 'PENDING' then 0 else 1 end,
    application.submitted_at desc;
end;
$function$;

create or replace function public.edit_admission_application(
  p_application_id uuid,
  p_student_name text,
  p_date_of_birth date,
  p_gender text,
  p_applying_class text,
  p_preferred_section text,
  p_guardian_name text,
  p_guardian_relationship text,
  p_guardian_phone text,
  p_whatsapp_phone text,
  p_guardian_email text,
  p_guardian_address text,
  p_secondary_guardian_name text,
  p_secondary_guardian_relationship text,
  p_secondary_guardian_phone text,
  p_secondary_guardian_email text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
  target public.admission_applications%rowtype;
  phone_digits text := regexp_replace(coalesce(p_guardian_phone, ''), '[^0-9]', '', 'g');
  whatsapp_digits text := regexp_replace(coalesce(p_whatsapp_phone, ''), '[^0-9]', '', 'g');
  secondary_phone_digits text := regexp_replace(coalesce(p_secondary_guardian_phone, ''), '[^0-9]', '', 'g');
  normalized_phone text;
  normalized_whatsapp text;
  normalized_secondary_phone text;
  secondary_name_value text := nullif(btrim(p_secondary_guardian_name), '');
  secondary_relationship_value text := nullif(btrim(p_secondary_guardian_relationship), '');
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can edit admissions.'
      using errcode = '42501';
  end if;

  select application.* into target
  from public.admission_applications as application
  where application.id = p_application_id
    and application.school_id = actor.school_id
    and application.status = 'PENDING'
  for update;

  if not found then
    raise exception 'This application is no longer available for editing.'
      using errcode = '42501';
  end if;

  normalized_phone := case
    when left(phone_digits, 2) = '00' then nullif(substr(phone_digits, 3), '')
    when left(phone_digits, 1) = '0' then nullif('92' || substr(phone_digits, 2), '')
    when length(phone_digits) = 10 and left(phone_digits, 1) = '3' then '92' || phone_digits
    else nullif(phone_digits, '')
  end;
  normalized_whatsapp := case
    when left(whatsapp_digits, 2) = '00' then nullif(substr(whatsapp_digits, 3), '')
    when left(whatsapp_digits, 1) = '0' then nullif('92' || substr(whatsapp_digits, 2), '')
    when length(whatsapp_digits) = 10 and left(whatsapp_digits, 1) = '3' then '92' || whatsapp_digits
    else nullif(whatsapp_digits, '')
  end;
  normalized_secondary_phone := case
    when left(secondary_phone_digits, 2) = '00' then nullif(substr(secondary_phone_digits, 3), '')
    when left(secondary_phone_digits, 1) = '0' then nullif('92' || substr(secondary_phone_digits, 2), '')
    when length(secondary_phone_digits) = 10 and left(secondary_phone_digits, 1) = '3' then '92' || secondary_phone_digits
    else nullif(secondary_phone_digits, '')
  end;

  if nullif(btrim(p_student_name), '') is null or length(btrim(p_student_name)) > 160
    or p_date_of_birth is null or p_date_of_birth >= current_date
    or nullif(btrim(p_applying_class), '') is null or length(btrim(p_applying_class)) > 100
    or nullif(btrim(p_guardian_name), '') is null or length(btrim(p_guardian_name)) > 160
    or nullif(btrim(p_guardian_relationship), '') is null or length(btrim(p_guardian_relationship)) > 60
    or normalized_phone is null or normalized_phone !~ '^[0-9]{8,15}$'
    or (normalized_whatsapp is not null and normalized_whatsapp !~ '^[0-9]{8,15}$')
    or length(coalesce(btrim(p_preferred_section), '')) > 40
    or length(coalesce(btrim(p_gender), '')) > 30
    or length(coalesce(btrim(p_guardian_address), '')) > 300
    or length(coalesce(secondary_name_value, '')) > 160
    or length(coalesce(secondary_relationship_value, '')) > 60
    or (secondary_name_value is not null and secondary_relationship_value is null)
    or (secondary_name_value is null and (
      secondary_relationship_value is not null
      or normalized_secondary_phone is not null
      or nullif(btrim(p_secondary_guardian_email), '') is not null
    ))
    or (normalized_secondary_phone is not null and normalized_secondary_phone !~ '^[0-9]{8,15}$')
    or (nullif(btrim(p_guardian_email), '') is not null
      and (length(btrim(p_guardian_email)) > 254
        or btrim(p_guardian_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    or (nullif(btrim(p_secondary_guardian_email), '') is not null
      and (length(btrim(p_secondary_guardian_email)) > 254
        or btrim(p_secondary_guardian_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
  then
    raise exception 'Please complete the required fields with valid information.'
      using errcode = '22023';
  end if;

  update public.admission_applications
  set student_name = btrim(p_student_name),
    date_of_birth = p_date_of_birth,
    gender = nullif(btrim(p_gender), ''),
    applying_class = btrim(p_applying_class),
    preferred_section = nullif(btrim(p_preferred_section), ''),
    guardian_name = btrim(p_guardian_name),
    guardian_relationship = btrim(p_guardian_relationship),
    guardian_phone = normalized_phone,
    whatsapp_phone = normalized_whatsapp,
    guardian_email = nullif(lower(btrim(p_guardian_email)), ''),
    guardian_address = nullif(btrim(p_guardian_address), ''),
    secondary_guardian_name = secondary_name_value,
    secondary_guardian_relationship = secondary_relationship_value,
    secondary_guardian_phone = normalized_secondary_phone,
    secondary_guardian_email = nullif(lower(btrim(p_secondary_guardian_email)), '')
  where id = target.id;

  insert into public.admission_application_events (application_id, actor_id, event_type, details)
  values (target.id, actor.id, 'EDITED', jsonb_build_object('modified_during_review', true));
end;
$function$;

create or replace function public.approve_admission_application(
  p_application_id uuid,
  p_campus_id uuid,
  p_roll_number text,
  p_section text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
  target public.admission_applications%rowtype;
  student_id uuid;
  student_first_name text;
  student_last_name text;
  guardian_first_name text;
  guardian_last_name text;
  primary_guardian_id uuid;
  secondary_guardian_id uuid;
  secondary_guardian_first_name text;
  secondary_guardian_last_name text;
  section_name text := nullif(btrim(p_section), '');
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can approve admissions.'
      using errcode = '42501';
  end if;

  select application.* into target
  from public.admission_applications as application
  where application.id = p_application_id
    and application.school_id = actor.school_id
    and application.status = 'PENDING'
  for update;

  if not found then
    raise exception 'This application is no longer pending.'
      using errcode = '42501';
  end if;

  if nullif(btrim(target.student_name), '') is null
    or target.date_of_birth >= current_date
    or nullif(btrim(target.applying_class), '') is null
    or nullif(btrim(target.guardian_name), '') is null
    or nullif(btrim(target.guardian_relationship), '') is null
    or target.guardian_phone !~ '^[0-9]{8,15}$'
    or length(coalesce(target.guardian_address, '')) > 300
    or (target.secondary_guardian_name is not null
      and (target.secondary_guardian_relationship is null
        or length(target.secondary_guardian_name) > 160
        or length(target.secondary_guardian_relationship) > 60))
    or (target.secondary_guardian_name is null and (
      target.secondary_guardian_relationship is not null
      or target.secondary_guardian_phone is not null
      or target.secondary_guardian_email is not null
    ))
    or (target.secondary_guardian_phone is not null
      and target.secondary_guardian_phone !~ '^[0-9]{8,15}$')
    or section_name is null
    or length(section_name) > 40
  then
    raise exception 'Complete the student and guardian details before approval.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.campuses as campus
    where campus.id = p_campus_id
      and campus.organization_id = actor.organization_id
      and campus.school_id = actor.school_id
      and campus.status = 'ACTIVE'
  ) then
    raise exception 'Select an active campus in your school.'
      using errcode = '42501';
  end if;

  student_first_name := split_part(btrim(target.student_name), ' ', 1);
  student_last_name := nullif(btrim(substr(btrim(target.student_name), length(student_first_name) + 1)), '');
  guardian_first_name := split_part(btrim(target.guardian_name), ' ', 1);
  guardian_last_name := nullif(btrim(substr(btrim(target.guardian_name), length(guardian_first_name) + 1)), '');

  student_id := public.create_student(
    p_campus_id,
    target.application_reference,
    student_first_name,
    coalesce(student_last_name, student_first_name),
    target.applying_class,
    section_name,
    p_roll_number,
    target.date_of_birth,
    target.gender,
    guardian_first_name,
    coalesce(guardian_last_name, guardian_first_name),
    target.guardian_phone,
    target.guardian_email,
    target.guardian_relationship
  );

  select relation.guardian_id into primary_guardian_id
  from public.student_guardians as relation
  where relation.student_id = student_id
    and relation.is_primary
  limit 1;

  if primary_guardian_id is null then
    raise exception 'The primary guardian could not be linked to the new student.'
      using errcode = '23503';
  end if;

  update public.guardians
  set address = target.guardian_address
  where id = primary_guardian_id;

  if target.secondary_guardian_name is not null then
    secondary_guardian_first_name := split_part(target.secondary_guardian_name, ' ', 1);
    secondary_guardian_last_name := nullif(btrim(substr(target.secondary_guardian_name, length(secondary_guardian_first_name) + 1)), '');

    insert into public.guardians (
      organization_id, school_id, campus_id, first_name, last_name,
      relationship, phone, email
    )
    values (
      actor.organization_id, actor.school_id, p_campus_id,
      secondary_guardian_first_name, coalesce(secondary_guardian_last_name, secondary_guardian_first_name),
      target.secondary_guardian_relationship, target.secondary_guardian_phone,
      target.secondary_guardian_email
    )
    returning id into secondary_guardian_id;

    insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
    values (student_id, secondary_guardian_id, target.secondary_guardian_relationship, false);
  end if;

  update public.admission_applications
  set status = 'APPROVED',
    preferred_section = section_name,
    reviewed_by = actor.id,
    reviewed_at = now(),
    approved_by = actor.id,
    approved_at = now(),
    created_student_id = student_id
  where id = target.id;

  insert into public.admission_application_events (application_id, actor_id, event_type, details)
  values (
    target.id, actor.id, 'APPROVED',
    jsonb_build_object(
      'created_student_id', student_id,
      'campus_id', p_campus_id,
      'secondary_guardian_linked', secondary_guardian_id is not null
    )
  );

  return student_id;
end;
$function$;

create or replace function public.reject_admission_application(
  p_application_id uuid,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
  target public.admission_applications%rowtype;
  reason text := nullif(btrim(p_rejection_reason), '');
begin
  select profile.* into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'Only an active school administrator can reject admissions.'
      using errcode = '42501';
  end if;

  select application.* into target
  from public.admission_applications as application
  where application.id = p_application_id
    and application.school_id = actor.school_id
    and application.status = 'PENDING'
  for update;

  if not found then
    raise exception 'This application is no longer pending.'
      using errcode = '42501';
  end if;

  if length(coalesce(reason, '')) > 500 then
    raise exception 'The rejection reason must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  update public.admission_applications
  set status = 'REJECTED', reviewed_by = actor.id, reviewed_at = now(), rejection_reason = reason
  where id = target.id;

  insert into public.admission_application_events (application_id, actor_id, event_type, details)
  values (target.id, actor.id, 'REJECTED', jsonb_build_object('reason', reason));
end;
$function$;

revoke all on function public.get_school_registration_link() from public, anon;
revoke all on function public.create_school_registration_link() from public, anon;
revoke all on function public.set_school_registration_enabled(boolean) from public, anon;
revoke all on function public.lookup_public_registration(text) from public, authenticated;
revoke all on function public.submit_public_registration(text, uuid, text, date, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.list_admission_applications() from public, anon;
revoke all on function public.edit_admission_application(uuid, text, date, text, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.approve_admission_application(uuid, uuid, text, text) from public, anon;
revoke all on function public.reject_admission_application(uuid, text) from public, anon;

grant execute on function public.get_school_registration_link() to authenticated;
grant execute on function public.create_school_registration_link() to authenticated;
grant execute on function public.set_school_registration_enabled(boolean) to authenticated;
grant execute on function public.lookup_public_registration(text) to anon, authenticated;
grant execute on function public.submit_public_registration(text, uuid, text, date, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.list_admission_applications() to authenticated;
grant execute on function public.edit_admission_application(uuid, text, date, text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.approve_admission_application(uuid, uuid, text, text) to authenticated;
grant execute on function public.reject_admission_application(uuid, text) to authenticated;

commit;
