-- Migration 024: Role-Based Corrections, Safe Archival, and Void Controls
-- Enforces atomic, audited operations across ADMIN, PRINCIPAL, TEACHER, and FINANCE.
-- Strict tenant isolation, no global row_security = off, preserves historical financial and attendance records.

begin;

-- ============================================================================
-- 1. EXTEND USER_MANAGEMENT_AUDIT EVENT_TYPE CHECK
-- Preserves all 6 existing event types and adds 11 new Migration 024 event types (17 total).
-- ============================================================================
do $reconcile_audit_check$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.user_management_audit'::regclass
      and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) like '%event_type%'
  loop
    execute format(
      'alter table public.user_management_audit drop constraint if exists %I',
      constraint_record.conname
    );
  end loop;

  alter table public.user_management_audit
    add constraint user_management_audit_event_type_check
    check (event_type in (
      -- 6 Existing event types
      'STUDENT_CREATED',
      'USER_CREATED',
      'USER_UPDATED',
      'USER_ROLE_CHANGED',
      'USER_DEACTIVATED',
      'INVOICE_CREATED',
      -- 11 New Migration 024 event types
      'STUDENT_UPDATED',
      'STUDENT_ARCHIVED',
      'GUARDIAN_UPDATED',
      'GUARDIAN_LINKED',
      'GUARDIAN_UNLINKED',
      'GUARDIAN_ARCHIVED',
      'ATTENDANCE_CORRECTED',
      'FEE_INVOICE_UPDATED',
      'FEE_INVOICE_VOIDED',
      'FEE_PAYMENT_VOIDED',
      'COMMUNICATION_DRAFT_DELETED'
    ));
end;
$reconcile_audit_check$;

-- ============================================================================
-- 2. SCHEMA EVOLUTION FOR ARCHIVAL AND VOID METADATA
-- ============================================================================

-- 2.1 Students Archival Metadata & Status Check
alter table public.students drop constraint if exists students_status_check;
alter table public.students add constraint students_status_check
  check (status in ('ACTIVE', 'INACTIVE', 'ALUMNI', 'ARCHIVED'));

alter table public.students
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null references public.profiles(id),
  add column if not exists archive_reason text null;

-- 2.2 Guardians Soft Archival Metadata
alter table public.guardians
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null references public.profiles(id),
  add column if not exists archive_reason text null;

-- 2.3 Fee Invoices Void Metadata (No status column invented)
alter table public.fee_invoices
  add column if not exists voided_at timestamptz null,
  add column if not exists voided_by uuid null references public.profiles(id),
  add column if not exists void_reason text null;

-- 2.4 Fee Payments Void Metadata (No status column invented)
alter table public.fee_payments
  add column if not exists voided_at timestamptz null,
  add column if not exists voided_by uuid null references public.profiles(id),
  add column if not exists void_reason text null;

-- ============================================================================
-- 3. ATOMIC SECURITY DEFINER RPC FUNCTIONS
-- All functions run with search_path = pg_catalog, public, auth without row_security = off.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RPC 1: update_student
-- ----------------------------------------------------------------------------
create or replace function public.update_student(
  p_student_id uuid,
  p_campus_id uuid,
  p_first_name text,
  p_last_name text,
  p_class_name text,
  p_section text,
  p_roll_number text,
  p_date_of_birth date,
  p_gender text,
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
  norm_first_name text := btrim(coalesce(p_first_name, ''));
  norm_last_name text := btrim(coalesce(p_last_name, ''));
  norm_class_name text := btrim(coalesce(p_class_name, ''));
  norm_section text := btrim(coalesce(p_section, ''));
  norm_roll_number text := btrim(coalesce(p_roll_number, ''));
  norm_gender text := btrim(coalesce(p_gender, ''));
  norm_reason text := btrim(coalesce(p_reason, ''));
  before_state jsonb;
  after_state jsonb;
  changed_fields jsonb := '[]'::jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found then
    raise exception 'An active user profile is required.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'An edit reason is required.' using errcode = '22023';
  end if;

  select * into student from public.students where id = p_student_id for update;
  if not found or student.organization_id <> actor.organization_id or student.school_id <> actor.school_id then
    raise exception 'Student not found in your authorized school scope.' using errcode = '42501';
  end if;

  if student.status = 'ARCHIVED' then
    raise exception 'Cannot modify an archived student.' using errcode = '22023';
  end if;

  -- Validate campus
  if p_campus_id is distinct from student.campus_id then
    if actor.role = 'TEACHER' then
      raise exception 'Teachers cannot change student campus.' using errcode = '42501';
    end if;

    if not exists (
      select 1 from public.campuses
      where id = p_campus_id
        and organization_id = actor.organization_id
        and school_id = actor.school_id
        and status = 'ACTIVE'
    ) then
      raise exception 'The destination campus is invalid or outside the active school scope.' using errcode = '22023';
    end if;
  end if;

  -- Role-specific field modifications
  if actor.role = 'FINANCE' then
    raise exception 'Finance accounts cannot modify student records.' using errcode = '42501';

  elsif actor.role = 'TEACHER' then
    -- Verify teacher active class assignment using public.teacher_class_assignments
    if not exists (
      select 1 from public.teacher_class_assignments
      where user_id = actor.id
        and school_id = actor.school_id
        and campus_id = student.campus_id
        and class_name = student.class_name
        and section = student.section
        and active = true
    ) then
      raise exception 'Teacher is not actively assigned to this student class.' using errcode = '42501';
    end if;

    -- Teachers can ONLY modify roll_number
    if norm_first_name <> student.first_name
      or norm_last_name <> student.last_name
      or norm_class_name <> student.class_name
      or norm_section <> student.section
      or p_campus_id is distinct from student.campus_id
      or p_date_of_birth is distinct from student.date_of_birth
      or norm_gender <> coalesce(student.gender, '')
    then
      raise exception 'Teachers may only correct student roll numbers.' using errcode = '42501';
    end if;

  elsif actor.role = 'PRINCIPAL' then
    -- Principals cannot modify identity fields
    if norm_first_name <> student.first_name
      or norm_last_name <> student.last_name
      or p_date_of_birth is distinct from student.date_of_birth
      or norm_gender <> coalesce(student.gender, '')
    then
      raise exception 'Principals cannot modify student identity fields.' using errcode = '42501';
    end if;

    if norm_class_name = '' or norm_section = '' then
      raise exception 'Class and section cannot be empty.' using errcode = '22023';
    end if;

  elsif actor.role = 'ADMIN' then
    if norm_first_name = '' or norm_last_name = '' or norm_class_name = '' or norm_section = '' then
      raise exception 'First name, last name, class, and section cannot be empty.' using errcode = '22023';
    end if;
  else
    raise exception 'Insufficient privileges to edit student.' using errcode = '42501';
  end if;

  before_state := jsonb_build_object(
    'campus_id', student.campus_id,
    'first_name', student.first_name,
    'last_name', student.last_name,
    'class_name', student.class_name,
    'section', student.section,
    'roll_number', student.roll_number,
    'date_of_birth', student.date_of_birth,
    'gender', student.gender
  );

  update public.students
  set
    campus_id = p_campus_id,
    first_name = norm_first_name,
    last_name = norm_last_name,
    class_name = norm_class_name,
    section = norm_section,
    roll_number = nullif(norm_roll_number, ''),
    date_of_birth = p_date_of_birth,
    gender = nullif(norm_gender, ''),
    updated_at = pg_catalog.now()
  where id = student.id
  returning * into student;

  after_state := jsonb_build_object(
    'campus_id', student.campus_id,
    'first_name', student.first_name,
    'last_name', student.last_name,
    'class_name', student.class_name,
    'section', student.section,
    'roll_number', student.roll_number,
    'date_of_birth', student.date_of_birth,
    'gender', student.gender
  );

  select jsonb_agg(key) into changed_fields
  from jsonb_each(before_state) as b(key, val)
  where b.val is distinct from after_state->b.key;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    student.id,
    'STUDENT_UPDATED',
    jsonb_build_object(
      'record_type', 'STUDENT',
      'action', 'UPDATE',
      'actor_role', actor.role,
      'reason', norm_reason,
      'before_state', before_state,
      'after_state', after_state,
      'changed_fields', coalesce(changed_fields, '[]'::jsonb)
    )
  );

  return jsonb_build_object('success', true, 'student_id', student.id);
