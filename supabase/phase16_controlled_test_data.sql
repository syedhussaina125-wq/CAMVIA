-- Controlled Phase 16 settings and integration metadata only.
-- Run manually after 017_live_administration.sql and the Phase 11 fixtures.
-- Contains no integration secrets and creates no Auth users.
-- No Finance-only settings currently exist in the product; Finance gets no administrative setting write path.

begin;

do $$
begin
  if not exists (
    select 1 from public.schools
    where id = 'a1100000-0000-4000-8000-000000000011'::uuid
      and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid
  ) or not exists (
    select 1 from public.schools
    where id = 'b1100000-0000-4000-8000-000000000011'::uuid
      and organization_id = 'b1100000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'Required Phase 11 School A and School B fixtures are missing or mis-scoped.';
  end if;
end;
$$;

update public.schools
set name = 'EduPulse Phase 11 Test School A',
    short_name = 'EPTEST-A',
    email = null,
    phone = null,
    address = 'Test Campus Address A',
    country = 'Test',
    timezone = 'UTC',
    academic_year = '2026-2027'
where id = 'a1100000-0000-4000-8000-000000000011'::uuid
  and organization_id = 'a1100000-0000-4000-8000-000000000001'::uuid;

update public.schools
set name = 'EduPulse Phase 11 Test School B',
    short_name = 'EPTEST-B',
    email = null,
    phone = null,
    address = 'Test Campus Address B',
    country = 'Test',
    timezone = 'UTC',
    academic_year = '2026-2027'
where id = 'b1100000-0000-4000-8000-000000000011'::uuid
  and organization_id = 'b1100000-0000-4000-8000-000000000001'::uuid;

insert into public.integration_configs (
  id, organization_id, school_id, provider_key, status, external_identifier
)
select
  md5(concat('phase16-integration:', school.id::text, ':', provider.provider_key))::uuid,
  school.organization_id,
  school.id,
  provider.provider_key,
  'NOT_CONFIGURED',
  null
from public.schools as school
join (values
  ('a1100000-0000-4000-8000-000000000011'::uuid),
  ('b1100000-0000-4000-8000-000000000011'::uuid)
) as fixture(school_id) on fixture.school_id = school.id
cross join (values ('EMAIL'::text), ('SMS'::text), ('WHATSAPP'::text)) as provider(provider_key)
on conflict (school_id, provider_key) do update
set status = excluded.status,
    external_identifier = excluded.external_identifier;

commit;

-- Run the following read checks separately while signed in as each controlled role.
-- School A identities must see only School A settings and integration metadata.
select id, organization_id, name, short_name, timezone, academic_year, updated_at, updated_by
from public.schools
where id in (
  'a1100000-0000-4000-8000-000000000011'::uuid,
  'b1100000-0000-4000-8000-000000000011'::uuid
);

select school_id, provider_key, status, external_identifier, updated_at, updated_by
from public.integration_configs
where school_id in (
  'a1100000-0000-4000-8000-000000000011'::uuid,
  'b1100000-0000-4000-8000-000000000011'::uuid
)
order by school_id, provider_key;
