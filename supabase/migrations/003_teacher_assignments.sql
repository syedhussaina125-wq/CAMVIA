create table if not exists public.teacher_class_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  class_name text not null,
  section text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint teacher_assignment_unique unique (user_id, school_id, campus_id, class_name, section)
);

create index if not exists teacher_class_assignments_user_idx
  on public.teacher_class_assignments (user_id, active);

create index if not exists teacher_class_assignments_school_idx
  on public.teacher_class_assignments (school_id, campus_id);
