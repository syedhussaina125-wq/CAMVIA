begin;

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

  if student.deleted_at is not null then
    raise exception 'This student is in Trash and cannot be used.' using errcode = '22023';
  end if;

  -- Operational lock: cannot initiate communication for an archived student
  if student.status = 'ARCHIVED' then
    raise exception 'Cannot create communication for an archived student.' using errcode = '22023';
  end if;

  if target_guardian_id is null or not exists (
    select 1
    from public.student_guardians as link
    join public.guardians as guardian
      on guardian.id = link.guardian_id
      and guardian.organization_id = student.organization_id
      and guardian.school_id = student.school_id
      and guardian.campus_id = student.campus_id
    where link.student_id = student.id
      and link.guardian_id = target_guardian_id
      and guardian.archived_at is null
      and guardian.deleted_at is null
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
      select 1
      from public.attendance_records as record
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
        select 1
        from public.fee_invoices as invoice
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

    if existing.deleted_at is not null then
      raise exception 'This communication draft is in Trash and cannot be used.' using errcode = '22023';
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

    event_action := case when target_submit then 'Submitted' else 'Edited' end;
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

    event_action := case when target_submit then 'Submitted' else 'Created' end;
  end if;

  insert into public.communication_recipients (message_id, student_id, guardian_id)
  values (saved_message_id, student.id, target_guardian_id)
  on conflict (message_id, guardian_id)
  do update set student_id = excluded.student_id;

  delete from public.communication_recipients
  where message_id = saved_message_id and guardian_id <> target_guardian_id;

  insert into public.communication_events (message_id, actor_id, action)
  values (saved_message_id, actor_id, event_action);

  return saved_message_id;
end;
$function$;

create or replace view public.live_alerts
with (security_invoker = true)
as
with attendance_ranked as (
  select
    session.organization_id,
    session.school_id,
    session.campus_id,
    session.class_name,
    session.section,
    record.student_id,
    record.status,
    record.updated_at,
    row_number() over (
      partition by record.student_id
      order by session.attendance_date desc, session.id desc
    ) as attendance_rank
  from public.attendance_records as record
  join public.attendance_sessions as session
    on session.id = record.attendance_session_id
  where public.can_view_attendance_alerts()
),
attendance_ordered as (
  select
    ranked.*,
    min(ranked.attendance_rank) filter (where ranked.status <> 'ABSENT')
      over (partition by ranked.student_id) as first_non_absent_rank
  from attendance_ranked as ranked
),
student_attendance as (
  select
    student.organization_id,
    student.school_id,
    student.campus_id,
    student.id as student_id,
    student.first_name,
    student.last_name,
    student.class_name,
    student.section,
    count(*) as record_count,
    count(*) filter (where ordered.status in ('PRESENT', 'LATE')) as attended_count,
    count(*) filter (
      where ordered.status = 'ABSENT'
        and (ordered.first_non_absent_rank is null or ordered.attendance_rank < ordered.first_non_absent_rank)
    ) as consecutive_absences,
    max(ordered.updated_at) as latest_attendance_at
  from attendance_ordered as ordered
  join public.students as student
    on student.id = ordered.student_id
    and student.organization_id = ordered.organization_id
    and student.school_id = ordered.school_id
    and student.campus_id = ordered.campus_id
    and student.class_name = ordered.class_name
    and student.section = ordered.section
  group by
    student.organization_id, student.school_id, student.campus_id,
    student.id, student.first_name, student.last_name, student.class_name, student.section
),
attendance_student_alerts as (
  select
    concat('attendance-absence-', student_id::text) as id,
    organization_id,
    school_id,
    campus_id,
    student_id,
    class_name,
    section,
    'HIGH'::text as priority,
    'OPEN'::text as status,
    'ATTENDANCE'::text as source_type,
    student_id::text as source_id,
    concat(first_name, ' ', last_name) as title,
    concat('Absent for ', consecutive_absences, ' consecutive recorded school days.') as detail,
    latest_attendance_at as created_at
  from student_attendance
  where consecutive_absences >= 3

  union all

  select
    concat('attendance-rate-', student_id::text),
    organization_id,
    school_id,
    campus_id,
    student_id,
    class_name,
    section,
    'MEDIUM'::text,
    'OPEN'::text,
    'ATTENDANCE'::text,
    student_id::text,
    concat(first_name, ' ', last_name),
    concat('Attendance is ', round(attended_count::numeric * 100 / nullif(record_count, 0))::integer, '%.' ),
    latest_attendance_at
  from student_attendance
  where attended_count::numeric * 100 / nullif(record_count, 0) < 75
),
class_session_rates as (
  select
    session.organization_id,
    session.school_id,
    session.campus_id,
    session.class_name,
    session.section,
    session.id as session_id,
    session.attendance_date,
    session.updated_at,
    count(record.id) as record_count,
    count(record.id) filter (where record.status in ('PRESENT', 'LATE')) as attended_count,
    case
      when count(record.id) = 0 then null
      else round(count(record.id) filter (where record.status in ('PRESENT', 'LATE'))::numeric * 100 / count(record.id))
    end as attendance_rate,
    row_number() over (
      partition by session.organization_id, session.school_id, session.campus_id, session.class_name, session.section
      order by session.attendance_date desc, session.id desc
    ) as session_rank
  from public.attendance_sessions as session
  left join public.attendance_records as record
    on record.attendance_session_id = session.id
  where public.can_view_attendance_alerts()
  group by
    session.organization_id, session.school_id, session.campus_id,
    session.class_name, session.section, session.id, session.attendance_date, session.updated_at
),
class_attention as (
  select
    latest.organization_id,
    latest.school_id,
    latest.campus_id,
    latest.class_name,
    latest.section,
    latest.attendance_rate as latest_rate,
    avg(previous.attendance_rate) as previous_average,
    max(latest.updated_at) as latest_attendance_at,
    count(previous.attendance_rate) as comparison_count
  from class_session_rates as latest
  left join class_session_rates as previous
    on previous.organization_id = latest.organization_id
    and previous.school_id = latest.school_id
    and previous.campus_id = latest.campus_id
    and previous.class_name = latest.class_name
    and previous.section = latest.section
    and previous.session_rank between 2 and 4
  where latest.session_rank = 1
  group by
    latest.organization_id, latest.school_id, latest.campus_id,
    latest.class_name, latest.section, latest.attendance_rate
),
attendance_class_alerts as (
  select
    concat(
      'attendance-class-', campus_id::text, '-',
      md5(class_name || '|' || section)
    ) as id,
    organization_id,
    school_id,
    campus_id,
    null::uuid as student_id,
    class_name,
    section,
    'NOTICE'::text as priority,
    'OPEN'::text as status,
    'ATTENDANCE'::text as source_type,
    concat(campus_id::text, '::', class_name, '::', section) as source_id,
    concat(class_name, '-', section) as title,
    concat(
      'Attendance is ',
      round(previous_average - latest_rate)::integer,
      '% below its recent average.'
    ) as detail,
    latest_attendance_at as created_at
  from class_attention
  where comparison_count > 0
    and latest_rate is not null
    and previous_average - latest_rate >= 8
),
attendance_alerts as (
  select * from attendance_student_alerts
  union all
  select * from attendance_class_alerts
),
fee_totals as (
  select
    invoice.id as invoice_id,
    invoice.organization_id,
    invoice.school_id,
    invoice.campus_id,
    invoice.student_id,
    invoice.updated_at,
    invoice.due_date,
    student.first_name,
    student.last_name,
    student.class_name,
    student.section,
    coalesce(items.total_amount, 0) - coalesce(payments.paid_amount, 0) as outstanding_amount
  from public.fee_invoices as invoice
  join public.students as student
    on student.id = invoice.student_id
    and student.organization_id = invoice.organization_id
    and student.school_id = invoice.school_id
    and student.campus_id = invoice.campus_id
  left join (
    select invoice_id, sum(amount) as total_amount
    from public.fee_invoice_items
    group by invoice_id
  ) as items on items.invoice_id = invoice.id
  left join (
    select invoice_id, sum(amount) as paid_amount
    from public.fee_payments
    where voided_at is null
    group by invoice_id
  ) as payments on payments.invoice_id = invoice.id
  where invoice.voided_at is null
),
alert_rows as (
  select
    attendance_alert.id,
    attendance_alert.organization_id,
    attendance_alert.school_id,
    attendance_alert.campus_id,
    attendance_alert.student_id,
    attendance_alert.class_name,
    attendance_alert.section,
    attendance_alert.priority,
    attendance_alert.status,
    attendance_alert.source_type,
    attendance_alert.source_id,
    attendance_alert.title,
    attendance_alert.detail,
    attendance_alert.created_at,
    case attendance_alert.priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end as priority_rank,
    0 as status_rank
  from attendance_alerts as attendance_alert

  union all

  select
    concat('fee-', invoice_id::text),
    organization_id,
    school_id,
    campus_id,
    student_id,
    class_name,
    section,
    case
      when current_date - due_date > 60 then 'HIGH'
      when current_date - due_date > 30 then 'MEDIUM'
      else 'NOTICE'
    end,
    'OPEN',
    'FEE',
    invoice_id::text,
    concat(first_name, ' ', last_name),
    concat(
      first_name, ' ', last_name, ' has PKR ',
      to_char(outstanding_amount, 'FM999,999,999,990'),
      ' outstanding',
      case when current_date - due_date > 0
        then concat(' and is ', current_date - due_date, ' days overdue')
        else ''
      end,
      '.'
    ),
    updated_at,
    case
      when current_date - due_date > 60 then 0
      when current_date - due_date > 30 then 1
      else 2
    end,
    0
  from fee_totals
  where outstanding_amount > 0

  union all

  select
    concat('approval-', message.id),
    message.organization_id,
    message.school_id,
    message.campus_id,
    message.student_id,
    student.class_name,
    student.section,
    'NOTICE',
    'IN_REVIEW',
    'COMMUNICATION',
    message.id::text,
    concat(message.message_type, ' is awaiting approval'),
    concat(student.first_name, ' ', student.last_name, ' is waiting for parent communication approval.'),
    message.updated_at,
    2,
    1
  from public.communication_messages as message
  join public.students as student
    on student.id = message.student_id
    and student.organization_id = message.organization_id
    and student.school_id = message.school_id
    and student.campus_id = message.campus_id
  where message.status = 'AWAITING_APPROVAL'
)
select
  id,
  organization_id,
  school_id,
  campus_id,
  student_id,
  class_name,
  section,
  priority,
  status,
  source_type,
  source_id,
  title,
  detail,
  created_at,
  priority_rank,
  status_rank
from alert_rows;

comment on view public.live_alerts is
  'Read-only role-scoped alerts derived from live attendance, fee, and communication source records.';

revoke all on public.live_alerts from public, anon;
grant select on public.live_alerts to authenticated;

commit;
