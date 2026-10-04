create table if not exists public.roles (
  name text primary key check (name in ('ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER')),
  description text
);

insert into public.roles (name, description)
values
  ('ADMIN', 'School owner and system administrator'),
  ('PRINCIPAL', 'Academic lead for the school'),
  ('FINANCE', 'Finance and collections access'),
  ('TEACHER', 'Classroom teacher access')
on conflict (name) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id),
  school_id uuid references public.schools(id),
  campus_id uuid references public.campuses(id),
  full_name text not null,
  email text not null unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  role text not null references public.roles(name),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null references public.roles(name),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, status, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'ACTIVE',
    coalesce(new.raw_user_meta_data->>'role', 'TEACHER')
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'role', 'TEACHER'))
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();