end;
$function$;

-- ----------------------------------------------------------------------------
-- RPC 2: archive_student
-- ----------------------------------------------------------------------------
create or replace function public.archive_student(
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
  before_state jsonb;
  after_state jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role <> 'ADMIN' then
    raise exception 'Only administrators can archive students.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'A reason is required to archive a student.' using errcode = '22023';
  end if;

  select * into student from public.students where id = p_student_id for update;
  if not found or student.organization_id <> actor.organization_id or student.school_id <> actor.school_id then
    raise exception 'Student not found in your authorized school scope.' using errcode = '42501';
  end if;

  if student.status = 'ARCHIVED' then
    raise exception 'Student is already archived.' using errcode = '22023';
  end if;

  before_state := jsonb_build_object('status', student.status);

  update public.students
  set
    status = 'ARCHIVED',
    archived_at = pg_catalog.now(),
    archived_by = actor.id,
    archive_reason = norm_reason,
    updated_at = pg_catalog.now()
  where id = student.id
  returning * into student;

  after_state := jsonb_build_object(
    'status', student.status,
    'archived_at', student.archived_at,
    'archived_by', student.archived_by,
    'archive_reason', student.archive_reason
  );

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    student.id,
    'STUDENT_ARCHIVED',
    jsonb_build_object(
      'record_type', 'STUDENT',
      'action', 'ARCHIVE',
      'actor_role', actor.role,
      'reason', norm_reason,
      'before_state', before_state,
      'after_state', after_state
    )
  );

  return jsonb_build_object('success', true, 'student_id', student.id, 'status', 'ARCHIVED');
end;
$function$;

