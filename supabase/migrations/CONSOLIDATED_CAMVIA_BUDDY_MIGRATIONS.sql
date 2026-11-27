-- ============================================================================
-- CAMVIA Buddy & Dashboard Consolidated Aggregates Migration (CORRECTED)
-- Migrations included: 048, 049, 050, 051, 052
-- Safe to apply in Supabase SQL Editor.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Migration 048: Admission Summary (get_camvia_admission_summary)
-- ============================================================================

create or replace function public.get_camvia_admission_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor_school_id uuid;
  summary jsonb;
begin
  select profile.school_id
  into actor_school_id
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN'
    and profile.organization_id is not null
    and profile.school_id is not null;

  if not found then
    raise exception 'An active school administrator is required to view admission summaries.'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'pending', count(*) filter (where application.status = 'PENDING'),
    'approved', count(*) filter (where application.status = 'APPROVED'),
    'rejected', count(*) filter (where application.status = 'REJECTED')
  )
  into summary
  from public.admission_applications as application
  where application.school_id = actor_school_id;

  return coalesce(summary, jsonb_build_object(
    'total', 0,
    'pending', 0,
    'approved', 0,
    'rejected', 0
  ));
end;
$function$;

revoke all on function public.get_camvia_admission_summary() from public, anon, authenticated;
grant execute on function public.get_camvia_admission_summary() to authenticated;


-- ============================================================================
-- 2. Migration 049: Dashboard Student Summary (get_dashboard_student_summary)
-- ============================================================================

create or replace function public.get_dashboard_student_summary()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
set row_security = on
as $function$
  with grouped_students as (
    select
      student.class_name,
      student.section,
      student.campus_id,
      student.gender,
      count(*)::integer as student_count,
      grouping(student.class_name) as class_rolled_up,
      grouping(student.section) as section_rolled_up,
      grouping(student.campus_id) as campus_rolled_up,
      grouping(student.gender) as gender_rolled_up
    from public.students as student
    where student.status = 'ACTIVE'
      and student.deleted_at is null
      and student.archived_at is null
    group by grouping sets (
      (),
      (student.class_name),
      (student.class_name, student.section, student.campus_id),
      (student.campus_id),
      (student.gender)
    )
  )
  select jsonb_build_object(
    'activeStudentCount',
      coalesce(max(student_count) filter (
        where class_rolled_up = 1
          and section_rolled_up = 1
          and campus_rolled_up = 1
          and gender_rolled_up = 1
      ), 0),
    'classCounts',
      coalesce(jsonb_agg(jsonb_build_object(
        'className', class_name,
        'studentCount', student_count
      ) order by class_name) filter (
        where class_rolled_up = 0
          and section_rolled_up = 1
          and campus_rolled_up = 1
          and gender_rolled_up = 1
      ), '[]'::jsonb),
    'sectionCounts',
      coalesce(jsonb_agg(jsonb_build_object(
        'className', class_name,
        'section', section,
        'campusId', campus_id,
        'studentCount', student_count
      ) order by class_name, section, campus_id) filter (
        where class_rolled_up = 0
          and section_rolled_up = 0
          and campus_rolled_up = 0
          and gender_rolled_up = 1
      ), '[]'::jsonb),
    'campusCounts',
      coalesce(jsonb_agg(jsonb_build_object(
        'campusId', campus_id,
        'studentCount', student_count
      ) order by campus_id) filter (
        where class_rolled_up = 1
          and section_rolled_up = 1
          and campus_rolled_up = 0
          and gender_rolled_up = 1
      ), '[]'::jsonb),
    'genderCounts',
      coalesce(jsonb_agg(jsonb_build_object(
        'gender', coalesce(gender, 'Unspecified'),
        'studentCount', student_count
      ) order by gender nulls last) filter (
        where class_rolled_up = 1
          and section_rolled_up = 1
          and campus_rolled_up = 1
          and gender_rolled_up = 0
      ), '[]'::jsonb)
  )
  from grouped_students;
$function$;

revoke all on function public.get_dashboard_student_summary() from public, anon;
grant execute on function public.get_dashboard_student_summary() to authenticated;


-- ============================================================================
-- 3. Migration 050: Dashboard Attendance Summary (get_dashboard_attendance_summary)
-- ============================================================================

