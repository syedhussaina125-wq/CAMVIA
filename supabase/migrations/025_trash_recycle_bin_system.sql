-- ============================================================================
-- CAMVIA Migration 025: Trash & 30-Day Recovery System
-- Purpose:
--   Implement controlled 30-day soft-delete (Trash) with automatic recovery
--   guarantee for eligible entities (Students, Guardians, Communication Drafts).
--   Hard-delete is prohibited before purge_after <= now().
--   After 30 days:
--     - Safe purge if no protected dependencies exist.
--     - Irreversible tombstone/anonymization if historical dependencies exist.
--   Preserves immutable ledger, attendance, and sent communications.
-- ============================================================================

begin;

-- ============================================================================
-- 1. SCHEMA EXTENSIONS: Soft-Delete Metadata Columns
-- ============================================================================

-- 1.1 Students
alter table public.students
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null references public.profiles(id),
  add column if not exists delete_reason text null,
  add column if not exists purge_after timestamptz null,
  add column if not exists is_tombstoned boolean not null default false;

-- 1.2 Guardians
alter table public.guardians
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null references public.profiles(id),
  add column if not exists delete_reason text null,
  add column if not exists purge_after timestamptz null,
  add column if not exists is_tombstoned boolean not null default false;

-- 1.3 Communication Messages
alter table public.communication_messages
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null references public.profiles(id),
  add column if not exists delete_reason text null,
  add column if not exists purge_after timestamptz null,
  add column if not exists is_tombstoned boolean not null default false;

-- ============================================================================
-- 2. PARTIAL INDEXES: Fast Operational Filtering & Trash Recovery
-- ============================================================================

create index if not exists idx_students_active_school
  on public.students (school_id, class_name, section)
  where deleted_at is null;

create index if not exists idx_guardians_active_school
  on public.guardians (school_id)
  where deleted_at is null;

create index if not exists idx_communication_active_school
  on public.communication_messages (school_id, status, created_at desc)
  where deleted_at is null;

create index if not exists idx_students_trashed
  on public.students (school_id, purge_after)
  where deleted_at is not null;

create index if not exists idx_guardians_trashed
  on public.guardians (school_id, purge_after)
  where deleted_at is not null;

create index if not exists idx_communication_trashed
  on public.communication_messages (school_id, purge_after)
  where deleted_at is not null;

-- ============================================================================
-- 3. AUDIT TRAIL EXPANSION
-- Add 9 Trash-specific events to user_management_audit
-- ============================================================================

alter table public.user_management_audit drop constraint if exists user_management_audit_event_type_check;
alter table public.user_management_audit add constraint user_management_audit_event_type_check
  check (event_type in (
    -- Original 6
    'STUDENT_CREATED', 'USER_CREATED', 'USER_UPDATED',
    'USER_ROLE_CHANGED', 'USER_DEACTIVATED', 'INVOICE_CREATED',
    -- Migration 024 (11 events)
    'STUDENT_UPDATED', 'STUDENT_ARCHIVED', 'GUARDIAN_UPDATED',
    'GUARDIAN_LINKED', 'GUARDIAN_UNLINKED', 'GUARDIAN_ARCHIVED',
    'ATTENDANCE_CORRECTED', 'FEE_INVOICE_UPDATED', 'FEE_INVOICE_VOIDED',
    'FEE_PAYMENT_VOIDED', 'COMMUNICATION_DRAFT_DELETED',
    -- Migration 025 (9 Trash events)
    'STUDENT_TRASHED', 'STUDENT_RESTORED',
    'GUARDIAN_TRASHED', 'GUARDIAN_RESTORED',
    'COMMUNICATION_DRAFT_TRASHED', 'COMMUNICATION_DRAFT_RESTORED',
    'RECORD_PERMANENTLY_DELETED', 'RECORD_TOMBSTONED', 'TRASH_PURGE_EXECUTED'
  ));

-- ============================================================================
-- 4. RPCs: TRASH OPERATIONS (Move to Trash)
-- ============================================================================