-- ----------------------------------------------------------------------------
-- RPC 3: update_guardian
-- ----------------------------------------------------------------------------
create or replace function public.update_guardian(
  p_guardian_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_address text,
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
  norm_first_name text := btrim(coalesce(p_first_name, ''));
  norm_last_name text := btrim(coalesce(p_last_name, ''));
  norm_phone text := btrim(coalesce(p_phone, ''));
  norm_email text := btrim(coalesce(p_email, ''));
  norm_address text := btrim(coalesce(p_address, ''));
  norm_reason text := btrim(coalesce(p_reason, ''));
  before_state jsonb;
  after_state jsonb;
  changed_fields jsonb := '[]'::jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role not in ('ADMIN', 'PRINCIPAL') then
    raise exception 'Only administrators and principals can update guardians.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'A reason is required to update guardian details.' using errcode = '22023';
  end if;

  select * into guardian from public.guardians where id = p_guardian_id for update;
  if not found or guardian.organization_id <> actor.organization_id or guardian.school_id <> actor.school_id then
    raise exception 'Guardian not found in your authorized school scope.' using errcode = '42501';
  end if;

  if guardian.archived_at is not null then
    raise exception 'Cannot modify an archived guardian.' using errcode = '22023';
  end if;

  if actor.role = 'PRINCIPAL' then
    if norm_first_name <> guardian.first_name or norm_last_name <> guardian.last_name then
      raise exception 'Principals may only update guardian contact information.' using errcode = '42501';
    end if;
  elsif actor.role = 'ADMIN' then
    if norm_first_name = '' or norm_last_name = '' then
      raise exception 'Guardian first and last names cannot be empty.' using errcode = '22023';
    end if;
  end if;

  before_state := jsonb_build_object(
    'first_name', guardian.first_name,
    'last_name', guardian.last_name,
    'phone', guardian.phone,
    'email', guardian.email,
    'address', guardian.address
  );

  update public.guardians
  set
    first_name = norm_first_name,
    last_name = norm_last_name,
    phone = nullif(norm_phone, ''),
    email = nullif(norm_email, ''),
    address = nullif(norm_address, ''),
    updated_at = pg_catalog.now()
  where id = guardian.id
  returning * into guardian;

  after_state := jsonb_build_object(
    'first_name', guardian.first_name,
    'last_name', guardian.last_name,
    'phone', guardian.phone,
    'email', guardian.email,
    'address', guardian.address
  );

  select jsonb_agg(key) into changed_fields
  from jsonb_each(before_state) as b(key, val)
  where b.val is distinct from after_state->b.key;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    guardian.id,
    'GUARDIAN_UPDATED',
    jsonb_build_object(
      'record_type', 'GUARDIAN',
      'action', 'UPDATE',
      'actor_role', actor.role,
      'reason', norm_reason,
      'before_state', before_state,
      'after_state', after_state,
      'changed_fields', coalesce(changed_fields, '[]'::jsonb)
    )
  );

  return jsonb_build_object('success', true, 'guardian_id', guardian.id);
end;
$function$;

-- ----------------------------------------------------------------------------
-- RPC 4: unlink_student_guardian
-- ----------------------------------------------------------------------------
create or replace function public.unlink_student_guardian(
  p_student_id uuid,
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
  student public.students%rowtype;
  guardian public.guardians%rowtype;
  norm_reason text := btrim(coalesce(p_reason, ''));
  remaining_links_count integer;
  guardian_archived boolean := false;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role <> 'ADMIN' then
    raise exception 'Only administrators can manage guardian links.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'A reason is required to unlink a guardian.' using errcode = '22023';
  end if;

  select * into student from public.students where id = p_student_id;
  if not found or student.organization_id <> actor.organization_id or student.school_id <> actor.school_id then
    raise exception 'Student not found in your authorized school scope.' using errcode = '42501';
  end if;

  select * into guardian from public.guardians where id = p_guardian_id;
  if not found or guardian.organization_id <> actor.organization_id or guardian.school_id <> actor.school_id then
    raise exception 'Guardian not found in your authorized school scope.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.student_guardians
    where student_id = p_student_id and guardian_id = p_guardian_id
  ) then
    raise exception 'Relationship between this student and guardian does not exist.' using errcode = '22023';
  end if;

  delete from public.student_guardians
  where student_id = p_student_id and guardian_id = p_guardian_id;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    p_student_id,
    'GUARDIAN_UNLINKED',
    jsonb_build_object(
      'record_type', 'STUDENT_GUARDIAN',
      'action', 'UNLINK',
      'actor_role', actor.role,
      'guardian_id', p_guardian_id,
      'reason', norm_reason
    )
  );

  -- Check if guardian has zero remaining active student relationships
  select count(*)::integer into remaining_links_count
  from public.student_guardians
  where guardian_id = p_guardian_id;

  if remaining_links_count = 0 and guardian.archived_at is null then
    update public.guardians
    set
      archived_at = pg_catalog.now(),
      archived_by = actor.id,
      archive_reason = 'Auto-archived: all student relationships removed',
      updated_at = pg_catalog.now()
    where id = p_guardian_id;

    guardian_archived := true;

    insert into public.user_management_audit (
      actor_id, target_id, event_type, details
    )
    values (
      actor.id,
      p_guardian_id,
      'GUARDIAN_ARCHIVED',
      jsonb_build_object(
        'record_type', 'GUARDIAN',
        'action', 'ARCHIVE',
        'actor_role', actor.role,
        'reason', 'Auto-archived: all student relationships unlinked'
      )
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'guardian_id', p_guardian_id,
    'guardian_archived', guardian_archived
  );
end;
$function$;

-- ----------------------------------------------------------------------------
-- RPC 5: link_student_guardian
-- ----------------------------------------------------------------------------
create or replace function public.link_student_guardian(
  p_student_id uuid,
  p_guardian_id uuid,
  p_relationship text,
  p_is_primary boolean,
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
  guardian public.guardians%rowtype;
  norm_relationship text := btrim(coalesce(p_relationship, ''));
  norm_reason text := btrim(coalesce(p_reason, ''));
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role <> 'ADMIN' then
    raise exception 'Only administrators can link guardians.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'A reason is required to link a guardian.' using errcode = '22023';
  end if;

  select * into student from public.students where id = p_student_id;
  if not found or student.organization_id <> actor.organization_id or student.school_id <> actor.school_id then
    raise exception 'Student not found in your authorized school scope.' using errcode = '42501';
  end if;

  if student.status = 'ARCHIVED' then
    raise exception 'Cannot link a guardian to an archived student.' using errcode = '22023';
  end if;

  select * into guardian from public.guardians where id = p_guardian_id;
  if not found or guardian.organization_id <> actor.organization_id or guardian.school_id <> actor.school_id then
    raise exception 'Guardian not found in your authorized school scope.' using errcode = '42501';
  end if;

  if guardian.archived_at is not null then
    -- Unarchive guardian upon re-linking
    update public.guardians
    set archived_at = null, archived_by = null, archive_reason = null, updated_at = pg_catalog.now()
    where id = guardian.id;
  end if;

  if p_is_primary then
    update public.student_guardians
    set is_primary = false
    where student_id = p_student_id;
  end if;

  insert into public.student_guardians (
    student_id, guardian_id, relationship, is_primary
  )
  values (
    p_student_id, p_guardian_id, nullif(norm_relationship, ''), coalesce(p_is_primary, false)
  )
  on conflict (student_id, guardian_id)
  do update set
    relationship = excluded.relationship,
    is_primary = excluded.is_primary;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    p_student_id,
    'GUARDIAN_LINKED',
    jsonb_build_object(
      'record_type', 'STUDENT_GUARDIAN',
      'action', 'LINK',
      'actor_role', actor.role,
      'guardian_id', p_guardian_id,
      'relationship', norm_relationship,
      'is_primary', coalesce(p_is_primary, false),
      'reason', norm_reason
    )
  );

  return jsonb_build_object('success', true, 'student_id', p_student_id, 'guardian_id', p_guardian_id);
