-- Forward-only migration 023: Fee Invoice Creation
-- Atomic RPC create_fee_invoice for ADMIN and FINANCE roles.
-- Does NOT set row_security = off. Enforces strict tenant and role isolation.

begin;

-- 1. Extend user_management_audit event_type check safely
do $reconcile_audit_check$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.user_management_audit'::regclass
      and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) like '%event_type%'
  loop
    execute format(
      'alter table public.user_management_audit drop constraint if exists %I',
      constraint_record.conname
    );
  end loop;

  alter table public.user_management_audit
    add constraint user_management_audit_event_type_check
    check (event_type in (
      'STUDENT_CREATED',
      'USER_CREATED',
      'USER_UPDATED',
      'USER_ROLE_CHANGED',
      'USER_DEACTIVATED',
      'INVOICE_CREATED'
    ));
end;
$reconcile_audit_check$;

-- 2. Create the create_fee_invoice atomic RPC
create or replace function public.create_fee_invoice(
  target_student_id uuid,
  target_fee_period date,
  target_due_date date,
  target_line_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  actor_id uuid;
  actor public.profiles%rowtype;
  student public.students%rowtype;
  normalized_fee_period date;
  new_invoice_id uuid;
  line_item jsonb;
  item_label text;
  item_amount numeric(12, 2);
  total_amount numeric(12, 2) := 0;
  line_item_count integer := 0;
begin
  -- 1. Caller identity & active role check
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'Authentication is required to create fee invoices.'
      using errcode = '42501';
  end if;

  select *
  into actor
  from public.profiles
  where id = actor_id
    and status = 'ACTIVE'
    and role in ('ADMIN', 'FINANCE')
    and organization_id is not null
    and school_id is not null;

  if not found then
    raise exception 'Only an active school administrator or finance officer can create fee invoices.'
      using errcode = '42501';
  end if;

  -- 2. Student validation (tenant isolation & active status)
  if target_student_id is null then
    raise exception 'A valid student is required.'
      using errcode = '22023';
  end if;

  select *
  into student
  from public.students
  where id = target_student_id
    and organization_id = actor.organization_id
    and school_id = actor.school_id;

  if not found then
    raise exception 'The selected student is outside your school or does not exist.'
      using errcode = '42501';
  end if;

  if student.status <> 'ACTIVE' then
    raise exception 'Fee invoices can only be created for active students.'
      using errcode = '22023';
  end if;

  -- 3. Fee Period & Due Date validation
  if target_fee_period is null then
    raise exception 'Fee period date is required.'
      using errcode = '22023';
  end if;

  normalized_fee_period := date_trunc('month', target_fee_period)::date;

  if target_due_date is null then
    raise exception 'Invoice due date is required.'
      using errcode = '22023';
  end if;

  if target_due_date < normalized_fee_period then
    raise exception 'Invoice due date cannot be before the fee period.'
      using errcode = '22023';
  end if;

  -- 4. Line items JSON validation
  if target_line_items is null
    or jsonb_typeof(target_line_items) <> 'array'
    or jsonb_array_length(target_line_items) = 0
  then
    raise exception 'Invoice must contain at least one line item.'
      using errcode = '22023';
  end if;

  for line_item in select value from jsonb_array_elements(target_line_items)
  loop
    item_label := nullif(btrim(line_item->>'label'), '');
    if item_label is null or length(item_label) > 160 then
      raise exception 'Every line item must have a valid label (up to 160 characters).'
        using errcode = '22023';
    end if;

    begin
      item_amount := (line_item->>'amount')::numeric(12, 2);
    exception when others then
      raise exception 'Line item amount must be a valid number.'
        using errcode = '22023';
    end;

    if item_amount is null or item_amount <= 0 then
      raise exception 'Line item amount must be greater than zero.'
        using errcode = '22023';
    end if;

    total_amount := total_amount + item_amount;
    line_item_count := line_item_count + 1;
  end loop;

  if total_amount <= 0 or line_item_count = 0 then
    raise exception 'Total invoice amount must be greater than zero.'
      using errcode = '22023';
  end if;

  -- 5. Advisory lock & Duplicate Monthly Invoice Check
  perform pg_advisory_xact_lock(
    hashtextextended(target_student_id::text || ':' || normalized_fee_period::text, 0)
  );

  if exists (
    select 1
    from public.fee_invoices
    where student_id = target_student_id
      and fee_period = normalized_fee_period
  ) then
    raise exception 'An invoice already exists for this student for %.', to_char(normalized_fee_period, 'Mon YYYY')
      using errcode = '23505';
  end if;

  -- 6. Insert into fee_invoices
  insert into public.fee_invoices (
    organization_id,
    school_id,
    campus_id,
    student_id,
    fee_period,
    due_date,
    created_by
  )
  values (
    actor.organization_id,
    actor.school_id,
    student.campus_id,
    student.id,
    normalized_fee_period,
    target_due_date,
    actor_id
  )
  returning id into new_invoice_id;

  -- 7. Insert into fee_invoice_items
  for line_item in select value from jsonb_array_elements(target_line_items)
  loop
    insert into public.fee_invoice_items (
      invoice_id,
      label,
      amount
    )
    values (
      new_invoice_id,
      btrim(line_item->>'label'),
      (line_item->>'amount')::numeric(12, 2)
    );
  end loop;

  -- 8. Write immutable audit record
  insert into public.user_management_audit (
    actor_id,
    target_id,
    event_type,
    details
  )
  values (
    actor_id,
    new_invoice_id,
    'INVOICE_CREATED',
    jsonb_build_object(
      'student_id', student.id,
      'student_code', student.student_code,
      'fee_period', normalized_fee_period,
      'due_date', target_due_date,
      'total_amount', total_amount,
      'line_item_count', line_item_count
    )
  );

  -- 9. Return JSON confirmation
  return jsonb_build_object(
    'invoice_id', new_invoice_id,
    'student_id', student.id,
    'fee_period', normalized_fee_period,
    'due_date', target_due_date,
    'total_amount', total_amount,
    'line_item_count', line_item_count
  );
end;
$function$;

-- 3. Set ownership and restrict execution grants
alter function public.create_fee_invoice(uuid, date, date, jsonb) owner to postgres;

revoke all on function public.create_fee_invoice(uuid, date, date, jsonb) from public, anon;
grant execute on function public.create_fee_invoice(uuid, date, date, jsonb) to authenticated, service_role;

commit;