-- 4.1 trash_student
create or replace function public.trash_student(
  p_student_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor_id uuid := auth.uid();
  actor public.profiles%rowtype;
  student public.students%rowtype;
  norm_reason text := btrim(coalesce(p_reason, ''));
  v_purge_after timestamptz := pg_catalog.now() + interval '30 days';
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role <> 'ADMIN' then
    raise exception 'Only administrators can move students to Trash.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'A reason is required to move a student to Trash.' using errcode = '22023';
  end if;

  select * into student from public.students where id = p_student_id for update;
  if not found or student.organization_id <> actor.organization_id or student.school_id <> actor.school_id then
    raise exception 'Student not found in your authorized school scope.' using errcode = '42501';
  end if;

  if student.deleted_at is not null then
    raise exception 'Student is already in Trash.' using errcode = '22023';
  end if;

  if student.is_tombstoned then
    raise exception 'Cannot trash a tombstoned student.' using errcode = '22023';
  end if;

  update public.students
  set
    deleted_at = pg_catalog.now(),
    deleted_by = actor.id,
    delete_reason = norm_reason,
    purge_after = v_purge_after,
    updated_at = pg_catalog.now()
  where id = student.id
  returning * into student;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    student.id,
    'STUDENT_TRASHED',
    jsonb_build_object(
      'record_type', 'STUDENT',
      'action', 'TRASH',
      'actor_role', actor.role,
      'student_id', student.id,
      'student_code', student.student_code,
      'deleted_at', student.deleted_at,
      'purge_after', student.purge_after,
      'reason', norm_reason
    )
  );

  return jsonb_build_object(
    'success', true,
    'student_id', student.id,
    'deleted_at', student.deleted_at,
    'purge_after', student.purge_after
  );
end;
$function$;

-- 4.2 trash_guardian
create or replace function public.trash_guardian(
  p_guardian_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor_id uuid := auth.uid();
  actor public.profiles%rowtype;
  guardian public.guardians%rowtype;
  norm_reason text := btrim(coalesce(p_reason, ''));
  v_purge_after timestamptz := pg_catalog.now() + interval '30 days';
  v_active_links int;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role <> 'ADMIN' then
    raise exception 'Only administrators can move guardians to Trash.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'A reason is required to move a guardian to Trash.' using errcode = '22023';
  end if;

  select * into guardian from public.guardians where id = p_guardian_id for update;
  if not found or guardian.organization_id <> actor.organization_id or guardian.school_id <> actor.school_id then
    raise exception 'Guardian not found in your authorized school scope.' using errcode = '42501';
  end if;

  if guardian.deleted_at is not null then
    raise exception 'Guardian is already in Trash.' using errcode = '22023';
  end if;

  if guardian.is_tombstoned then
    raise exception 'Cannot trash a tombstoned guardian.' using errcode = '22023';
  end if;

  -- Ensure guardian is not linked to any active non-trashed student
  select count(*) into v_active_links
  from public.student_guardians sg
  join public.students s on s.id = sg.student_id
  where sg.guardian_id = guardian.id
    and s.deleted_at is null;

  if v_active_links > 0 then
    raise exception 'Cannot move guardian to Trash while they are linked to active students.' using errcode = '22023';
  end if;

  update public.guardians
  set
    deleted_at = pg_catalog.now(),
    deleted_by = actor.id,
    delete_reason = norm_reason,
    purge_after = v_purge_after,
    updated_at = pg_catalog.now()
  where id = guardian.id
  returning * into guardian;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    guardian.id,
    'GUARDIAN_TRASHED',
    jsonb_build_object(
      'record_type', 'GUARDIAN',
      'action', 'TRASH',
      'actor_role', actor.role,
      'guardian_id', guardian.id,
      'deleted_at', guardian.deleted_at,
      'purge_after', guardian.purge_after,
      'reason', norm_reason
    )
  );

  return jsonb_build_object(
    'success', true,
    'guardian_id', guardian.id,
    'deleted_at', guardian.deleted_at,
    'purge_after', guardian.purge_after
  );
end;
$function$;

