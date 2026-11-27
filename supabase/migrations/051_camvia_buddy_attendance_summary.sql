begin;

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

commit;
