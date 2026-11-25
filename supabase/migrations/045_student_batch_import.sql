create or replace function public.create_students_batch(
  target_campus_id uuid,
  target_students jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $function$
declare
  student_record jsonb;
  student_index integer := 0;
  created_student_id uuid;
  row_result jsonb;
  batch_results jsonb := '[]'::jsonb;
  row_error_message text;
  row_error_code text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to import students.'
      using errcode = '42501';
  end if;

  if target_students is null or jsonb_typeof(target_students) <> 'array' then
    raise exception 'Student import rows must be provided as an array.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(target_students) < 1
    or jsonb_array_length(target_students) > 500
  then
    raise exception 'A student import batch must contain between 1 and 500 rows.'
      using errcode = '22023';
  end if;

  for student_record in
    select value
    from jsonb_array_elements(target_students) as rows(value)
  loop
    created_student_id := null;
    row_error_message := null;
    row_error_code := null;

    begin
      if jsonb_typeof(student_record) is distinct from 'object' then
        raise exception 'Each import row must be an object.'
          using errcode = '22023';
      end if;

      created_student_id := public.create_student(
        target_campus_id,
        student_record ->> 'student_code',
        student_record ->> 'first_name',
        student_record ->> 'last_name',
        student_record ->> 'class_name',
        student_record ->> 'section',
        student_record ->> 'roll_number',
        nullif(student_record ->> 'date_of_birth', '')::date,
        student_record ->> 'gender',
        student_record ->> 'guardian_first_name',
        student_record ->> 'guardian_last_name',
        student_record ->> 'guardian_phone',
        student_record ->> 'guardian_email',
        student_record ->> 'guardian_relationship'
      );

      row_result := jsonb_build_object(
        'row_index', student_index,
        'success', true,
        'student_id', created_student_id
      );
    exception when others then
      get stacked diagnostics
        row_error_message = message_text,
        row_error_code = returned_sqlstate;

      row_result := jsonb_build_object(
        'row_index', student_index,
        'success', false,
        'error_code', row_error_code,
        'error_message', row_error_message
      );
    end;

    batch_results := batch_results || jsonb_build_array(row_result);
    student_index := student_index + 1;
  end loop;

  return batch_results;
end;
$function$;

alter function public.create_students_batch(uuid, jsonb) owner to postgres;

revoke all on function public.create_students_batch(uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.create_students_batch(uuid, jsonb)
  to authenticated;
