import { useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowLeft, Banknote, FileText, Search, Wallet, type LucideIcon } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import type { SchoolUser } from './mockData'
import type { Student } from './studentData'
import {
  canMutateFeeData,
  getFeeAgingBuckets,
  getFeeInvoices,
  getFeeMetrics,
  localDateKey,
  localMonthKey,
  type FeeAccessUser,
  type FeeInvoiceView,
  type FeePayment,
  type FeePaymentSubmission,
  type FeeState,
  type PaymentMethod,
} from './feeData'

type FeesPagesProps = {
  user: FeeAccessUser & { name: string }
  students: Student[]
  feeState: FeeState
  feeLoading: boolean
  feeError: string
  schoolUsers: SchoolUser[]
  onRecordPayment: (payment: FeePaymentSubmission) => Promise<boolean>
  onRetry: () => void
}

const paymentMethods: PaymentMethod[] = ['Cash', 'Bank Transfer', 'Card', 'Online']
const currentDate = localDateKey()

export function FeesPage(props: FeesPagesProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [month, setMonth] = useState(localMonthKey())
  const [classFilter, setClassFilter] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const allInvoices = useMemo(
    () => getFeeInvoices(props.feeState, props.students, props.user),
    [props.feeState, props.students, props.user],
  )

  if (props.feeLoading) return <FeesLoadingState />
  if (props.feeError) return <FeesErrorState error={props.feeError} onRetry={props.onRetry} />

  const months = [...new Set(allInvoices.map((invoice) => invoice.month))].sort().reverse()
  const classes = [...new Set(allInvoices.map((invoice) => invoice.student.className))].sort()
  const sections = [...new Set(allInvoices
    .filter((invoice) => !classFilter || invoice.student.className === classFilter)
    .map((invoice) => invoice.student.section))].sort()
  const filteredInvoices = allInvoices.filter((invoice) => {
    const student = invoice.student
    const matchesQuery = [
      `${student.firstName} ${student.lastName}`,
      student.studentId,
      student.className,
    ].join(' ').toLowerCase().includes(query.trim().toLowerCase())
    return matchesQuery &&
      (!month || invoice.month === month) &&
      (!classFilter || student.className === classFilter) &&
      (!sectionFilter || student.section === sectionFilter) &&
      (!statusFilter || invoice.status === statusFilter)
  })
  const metrics = getFeeMetrics(filteredInvoices)
  const overdueInvoices = allInvoices
    .filter((invoice) => invoice.overdueDays > 0)
    .sort((left, right) => right.overdueDays - left.overdueDays)
    .slice(0, 5)
  const aging = getFeeAgingBuckets(allInvoices)

  return (
    <section className="fees-page">
      <div className="fees-page-heading">
        <div>
          <p className="eyebrow">SEE · COLLECT · FOLLOW UP</p>
          <h1>Fees &amp; Collections</h1>
          <p>Track collections, outstanding balances, and follow-up priorities.</p>
        </div>
      </div>

      <div className="help-banner">
        <strong>Helpful tip:</strong> Outstanding and overdue balances are shown here.
      </div>

      <div className="fees-filters" aria-label="Fee filters">
        <label>Month<select value={month} onChange={(event) => setMonth(event.target.value)}>
          <option value="">All months</option>
          {months.map((item) => <option key={item} value={item}>{formatMonth(item)}</option>)}
        </select></label>
        <label>Class<select value={classFilter} onChange={(event) => {
          setClassFilter(event.target.value)
          setSectionFilter('')
        }}><option value="">All classes</option>{classes.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Section<select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}><option value="">All sections</option>{sections.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{['Paid', 'Partially Paid', 'Pending', 'Overdue'].map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>

      <div className="fees-summary-grid">
        <FeeMetric label="Expected" value={formatCurrency(metrics.expected)} icon={FileText} tone="blue" />
        <FeeMetric label="Collected" value={formatCurrency(metrics.collected)} icon={Banknote} tone="green" />
        <FeeMetric label="Outstanding" value={formatCurrency(metrics.outstanding)} icon={Wallet} tone="purple" />
        <FeeMetric label="Overdue" value={formatCurrency(metrics.overdue)} icon={AlertTriangle} tone="amber" />
      </div>

      <div className="fees-overview-grid">
        <section className="fees-panel">
          <div className="fees-panel-heading">
            <div><h2>Fee accounts</h2><p>{filteredInvoices.length} records for {month ? formatMonth(month) : 'all months'}</p></div>
            <label className="fees-search"><Search size={16} /><input aria-label="Search fee records" placeholder="Search student, ID, or class" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          </div>
          {filteredInvoices.length ? <FeeInvoiceTable invoices={filteredInvoices} onView={(id) => navigate(`/fees/${encodeURIComponent(id)}`)} /> : (
            <div className="fees-empty"><div className="fees-empty-icon"><Wallet size={20} /></div><strong>No fee records found for this period.</strong><p>Try another month or adjust your filters.</p></div>
          )}
        </section>

        <aside className="fees-side-column">
          <section className="fees-panel aging-panel">
            <div className="fees-panel-heading"><div><h2>Overdue aging</h2><p>Outstanding balances by age</p></div></div>
            <div className="aging-list">
              {Object.entries(aging).map(([label, bucket]) => (
                <div key={label}><span>{label}<small>{bucket.count} {bucket.count === 1 ? 'account' : 'accounts'}</small></span><strong>{formatCurrency(bucket.amount)}</strong></div>
              ))}
            </div>
          </section>
          <section className="fees-panel attention-panel">
            <div className="fees-panel-heading"><div><h2>Needs attention</h2><p>Up to 5 overdue accounts</p></div></div>
            {overdueInvoices.length ? (
              <div className="fee-attention-list">
                {overdueInvoices.map((invoice) => (
                  <article key={invoice.id}>
                    <div className="fee-attention-copy"><span className={`attention-level ${attentionLevel(invoice)}`}>{attentionLevel(invoice)}</span><strong>{invoice.student.firstName} {invoice.student.lastName}</strong><span>{formatCurrency(invoice.outstandingAmount)} overdue {invoice.overdueDays} days</span></div>
                    <div className="fee-attention-actions">
                      <button type="button" className="text-button" onClick={() => navigate(`/fees/${encodeURIComponent(invoice.studentId)}`)}>View Student</button>
                      {canMutateFeeData(props.user) ? <ReminderButton invoice={invoice} onPrepare={() => navigate(`/communication?studentId=${encodeURIComponent(invoice.studentId)}&sourceType=FEE&sourceId=${encodeURIComponent(invoice.id)}`)} /> : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="student-muted">All fees are up to date.</p>}
          </section>
        </aside>
      </div>
    </section>
  )
}

export function FeeStudentDetailPage(props: FeesPagesProps) {
  const navigate = useNavigate()
  const { studentId = '' } = useParams()
  const [activeInvoiceId, setActiveInvoiceId] = useState('')

  const invoices = useMemo(
    () => getFeeInvoices(props.feeState, props.students, props.user).filter((invoice) => invoice.studentId === studentId),
    [props.feeState, props.students, props.user, studentId],
  )

  if (props.feeLoading) return <FeesLoadingState />
  if (props.feeError) return <FeesErrorState error={props.feeError} onRetry={props.onRetry} />
  if (!invoices.length) {
    return <section className="fees-not-found"><div className="fees-empty-icon"><Wallet size={20} /></div><h1>Fee record not found</h1><p>This student may not have fee records in your authorized access.</p><button type="button" className="secondary-button small-button" onClick={() => navigate('/fees')}><ArrowLeft size={15} /> Back to Fees</button></section>
  }

  const student = invoices[0].student
  const metrics = getFeeMetrics(invoices)
  const invoice = invoices.find((item) => item.id === activeInvoiceId) ?? invoices.find((item) => item.outstandingAmount > 0) ?? invoices[0]
  const payments = props.feeState.payments
    .filter((payment) => invoices.some((item) => item.id === payment.invoiceId))
    .sort((left, right) => right.date.localeCompare(left.date))
  const principalReadOnly = props.user.role === 'principal'

  return (
    <section className="fees-page fee-detail-page">
      <button type="button" className="back-link" onClick={() => navigate('/fees')}><ArrowLeft size={16} /> Fees &amp; Collections</button>
      <div className="fees-page-heading detail-heading">
        <div><p className="eyebrow">Student fee account</p><h1>{student.firstName} {student.lastName}</h1><p>{student.studentId} <span>·</span> {student.className}-{student.section}</p></div>
        <span className="fee-role-note">{principalReadOnly ? 'Read-only overview' : 'Authorized fee record'}</span>
      </div>

      <div className="fees-summary-grid detail-metrics">
        <FeeMetric label="Total expected" value={formatCurrency(metrics.expected)} icon={FileText} tone="blue" />
        <FeeMetric label="Total paid" value={formatCurrency(metrics.collected)} icon={Banknote} tone="green" />
        <FeeMetric label="Outstanding" value={formatCurrency(metrics.outstanding)} icon={Wallet} tone="purple" />
        <FeeMetric label="Overdue" value={formatCurrency(metrics.overdue)} icon={AlertTriangle} tone="amber" />
      </div>

      <div className="fee-detail-grid">
        <div className="fee-detail-main">
          <section className="fees-panel">
            <div className="fees-panel-heading"><div><h2>Monthly fee items</h2><p>Choose an invoice to review or record a payment.</p></div></div>
            <div className="fee-invoice-list">
              {invoices.map((item) => (
                <button type="button" key={item.id} className={`fee-invoice-option ${invoice.id === item.id ? 'selected' : ''}`} onClick={() => setActiveInvoiceId(item.id)}>
                  <span><strong>{formatMonth(item.month)}</strong><small>Due {formatDate(item.dueDate)}</small></span>
                  <span><strong>{formatCurrency(item.outstandingAmount)}</strong><small className={`fee-status-badge ${statusClass(item.status)}`}>{item.status}</small></span>
                </button>
              ))}
            </div>
            <div className="fee-line-items">
              <h3>{formatMonth(invoice.month)} breakdown</h3>
              {invoice.lineItems.map((item) => <div key={item.id}><span>{item.label}</span><strong>{formatCurrency(item.amount)}</strong></div>)}
              <div className="fee-line-total"><span>Total</span><strong>{formatCurrency(invoice.totalAmount)}</strong></div>
            </div>
          </section>

          {canMutateFeeData(props.user) && invoice.outstandingAmount > 0 ? <PaymentForm key={invoice.id} invoice={invoice} onRecord={props.onRecordPayment} /> : null}
        </div>

        <section className="fees-panel payment-history-panel">
          <div className="fees-panel-heading"><div><h2>Payment history</h2><p>Recorded transactions for this student</p></div></div>
          {payments.length ? <div className="payment-history-list">
            {payments.map((payment) => <PaymentRow key={payment.id} payment={payment} users={props.schoolUsers} />)}
          </div> : <p className="student-muted">No payments have been recorded yet.</p>}
        </section>
      </div>
    </section>
  )
}

function FeeInvoiceTable({ invoices, onView }: { invoices: FeeInvoiceView[]; onView: (id: string) => void }) {
  return (
    <>
      <div className="fee-table-wrap">
        <table className="fee-table">
          <thead><tr><th>Student</th><th>Class</th><th>Expected</th><th>Paid</th><th>Outstanding</th><th>Due date</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{invoices.map((invoice) => <tr key={invoice.id}>
            <td><strong>{invoice.student.firstName} {invoice.student.lastName}</strong><small>{invoice.student.studentId}</small></td>
            <td>{invoice.student.className}-{invoice.student.section}</td>
            <td>{formatCurrency(invoice.totalAmount)}</td><td>{formatCurrency(invoice.paidAmount)}</td><td>{formatCurrency(invoice.outstandingAmount)}</td><td>{invoice.status === 'Paid' ? '—' : formatDate(invoice.dueDate)}</td>
            <td><span className={`fee-status-badge ${statusClass(invoice.status)}`}>{invoice.status}</span></td>
            <td><button type="button" className="text-button" onClick={() => onView(invoice.studentId)}>View</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="fee-mobile-list">{invoices.map((invoice) => <article className="fee-mobile-card" key={invoice.id}>
        <div className="fee-mobile-card-heading"><span><strong>{invoice.student.firstName} {invoice.student.lastName}</strong><small>{invoice.student.studentId} · {invoice.student.className}-{invoice.student.section}</small></span><span className={`fee-status-badge ${statusClass(invoice.status)}`}>{invoice.status}</span></div>
        <div className="fee-mobile-values"><span>Expected<strong>{formatCurrency(invoice.totalAmount)}</strong></span><span>Paid<strong>{formatCurrency(invoice.paidAmount)}</strong></span><span>Outstanding<strong>{formatCurrency(invoice.outstandingAmount)}</strong></span><span>Due date<strong>{invoice.status === 'Paid' ? '—' : formatDate(invoice.dueDate)}</strong></span></div>
        <button type="button" className="secondary-button small-button" onClick={() => onView(invoice.studentId)}>View fee details</button>
      </article>)}</div>
    </>
  )
}

function PaymentForm({ invoice, onRecord }: { invoice: FeeInvoiceView; onRecord: (payment: FeePaymentSubmission) => Promise<boolean> }) {
  const [amount, setAmount] = useState(String(invoice.outstandingAmount))
  const [date, setDate] = useState(currentDate)
  const [method, setMethod] = useState<PaymentMethod>('Cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const idempotencyKey = useRef('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    setError('')
    setSuccess('')
    setSubmitting(true)
    if (!idempotencyKey.current) {
      idempotencyKey.current = `payment-${invoice.id}-${Date.now()}-${Math.random()}`
    }
    try {
      const saved = await onRecord({
        invoiceId: invoice.id,
        amount: Number(amount),
        date,
        method,
        reference,
        note,
        idempotencyKey: idempotencyKey.current,
      })
      if (!saved) {
        setError('Payment could not be recorded. Review the payment details and try again.')
        return
      }
      setSuccess('Payment recorded successfully.')
      setAmount('')
      setReference('')
      setNote('')
      idempotencyKey.current = ''
    } catch {
      setError('Payment could not be recorded. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="fees-panel payment-form-panel">
      <div className="fees-panel-heading"><div><h2>Record payment</h2><p>Balance due: <strong>{formatCurrency(invoice.outstandingAmount)}</strong></p></div></div>
      <form className="fee-payment-form" onSubmit={handleSubmit}>
        <label>Amount<input type="number" min="0.01" max={invoice.outstandingAmount} step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>Payment date<input type="date" max={currentDate} required value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Payment method<select required value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{paymentMethods.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Reference number<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional" /></label>
        <label className="fee-note-field">Note <span>(optional)</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        {error ? <p className="fee-form-error" role="alert">{error}</p> : null}
        {success ? <p className="fee-form-success" role="status">{success}</p> : null}
        <button type="submit" className="primary-button" disabled={submitting}>{submitting ? 'Recording…' : 'Record Payment'}</button>
      </form>
    </section>
  )
}

function ReminderButton({ onPrepare }: { invoice: FeeInvoiceView; onPrepare: () => void }) {
  return <button type="button" className="text-button" onClick={onPrepare}>Prepare Reminder</button>
}

function PaymentRow({ payment, users }: { payment: FeePayment; users: SchoolUser[] }) {
  const name = users.find((user) => user.id === payment.recordedByUserId)?.name ?? 'School finance team'
  return <article className="payment-history-row">
    <div><strong>{formatDate(payment.date)}</strong><span>{formatCurrency(payment.amount)}</span></div>
    <div><span>{payment.method}</span><small>{payment.reference || 'No reference'} · {name}</small></div>
  </article>
}

function FeeMetric({ label, value, icon: Icon, tone }: { label: string; value: string; icon: LucideIcon; tone: string }) {
  return <article className={`fees-metric-card ${tone}`}><div><span>{label}</span><Icon size={18} /></div><strong>{value}</strong></article>
}

function FeesLoadingState() {
  return <section className="fees-page fees-loading" aria-label="Loading fee information"><div className="skeleton fees-title-skeleton" /><div className="fees-summary-grid">{Array.from({ length: 4 }).map((_, index) => <div className="skeleton fees-card-skeleton" key={index} />)}</div><div className="skeleton fees-content-skeleton" /></section>
}

function FeesErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <section className="fees-state-card"><div className="fees-empty-icon"><AlertTriangle size={20} /></div><h1>We couldn't load fee information.</h1><p>{error}</p><button type="button" className="primary-button small-button" onClick={onRetry}>Try Again</button></section>
}

function formatCurrency(amount: number): string {
  return `PKR ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(amount)}`
}

function formatDate(date: string): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00`))
}

function formatMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00`)
  return Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date)
}

function statusClass(status: FeeInvoiceView['status']): string {
  return status.toLowerCase().replace(' ', '-')
}

function attentionLevel(invoice: FeeInvoiceView): 'HIGH' | 'MEDIUM' | 'NOTICE' {
  return invoice.overdueDays > 60 ? 'HIGH' : invoice.overdueDays > 30 ? 'MEDIUM' : 'NOTICE'
}
