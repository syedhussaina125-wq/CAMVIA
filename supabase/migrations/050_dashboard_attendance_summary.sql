begin;

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

commit;
