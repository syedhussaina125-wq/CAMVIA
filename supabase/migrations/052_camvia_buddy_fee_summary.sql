begin;

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
