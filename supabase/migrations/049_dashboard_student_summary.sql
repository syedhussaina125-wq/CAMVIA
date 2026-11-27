begin;

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

commit;
