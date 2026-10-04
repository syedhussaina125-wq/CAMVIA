create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  student_code text not null,
  first_name text not null,
  last_name text not null,
  class_name text not null,
  section text not null,
  roll_number text,
  date_of_birth date,
  gender text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'ALUMNI')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint students_school_code_unique unique (school_id, student_code)
);

create table if not exists public.guardians (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  relationship text,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.student_guardians (
  student_id uuid not null references public.students(id) on delete cascade,
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  relationship text,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (student_id, guardian_id)
);

create trigger students_set_updated_at
before update on public.students
for each row
execute function public.set_updated_at();

create trigger guardians_set_updated_at
before update on public.guardians
for each row
execute function public.set_updated_at();

create index if not exists students_school_scope_idx
  on public.students (organization_id, school_id, campus_id);

create index if not exists student_guardians_student_idx
  on public.student_guardians (student_id);