-- 4.3 trash_communication_draft
create or replace function public.trash_communication_draft(
  p_message_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor_id uuid := auth.uid();
  actor public.profiles%rowtype;
  msg public.communication_messages%rowtype;
  norm_reason text := btrim(coalesce(p_reason, ''));
  v_purge_after timestamptz := pg_catalog.now() + interval '30 days';
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found then
    raise exception 'Active profile required.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'A reason is required to move a communication draft to Trash.' using errcode = '22023';
  end if;

  select * into msg from public.communication_messages where id = p_message_id for update;
  if not found or msg.organization_id <> actor.organization_id or msg.school_id <> actor.school_id then
    raise exception 'Communication message not found in your school scope.' using errcode = '42501';
  end if;

  if msg.deleted_at is not null then
    raise exception 'Message is already in Trash.' using errcode = '22023';
  end if;

  if msg.is_tombstoned then
    raise exception 'Cannot trash a tombstoned message.' using errcode = '22023';
  end if;

  -- Only drafts or rejected messages can be trashed
  if msg.status not in ('DRAFT', 'REJECTED') then
    raise exception 'Only draft or rejected communication messages can be moved to Trash.' using errcode = '22023';
  end if;

  if actor.role in ('ADMIN', 'PRINCIPAL') then
    null;
  elsif actor.role in ('TEACHER', 'FINANCE') then
    if msg.created_by <> actor.id then
      raise exception 'Staff may only move drafts they authored to Trash.' using errcode = '42501';
    end if;
  else
    raise exception 'Insufficient permissions to trash communication drafts.' using errcode = '42501';
  end if;

  update public.communication_messages
  set
    deleted_at = pg_catalog.now(),
    deleted_by = actor.id,
    delete_reason = norm_reason,
    purge_after = v_purge_after,
    updated_at = pg_catalog.now()
  where id = msg.id
  returning * into msg;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    msg.id,
    'COMMUNICATION_DRAFT_TRASHED',
    jsonb_build_object(
      'record_type', 'COMMUNICATION_DRAFT',
      'action', 'TRASH',
      'actor_role', actor.role,
      'student_id', msg.student_id,
      'deleted_at', msg.deleted_at,
      'purge_after', msg.purge_after,
      'reason', norm_reason
    )
  );

  return jsonb_build_object(
    'success', true,
    'message_id', msg.id,
    'deleted_at', msg.deleted_at,
    'purge_after', msg.purge_after
  );
end;
$function$;

