begin;

create table if not exists public.communication_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  message_type text not null check (message_type in (
    'Attendance Reminder', 'Fee Reminder', 'General Notice', 'Follow-up'
  )),
  channel text not null check (channel in ('WhatsApp', 'SMS', 'Email')),
  body text not null check (length(btrim(body)) > 0),
  source_type text not null check (source_type in ('ATTENDANCE', 'FEE', 'STUDENT', 'MANUAL')),
  source_id text not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT')),
  requires_approval boolean not null default true,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejected_by uuid references public.profiles(id),
  rejected_at timestamptz,
  rejection_reason text not null default '',
  sent_by uuid references public.profiles(id),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communication_messages_student_id_id_unique unique (id, student_id)
);

create table if not exists public.communication_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  student_id uuid not null,
  guardian_id uuid not null references public.guardians(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint communication_recipients_message_guardian_unique unique (message_id, guardian_id),
  constraint communication_recipients_message_student_fk
    foreign key (message_id, student_id)
    references public.communication_messages(id, student_id) on delete cascade,
  constraint communication_recipients_student_guardian_fk
    foreign key (student_id, guardian_id)
    references public.student_guardians(student_id, guardian_id) on delete restrict
);

create table if not exists public.communication_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.communication_messages(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null check (action in ('Created', 'Edited', 'Submitted', 'Approved', 'Rejected', 'Sent')),
  created_at timestamptz not null default now()
);

create index if not exists communication_messages_scope_status_created_idx
  on public.communication_messages (organization_id, school_id, status, created_at desc);
create index if not exists communication_messages_student_created_idx
  on public.communication_messages (student_id, created_at desc);
create index if not exists communication_recipients_guardian_idx
  on public.communication_recipients (guardian_id, message_id);
create index if not exists communication_events_message_created_idx
  on public.communication_events (message_id, created_at);

drop trigger if exists communication_messages_set_updated_at on public.communication_messages;
create trigger communication_messages_set_updated_at
before update on public.communication_messages
for each row
execute function public.set_updated_at();

alter table public.communication_messages enable row level security;
alter table public.communication_recipients enable row level security;
alter table public.communication_events enable row level security;

create or replace function public.can_access_communication_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
  select exists (
    select 1
    from public.profiles as requester
    join public.students as student
      on student.id = target_student_id
      and student.organization_id = requester.organization_id
      and student.school_id = requester.school_id
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and (
        requester.role in ('ADMIN', 'PRINCIPAL')
        or (
          requester.role = 'FINANCE'
          and exists (
            select 1 from public.fee_invoices as invoice
            where invoice.student_id = student.id
              and invoice.organization_id = student.organization_id
              and invoice.school_id = student.school_id
              and invoice.campus_id = student.campus_id
          )
        )
        or (
          requester.role = 'TEACHER'
          and exists (
            select 1
            from public.teacher_class_assignments as assignment
            where assignment.user_id = requester.id
              and assignment.active = true
              and assignment.school_id = student.school_id
              and assignment.campus_id = student.campus_id
              and assignment.class_name = student.class_name
              and assignment.section = student.section
          )
        )
      )
  );
$function$;

