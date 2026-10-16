-- 021_production_security_hardening.sql
-- Production Security Hardening Migration for CAMVIA
-- Defense-in-depth privileges, trigger hardening, and tenant isolation reinforcement.

begin;

-- 1. Ensure fixed search_path on base trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. Revoke execute on internal triggers from public and anon
-- PostgREST hides functions returning trigger from RPC; revoking from public/anon removes public exposure.
-- Authenticated execute is preserved so SECURITY INVOKER DML triggers execute cleanly without privilege errors.
revoke execute on function public.set_updated_at() from public, anon;
revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.set_administration_audit() from public, anon;

-- 3. Revoke all privileges on all 20 application tables from 'anon' and 'public'
-- Defense-in-depth: Unauthenticated callers must have zero direct table permissions.
revoke all privileges on table public.organizations from public, anon;
revoke all privileges on table public.schools from public, anon;
revoke all privileges on table public.campuses from public, anon;
revoke all privileges on table public.roles from public, anon;
revoke all privileges on table public.profiles from public, anon;
revoke all privileges on table public.user_roles from public, anon;
revoke all privileges on table public.teacher_class_assignments from public, anon;
revoke all privileges on table public.students from public, anon;
revoke all privileges on table public.guardians from public, anon;
revoke all privileges on table public.student_guardians from public, anon;
revoke all privileges on table public.attendance_sessions from public, anon;
revoke all privileges on table public.attendance_records from public, anon;
revoke all privileges on table public.fee_invoices from public, anon;
revoke all privileges on table public.fee_invoice_items from public, anon;
revoke all privileges on table public.fee_payments from public, anon;
revoke all privileges on table public.communication_messages from public, anon;
revoke all privileges on table public.communication_recipients from public, anon;
revoke all privileges on table public.communication_events from public, anon;
revoke all privileges on table public.integration_configs from public, anon;
revoke all privileges on table public.user_management_audit from public, anon;

-- 4. Harden sensitive administrative and reference tables against direct table mutations
-- Direct writes to teacher assignments, user roles, organizations, and roles are disabled.
-- User roles and teacher class assignments are managed exclusively via the audited update_school_user RPC.
revoke insert, update, delete on table public.organizations from authenticated;
revoke insert, update, delete on table public.roles from authenticated;
revoke insert, update, delete on table public.user_roles from authenticated;
revoke insert, update, delete on table public.teacher_class_assignments from authenticated;

-- Ensure authenticated users retain least-privilege SELECT where required for application navigation
-- Explicitly grant SELECT on guardians and student_guardians to preserve student profile and communication views.
grant select on table public.organizations to authenticated;
grant select on table public.roles to authenticated;
grant select on table public.user_roles to authenticated;
grant select on table public.teacher_class_assignments to authenticated;
grant select on table public.guardians to authenticated;
grant select on table public.student_guardians to authenticated;

-- 5. Harden guardian table privileges
-- Direct inserts and updates on guardians are scoped via create_student RPC.
-- Revoke direct delete on guardians to prevent destructive cascades of historical student records.
revoke delete on table public.guardians from authenticated;
drop policy if exists guardians_delete_same_school_admin on public.guardians;

-- 6. Re-affirm Row Level Security across all 20 protected tables
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
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.fee_invoices enable row level security;
alter table public.fee_invoice_items enable row level security;
alter table public.fee_payments enable row level security;
alter table public.communication_messages enable row level security;
alter table public.communication_recipients enable row level security;
alter table public.communication_events enable row level security;
alter table public.integration_configs enable row level security;
alter table public.user_management_audit enable row level security;

commit;
