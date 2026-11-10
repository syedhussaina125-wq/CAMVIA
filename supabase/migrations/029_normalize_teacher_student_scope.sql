begin;

-- Keep teacher access scoped to assigned classes while tolerating harmless
-- differences in capitalization and whitespace in class/section labels.
create or replace function public.can_access_student(target_student_id uuid)
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
    where requester.id = auth.uid()
      and requester.status = 'ACTIVE'
      and requester.organization_id = student.organization_id
      and requester.school_id = student.school_id
      and (
        requester.role in ('ADMIN', 'PRINCIPAL', 'FINANCE')
        or exists (
          select 1
          from public.user_roles as assigned_role
          where assigned_role.user_id = requester.id
            and assigned_role.role in ('ADMIN', 'PRINCIPAL', 'FINANCE')
        )
        or exists (
          select 1
          from public.teacher_class_assignments as assignment
          where assignment.user_id = requester.id
            and assignment.active = true
            and assignment.school_id = student.school_id
            and assignment.campus_id = student.campus_id
            and lower(btrim(regexp_replace(assignment.class_name, '[[:space:]]+', ' ', 'g')))
              = lower(btrim(regexp_replace(student.class_name, '[[:space:]]+', ' ', 'g')))
            and lower(btrim(regexp_replace(assignment.section, '[[:space:]]+', ' ', 'g')))
              = lower(btrim(regexp_replace(student.section, '[[:space:]]+', ' ', 'g')))
        )
      )
  );
$function$;

revoke all on function public.can_access_student(uuid) from public, anon;
grant execute on function public.can_access_student(uuid) to authenticated;

commit;