create or replace function public.get_dashboard_attendance_summary()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
set row_security = on
as $function$
  with active_students as (
    select
      student.id,
      student.campus_id,
      student.class_name,
      student.section,
      case
        when nullif(btrim(student.class_name), '') is null then 'Unassigned'
        when btrim(student.class_name) ~ '^[0-9]+$' then 'Class ' || btrim(student.class_name)
        else btrim(student.class_name)
      end as class_label
    from public.students as student
    where student.status = 'ACTIVE'
      and student.deleted_at is null
      and student.archived_at is null
  ),
  authorized_classes as (
    select distinct class_label
    from active_students
  ),
  latest_attendance as (
    select session.attendance_date as latest_date
    from public.attendance_sessions as session
    where exists (
        select 1
        from public.attendance_records as record
        join active_students as student
          on student.id = record.student_id
          and student.campus_id = session.campus_id
          and student.class_name = session.class_name
          and student.section = session.section
        where record.attendance_session_id = session.id
          and record.trashed_at is null
      )
    order by session.attendance_date desc
    limit 1
  ),
  attendance_rows as (
    select
      session.attendance_date,
      student.class_label,
      record.status
    from public.attendance_sessions as session
    cross join latest_attendance
    join public.attendance_records as record
      on record.attendance_session_id = session.id
      and record.trashed_at is null
    join active_students as student
      on student.id = record.student_id
      and student.campus_id = session.campus_id
      and student.class_name = session.class_name
      and student.section = session.section
    where latest_attendance.latest_date is not null
      and session.attendance_date >= (
        date_trunc('month', latest_attendance.latest_date)::date - interval '11 months'
      )
      and session.attendance_date <= latest_attendance.latest_date
  ),
  daily_counts as (
    select
      class_label,
      attendance_date,
      count(*) filter (where status = 'PRESENT')::integer as present,
      count(*) filter (where status = 'LATE')::integer as late,
      count(*) filter (where status = 'ABSENT')::integer as absent
    from attendance_rows
    group by class_label, attendance_date
  )
  select jsonb_build_object(
    'classNames',
      coalesce((
        select jsonb_agg(class_label order by class_label)
        from authorized_classes
      ), '[]'::jsonb),
    'dailyCounts',
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'className', daily_counts.class_label,
          'date', daily_counts.attendance_date,
          'present', daily_counts.present,
          'late', daily_counts.late,
          'absent', daily_counts.absent
        ) order by daily_counts.attendance_date, daily_counts.class_label)
        from daily_counts
      ), '[]'::jsonb)
  );
$function$;

revoke all on function public.get_dashboard_attendance_summary() from public, anon;
grant execute on function public.get_dashboard_attendance_summary() to authenticated;


-- ============================================================================
-- 4. Migration 051: CAMVIA Buddy Attendance Summary & Search
-- ============================================================================

create or replace function public.get_camvia_buddy_attendance_summary(
  target_date date,
  target_class_names text[] default null,
  target_section text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
set row_security = on
as $function$
  with visible_sessions as (
    select
      session.id,
      session.campus_id,
      session.class_name,
      session.section
    from public.attendance_sessions as session
    where session.attendance_date = target_date
      and (
        target_class_names is null
        or session.class_name = any(target_class_names)
      )
      and (
        target_section is null
        or lower(btrim(session.section)) = lower(btrim(target_section))
      )
  ),
  summary as (
    select
      count(distinct session.id)::integer as session_count,
      count(student.id)::integer as eligible_count,
      count(record.id)::integer as recorded_count,
      count(record.id) filter (where record.status = 'PRESENT')::integer as present_count,
      count(record.id) filter (where record.status = 'ABSENT')::integer as absent_count,
      count(record.id) filter (where record.status = 'LATE')::integer as late_count
    from visible_sessions as session
    left join public.students as student
      on student.campus_id = session.campus_id
      and student.class_name = session.class_name
      and student.section = session.section
      and student.status = 'ACTIVE'
      and student.deleted_at is null
      and student.archived_at is null
    left join public.attendance_records as record
      on record.attendance_session_id = session.id
      and record.student_id = student.id
      and record.trashed_at is null
  )
  select jsonb_build_object(
    'sessionCount', session_count,
    'eligibleCount', eligible_count,
    'recordedCount', recorded_count,
    'unmarkedCount', greatest(eligible_count - recorded_count, 0),
    'presentCount', present_count,
    'absentCount', absent_count,
    'lateCount', late_count
  )
  from summary;
$function$;

revoke all on function public.get_camvia_buddy_attendance_summary(date, text[], text) from public, anon;
grant execute on function public.get_camvia_buddy_attendance_summary(date, text[], text) to authenticated;

create or replace function public.get_camvia_buddy_attendance_search(
  target_date date,
  target_class_names text[] default null,
  target_section text default null,
  target_status text default null,
  target_page integer default 1
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
set row_security = on
as $function$
  with matching_records as (
    select
      student.id,
      student.first_name,
      student.last_name,
      session.class_name,
      session.section,
      record.status
    from public.attendance_sessions as session
    join public.attendance_records as record
      on record.attendance_session_id = session.id
      and record.trashed_at is null
    join public.students as student
      on student.id = record.student_id
      and student.campus_id = session.campus_id
      and student.class_name = session.class_name
      and student.section = session.section
      and student.status = 'ACTIVE'
      and student.deleted_at is null
      and student.archived_at is null
    where session.attendance_date = target_date
      and record.status = target_status
      and target_status in ('PRESENT', 'ABSENT', 'LATE')
      and (
        target_class_names is null
        or session.class_name = any(target_class_names)
      )
      and (
        target_section is null
        or lower(btrim(session.section)) = lower(btrim(target_section))
      )
  ),
  matching_total as (
    select count(*) as total
    from matching_records
  ),
  page_rows as (
    select *
    from matching_records
    where target_page between 1 and 10000
    order by lower(btrim(first_name)), lower(btrim(last_name)), id
    limit 50
    offset greatest(target_page - 1, 0) * 50
  )
  select jsonb_build_object(
    'total', matching_total.total,
    'page', target_page,
    'pageSize', 50,
    'rows',
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'studentName', btrim(page_rows.first_name || ' ' || page_rows.last_name),
          'className', page_rows.class_name,
          'section', page_rows.section,
          'status', page_rows.status
        ) order by lower(btrim(page_rows.first_name)), lower(btrim(page_rows.last_name)), page_rows.id)
        from page_rows
      ), '[]'::jsonb)
  )
  from matching_total;