end;
$function$;

-- ----------------------------------------------------------------------------
-- RPC 6: correct_attendance_session
-- ----------------------------------------------------------------------------
create or replace function public.correct_attendance_session(
  p_session_id uuid,
  p_records jsonb,
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
  session_row public.attendance_sessions%rowtype;
  norm_reason text := btrim(coalesce(p_reason, ''));
  record_entry record;
  student_row public.students%rowtype;
  updated_count integer := 0;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role not in ('ADMIN', 'PRINCIPAL', 'TEACHER') then
    raise exception 'Your role cannot correct attendance.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'A reason is required to correct attendance.' using errcode = '22023';
  end if;

  if p_records is null or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 then
    raise exception 'Attendance correction records must be a non-empty array.' using errcode = '22023';
  end if;

  select * into session_row from public.attendance_sessions where id = p_session_id for update;
  if not found or session_row.organization_id <> actor.organization_id or session_row.school_id <> actor.school_id then
    raise exception 'Attendance session not found in your school scope.' using errcode = '42501';
  end if;

  if actor.role = 'TEACHER' then
    if not exists (
      select 1 from public.teacher_class_assignments
      where user_id = actor.id
        and school_id = actor.school_id
        and campus_id = session_row.campus_id
        and class_name = session_row.class_name
        and section = session_row.section
        and active = true
    ) then
      raise exception 'Teachers may only correct attendance for their assigned classes.' using errcode = '42501';
    end if;
  end if;

  for record_entry in
    select
      (elem->>'student_id')::uuid as student_id,
      upper(btrim(coalesce(elem->>'status', ''))) as status,
      btrim(coalesce(elem->>'note', '')) as note
    from jsonb_array_elements(p_records) as elem
  loop
    if record_entry.student_id is null or record_entry.status not in ('PRESENT', 'ABSENT', 'LATE') then
      raise exception 'Invalid student or status in correction payload.' using errcode = '22023';
    end if;

    select * into student_row from public.students where id = record_entry.student_id;
    if not found
      or student_row.organization_id <> session_row.organization_id
      or student_row.school_id <> session_row.school_id
      or student_row.campus_id <> session_row.campus_id
      or student_row.class_name <> session_row.class_name
      or student_row.section <> session_row.section
    then
      raise exception 'Student does not belong to this attendance session.' using errcode = '22023';
    end if;

    insert into public.attendance_records (
      attendance_session_id, student_id, status, note, marked_by
    )
    values (
      session_row.id, record_entry.student_id, record_entry.status, record_entry.note, actor.id
    )
    on conflict (attendance_session_id, student_id)
    do update set
      status = excluded.status,
      note = excluded.note,
      marked_by = actor.id,
      updated_at = pg_catalog.now();

    updated_count := updated_count + 1;
  end loop;

  update public.attendance_sessions
  set updated_by = actor.id, updated_at = pg_catalog.now()
  where id = session_row.id;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    session_row.id,
    'ATTENDANCE_CORRECTED',
    jsonb_build_object(
      'record_type', 'ATTENDANCE_SESSION',
      'action', 'CORRECT',
      'actor_role', actor.role,
      'reason', norm_reason,
      'records_corrected', updated_count
    )
  );

  return jsonb_build_object('success', true, 'session_id', session_row.id, 'records_updated', updated_count);
end;
$function$;

