begin;

alter table public.schools
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

alter table public.campuses
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

create or replace function public.set_administration_audit()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $function$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$function$;

drop trigger if exists schools_set_administration_audit on public.schools;
create trigger schools_set_administration_audit
before update on public.schools
for each row
execute function public.set_administration_audit();

drop trigger if exists campuses_set_administration_audit on public.campuses;
create trigger campuses_set_administration_audit
before update on public.campuses
for each row
execute function public.set_administration_audit();

drop policy if exists schools_admin_update_own on public.schools;
create policy schools_admin_update_own
on public.schools
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles as requester
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.role = 'ADMIN'
      and requester.organization_id = schools.organization_id
      and requester.school_id = schools.id
  )
)
with check (
  exists (
    select 1
    from public.profiles as requester
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.role = 'ADMIN'
      and requester.organization_id = schools.organization_id
      and requester.school_id = schools.id
  )
);

drop policy if exists campuses_admin_update_own_school on public.campuses;
create policy campuses_admin_update_own_school
on public.campuses
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles as requester
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.role = 'ADMIN'
      and requester.organization_id = campuses.organization_id
      and requester.school_id = campuses.school_id
  )
)
with check (
  exists (
    select 1
    from public.profiles as requester
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.role = 'ADMIN'
      and requester.organization_id = campuses.organization_id
      and requester.school_id = campuses.school_id
  )
);

revoke insert, update, delete on public.schools from public, anon, authenticated;
revoke insert, update, delete on public.campuses from public, anon, authenticated;
grant select on public.schools, public.campuses to authenticated;
grant update (name, short_name, email, phone, address, timezone)
  on public.schools to authenticated;
grant update (name, code, address, status)
  on public.campuses to authenticated;

create unique index if not exists schools_organization_id_id_unique
  on public.schools (organization_id, id);

create table if not exists public.integration_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  provider_key text not null check (provider_key in ('EMAIL', 'SMS', 'WHATSAPP')),
  status text not null default 'NOT_CONFIGURED'
    check (status in ('NOT_CONFIGURED', 'CONFIGURED', 'DISABLED')),
  external_identifier text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint integration_configs_school_provider_unique unique (school_id, provider_key),
  constraint integration_configs_school_tenant_match
    foreign key (organization_id, school_id)
    references public.schools(organization_id, id)
    on delete cascade
);

create index if not exists integration_configs_school_scope_idx
  on public.integration_configs (organization_id, school_id);

drop trigger if exists integration_configs_set_updated_at on public.integration_configs;
create trigger integration_configs_set_updated_at
before update on public.integration_configs
for each row
execute function public.set_administration_audit();

alter table public.integration_configs enable row level security;

drop policy if exists integration_configs_read_school_admins on public.integration_configs;
create policy integration_configs_read_school_admins
on public.integration_configs
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles as requester
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.role in ('ADMIN', 'PRINCIPAL')
      and requester.organization_id = integration_configs.organization_id
      and requester.school_id = integration_configs.school_id
  )
);

revoke all on public.integration_configs from public, anon, authenticated;
grant select on public.integration_configs to authenticated;

insert into public.integration_configs (
  id, organization_id, school_id, provider_key, status, external_identifier
)
select
  md5(concat('integration-config:', school.id::text, ':', provider.provider_key))::uuid,
  school.organization_id,
  school.id,
  provider.provider_key,
  'NOT_CONFIGURED',
  null
from public.schools as school
cross join (values ('EMAIL'::text), ('SMS'::text), ('WHATSAPP'::text)) as provider(provider_key)
on conflict (school_id, provider_key) do nothing;

comment on table public.integration_configs is
  'Non-secret provider metadata only. No credentials, connectivity checks, or delivery integration are stored here.';
comment on column public.integration_configs.external_identifier is
  'Optional non-secret account or tenant identifier; never store keys, tokens, passwords, or private credentials.';

commit;
