import type { AttendanceStatus } from '../attendanceData'
import type { FeeState, PaymentMethod } from '../feeData'
import type { Student } from '../studentData'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

const client = supabase as any
const idBatchSize = 100
const pageSize = 1000

type StatementInvoiceRow = {
  id: string
  organization_id: string
  school_id: string
  campus_id: string
  student_id: string
  fee_period: string
  due_date: string
  created_at: string
  updated_at: string
  voided_at: string | null
  void_reason: string | null
}

type StatementInvoiceItemRow = {
  id: string
  invoice_id: string
  label: string
  amount: number | string
}

type StatementPaymentRow = {
  invoice_id: string
  amount: number | string
  payment_date: string
  payment_method: PaymentMethod
  voided_at: string | null
  void_reason: string | null
}

type AttendanceStatementRow = {
  status: AttendanceStatus
  attendance_sessions: {
    attendance_date: string
    class_name: string
    section: string
  }
}

function isMissingAttendanceTrashColumn(error: { code?: string; message?: string }): boolean {
  return error.code === '42703' && /trashed_at/i.test(error.message ?? '')
}

function requireSupabase() {
  if (!isSupabaseConfigured || !client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return client
}

async function fetchInvoiceRelations<T>(table: string, columns: string, invoiceIds: string[]): Promise<T[]> {
  const db = requireSupabase()
  const batches = Array.from({ length: Math.ceil(invoiceIds.length / idBatchSize) }, (_, index) =>
    invoiceIds.slice(index * idBatchSize, (index + 1) * idBatchSize),
  )

  const resultBatches = await Promise.all(batches.map(async (ids) => {
    const rows: T[] = []
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await db.from(table)
        .select(columns)
        .in('invoice_id', ids)
        .order('created_at', { ascending: true })
        .range(offset, offset + pageSize - 1)
      if (error) throw error
      const page = (data ?? []) as T[]
      rows.push(...page)
      if (page.length < pageSize) break
    }
    return rows
  }))

  return resultBatches.flat()
}

export async function fetchAccountStatementState(
  student: Student,
  fromMonth: string,
  toMonth: string,
): Promise<FeeState> {
  const db = requireSupabase()
  if (!student.schoolId || !student.organizationId) {
    throw new Error('This student is not available in your authorized school scope.')
  }

  const { data, error } = await db.from('fee_invoices')
    .select('id, organization_id, school_id, campus_id, student_id, fee_period, due_date, created_at, updated_at, voided_at, void_reason')
    .eq('student_id', student.id)
    .eq('school_id', student.schoolId)
    .eq('organization_id', student.organizationId)
    .gte('fee_period', `${fromMonth}-01`)
    .lte('fee_period', `${toMonth}-01`)
    .order('fee_period', { ascending: true })
  if (error) throw error

  const invoices = (data ?? []) as StatementInvoiceRow[]
  const invoiceIds = invoices.map((invoice) => invoice.id)
  const [items, payments] = invoiceIds.length
    ? await Promise.all([
      fetchInvoiceRelations<StatementInvoiceItemRow>(
        'fee_invoice_items',
        'id, invoice_id, label, amount',
        invoiceIds,
      ),
      fetchInvoiceRelations<StatementPaymentRow>(
        'fee_payments',
        'invoice_id, amount, payment_date, payment_method, voided_at, void_reason',
        invoiceIds,
      ),
    ])
    : [[], []]

  const itemsByInvoice = new Map<string, StatementInvoiceItemRow[]>()
  for (const item of items) {
    const list = itemsByInvoice.get(item.invoice_id) ?? []
    list.push(item)
    itemsByInvoice.set(item.invoice_id, list)
  }

  return {
    invoices: invoices.map((invoice) => {
      const lineItems = (itemsByInvoice.get(invoice.id) ?? []).map((item) => ({
        id: item.id,
        invoiceId: item.invoice_id,
        label: item.label,
        amount: Number(item.amount),
      }))
      return {
        id: invoice.id,
        studentId: invoice.student_id,
        schoolName: student.school ?? '',
        campusId: invoice.campus_id,
        organizationId: invoice.organization_id,
        schoolId: invoice.school_id,
        month: (invoice.fee_period ?? '').slice(0, 7),
        dueDate: invoice.due_date,
        totalAmount: lineItems.reduce((total, item) => total + item.amount, 0),
        paidAmount: 0,
        status: (invoice.voided_at ? 'Cancelled' : 'Pending') as import('../feeData').FeeStatus,
        createdAt: invoice.created_at,
        updatedAt: invoice.updated_at,
        voidedAt: invoice.voided_at,
        voidReason: invoice.void_reason,
        lineItems,
      }
    }),
    payments: payments.map((payment, index) => ({
      id: `statement-payment-${index}`,
      invoiceId: payment.invoice_id,
      amount: Number(payment.amount),
      date: payment.payment_date,
      method: payment.payment_method,
      reference: '',
      note: '',
      recordedByUserId: 0,
      idempotencyKey: '',
      voidedAt: payment.voided_at,
      voidReason: payment.void_reason,
    })),
  }
}

export async function fetchAttendanceStatementRecords(
  student: Student,
  dateFrom: string,
  dateTo: string,
  className?: string,
  section?: string,
): Promise<Array<{ date: string; status: AttendanceStatus; className: string; section: string }>> {
  const db = requireSupabase()
  if (!student.schoolId) {
    throw new Error('This student is not available in your authorized school scope.')
  }

  const rows: AttendanceStatementRow[] = []
  let trashColumnAvailable = true
  for (let offset = 0; ; offset += pageSize) {
    const request = () => {
      let query = db.from('attendance_records')
        .select('status, attendance_sessions!inner(attendance_date, class_name, section)')
        .eq('student_id', student.id)
        .eq('attendance_sessions.school_id', student.schoolId)
        .gte('attendance_sessions.attendance_date', dateFrom)
        .lte('attendance_sessions.attendance_date', dateTo)
        .order('attendance_date', { ascending: false, referencedTable: 'attendance_sessions' })
        .range(offset, offset + pageSize - 1)
      if (className) query = query.eq('attendance_sessions.class_name', className)
      if (section) query = query.eq('attendance_sessions.section', section)
      return query
    }

    let result = trashColumnAvailable
      ? await request().is('trashed_at', null)
      : await request()
    if (result.error && trashColumnAvailable && isMissingAttendanceTrashColumn(result.error)) {
      trashColumnAvailable = false
      if (import.meta.env.DEV) {
        console.warn('[CAMVIA Statements] Attendance Trash migration is not installed; loading legacy attendance records.', {
          operation: 'attendance_statement.select',
          role: 'unknown',
          column: 'attendance_records.trashed_at',
        })
      }
      result = await request()
    }
    const { data, error } = result
    if (error) throw error
    const page = (data ?? []) as AttendanceStatementRow[]
    rows.push(...page)
    if (page.length < pageSize) break
  }

  return rows.flatMap((record) => {
    if (!record.attendance_sessions) return []
    return [{
      date: record.attendance_sessions.attendance_date,
      status: record.status,
      className: record.attendance_sessions.class_name,
      section: record.attendance_sessions.section,
    }]
  })
}
