create index if not exists students_school_student_code_normalized_idx
  on public.students (school_id, lower(btrim(student_code)));

create index if not exists students_school_roll_number_normalized_idx
  on public.students (
    school_id,
    lower(btrim(class_name)),
    lower(btrim(section)),
    lower(btrim(roll_number))
  )
  where nullif(btrim(roll_number), '') is not null;

create index if not exists students_school_identity_normalized_idx
  on public.students (
    school_id,
    lower(btrim(first_name)),
    lower(btrim(last_name)),
    date_of_birth,
    lower(btrim(class_name)),
    lower(btrim(section))
  )
  where date_of_birth is not null;

create or replace function public.check_student_csv_duplicates(target_students jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $function$
declare
  actor public.profiles%rowtype;
  student_record jsonb;
  student_index integer := 0;
  row_result jsonb;
  check_results jsonb := '[]'::jsonb;
  duplicate_rule text;
  duplicate_message text;
  student_code text;
  first_name text;
  last_name text;
  class_name text;
  section_name text;
  roll_number text;
  date_of_birth date;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to check student duplicates.'
      using errcode = '42501';
  end if;

  select profile.*
    into actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.role = 'ADMIN';

  if not found or actor.organization_id is null or actor.school_id is null then
    raise exception 'Only active school administrators can check student duplicates.'
      using errcode = '42501';
  end if;

  if target_students is null or jsonb_typeof(target_students) <> 'array' then
    raise exception 'Student CSV rows must be provided as an array.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(target_students) > 1500 then
    raise exception 'A student CSV can contain at most 1,500 rows.'
      using errcode = '22023';
  end if;

  for student_record in
    select value
    from jsonb_array_elements(target_students) as rows(value)
  loop
    if jsonb_typeof(student_record) is distinct from 'object' then
      raise exception 'Each student CSV row must be an object.'
        using errcode = '22023';
    end if;

    student_code := nullif(btrim(student_record ->> 'student_code'), '');
    first_name := nullif(btrim(student_record ->> 'first_name'), '');
    last_name := nullif(btrim(student_record ->> 'last_name'), '');
    class_name := nullif(btrim(student_record ->> 'class_name'), '');
    section_name := nullif(btrim(student_record ->> 'section'), '');
    roll_number := nullif(btrim(student_record ->> 'roll_number'), '');
    date_of_birth := nullif(student_record ->> 'date_of_birth', '')::date;
    duplicate_rule := null;
    duplicate_message := null;

    if student_code is not null and exists (
      select 1
      from public.students as existing_student
      where existing_student.school_id = actor.school_id
        and lower(btrim(existing_student.student_code)) = lower(student_code)
    ) then
      duplicate_rule := 'student_id';
      duplicate_message := 'Student ID already exists.';
    elsif roll_number is not null and exists (
      select 1
      from public.students as existing_student
      where existing_student.school_id = actor.school_id
        and lower(btrim(existing_student.class_name)) = lower(coalesce(class_name, ''))
        and lower(btrim(existing_student.section)) = lower(coalesce(section_name, ''))
        and lower(btrim(existing_student.roll_number)) = lower(roll_number)
    ) then
      duplicate_rule := 'roll_number';
      duplicate_message := format(
        'Roll number already exists in %s-%s.',
        coalesce(class_name, ''),
        coalesce(section_name, '')
      );
    elsif date_of_birth is not null
      and first_name is not null
      and last_name is not null
      and class_name is not null
      and section_name is not null
      and exists (
        select 1
        from public.students as existing_student
        where existing_student.school_id = actor.school_id
          and lower(btrim(existing_student.first_name)) = lower(first_name)
          and lower(btrim(existing_student.last_name)) = lower(last_name)
          and existing_student.date_of_birth = date_of_birth
          and lower(btrim(existing_student.class_name)) = lower(class_name)
          and lower(btrim(existing_student.section)) = lower(section_name)
      )
    then
      duplicate_rule := 'identity';
      duplicate_message := 'Possible duplicate student found. Review before creating.';
    end if;

    if duplicate_rule is null then
      row_result := jsonb_build_object(
        'row_index', student_index,
        'is_duplicate', false
      );
    else
      row_result := jsonb_build_object(
        'row_index', student_index,
        'is_duplicate', true,
        'rule', duplicate_rule,
        'message', duplicate_message
      );
    end if;

    check_results := check_results || jsonb_build_array(row_result);
    student_index := student_index + 1;
  end loop;

  return check_results;
end;
$function$;

alter function public.check_student_csv_duplicates(jsonb) owner to postgres;

revoke all on function public.check_student_csv_duplicates(jsonb)
  from public, anon, authenticated;

grant execute on function public.check_student_csv_duplicates(jsonb)
  to authenticated;