create or replace function public.can_access_communication_message(target_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
  select exists (
    select 1
    from public.communication_messages as message
    join public.profiles as requester
      on requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.organization_id = message.organization_id
      and requester.school_id = message.school_id
    where message.id = target_message_id
      and public.can_access_communication_student(message.student_id)
      and (
        requester.role in ('ADMIN', 'PRINCIPAL')
        or (
          requester.role = 'FINANCE'
          and message.message_type = 'Fee Reminder'
          and message.source_type = 'FEE'
        )
        or (
          requester.role = 'TEACHER'
          and message.message_type in ('Attendance Reminder', 'Follow-up')
          and message.source_type <> 'FEE'
        )
      )
  );
$function$;

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
set row_security = off
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
    raise exception 'An active EduPulse profile is required.' using errcode = '42501';
  end if;

  select * into student from public.students where id = target_student_id;
  if not found
    or student.organization_id <> actor.organization_id
    or student.school_id <> actor.school_id
    or not public.can_access_communication_student(target_student_id)
  then
    raise exception 'The student is outside your authorized communication scope.' using errcode = '42501';
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
  ) then
    raise exception 'The selected guardian is not linked to this student.' using errcode = '42501';
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
          and invoice.student_id = student.id
          and invoice.organization_id = student.organization_id
          and invoice.school_id = student.school_id
          and invoice.campus_id = student.campus_id
      )
    then
      raise exception 'The fee invoice is not linked to this student in your school.' using errcode = '42501';
    end if;
  elsif normalized_source_type = 'ATTENDANCE' then
    if normalized_source_id <> student.id::text or not exists (
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
  elsif normalized_source_type in ('STUDENT', 'MANUAL') then
    if normalized_source_id <> student.id::text then
      raise exception 'The communication source does not match the selected student.' using errcode = '22023';
    end if;
  else
    raise exception 'Unsupported communication source.' using errcode = '22023';
  end if;

  if target_message_id is not null then
    select * into existing
    from public.communication_messages
    where id = target_message_id
    for update;

    if not found or not public.can_access_communication_message(target_message_id)
      or existing.status not in ('DRAFT', 'REJECTED', 'AWAITING_APPROVAL')
      or (existing.created_by <> actor_id and actor.role not in ('ADMIN', 'PRINCIPAL'))
    then
      raise exception 'This communication cannot be edited by the current user.' using errcode = '42501';
    end if;

    update public.communication_messages
    set student_id = student.id,
        organization_id = student.organization_id,
        school_id = student.school_id,
        campus_id = student.campus_id,
        message_type = target_message_type,
        channel = target_channel,
        body = btrim(target_body),
        source_type = normalized_source_type,
        source_id = normalized_source_id,
        status = case when target_submit then 'AWAITING_APPROVAL' else status end,
        submitted_at = case when target_submit then now() else submitted_at end
    where id = target_message_id;
    saved_message_id := target_message_id;
    event_action := case when target_submit then 'Submitted' else 'Edited' end;

    delete from public.communication_recipients where communication_recipients.message_id = saved_message_id;
  else
    if actor.role not in ('ADMIN', 'FINANCE', 'TEACHER') then
      raise exception 'Your role cannot create parent communication.' using errcode = '42501';
    end if;
    insert into public.communication_messages (
      organization_id, school_id, campus_id, student_id, created_by,
      message_type, channel, body, source_type, source_id, requires_approval, status, submitted_at
    )
    values (
      student.organization_id, student.school_id, student.campus_id, student.id, actor_id,
      target_message_type, target_channel, btrim(target_body), normalized_source_type, normalized_source_id, true,
      case when target_submit then 'AWAITING_APPROVAL' else 'DRAFT' end,
      case when target_submit then now() else null end
    )
    returning id into saved_message_id;
    event_action := case when target_submit then 'Submitted' else 'Created' end;
  end if;

  insert into public.communication_recipients (message_id, student_id, guardian_id)
  values (saved_message_id, student.id, target_guardian_id);

  insert into public.communication_events (message_id, actor_id, action)
  values (saved_message_id, actor_id, event_action);

  return saved_message_id;
end;
$function$;

create or replace function public.transition_communication_message(
  target_message_id uuid,
  target_operation text,
  target_rejection_reason text default ''
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor_id uuid := auth.uid();
  actor public.profiles%rowtype;
  message public.communication_messages%rowtype;
  next_status text;
  audit_action text;
begin
  if actor_id is null then
    raise exception 'Authentication is required to update communication.' using errcode = '42501';
  end if;
  select * into actor from public.profiles where id = actor_id and status = 'ACTIVE';
  if not found then
    raise exception 'An active EduPulse profile is required.' using errcode = '42501';
  end if;

  select * into message
  from public.communication_messages
  where id = target_message_id
  for update;
  if not found or not public.can_access_communication_message(target_message_id) then
    raise exception 'This communication is outside your authorized scope.' using errcode = '42501';
  end if;

  if target_operation = 'submit' then
    if message.status not in ('DRAFT', 'REJECTED')
      or (message.created_by <> actor_id and actor.role <> 'ADMIN')
    then
      raise exception 'Only the draft creator or an administrator can submit this draft.' using errcode = '42501';
    end if;
    next_status := 'AWAITING_APPROVAL';
    audit_action := 'Submitted';
  elsif target_operation in ('approve', 'reject') then
    if actor.role not in ('ADMIN', 'PRINCIPAL') or message.status <> 'AWAITING_APPROVAL' then
      raise exception 'Only an Admin or Principal can review a submitted message.' using errcode = '42501';
    end if;
    next_status := case when target_operation = 'approve' then 'APPROVED' else 'REJECTED' end;
    audit_action := case when target_operation = 'approve' then 'Approved' else 'Rejected' end;
  elsif target_operation = 'send' then
    if actor.role not in ('ADMIN', 'PRINCIPAL')
      or message.status <> 'APPROVED'
      or message.requires_approval is distinct from true
    then
      raise exception 'Only an Admin or Principal can mark an approved message as sent.' using errcode = '42501';
    end if;
    next_status := 'SENT';
    audit_action := 'Sent';
  else
    raise exception 'Unsupported communication operation.' using errcode = '22023';
  end if;

  update public.communication_messages
  set status = next_status,
      submitted_at = case when target_operation = 'submit' then now() else submitted_at end,
      approved_by = case when target_operation = 'approve' then actor_id else approved_by end,
      approved_at = case when target_operation = 'approve' then now() else approved_at end,
      rejected_by = case when target_operation = 'reject' then actor_id else rejected_by end,
      rejected_at = case when target_operation = 'reject' then now() else rejected_at end,
      rejection_reason = case when target_operation = 'reject' then btrim(coalesce(target_rejection_reason, '')) else rejection_reason end,
      sent_by = case when target_operation = 'send' then actor_id else sent_by end,
      sent_at = case when target_operation = 'send' then now() else sent_at end
  where id = target_message_id;

  insert into public.communication_events (message_id, actor_id, action)
  values (target_message_id, actor_id, audit_action);
end;
$function$;

revoke all on function public.can_access_communication_student(uuid) from public, anon;
revoke all on function public.can_access_communication_message(uuid) from public, anon;
revoke all on function public.save_communication_draft(uuid, uuid, text, text, text, text, text, uuid, boolean) from public, anon;
revoke all on function public.transition_communication_message(uuid, text, text) from public, anon;
grant execute on function public.can_access_communication_student(uuid) to authenticated;
grant execute on function public.can_access_communication_message(uuid) to authenticated;
grant execute on function public.save_communication_draft(uuid, uuid, text, text, text, text, text, uuid, boolean) to authenticated;
grant execute on function public.transition_communication_message(uuid, text, text) to authenticated;

revoke all on public.communication_messages from public, anon, authenticated;
revoke all on public.communication_recipients from public, anon, authenticated;
revoke all on public.communication_events from public, anon, authenticated;
grant select on public.communication_messages to authenticated;
grant select on public.communication_recipients to authenticated;
grant select on public.communication_events to authenticated;

drop policy if exists communication_messages_read_authorized on public.communication_messages;
create policy communication_messages_read_authorized
on public.communication_messages
for select
to authenticated
using (public.can_access_communication_message(id));

drop policy if exists communication_recipients_read_authorized on public.communication_recipients;
create policy communication_recipients_read_authorized
on public.communication_recipients
for select
to authenticated
using (public.can_access_communication_message(message_id));

drop policy if exists communication_events_read_authorized on public.communication_events;
create policy communication_events_read_authorized
on public.communication_events
for select
to authenticated
using (public.can_access_communication_message(message_id));

commit;