-- 4.4 Backward-compatible redirect: delete_communication_draft -> trash_communication_draft
create or replace function public.delete_communication_draft(
  p_message_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
begin
  return public.trash_communication_draft(p_message_id, p_reason);
end;
$function$;

-- ============================================================================
-- 5. RPCs: RESTORE OPERATIONS (Restore from Trash)
-- ============================================================================

-- 5.1 restore_trashed_student
create or replace function public.restore_trashed_student(
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor_id uuid := auth.uid();
  actor public.profiles%rowtype;
  student public.students%rowtype;
  orig_deleted_at timestamptz;
  v_collision_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role <> 'ADMIN' then
    raise exception 'Only administrators can restore students from Trash.' using errcode = '42501';
  end if;

  select * into student from public.students where id = p_student_id for update;
  if not found or student.organization_id <> actor.organization_id or student.school_id <> actor.school_id then
    raise exception 'Student not found in your authorized school scope.' using errcode = '42501';
  end if;

  if student.deleted_at is null then
    raise exception 'Student is not in Trash.' using errcode = '22023';
  end if;

  if student.is_tombstoned then
    raise exception 'Tombstoned students cannot be restored.' using errcode = '22023';
  end if;

  if student.purge_after is not null and student.purge_after <= pg_catalog.now() then
    raise exception 'The 30-day recovery window for this record has expired.' using errcode = '22023';
  end if;

  -- Check student_code collision with active students
  select id into v_collision_id
  from public.students
  where school_id = student.school_id
    and student_code = student.student_code
    and id <> student.id
    and deleted_at is null
  limit 1;

  if v_collision_id is not null then
    raise exception 'Cannot restore student: student code % is now used by another active student.', student.student_code using errcode = '23505';
  end if;

  orig_deleted_at := student.deleted_at;

  update public.students
  set
    deleted_at = null,
    deleted_by = null,
    delete_reason = null,
    purge_after = null,
    updated_at = pg_catalog.now()
  where id = student.id
  returning * into student;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    student.id,
    'STUDENT_RESTORED',
    jsonb_build_object(
      'record_type', 'STUDENT',
      'action', 'RESTORE',
      'actor_role', actor.role,
      'student_id', student.id,
      'student_code', student.student_code,
      'original_deleted_at', orig_deleted_at,
      'restored_at', pg_catalog.now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'student_id', student.id,
    'status', student.status,
    'restored_at', pg_catalog.now()
  );
end;
$function$;

-- 5.2 restore_trashed_guardian
create or replace function public.restore_trashed_guardian(
  p_guardian_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor_id uuid := auth.uid();
  actor public.profiles%rowtype;
  guardian public.guardians%rowtype;
  orig_deleted_at timestamptz;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role <> 'ADMIN' then
    raise exception 'Only administrators can restore guardians from Trash.' using errcode = '42501';
  end if;

  select * into guardian from public.guardians where id = p_guardian_id for update;
  if not found or guardian.organization_id <> actor.organization_id or guardian.school_id <> actor.school_id then
    raise exception 'Guardian not found in your authorized school scope.' using errcode = '42501';
  end if;

  if guardian.deleted_at is null then
    raise exception 'Guardian is not in Trash.' using errcode = '22023';
  end if;

  if guardian.is_tombstoned then
    raise exception 'Tombstoned guardians cannot be restored.' using errcode = '22023';
  end if;

  if guardian.purge_after is not null and guardian.purge_after <= pg_catalog.now() then
    raise exception 'The 30-day recovery window for this record has expired.' using errcode = '22023';
  end if;

  orig_deleted_at := guardian.deleted_at;

  update public.guardians
  set
    deleted_at = null,
    deleted_by = null,
    delete_reason = null,
    purge_after = null,
    updated_at = pg_catalog.now()
  where id = guardian.id
  returning * into guardian;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    guardian.id,
    'GUARDIAN_RESTORED',
    jsonb_build_object(
      'record_type', 'GUARDIAN',
      'action', 'RESTORE',
      'actor_role', actor.role,
      'guardian_id', guardian.id,
      'original_deleted_at', orig_deleted_at,
      'restored_at', pg_catalog.now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'guardian_id', guardian.id,
    'restored_at', pg_catalog.now()
  );
end;
$function$;

-- 5.3 restore_trashed_communication
create or replace function public.restore_trashed_communication(
  p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor_id uuid := auth.uid();
  actor public.profiles%rowtype;
  msg public.communication_messages%rowtype;
  orig_deleted_at timestamptz;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role <> 'ADMIN' then
    raise exception 'Only administrators can restore communication messages from Trash.' using errcode = '42501';
  end if;

  select * into msg from public.communication_messages where id = p_message_id for update;
  if not found or msg.organization_id <> actor.organization_id or msg.school_id <> actor.school_id then
    raise exception 'Communication message not found in your school scope.' using errcode = '42501';
  end if;

  if msg.deleted_at is null then
    raise exception 'Message is not in Trash.' using errcode = '22023';
  end if;

  if msg.is_tombstoned then
    raise exception 'Tombstoned messages cannot be restored.' using errcode = '22023';
  end if;

  if msg.purge_after is not null and msg.purge_after <= pg_catalog.now() then
    raise exception 'The 30-day recovery window for this record has expired.' using errcode = '22023';
  end if;

  orig_deleted_at := msg.deleted_at;

  update public.communication_messages
  set
    deleted_at = null,
    deleted_by = null,
    delete_reason = null,
    purge_after = null,
    updated_at = pg_catalog.now()
  where id = msg.id
  returning * into msg;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    msg.id,
    'COMMUNICATION_DRAFT_RESTORED',
    jsonb_build_object(
      'record_type', 'COMMUNICATION_DRAFT',
      'action', 'RESTORE',
      'actor_role', actor.role,
      'message_id', msg.id,
      'original_deleted_at', orig_deleted_at,
      'restored_at', pg_catalog.now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'message_id', msg.id,
    'restored_at', pg_catalog.now()
  );
end;
$function$;

-- ============================================================================
-- 6. RPC: GET TRASHED RECORDS (Admin Trash Directory)
-- ============================================================================

create or replace function public.get_trashed_records(
  p_record_type text default 'ALL'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor_id uuid := auth.uid();
  actor public.profiles%rowtype;
  norm_type text := upper(btrim(coalesce(p_record_type, 'ALL')));
  result jsonb := '[]'::jsonb;
  student_items jsonb := '[]'::jsonb;
  guardian_items jsonb := '[]'::jsonb;
  comm_items jsonb := '[]'::jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role <> 'ADMIN' then
    raise exception 'Only administrators can view the Trash directory.' using errcode = '42501';
  end if;

  -- 1. Students
  if norm_type in ('ALL', 'STUDENTS', 'STUDENT') then
    select coalesce(jsonb_agg(item order by item->>'deleted_at' desc), '[]'::jsonb)
    into student_items
    from (
      select jsonb_build_object(
        'id', s.id,
        'record_type', 'STUDENT',
        'name', s.first_name || ' ' || s.last_name,
        'identifier', s.student_code,
        'detail', s.class_name || '-' || s.section || coalesce(' · Roll ' || s.roll_number, ''),
        'deleted_at', s.deleted_at,
        'deleted_by', s.deleted_by,
        'deleted_by_name', coalesce(p.full_name, 'School Administrator'),
        'delete_reason', s.delete_reason,
        'purge_after', s.purge_after,
        'days_remaining', greatest(0, ceil(extract(epoch from (s.purge_after - pg_catalog.now())) / 86400)),
        'is_tombstoned', s.is_tombstoned
      ) as item
      from public.students s
      left join public.profiles p on p.id = s.deleted_by
      where s.organization_id = actor.organization_id
        and s.school_id = actor.school_id
        and s.deleted_at is not null
        and not s.is_tombstoned
    ) q;
  end if;

  -- 2. Guardians
  if norm_type in ('ALL', 'GUARDIANS', 'GUARDIAN') then
    select coalesce(jsonb_agg(item order by item->>'deleted_at' desc), '[]'::jsonb)
    into guardian_items
    from (
      select jsonb_build_object(
        'id', g.id,
        'record_type', 'GUARDIAN',
        'name', g.first_name || ' ' || g.last_name,
        'identifier', coalesce(g.phone, g.email, 'Guardian'),
        'detail', coalesce(g.relationship, 'Guardian') || coalesce(' · ' || g.phone, ''),
        'deleted_at', g.deleted_at,
        'deleted_by', g.deleted_by,
        'deleted_by_name', coalesce(p.full_name, 'School Administrator'),
        'delete_reason', g.delete_reason,
        'purge_after', g.purge_after,
        'days_remaining', greatest(0, ceil(extract(epoch from (g.purge_after - pg_catalog.now())) / 86400)),
        'is_tombstoned', g.is_tombstoned
      ) as item
      from public.guardians g
      left join public.profiles p on p.id = g.deleted_by
      where g.organization_id = actor.organization_id
        and g.school_id = actor.school_id
        and g.deleted_at is not null
        and not g.is_tombstoned
    ) q;
  end if;

  -- 3. Communication Drafts
  if norm_type in ('ALL', 'COMMUNICATIONS', 'COMMUNICATION', 'DRAFTS', 'DRAFT') then
    select coalesce(jsonb_agg(item order by item->>'deleted_at' desc), '[]'::jsonb)
    into comm_items
    from (
      select jsonb_build_object(
        'id', m.id,
        'record_type', 'COMMUNICATION_DRAFT',
        'name', m.message_type || ' (' || m.channel || ')',
        'identifier', substring(m.id::text from 1 for 8),
        'detail', substring(m.body from 1 for 60) || case when length(m.body) > 60 then '…' else '' end,
        'deleted_at', m.deleted_at,
        'deleted_by', m.deleted_by,
        'deleted_by_name', coalesce(p.full_name, 'School Staff'),
        'delete_reason', m.delete_reason,
        'purge_after', m.purge_after,
        'days_remaining', greatest(0, ceil(extract(epoch from (m.purge_after - pg_catalog.now())) / 86400)),
        'is_tombstoned', m.is_tombstoned
      ) as item
      from public.communication_messages m
      left join public.profiles p on p.id = m.deleted_by
      where m.organization_id = actor.organization_id
        and m.school_id = actor.school_id
        and m.deleted_at is not null
        and not m.is_tombstoned
    ) q;
  end if;

  result := student_items || guardian_items || comm_items;
  return result;
end;
$function$;

-- ============================================================================
-- 7. RPC: AUTOMATED CLEANUP (Physical Delete vs. Irreversible Tombstone)
-- Strictly accessible ONLY to internal scheduled/maintenance contexts.
-- ============================================================================

create or replace function public.purge_expired_trash_records()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  s_row public.students%rowtype;
  g_row public.guardians%rowtype;
  m_row public.communication_messages%rowtype;
  v_has_dependencies boolean;
  v_students_purged int := 0;
  v_students_tombstoned int := 0;
  v_guardians_purged int := 0;
  v_guardians_tombstoned int := 0;
  v_comms_purged int := 0;
  v_comms_tombstoned int := 0;
begin
  -- -------------------------------------------------------------------------
  -- 1. PURGE EXPIRED STUDENTS (purge_after <= now())
  -- -------------------------------------------------------------------------
  for s_row in
    select * from public.students
    where deleted_at is not null
      and not is_tombstoned
      and purge_after is not null
      and purge_after <= v_now
    for update
  loop
    -- Check for protected dependencies:
    -- 1. fee_invoices
    -- 2. fee_payments
    -- 3. attendance_records
    -- 4. sent communication messages
    select exists (
      select 1 from public.fee_invoices fi where fi.student_id = s_row.id
      union all
      select 1 from public.fee_payments fp where fp.student_id = s_row.id
      union all
      select 1 from public.attendance_records ar where ar.student_id = s_row.id
      union all
      select 1 from public.communication_messages cm where cm.student_id = s_row.id and cm.status = 'SENT'
    ) into v_has_dependencies;

    if v_has_dependencies then
      -- IRREVERSIBLE TOMBSTONE: Anonymize personal details, preserve immutable identifiers
      -- Note: student_code is preserved to prevent unique constraint conflicts while keeping FK history intact
      update public.students
      set
        first_name = 'Deleted',
        last_name = 'Student',
        roll_number = null,
        date_of_birth = null,
        gender = null,
        status = 'ARCHIVED',
        is_tombstoned = true,
        purge_after = null,
        archive_reason = 'Permanently purged: personal data tombstoned due to historical ledger/attendance retention',
        updated_at = v_now
      where id = s_row.id;

      -- Sever links in student_guardians junction table
      delete from public.student_guardians where student_id = s_row.id;

      v_students_tombstoned := v_students_tombstoned + 1;

      insert into public.user_management_audit (
        actor_id, target_id, event_type, details
      )
      values (
        coalesce(s_row.deleted_by, s_row.id),
        s_row.id,
        'RECORD_TOMBSTONED',
        jsonb_build_object(
          'record_type', 'STUDENT',
          'action', 'TOMBSTONE',
          'student_id', s_row.id,
          'student_code', s_row.student_code,
          'reason', 'Expired 30-day recovery window; historical ledger/attendance dependencies retained.'
        )
      );
    else
      -- ZERO DEPENDENCIES: Safe to physically delete
      delete from public.student_guardians where student_id = s_row.id;
      delete from public.alerts where student_id = s_row.id;
      delete from public.communication_messages where student_id = s_row.id;
      delete from public.students where id = s_row.id;

      v_students_purged := v_students_purged + 1;

      insert into public.user_management_audit (
        actor_id, target_id, event_type, details
      )
      values (
        coalesce(s_row.deleted_by, s_row.id),
        s_row.id,
        'RECORD_PERMANENTLY_DELETED',
        jsonb_build_object(
          'record_type', 'STUDENT',
          'action', 'PERMANENT_DELETE',
          'student_id', s_row.id,
          'student_code', s_row.student_code,
          'reason', 'Expired 30-day recovery window; zero historical dependencies found.'
        )
      );
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- 2. PURGE EXPIRED GUARDIANS (purge_after <= now())
  -- -------------------------------------------------------------------------
  for g_row in
    select * from public.guardians
    where deleted_at is not null
      and not is_tombstoned
      and purge_after is not null
      and purge_after <= v_now
    for update
  loop
    -- Check for dependencies in communication_recipients
    select exists (
      select 1 from public.communication_recipients cr where cr.guardian_id = g_row.id
      union all
      select 1 from public.student_guardians sg where sg.guardian_id = g_row.id
    ) into v_has_dependencies;

    if v_has_dependencies then
      -- IRREVERSIBLE TOMBSTONE
      update public.guardians
      set
        first_name = 'Deleted',
        last_name = 'Guardian',
        phone = null,
        email = null,
        address = null,
        relationship = null,
        is_tombstoned = true,
        purge_after = null,
        archive_reason = 'Permanently purged: personal data tombstoned',
        updated_at = v_now
      where id = g_row.id;

      -- Sever remaining student links if any trashed students still refer
      delete from public.student_guardians where guardian_id = g_row.id;

      v_guardians_tombstoned := v_guardians_tombstoned + 1;

      insert into public.user_management_audit (
        actor_id, target_id, event_type, details
      )
      values (
        coalesce(g_row.deleted_by, g_row.id),
        g_row.id,
        'RECORD_TOMBSTONED',
        jsonb_build_object(
          'record_type', 'GUARDIAN',
          'action', 'TOMBSTONE',
          'guardian_id', g_row.id,
          'reason', 'Expired 30-day recovery window; historical communication recipient references retained.'
        )
      );
    else
      delete from public.guardians where id = g_row.id;
      v_guardians_purged := v_guardians_purged + 1;

      insert into public.user_management_audit (
        actor_id, target_id, event_type, details
      )
      values (
        coalesce(g_row.deleted_by, g_row.id),
        g_row.id,
        'RECORD_PERMANENTLY_DELETED',
        jsonb_build_object(
          'record_type', 'GUARDIAN',
          'action', 'PERMANENT_DELETE',
          'guardian_id', g_row.id,
          'reason', 'Expired 30-day recovery window; zero historical dependencies found.'
        )
      );
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- 3. PURGE EXPIRED COMMUNICATION DRAFTS (purge_after <= now())
  -- -------------------------------------------------------------------------
  for m_row in
    select * from public.communication_messages
    where deleted_at is not null
      and not is_tombstoned
      and purge_after is not null
      and purge_after <= v_now
    for update
  loop
    -- Check if immutable communication_events exist
    select exists (
      select 1 from public.communication_events ce where ce.message_id = m_row.id
    ) into v_has_dependencies;

    if v_has_dependencies then
      -- IRREVERSIBLE TOMBSTONE: Anonymize body, preserve event log continuity
      update public.communication_messages
      set
        body = '[Draft message deleted and purged]',
        is_tombstoned = true,
        purge_after = null,
        updated_at = v_now
      where id = m_row.id;

      v_comms_tombstoned := v_comms_tombstoned + 1;

      insert into public.user_management_audit (
        actor_id, target_id, event_type, details
      )
      values (
        coalesce(m_row.deleted_by, m_row.id),
        m_row.id,
        'RECORD_TOMBSTONED',
        jsonb_build_object(
          'record_type', 'COMMUNICATION_DRAFT',
          'action', 'TOMBSTONE',
          'message_id', m_row.id,
          'reason', 'Expired 30-day recovery window; immutable communication event audit history retained.'
        )
      );
    else
      delete from public.communication_recipients where message_id = m_row.id;
      delete from public.communication_messages where id = m_row.id;
      v_comms_purged := v_comms_purged + 1;

      insert into public.user_management_audit (
        actor_id, target_id, event_type, details
      )
      values (
        coalesce(m_row.deleted_by, m_row.id),
        m_row.id,
        'RECORD_PERMANENTLY_DELETED',
        jsonb_build_object(
          'record_type', 'COMMUNICATION_DRAFT',
          'action', 'PERMANENT_DELETE',
          'message_id', m_row.id,
          'reason', 'Expired 30-day recovery window; zero event history found.'
        )
      );
    end if;
  end loop;

  -- Overall purge execution log
  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'TRASH_PURGE_EXECUTED',
    jsonb_build_object(
      'timestamp', v_now,
      'students_purged', v_students_purged,
      'students_tombstoned', v_students_tombstoned,
      'guardians_purged', v_guardians_purged,
      'guardians_tombstoned', v_guardians_tombstoned,
      'comms_purged', v_comms_purged,
      'comms_tombstoned', v_comms_tombstoned
    )
  );

  return jsonb_build_object(
    'success', true,
    'executed_at', v_now,
    'students_purged', v_students_purged,
    'students_tombstoned', v_students_tombstoned,
    'guardians_purged', v_guardians_purged,
    'guardians_tombstoned', v_guardians_tombstoned,
    'comms_purged', v_comms_purged,
    'comms_tombstoned', v_comms_tombstoned
  );
end;
$function$;

-- ============================================================================
-- 8. FUNCTION PERMISSIONS & GRANTS
-- ============================================================================

-- Revoke all from PUBLIC and anon for all functions
revoke all on function public.trash_student(uuid, text) from public, anon;
revoke all on function public.trash_guardian(uuid, text) from public, anon;
revoke all on function public.trash_communication_draft(uuid, text) from public, anon;
revoke all on function public.delete_communication_draft(uuid, text) from public, anon;
revoke all on function public.get_trashed_records(text) from public, anon;
revoke all on function public.restore_trashed_student(uuid) from public, anon;
revoke all on function public.restore_trashed_guardian(uuid) from public, anon;
revoke all on function public.restore_trashed_communication(uuid) from public, anon;

-- Grant user RPCs to authenticated
grant execute on function public.trash_student(uuid, text) to authenticated;
grant execute on function public.trash_guardian(uuid, text) to authenticated;
grant execute on function public.trash_communication_draft(uuid, text) to authenticated;
grant execute on function public.delete_communication_draft(uuid, text) to authenticated;
grant execute on function public.get_trashed_records(text) to authenticated;
grant execute on function public.restore_trashed_student(uuid) to authenticated;
grant execute on function public.restore_trashed_guardian(uuid) to authenticated;
grant execute on function public.restore_trashed_communication(uuid) to authenticated;

-- STRICT: revoke purge_expired_trash_records from ALL users including authenticated!
revoke all on function public.purge_expired_trash_records() from public, anon, authenticated;

-- ============================================================================
-- 9. PG_CRON SCHEDULER (Safe conditional invocation)
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule(
        'camvia-daily-trash-purge',
        '0 3 * * *', -- Daily at 03:00 AM UTC
        'select public.purge_expired_trash_records();'
      );
      raise notice 'pg_cron job camvia-daily-trash-purge scheduled successfully.';
    exception when others then
      raise notice 'Scheduling pg_cron job failed: %, continuing migration safely.', sqlerrm;
    end;
  elsif exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule(
        'camvia-daily-trash-purge',
        '0 3 * * *',
        'select public.purge_expired_trash_records();'
      );
      raise notice 'pg_cron extension created and job scheduled successfully.';
    exception when others then
      raise notice 'Creating/scheduling pg_cron failed: %, continuing migration safely.', sqlerrm;
    end;
  else
    raise notice 'pg_cron extension is not available in this environment. Purge will run via external server worker.';
  end if;
end;
$$;

commit;