-- ----------------------------------------------------------------------------
-- RPC 7: update_fee_invoice
-- ----------------------------------------------------------------------------
create or replace function public.update_fee_invoice(
  p_invoice_id uuid,
  p_due_date date,
  p_line_items jsonb,
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
  invoice public.fee_invoices%rowtype;
  norm_reason text := btrim(coalesce(p_reason, ''));
  active_payments_count integer;
  item_entry record;
  before_state jsonb;
  after_state jsonb;
  new_total numeric(12, 2) := 0;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role not in ('ADMIN', 'FINANCE') then
    raise exception 'Only administrators and finance staff can modify invoices.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'A reason is required to update invoice details.' using errcode = '22023';
  end if;

  select * into invoice from public.fee_invoices where id = p_invoice_id for update;
  if not found or invoice.organization_id <> actor.organization_id or invoice.school_id <> actor.school_id then
    raise exception 'Invoice not found in your authorized school scope.' using errcode = '42501';
  end if;

  if invoice.voided_at is not null then
    raise exception 'Cannot update a voided invoice.' using errcode = '22023';
  end if;

  -- Block editing if invoice already has active recorded payments
  select count(*)::integer into active_payments_count
  from public.fee_payments
  where invoice_id = invoice.id and voided_at is null;

  if active_payments_count > 0 then
    raise exception 'Cannot modify an invoice with recorded payments. Void payments first.' using errcode = '22023';
  end if;

  if p_due_date is null or p_due_date < invoice.fee_period then
    raise exception 'Due date cannot be before the fee period.' using errcode = '22023';
  end if;

  if p_line_items is null or jsonb_typeof(p_line_items) <> 'array' or jsonb_array_length(p_line_items) = 0 then
    raise exception 'Invoice must contain at least one line item.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'due_date', invoice.due_date,
    'items', (select jsonb_agg(jsonb_build_object('label', label, 'amount', amount)) from public.fee_invoice_items where invoice_id = invoice.id)
  ) into before_state;

  delete from public.fee_invoice_items where invoice_id = invoice.id;

  for item_entry in
    select
      btrim(coalesce(elem->>'label', elem->>'description', '')) as label,
      (elem->>'amount')::numeric(12, 2) as amount
    from jsonb_array_elements(p_line_items) as elem
  loop
    if item_entry.label = '' or item_entry.amount is null or item_entry.amount <= 0 then
      raise exception 'Each line item must have a non-empty label and positive amount.' using errcode = '22023';
    end if;

    insert into public.fee_invoice_items (invoice_id, label, amount)
    values (invoice.id, item_entry.label, item_entry.amount);

    new_total := new_total + item_entry.amount;
  end loop;

  update public.fee_invoices
  set due_date = p_due_date, updated_at = pg_catalog.now()
  where id = invoice.id
  returning * into invoice;

  after_state := jsonb_build_object(
    'due_date', invoice.due_date,
    'total_amount', new_total,
    'items', p_line_items
  );

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    invoice.id,
    'FEE_INVOICE_UPDATED',
    jsonb_build_object(
      'record_type', 'FEE_INVOICE',
      'action', 'UPDATE',
      'actor_role', actor.role,
      'reason', norm_reason,
      'before_state', before_state,
      'after_state', after_state
    )
  );

  return jsonb_build_object('success', true, 'invoice_id', invoice.id, 'total_amount', new_total);
end;
$function$;

-- ----------------------------------------------------------------------------
-- RPC 8: void_fee_invoice
-- ----------------------------------------------------------------------------
create or replace function public.void_fee_invoice(
  p_invoice_id uuid,
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
  invoice public.fee_invoices%rowtype;
  norm_reason text := btrim(coalesce(p_reason, ''));
  active_payments_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role not in ('ADMIN', 'FINANCE') then
    raise exception 'Only administrators and finance staff can void invoices.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'A reason is required to void an invoice.' using errcode = '22023';
  end if;

  select * into invoice from public.fee_invoices where id = p_invoice_id for update;
  if not found or invoice.organization_id <> actor.organization_id or invoice.school_id <> actor.school_id then
    raise exception 'Invoice not found in your authorized school scope.' using errcode = '42501';
  end if;

  if invoice.voided_at is not null then
    raise exception 'Invoice is already voided.' using errcode = '22023';
  end if;

  select count(*)::integer into active_payments_count
  from public.fee_payments
  where invoice_id = invoice.id and voided_at is null;

  if active_payments_count > 0 then
    raise exception 'Cannot void invoice with active payments. Void payments first.' using errcode = '22023';
  end if;

  update public.fee_invoices
  set
    voided_at = pg_catalog.now(),
    voided_by = actor.id,
    void_reason = norm_reason,
    updated_at = pg_catalog.now()
  where id = invoice.id
  returning * into invoice;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    invoice.id,
    'FEE_INVOICE_VOIDED',
    jsonb_build_object(
      'record_type', 'FEE_INVOICE',
      'action', 'VOID',
      'actor_role', actor.role,
      'reason', norm_reason,
      'voided_at', invoice.voided_at
    )
  );

  return jsonb_build_object('success', true, 'invoice_id', invoice.id, 'voided_at', invoice.voided_at);
end;
$function$;

-- ----------------------------------------------------------------------------
-- RPC 9: void_fee_payment
-- ----------------------------------------------------------------------------
create or replace function public.void_fee_payment(
  p_payment_id uuid,
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
  payment public.fee_payments%rowtype;
  invoice public.fee_invoices%rowtype;
  norm_reason text := btrim(coalesce(p_reason, ''));
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found or actor.role not in ('ADMIN', 'FINANCE') then
    raise exception 'Only administrators and finance staff can void payments.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'A reason is required to void a payment.' using errcode = '22023';
  end if;

  select * into payment from public.fee_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment record not found.' using errcode = '22023';
  end if;

  select * into invoice from public.fee_invoices where id = payment.invoice_id;
  if not found or invoice.organization_id <> actor.organization_id or invoice.school_id <> actor.school_id then
    raise exception 'Payment does not belong to your authorized school scope.' using errcode = '42501';
  end if;

  if payment.voided_at is not null then
    raise exception 'Payment is already voided.' using errcode = '22023';
  end if;

  update public.fee_payments
  set
    voided_at = pg_catalog.now(),
    voided_by = actor.id,
    void_reason = norm_reason
  where id = payment.id
  returning * into payment;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    payment.id,
    'FEE_PAYMENT_VOIDED',
    jsonb_build_object(
      'record_type', 'FEE_PAYMENT',
      'action', 'VOID',
      'actor_role', actor.role,
      'invoice_id', payment.invoice_id,
      'amount', payment.amount,
      'reason', norm_reason,
      'voided_at', payment.voided_at
    )
  );

  return jsonb_build_object('success', true, 'payment_id', payment.id, 'voided_at', payment.voided_at);
end;
$function$;