$function$;

revoke all on function public.get_camvia_buddy_attendance_search(date, text[], text, text, integer) from public, anon;
grant execute on function public.get_camvia_buddy_attendance_search(date, text[], text, text, integer) to authenticated;


-- ============================================================================
-- 5. Migration 052: CAMVIA Buddy Fee Summary (get_camvia_buddy_fee_summary)
-- ============================================================================

create or replace function public.get_camvia_buddy_fee_summary(
  target_class_names text[] default null,
  target_section text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, auth
set row_security = on
as $function$
  with visible_invoices as (
    select
      invoice.id,
      invoice.student_id,
      invoice.due_date
    from public.fee_invoices as invoice
    left join public.students as student
      on student.id = invoice.student_id
      and student.organization_id = invoice.organization_id
      and student.school_id = invoice.school_id
      and student.campus_id = invoice.campus_id
    where invoice.voided_at is null
      and (
        (target_class_names is null and target_section is null)
        or (
          student.id is not null
          and student.status = 'ACTIVE'
          and student.deleted_at is null
          and (
            target_class_names is null
            or student.class_name = any(target_class_names)
          )
          and (
            target_section is null
            or student.section ilike target_section
          )
        )
      )
  ),
  item_totals as (
    select item.invoice_id, sum(item.amount) as amount
    from public.fee_invoice_items as item
    join visible_invoices as invoice on invoice.id = item.invoice_id
    group by item.invoice_id
  ),
  payment_totals as (
    select payment.invoice_id, sum(payment.amount) as amount
    from public.fee_payments as payment
    join visible_invoices as invoice on invoice.id = payment.invoice_id
    where payment.voided_at is null
    group by payment.invoice_id
  ),
  invoice_balances as (
    select
      invoice.id,
      invoice.student_id,
      invoice.due_date,
      coalesce(items.amount, 0::numeric) as invoice_total,
      coalesce(payments.amount, 0::numeric) as paid_total,
      greatest(
        0::numeric,
        coalesce(items.amount, 0::numeric) - coalesce(payments.amount, 0::numeric)
      ) as outstanding
    from visible_invoices as invoice
    left join item_totals as items on items.invoice_id = invoice.id
    left join payment_totals as payments on payments.invoice_id = invoice.id
  )
  select jsonb_build_object(
    'outstandingAmount',
      (coalesce(sum(outstanding), 0::numeric)::numeric(30, 2))::text,
    'collectedAmount',
      (coalesce(sum(paid_total), 0::numeric)::numeric(30, 2))::text,
    'overdueAmount',
      (coalesce(sum(outstanding) filter (where due_date < current_date), 0::numeric)::numeric(30, 2))::text,
    'outstandingInvoiceCount',
      count(*) filter (where outstanding > 0),
    'overdueInvoiceCount',
      count(*) filter (where outstanding > 0 and due_date < current_date),
    'outstandingStudentCount',
      count(distinct student_id) filter (where outstanding > 0),
    'invoiceCount',
      count(*)
  )
  from invoice_balances;
$function$;

revoke all on function public.get_camvia_buddy_fee_summary(text[], text) from public, anon;
grant execute on function public.get_camvia_buddy_fee_summary(text[], text) to authenticated;

commit;
