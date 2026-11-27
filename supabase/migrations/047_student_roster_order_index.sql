create index if not exists students_active_roster_order_idx
  on public.students (organization_id, school_id, last_name, first_name, id)
  where deleted_at is null
    and archived_at is null
    and status <> 'ARCHIVED';
