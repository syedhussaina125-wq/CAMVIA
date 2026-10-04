begin;

create or replace function public.can_view_attendance_alerts()
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
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.role in ('ADMIN', 'PRINCIPAL', 'TEACHER')
  );
$function$;

revoke all on function public.can_view_attendance_alerts() from public, anon;
grant execute on function public.can_view_attendance_alerts() to authenticated;

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
    concat('Attendance is ', round(attended_count::numeric * 100 / nullif(record_count, 0))::integer, '%.'),
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
    group by invoice_id
  ) as payments on payments.invoice_id = invoice.id
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
