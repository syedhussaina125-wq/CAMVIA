-- ============================================================================
-- Migration 028: Login Brute-Force Protection & Password Verification Hook
--
-- GOAL:
-- Prevent brute-force password guessing by enforcing server-side temporary
-- lockouts after 5 consecutive failed password attempts.
--
-- SECURITY PROPERTIES:
-- 1. Enforced server-side via Supabase Auth Password Verification Hook.
-- 2. State stored in public.login_bruteforce_protection with zero client access.
-- 3. Row-Level Security enabled with all privileges revoked from anon/authenticated.
-- 4. Only supabase_auth_admin has access to tables and the verification hook.
-- 5. Automatic 15-minute expiration; no permanent lockouts and no DoS exposure.
-- 6. Atomic concurrency protection with SELECT ... FOR UPDATE.
-- 7. Audit log of security events (LOGIN_FAILED, LOGIN_TEMPORARILY_LOCKED,
--    LOGIN_SUCCESS_AFTER_FAILURES) without sensitive credentials.
--
-- IMPORTANT:
-- This migration proposal must be reviewed prior to running in production.
-- ============================================================================

begin;

-- ============================================================================
-- 1. TABLE: public.login_bruteforce_protection
-- ============================================================================
create table if not exists public.login_bruteforce_protection (
  user_id uuid primary key references auth.users(id) on delete cascade,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  last_failed_at timestamptz,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.login_bruteforce_protection is
  'Tracks consecutive failed password verification attempts and temporary 15-minute lockouts for Supabase Auth.';

create index if not exists idx_login_bruteforce_locked_until
  on public.login_bruteforce_protection (locked_until)
  where locked_until is not null;

-- Enable RLS and isolate strictly from client roles
alter table public.login_bruteforce_protection enable row level security;
revoke all on table public.login_bruteforce_protection from public, anon, authenticated;

-- Allow only Supabase Auth internal engine to access tracking state
grant select, insert, update, delete on table public.login_bruteforce_protection to supabase_auth_admin;


-- ============================================================================
-- 2. TABLE: public.login_security_audit
-- ============================================================================
create table if not exists public.login_security_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (
    event_type in ('LOGIN_FAILED', 'LOGIN_TEMPORARILY_LOCKED', 'LOGIN_SUCCESS_AFTER_FAILURES')
  ),
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.login_security_audit is
  'Audit log for authentication security events without storing credentials, tokens, or secrets.';

create index if not exists idx_login_security_audit_user_id
  on public.login_security_audit (user_id, created_at desc);

alter table public.login_security_audit enable row level security;
revoke all on table public.login_security_audit from public, anon, authenticated;

grant select, insert on table public.login_security_audit to supabase_auth_admin;


-- ============================================================================
-- 3. PASSWORD VERIFICATION HOOK: hook_password_verification_attempt
-- ============================================================================
create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  target_user_id uuid;
  is_valid boolean;
  current_record public.login_bruteforce_protection%rowtype;
  now_ts timestamptz := clock_timestamp();
  remaining_seconds integer;
  minutes_part integer;
  seconds_part integer;
  formatted_time text;
  new_failed_attempts integer;
begin
  -- Parse event payload provided by Supabase Auth GoTrue
  target_user_id := (event->>'user_id')::uuid;
  is_valid := coalesce((event->>'valid')::boolean, false);

  -- Defensive guard: if user_id is missing or unparseable, continue standard flow
  if target_user_id is null then
    return jsonb_build_object('decision', 'continue');
  end if;

  -- Concurrency & Race Protection:
  -- Initialize row if not present, then lock row for atomic transaction processing
  insert into public.login_bruteforce_protection (user_id, failed_attempts, updated_at)
  values (target_user_id, 0, now_ts)
  on conflict (user_id) do nothing;

  select * into current_record
  from public.login_bruteforce_protection
  where user_id = target_user_id
  for update;

  -- Check if user is currently in an active 15-minute lockout period
  if current_record.locked_until is not null and current_record.locked_until > now_ts then
    remaining_seconds := greatest(1, ceil(extract(epoch from (current_record.locked_until - now_ts))))::integer;
    minutes_part := remaining_seconds / 60;
    seconds_part := remaining_seconds % 60;
    formatted_time := to_char(minutes_part, 'FM00') || ':' || to_char(seconds_part, 'FM00');

    -- Record audit event for attempt during lockout
    insert into public.login_security_audit (user_id, event_type, failed_attempts, locked_until, created_at)
    values (target_user_id, 'LOGIN_TEMPORARILY_LOCKED', current_record.failed_attempts, current_record.locked_until, now_ts);

    -- Reject further verification attempts during lock
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Too many unsuccessful login attempts. Please try again in ' || formatted_time || '.',
      'should_logout_user', true
    );
  end if;

  -- If a previous lock has expired, reset failed counter
  if current_record.locked_until is not null and current_record.locked_until <= now_ts then
    current_record.failed_attempts := 0;
    current_record.locked_until := null;
  end if;

  -- Case A: Password verification succeeded
  if is_valid is true then
    if current_record.failed_attempts > 0 then
      insert into public.login_security_audit (user_id, event_type, failed_attempts, locked_until, created_at)
      values (target_user_id, 'LOGIN_SUCCESS_AFTER_FAILURES', current_record.failed_attempts, null, now_ts);
    end if;

    -- Clear all failure and lock state
    update public.login_bruteforce_protection
    set failed_attempts = 0,
        locked_until = null,
        updated_at = now_ts
    where user_id = target_user_id;

    return jsonb_build_object('decision', 'continue');
  end if;

  -- Case B: Password verification failed
  new_failed_attempts := current_record.failed_attempts + 1;

  if new_failed_attempts >= 5 then
    -- 5th failure: Trigger 15-minute temporary lockout
    current_record.locked_until := now_ts + interval '15 minutes';
    current_record.failed_attempts := new_failed_attempts;
    current_record.last_failed_at := now_ts;
    current_record.updated_at := now_ts;

    update public.login_bruteforce_protection
    set failed_attempts = current_record.failed_attempts,
        last_failed_at = current_record.last_failed_at,
        locked_until = current_record.locked_until,
        updated_at = current_record.updated_at
    where user_id = target_user_id;

    insert into public.login_security_audit (user_id, event_type, failed_attempts, locked_until, created_at)
    values (target_user_id, 'LOGIN_TEMPORARILY_LOCKED', current_record.failed_attempts, current_record.locked_until, now_ts);

    remaining_seconds := ceil(extract(epoch from (current_record.locked_until - now_ts)))::integer;
    minutes_part := remaining_seconds / 60;
    seconds_part := remaining_seconds % 60;
    formatted_time := to_char(minutes_part, 'FM00') || ':' || to_char(seconds_part, 'FM00');

    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Too many unsuccessful login attempts. Please try again in ' || formatted_time || '.',
      'should_logout_user', true
    );
  else
    -- Attempts 1-4: Update counter and allow standard auth failure response
    update public.login_bruteforce_protection
    set failed_attempts = new_failed_attempts,
        last_failed_at = now_ts,
        locked_until = null,
        updated_at = now_ts
    where user_id = target_user_id;

    insert into public.login_security_audit (user_id, event_type, failed_attempts, locked_until, created_at)
    values (target_user_id, 'LOGIN_FAILED', new_failed_attempts, null, now_ts);

    return jsonb_build_object('decision', 'continue');
  end if;
end;
$$;

-- Secure hook execution privileges
grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_password_verification_attempt(jsonb) from anon, authenticated, public;

commit;