-- ----------------------------------------------------------------------------
-- RPC 10: delete_communication_draft
-- ----------------------------------------------------------------------------
create or replace function public.delete_communication_draft(
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
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found then
    raise exception 'Active profile required.' using errcode = '42501';
  end if;

  if norm_reason = '' then
    raise exception 'A reason is required to delete a communication draft.' using errcode = '22023';
  end if;

  select * into msg from public.communication_messages where id = p_message_id for update;
  if not found or msg.organization_id <> actor.organization_id or msg.school_id <> actor.school_id then
    raise exception 'Communication message not found in your school scope.' using errcode = '42501';
  end if;

  if msg.status not in ('DRAFT', 'REJECTED') then
    raise exception 'Only draft or rejected communication messages can be removed.' using errcode = '22023';
  end if;

  if actor.role = 'ADMIN' or actor.role = 'PRINCIPAL' then
    null;
  elsif actor.role in ('TEACHER', 'FINANCE') then
    if msg.created_by <> actor.id then
      raise exception 'Staff may only delete drafts they authored.' using errcode = '42501';
    end if;
  else
    raise exception 'Insufficient permissions to delete communication drafts.' using errcode = '42501';
  end if;

  -- Delete associated recipients and events first
  delete from public.communication_recipients where message_id = msg.id;
  delete from public.communication_events where message_id = msg.id;
  delete from public.communication_messages where id = msg.id;

  insert into public.user_management_audit (
    actor_id, target_id, event_type, details
  )
  values (
    actor.id,
    msg.id,
    'COMMUNICATION_DRAFT_DELETED',
    jsonb_build_object(
      'record_type', 'COMMUNICATION_DRAFT',
      'action', 'DELETE_DRAFT',
      'actor_role', actor.role,
      'student_id', msg.student_id,
      'reason', norm_reason
    )
  );

  return jsonb_build_object('success', true, 'message_id', msg.id);
end;
$function$;

-- ============================================================================
-- 4. UPDATE EXISTING OPERATIONAL RPCS FOR ARCHIVED STUDENT LOCK
-- ============================================================================

-- 4.1 Update save_attendance_session to reject archived students
create or replace function public.save_attendance_session(
  target_organization_id uuid,
  target_school_id uuid,
  target_campus_id uuid,
  target_class_name text,
  target_section text,
  target_attendance_date date,
  target_records jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  saved_session_id uuid;
  expected_student_count integer;
  submitted_row_count integer;
  submitted_student_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to save attendance.'
      using errcode = '42501';
  end if;

  if target_attendance_date is null
    or target_attendance_date > current_date
    or nullif(btrim(target_class_name), '') is null
    or nullif(btrim(target_section), '') is null
    or target_records is null
    or jsonb_typeof(target_records) <> 'array'
    or not public.can_manage_attendance_scope(
      target_organization_id,
      target_school_id,
      target_campus_id,
      target_class_name,
      target_section
    )
  then
    raise exception 'The attendance scope or submission is invalid.'
      using errcode = '42501';
  end if;

  -- Operational lock: expected students must be ACTIVE (not ARCHIVED, INACTIVE, or ALUMNI)
  select count(*)::integer
    into expected_student_count
  from public.students as student
  where student.organization_id = target_organization_id
    and student.school_id = target_school_id
    and student.campus_id = target_campus_id
    and student.class_name = target_class_name
    and student.section = target_section
    and student.status = 'ACTIVE';

  select count(*)::integer, count(distinct submitted.student_id)::integer
    into submitted_row_count, submitted_student_count
  from jsonb_to_recordset(target_records)
    as submitted(student_id uuid, status text, note text);

  if expected_student_count = 0
    or submitted_row_count <> expected_student_count
    or submitted_student_count <> expected_student_count
    or exists (
      select 1
      from jsonb_to_recordset(target_records)
        as submitted(student_id uuid, status text, note text)
      left join public.students as student
        on student.id = submitted.student_id
        and student.organization_id = target_organization_id
        and student.school_id = target_school_id
        and student.campus_id = target_campus_id
        and student.class_name = target_class_name
        and student.section = target_section
        and student.status = 'ACTIVE'
      where student.id is null
        or submitted.student_id is null
        or submitted.status is null
        or submitted.status not in ('PRESENT', 'ABSENT', 'LATE')
    )
  then
    raise exception 'Attendance must include exactly one valid status for every active student in the assigned class.'
      using errcode = '22023';
  end if;

  insert into public.attendance_sessions (
    organization_id, school_id, campus_id, class_name, section,
    attendance_date, created_by, updated_by, status
  )
  values (
    target_organization_id, target_school_id, target_campus_id,
    target_class_name, target_section, target_attendance_date,
    auth.uid(), auth.uid(), 'COMPLETED'
  )
  on conflict (
    organization_id, school_id, campus_id, class_name, section,
    attendance_date
  )
  do update set
    updated_by = auth.uid(),
    status = 'COMPLETED',
    updated_at = pg_catalog.now()
  returning id into saved_session_id;

  insert into public.attendance_records (
    attendance_session_id, student_id, status, note, marked_by
  )
  select
    saved_session_id,
    submitted.student_id,
    submitted.status,
    coalesce(submitted.note, ''),
    auth.uid()
  from jsonb_to_recordset(target_records)
    as submitted(student_id uuid, status text, note text)
  on conflict (attendance_session_id, student_id)
  do update set
    status = excluded.status,
    note = excluded.note,
    marked_by = auth.uid(),
    updated_at = pg_catalog.now();

  return saved_session_id;
end;
$function$;

-- 4.2 Update save_communication_draft to reject archived students
create or replace function public.save_communication_draft(
  target_student_id uuid,
  target_guardian_id uuid,
  target_message_type text,
  target_channel text,
  target_body text,
  target_source_type text,
  target_source_id text,
  target_message_id uuid default null,
  target_submit boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor_id uuid := auth.uid();
  actor public.profiles%rowtype;
  student public.students%rowtype;
  existing public.communication_messages%rowtype;
  saved_message_id uuid;
  normalized_source_type text := coalesce(target_source_type, 'STUDENT');
  normalized_source_id text := coalesce(nullif(btrim(target_source_id), ''), target_student_id::text);
  event_action text;
begin
  if actor_id is null then
    raise exception 'Authentication is required to save parent communication.' using errcode = '42501';
  end if;

  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found then
    raise exception 'An active profile is required.' using errcode = '42501';
  end if;

  select * into student from public.students where id = target_student_id;
  if not found
    or student.organization_id <> actor.organization_id
    or student.school_id <> actor.school_id
    or not public.can_access_communication_student(target_student_id)
  then
    raise exception 'The student is outside your authorized communication scope.' using errcode = '42501';
  end if;

  -- Operational lock: cannot initiate communication for an archived student
  if student.status = 'ARCHIVED' then
    raise exception 'Cannot create communication for an archived student.' using errcode = '22023';
  end if;

  if target_guardian_id is null or not exists (
    select 1 from public.student_guardians as link
    join public.guardians as guardian
      on guardian.id = link.guardian_id
      and guardian.organization_id = student.organization_id
      and guardian.school_id = student.school_id
      and guardian.campus_id = student.campus_id
    where link.student_id = student.id
      and link.guardian_id = target_guardian_id
      and guardian.archived_at is null
  ) then
    raise exception 'The selected guardian is not active or not linked to this student.' using errcode = '42501';
  end if;

  if target_message_type not in ('Attendance Reminder', 'Fee Reminder', 'General Notice', 'Follow-up')
    or target_channel not in ('WhatsApp', 'SMS', 'Email')
    or target_body is null or length(btrim(target_body)) = 0
  then
    raise exception 'Message type, channel, and non-empty body are required.' using errcode = '22023';
  end if;

  if actor.role = 'ADMIN' then
    null;
  elsif actor.role = 'FINANCE' then
    if target_message_type <> 'Fee Reminder' or normalized_source_type <> 'FEE' then
      raise exception 'Finance may only prepare fee-invoice-linked reminders.' using errcode = '42501';
    end if;
  elsif actor.role = 'TEACHER' then
    if target_message_type not in ('Attendance Reminder', 'Follow-up')
      or normalized_source_type = 'FEE'
      or normalized_source_type not in ('ATTENDANCE', 'STUDENT', 'MANUAL')
    then
      raise exception 'Teachers may only prepare attendance reminders and student follow-ups.' using errcode = '42501';
    end if;
    if normalized_source_type = 'ATTENDANCE' and not exists (
      select 1 from public.attendance_records as record
      join public.attendance_sessions as session on session.id = record.attendance_session_id
      where record.student_id = student.id
        and session.organization_id = student.organization_id
        and session.school_id = student.school_id
        and session.campus_id = student.campus_id
        and session.class_name = student.class_name
        and session.section = student.section
    ) then
      raise exception 'The attendance context is not available for this student.' using errcode = '42501';
    end if;
  else
    raise exception 'Your role cannot create parent communication.' using errcode = '42501';
  end if;

  if normalized_source_type = 'FEE' then
    if normalized_source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not exists (
        select 1 from public.fee_invoices as invoice
        where invoice.id = normalized_source_id::uuid
          and invoice.organization_id = student.organization_id
          and invoice.school_id = student.school_id
          and invoice.campus_id = student.campus_id
          and invoice.student_id = student.id
          and invoice.voided_at is null
      )
    then
      raise exception 'The linked fee invoice is invalid, voided, or outside the student scope.' using errcode = '42501';
    end if;
  end if;

  if target_message_id is not null then
    select * into existing from public.communication_messages where id = target_message_id for update;
    if not found
      or existing.organization_id <> student.organization_id
      or existing.school_id <> student.school_id
      or existing.campus_id <> student.campus_id
      or existing.student_id <> student.id
    then
      raise exception 'The communication draft was not found in your school scope.' using errcode = '42501';
    end if;

    if existing.status not in ('DRAFT', 'REJECTED') then
      raise exception 'Only draft or rejected messages can be edited.' using errcode = '42501';
    end if;

    if actor.role <> 'ADMIN' and existing.created_by <> actor_id then
      raise exception 'Only the draft author or an administrator can edit this message.' using errcode = '42501';
    end if;

    update public.communication_messages
    set
      message_type = target_message_type,
      channel = target_channel,
      body = btrim(target_body),
      source_type = normalized_source_type,
      source_id = normalized_source_id,
      status = case when target_submit then 'AWAITING_APPROVAL' else 'DRAFT' end,
      requires_approval = true,
      submitted_at = case when target_submit then pg_catalog.now() else existing.submitted_at end,
      rejected_by = null,
      rejected_at = null,
      rejection_reason = '',
      updated_at = pg_catalog.now()
    where id = existing.id
    returning id into saved_message_id;

    event_action := case when target_submit then 'SUBMITTED' else 'UPDATED' end;
  else
    insert into public.communication_messages (
      organization_id, school_id, campus_id, student_id, created_by,
      message_type, channel, body, source_type, source_id, status,
      requires_approval, submitted_at
    )
    values (
      student.organization_id, student.school_id, student.campus_id, student.id, actor_id,
      target_message_type, target_channel, btrim(target_body), normalized_source_type, normalized_source_id,
      case when target_submit then 'AWAITING_APPROVAL' else 'DRAFT' end,
      true, case when target_submit then pg_catalog.now() else null end
    )
    returning id into saved_message_id;

    event_action := case when target_submit then 'SUBMITTED' else 'DRAFTED' end;
  end if;

  insert into public.communication_recipients (message_id, guardian_id)
  values (saved_message_id, target_guardian_id)
  on conflict (message_id, guardian_id) do nothing;

  delete from public.communication_recipients
  where message_id = saved_message_id and guardian_id <> target_guardian_id;

  insert into public.communication_events (message_id, actor_id, action)
  values (saved_message_id, actor_id, event_action);

  return saved_message_id;
end;
$function$;

-- 4.3 Update record_fee_payment to reject voided invoices
create or replace function public.record_fee_payment(
  target_invoice_id uuid,
  target_student_id uuid,
  target_amount numeric,
  target_payment_date date,
  target_payment_method text,
  target_reference text,
  target_note text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor_id uuid := auth.uid();
  invoice_row public.fee_invoices%rowtype;
  existing_payment public.fee_payments%rowtype;
  invoice_total numeric(12, 2);
  total_paid numeric(12, 2);
  saved_payment_id uuid;
  normalized_reference text := btrim(coalesce(target_reference, ''));
  normalized_note text := btrim(coalesce(target_note, ''));
begin
  if actor_id is null then
    raise exception 'Authentication is required to record a fee payment.'
      using errcode = '42501';
  end if;

  if target_idempotency_key is null or length(btrim(target_idempotency_key)) = 0 then
    raise exception 'A payment idempotency key is required.'
      using errcode = '22023';
  end if;

  select invoice.*
  into invoice_row
  from public.fee_invoices as invoice
  where invoice.id = target_invoice_id
    and invoice.student_id = target_student_id
  for update;

  if not found or not public.can_manage_fee_invoice(target_invoice_id, target_student_id) then
    raise exception 'The fee invoice is outside your authorized scope or does not belong to this student.'
      using errcode = '42501';
  end if;

  if invoice_row.voided_at is not null then
    raise exception 'Cannot record payment against a voided invoice.'
      using errcode = '22023';
  end if;

  select payment.*
  into existing_payment
  from public.fee_payments as payment
  where payment.idempotency_key = target_idempotency_key;

  if found then
    if existing_payment.invoice_id = target_invoice_id
      and existing_payment.student_id = target_student_id
      and existing_payment.amount = target_amount
      and existing_payment.payment_date = target_payment_date
      and existing_payment.payment_method = target_payment_method
      and existing_payment.reference = normalized_reference
      and existing_payment.note = normalized_note
    then
      return existing_payment.id;
    end if;
    raise exception 'This payment idempotency key was already used for a different payment.'
      using errcode = '23505';
  end if;

  if target_amount is null
    or target_amount <= 0
    or target_amount <> round(target_amount, 2)
    or target_payment_date is null
    or target_payment_date > current_date
    or target_payment_method is null
    or target_payment_method not in ('Cash', 'Bank Transfer', 'Card', 'Online')
  then
    raise exception 'Payment amount, date, or method is invalid.'
      using errcode = '22023';
  end if;

  select coalesce(sum(item.amount), 0)::numeric(12, 2)
  into invoice_total
  from public.fee_invoice_items as item
  where item.invoice_id = target_invoice_id;

  -- Only sum active (non-voided) payments
  select coalesce(sum(payment.amount), 0)::numeric(12, 2)
  into total_paid
  from public.fee_payments as payment
  where payment.invoice_id = target_invoice_id
    and payment.voided_at is null;

  if invoice_total <= 0 then
    raise exception 'The fee invoice has no payable line items.'
      using errcode = '22023';
  end if;

  if target_amount > invoice_total - total_paid then
    raise exception 'Payment amount cannot exceed the current outstanding balance.'
      using errcode = '22023';
  end if;

  if normalized_reference <> '' and exists (
    select 1
    from public.fee_payments as payment
    where payment.invoice_id = target_invoice_id
      and payment.voided_at is null
      and lower(btrim(payment.reference)) = lower(normalized_reference)
  ) then
    raise exception 'A payment with this reference is already recorded for the invoice.'
      using errcode = '23505';
  end if;

  insert into public.fee_payments (
    invoice_id, student_id, amount, payment_date,
    payment_method, reference, note, idempotency_key, received_by
  )
  values (
    target_invoice_id, target_student_id, target_amount, target_payment_date,
    target_payment_method, normalized_reference, normalized_note,
    target_idempotency_key, actor_id
  )
  returning id into saved_payment_id;

  return saved_payment_id;
end;
$function$;

-- ============================================================================
-- 5. FUNCTION PERMISSIONS & GRANTS
-- Revoke from public/anon, grant execute only to authenticated.
-- ============================================================================
revoke all on function public.update_student(uuid, uuid, text, text, text, text, text, date, text, text) from public, anon;
revoke all on function public.archive_student(uuid, text) from public, anon;
revoke all on function public.update_guardian(uuid, text, text, text, text, text, text) from public, anon;
revoke all on function public.unlink_student_guardian(uuid, uuid, text) from public, anon;
revoke all on function public.link_student_guardian(uuid, uuid, text, boolean, text) from public, anon;
revoke all on function public.correct_attendance_session(uuid, jsonb, text) from public, anon;
revoke all on function public.update_fee_invoice(uuid, date, jsonb, text) from public, anon;
revoke all on function public.void_fee_invoice(uuid, text) from public, anon;
revoke all on function public.void_fee_payment(uuid, text) from public, anon;
revoke all on function public.delete_communication_draft(uuid, text) from public, anon;

grant execute on function public.update_student(uuid, uuid, text, text, text, text, text, date, text, text) to authenticated;
grant execute on function public.archive_student(uuid, text) to authenticated;
grant execute on function public.update_guardian(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.unlink_student_guardian(uuid, uuid, text) to authenticated;
grant execute on function public.link_student_guardian(uuid, uuid, text, boolean, text) to authenticated;
grant execute on function public.correct_attendance_session(uuid, jsonb, text) to authenticated;
grant execute on function public.update_fee_invoice(uuid, date, jsonb, text) to authenticated;
grant execute on function public.void_fee_invoice(uuid, text) to authenticated;
grant execute on function public.void_fee_payment(uuid, text) to authenticated;
grant execute on function public.delete_communication_draft(uuid, text) to authenticated;

commit;

