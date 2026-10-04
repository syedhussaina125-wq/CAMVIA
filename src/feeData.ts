import type { Role } from './mockData'
import type { Student } from './studentData'

export type FeeStatus = 'Paid' | 'Partially Paid' | 'Pending' | 'Overdue'
export type PaymentMethod = 'Cash' | 'Bank Transfer' | 'Card' | 'Online'
export type FeeLineItem = {
  id: string
  invoiceId: string
  label: string
  amount: number
}

export type FeeInvoice = {
  id: string
  studentId: string
  schoolName: string
  campusId: string
  organizationId?: string
  schoolId?: string
  month: string
  dueDate: string
  totalAmount: number
  paidAmount: number
  status: FeeStatus
  createdAt: string
  updatedAt: string
  lineItems: FeeLineItem[]
}

export type FeePayment = {
  id: string
  invoiceId: string
  amount: number
  date: string
  method: PaymentMethod
  reference: string
  note: string
  recordedByUserId: number
  idempotencyKey: string
}

export type FeeState = {
  invoices: FeeInvoice[]
  payments: FeePayment[]
}

export type FeeAccessUser = {
  id: number
  role: Role
  schoolName: string
  campusName: string
  organizationId?: string | null
  schoolId?: string | null
}

export type FeePaymentSubmission = {
  invoiceId: string
  amount: number
  date: string
  method: PaymentMethod
  reference: string
  note: string
  idempotencyKey: string
}

export type FeeInvoiceView = FeeInvoice & {
  student: Student
  paidAmount: number
  outstandingAmount: number
  status: FeeStatus
  overdueDays: number
}

const dayMilliseconds = 24 * 60 * 60 * 1000

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

export function localMonthKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + days)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function daysBetween(earlier: string, later: string): number {
  const start = Date.parse(`${earlier}T00:00:00Z`)
  const end = Date.parse(`${later}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, Math.floor((end - start) / dayMilliseconds))
}

function campusKey(campusName: string): string {
  return campusName.trim().toLowerCase()
}

export function canAccessFeeData(user: FeeAccessUser): boolean {
  return user.role !== 'teacher' &&
    (user.role === 'admin' || user.role === 'principal' || user.role === 'finance')
}

export function canMutateFeeData(user: FeeAccessUser): boolean {
  return user.role === 'admin' || user.role === 'finance'
}

export function getFeeInvoices(
  state: FeeState,
  students: Student[],
  user: FeeAccessUser,
  today = new Date().toISOString().slice(0, 10),
): FeeInvoiceView[] {
  if (!canAccessFeeData(user) || !Array.isArray(state?.invoices) || !Array.isArray(state?.payments)) return []

  const authorizedStudents = new Map(
    students
      .filter((student) =>
        (!user.organizationId || student.organizationId === user.organizationId) &&
        (!user.schoolId || student.schoolId === user.schoolId) &&
        (user.schoolId || campusKey(student.campus) === campusKey(user.campusName)),
      )
      .map((student) => [student.id, student]),
  )
  if (!authorizedStudents.size) return []

  const paymentsByInvoice = new Map<string, number>()
  for (const payment of state.payments) {
    paymentsByInvoice.set(payment.invoiceId, roundMoney((paymentsByInvoice.get(payment.invoiceId) ?? 0) + payment.amount))
  }

  return state.invoices.flatMap((invoice) => {
    const student = authorizedStudents.get(invoice.studentId)
    if (!student) return []
    if (user.schoolId) {
      if (invoice.schoolId !== user.schoolId || invoice.organizationId !== user.organizationId || invoice.campusId !== student.campusId) return []
    } else if (invoice.schoolName !== user.schoolName || invoice.campusId !== campusKey(user.campusName)) {
      return []
    }
    const paidAmount = paymentsByInvoice.get(invoice.id) ?? 0
    const outstandingAmount = roundMoney(Math.max(0, invoice.totalAmount - paidAmount))
    const overdueDays = outstandingAmount > 0 ? daysBetween(invoice.dueDate, today) : 0
    const status: FeeStatus = outstandingAmount === 0
      ? 'Paid'
      : paidAmount > 0
        ? 'Partially Paid'
        : invoice.dueDate < today
          ? 'Overdue'
          : 'Pending'
    return [{ ...invoice, student, paidAmount, outstandingAmount, status, overdueDays }]
  })
}

export function getFeeMetrics(invoices: FeeInvoiceView[]) {
  return {
    expected: roundMoney(invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0)),
    collected: roundMoney(invoices.reduce((sum, invoice) => sum + invoice.paidAmount, 0)),
    outstanding: roundMoney(invoices.reduce((sum, invoice) => sum + invoice.outstandingAmount, 0)),
    overdue: roundMoney(invoices.reduce(
      (sum, invoice) => sum + (invoice.overdueDays > 0 ? invoice.outstandingAmount : 0),
      0,
    )),
  }
}

export function getFeeAgingBuckets(invoices: FeeInvoiceView[]) {
  const buckets = {
    '1–30 days': { count: 0, amount: 0 },
    '31–60 days': { count: 0, amount: 0 },
    '60+ days': { count: 0, amount: 0 },
  }
  for (const invoice of invoices) {
    if (invoice.overdueDays <= 0) continue
    const bucket = invoice.overdueDays <= 30
      ? buckets['1–30 days']
      : invoice.overdueDays <= 60
        ? buckets['31–60 days']
        : buckets['60+ days']
    bucket.count += 1
    bucket.amount = roundMoney(bucket.amount + invoice.outstandingAmount)
  }
  return buckets
}

export function getFeeCollectionTrend(
  state: FeeState,
  students: Student[],
  user: FeeAccessUser,
  today = new Date().toISOString().slice(0, 10),
) {
  if (!Array.isArray(state?.payments)) return []
  const authorizedInvoiceIds = new Set(getFeeInvoices(state, students, user, today).map((invoice) => invoice.id))
  return Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(today, index - 6)
    const collected = state.payments
      .filter((payment) => payment.date === date && authorizedInvoiceIds.has(payment.invoiceId))
      .reduce((sum, payment) => sum + payment.amount, 0)
    const day = new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(`${date}T00:00:00`))
    return { day, value: roundMoney(collected) }
  })
}

export function getFeePaymentsCollected(
  state: FeeState,
  students: Student[],
  user: FeeAccessUser,
  month = localMonthKey(),
): number {
  if (!Array.isArray(state?.payments)) return 0
  const authorizedInvoiceIds = new Set(getFeeInvoices(state, students, user).map((invoice) => invoice.id))
  return roundMoney(state.payments
    .filter((payment) => payment.date.startsWith(`${month}-`) && authorizedInvoiceIds.has(payment.invoiceId))
    .reduce((sum, payment) => sum + payment.amount, 0))
}
