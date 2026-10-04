import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { Student } from '../studentData'
import type { FeePaymentSubmission, FeeState, PaymentMethod } from '../feeData'

const client = supabase as any
const pageSize = 1000
const idBatchSize = 100

type InvoiceRow = {
  id: string
  organization_id: string
  school_id: string
  campus_id: string
  student_id: string
  fee_period: string
  due_date: string
  created_at: string
  updated_at: string
}

type InvoiceItemRow = {
  id: string
  invoice_id: string
  label: string
  amount: number | string
}

type PaymentRow = {
  id: string
  invoice_id: string
  student_id: string
  amount: number | string
  payment_date: string
  payment_method: PaymentMethod
  reference: string
  note: string
  idempotency_key: string
  received_by: string
}

function requireSupabase() {
  if (!isSupabaseConfigured || !client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return client
}

function profileDisplayId(authUserId: string): number {
  return authUserId.split('').reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0)
}

async function fetchAllRows<T>(
  db: any,
  table: string,
  select: string,
  invoiceIds?: string[],
): Promise<T[]> {
  const rows: T[] = []
  const batches = invoiceIds
    ? Array.from({ length: Math.ceil(invoiceIds.length / idBatchSize) }, (_, index) =>
      invoiceIds.slice(index * idBatchSize, (index + 1) * idBatchSize))
    : [undefined]

  for (const ids of batches) {
    for (let offset = 0; ; offset += pageSize) {
      let request = db.from(table).select(select).order('created_at', { ascending: false })
      if (ids) request = request.in('invoice_id', ids)
      const { data, error } = await request.range(offset, offset + pageSize - 1)
      if (error) throw error
      const page = (data ?? []) as T[]
      rows.push(...page)
      if (page.length < pageSize) break
    }
  }
  return rows
}

export async function fetchFeeState(students: Student[]): Promise<FeeState> {
  const db = requireSupabase()
  const invoiceRows = await fetchAllRows<InvoiceRow>(
    db,
    'fee_invoices',
    'id, organization_id, school_id, campus_id, student_id, fee_period, due_date, created_at, updated_at',
  )
  const invoiceIds = invoiceRows.map((invoice) => invoice.id)
  const [itemRows, paymentRows] = invoiceIds.length
    ? await Promise.all([
      fetchAllRows<InvoiceItemRow>(db, 'fee_invoice_items', 'id, invoice_id, label, amount', invoiceIds),
      fetchAllRows<PaymentRow>(
        db,
        'fee_payments',
        'id, invoice_id, student_id, amount, payment_date, payment_method, reference, note, idempotency_key, received_by',
        invoiceIds,
      ),
    ])
    : [[], []]

  const studentById = new Map(students.map((student) => [student.id, student]))
  const itemsByInvoice = new Map<string, InvoiceItemRow[]>()
  for (const item of itemRows) {
    const list = itemsByInvoice.get(item.invoice_id) ?? []
    list.push(item)
    itemsByInvoice.set(item.invoice_id, list)
  }

  return {
    invoices: invoiceRows.flatMap((row) => {
      const student = studentById.get(row.student_id)
      if (!student) return []
      const lineItems = (itemsByInvoice.get(row.id) ?? []).map((item) => ({
        id: item.id,
        invoiceId: item.invoice_id,
        label: item.label,
        amount: Number(item.amount),
      }))
      return [{
        id: row.id,
        studentId: row.student_id,
        schoolName: student.school ?? '',
        campusId: row.campus_id,
        organizationId: row.organization_id,
        schoolId: row.school_id,
        month: row.fee_period.slice(0, 7),
        dueDate: row.due_date,
        totalAmount: lineItems.reduce((total, item) => total + item.amount, 0),
        paidAmount: 0,
        status: 'Pending' as const,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lineItems,
      }]
    }),
    payments: paymentRows.map((row) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      amount: Number(row.amount),
      date: row.payment_date,
      method: row.payment_method,
      reference: row.reference,
      note: row.note,
      recordedByUserId: profileDisplayId(row.received_by),
      idempotencyKey: row.idempotency_key,
    })),
  }
}

export async function recordFeePayment(
  students: Student[],
  submission: FeePaymentSubmission,
): Promise<FeeState> {
  const db = requireSupabase()
  const invoice = await db
    .from('fee_invoices')
    .select('student_id')
    .eq('id', submission.invoiceId)
    .maybeSingle()

  if (invoice.error) throw invoice.error
  if (!invoice.data) throw new Error('The fee invoice is not available in your authorized scope.')

  const { error } = await db.rpc('record_fee_payment', {
    target_invoice_id: submission.invoiceId,
    target_student_id: invoice.data.student_id,
    target_amount: submission.amount,
    target_payment_date: submission.date,
    target_payment_method: submission.method,
    target_reference: submission.reference,
    target_note: submission.note,
    target_idempotency_key: submission.idempotencyKey,
  })
  if (error) throw error
  return fetchFeeState(students)
}
