import { useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, CalendarDays, Download, FileText, Printer } from 'lucide-react'
import type { jsPDF } from 'jspdf'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { AttendanceStatus } from './attendanceData'
import { getAttendanceCountsFromStatuses } from './attendanceData'
import {
  getFeeStatementMetrics,
  type FeeAccessUser,
  type FeeState,
} from './feeData'
import type { Role, SessionUser } from './mockData'
import type { Student } from './studentData'
import { fetchAccountStatementState, fetchAttendanceStatementRecords } from './services/statements'
import camviaLogo from './assets/camvia-light-logo.png'
import { schoolDateKey } from './utils/schoolTimezone'

export type StatementKind = 'account' | 'attendance'

type StatementsPageProps = {
  user: SessionUser
  students: Student[]
  studentsLoading: boolean
  studentsError: string
  onRetryStudents: () => void
  kind: StatementKind
}

type AttendanceStatementRow = {
  date: string
  status: AttendanceStatus
  className: string
  section: string
}

type StatementData =
  | {
      kind: 'account'
      student: Student
      accessUser: FeeAccessUser
      dateFrom: string
      dateTo: string
      feePeriod: string
      timeZone: string | null | undefined
      state: FeeState
    }
  | {
      kind: 'attendance'
      student: Student
      dateFrom: string
      dateTo: string
      className: string
      section: string
      timeZone: string | null | undefined
      records: AttendanceStatementRow[]
    }

type AccountLedgerRow = {
  date: string
  description: string
  invoiceAmount: number | null
  paymentAmount: number | null
  status: string
  balance: number
  cancellationReason?: string
}

function canViewAccountStatement(role: Role): boolean {
  return role === 'admin' || role === 'principal' || role === 'finance'
}

function canViewAttendanceStatement(role: Role): boolean {
  return role === 'admin' || role === 'principal' || role === 'teacher'
}

function isStudentInActiveTeacherAssignment(
  student: Student,
  user: SessionUser,
): boolean {
  return user.teacherAssignments.some((assignment) =>
    assignment.active &&
    assignment.school_id === student.schoolId &&
    assignment.campus_id === student.campusId &&
    assignment.class_name.trim().replace(/\s+/g, ' ').toLowerCase() === student.className.trim().replace(/\s+/g, ' ').toLowerCase() &&
    assignment.section.trim().replace(/\s+/g, ' ').toLowerCase() === student.section.trim().replace(/\s+/g, ' ').toLowerCase(),
  )
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDate(value: string): string {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date)
}

function statementMonths(dateFrom: string, dateTo: string, feePeriod: string): [string, string] {
  return feePeriod
    ? [feePeriod, feePeriod]
    : [dateFrom.slice(0, 7), dateTo.slice(0, 7)]
}

function buildAccountLedgerRows(
  data: Extract<StatementData, { kind: 'account' }>,
): AccountLedgerRow[] {
  const months = statementMonths(data.dateFrom, data.dateTo, data.feePeriod)
  const summary = getFeeStatementMetrics(data.state, data.student, data.accessUser, months[0], months[1])
  const invoices = new Map(summary.invoices.map((invoice) => [invoice.id, invoice]))
  const entries: Array<AccountLedgerRow & { order: number; invoiceId: string }> = []

  for (const invoice of summary.invoices) {
    const cancelled = Boolean(invoice.voidedAt)
    entries.push({
      date: cancelled ? invoice.voidedAt!.slice(0, 10) : `${invoice.month}-01`,
      description: invoice.lineItems.map((item) => item.label).join(', ') || 'Fee invoice',
      invoiceAmount: invoice.totalAmount,
      paymentAmount: null,
      status: cancelled ? 'Cancelled' : invoice.status,
      balance: 0,
      cancellationReason: cancelled ? invoice.voidReason ?? undefined : undefined,
      order: 0,
      invoiceId: invoice.id,
    })
  }

  for (const payment of data.state.payments) {
    const invoice = invoices.get(payment.invoiceId)
    if (!invoice) continue
    const cancelled = Boolean(payment.voidedAt || invoice.voidedAt)
    entries.push({
      date: payment.voidedAt ? payment.voidedAt.slice(0, 10) : payment.date,
      description: `Payment — ${payment.method}`,
      invoiceAmount: null,
      paymentAmount: payment.amount,
      status: cancelled ? 'Cancelled' : 'Paid',
      balance: 0,
      cancellationReason: payment.voidedAt
        ? payment.voidReason ?? undefined
        : invoice.voidedAt
          ? invoice.voidReason ?? undefined
          : undefined,
      order: 1,
      invoiceId: invoice.id,
    })
  }

  entries.sort((left, right) =>
    (left.date ?? '').localeCompare(right.date ?? '') || left.order - right.order || left.invoiceId.localeCompare(right.invoiceId),
  )

  let balance = 0
  return entries.map(({ order: _order, invoiceId, ...entry }) => {
    const invoice = invoices.get(invoiceId)
    if (entry.status !== 'Cancelled') {
      if (entry.invoiceAmount !== null) balance += entry.invoiceAmount
      if (entry.paymentAmount !== null) balance -= entry.paymentAmount
    }
    balance = Math.round((balance + Number.EPSILON) * 100) / 100
    return {
      ...entry,
      balance,
      cancellationReason: entry.cancellationReason ?? (entry.status === 'Cancelled' ? invoice?.voidReason ?? undefined : undefined),
    }
  })
}

function makeFilename(kind: StatementKind, studentId: string, timeZone: string | null | undefined): string {
  const safeStudentId = studentId.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Student'
  const date = schoolDateKey(timeZone)
  return `CAMVIA_${kind === 'account' ? 'Account' : 'Attendance'}_Statement_${safeStudentId}_${date}.pdf`
}

async function downloadPdf(data: StatementData): Promise<void> {
  const [{ jsPDF: JsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const document = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const logo = new Image()
  logo.src = camviaLogo
  try {
    await logo.decode()
    document.addImage(logo, 'PNG', 14, 10, 48, 16)
  } catch {
    // Continue PDF generation without logo if image decoding fails.
  }
  document.setTextColor(25, 45, 80)
  document.setFontSize(17)
  document.setFont('helvetica', 'bold')
  document.text(data.kind === 'account' ? 'Account Statement' : 'Attendance Statement', 14, 35)
  document.setFontSize(9)
  document.setFont('helvetica', 'normal')
  document.text(`${data.student.school || data.student.campus}  |  ${data.student.campus}`, 14, 42)
  document.text(`Student: ${data.student.firstName} ${data.student.lastName}`, 14, 49)
  document.text(`Student ID: ${data.student.studentId}  |  Class: ${data.student.className}  |  Section: ${data.student.section}`, 14, 55)
  document.text(`Date From: ${formatDate(data.dateFrom)}  |  Date To: ${formatDate(data.dateTo)}`, 14, 61)
  document.text(`Generated: ${formatDate(schoolDateKey(data.timeZone))}`, 14, 67)

  if (data.kind === 'account') {
    const months = statementMonths(data.dateFrom, data.dateTo, data.feePeriod)
    const summary = getFeeStatementMetrics(data.state, data.student, data.accessUser, months[0], months[1])
    autoTable(document, {
      startY: 74,
      head: [['Total Invoiced', 'Total Paid', 'Outstanding Balance', 'Cancelled Invoices', 'Cancelled Payments']],
      body: [[
        formatCurrency(summary.totalInvoiced),
        formatCurrency(summary.totalPaid),
        formatCurrency(summary.outstanding),
        formatCurrency(summary.cancelledInvoices),
        formatCurrency(summary.cancelledPayments),
      ]],
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2.5, textColor: [30, 42, 70], lineColor: [180, 190, 205], lineWidth: 0.15 },
      headStyles: { fillColor: [238, 243, 249], textColor: [25, 45, 80], fontStyle: 'bold' },
      margin: { left: 14, right: 14 },
    })
    const ledgerRows = buildAccountLedgerRows(data)
    autoTable(document, {
      startY: (document as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
        ? (document as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
        : 96,
      head: [['Date', 'Description', 'Invoice Amount', 'Payment Amount', 'Status', 'Balance']],
      body: ledgerRows.length
        ? ledgerRows.map((row) => [
          formatDate(row.date),
          `${row.description}${row.cancellationReason ? `\nCancellation Reason: ${row.cancellationReason}` : ''}`,
          row.invoiceAmount === null ? '—' : formatCurrency(row.invoiceAmount),
          row.paymentAmount === null ? '—' : formatCurrency(row.paymentAmount),
          row.status,
          formatCurrency(row.balance),
        ])
        : [[{ content: 'No financial records found for the selected period.', colSpan: 6 }]],
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2, overflow: 'linebreak', textColor: [30, 42, 70], lineColor: [180, 190, 205], lineWidth: 0.15 },
      headStyles: { fillColor: [238, 243, 249], textColor: [25, 45, 80], fontStyle: 'bold' },
      columnStyles: { 1: { cellWidth: 48 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 5: { halign: 'right' } },
      margin: { left: 14, right: 14, top: 16, bottom: 14 },
      showHead: 'everyPage',
      didDrawPage: () => {
        document.setFontSize(8)
        document.setTextColor(90, 100, 115)
        document.text('CAMVIA Account Statement', 14, 8)
      },
    })
  } else {
    const counts = getAttendanceCountsFromStatuses(data.records.map((record) => record.status))
    autoTable(document, {
      startY: 74,
      head: [['Total Recorded Days', 'Present Days', 'Absent Days', 'Late Days', 'Attendance Percentage']],
      body: [[String(counts.total), String(counts.present), String(counts.absent), String(counts.late), `${counts.rate ?? 0}%`]],
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2.5, textColor: [30, 42, 70], lineColor: [180, 190, 205], lineWidth: 0.15 },
      headStyles: { fillColor: [238, 243, 249], textColor: [25, 45, 80], fontStyle: 'bold' },
      margin: { left: 14, right: 14 },
    })
    autoTable(document, {
      startY: (document as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
        ? (document as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
        : 96,
      head: [['Date', 'Status', 'Class / Section']],
      body: data.records.length
        ? data.records.map((record) => [
          formatDate(record.date),
          attendanceStatusLabel(record.status),
          `${record.className} / ${record.section}`,
        ])
        : [[{ content: 'No attendance records found for the selected period.', colSpan: 3 }]],
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2.5, textColor: [30, 42, 70], lineColor: [180, 190, 205], lineWidth: 0.15 },
      headStyles: { fillColor: [238, 243, 249], textColor: [25, 45, 80], fontStyle: 'bold' },
      margin: { left: 14, right: 14, top: 16, bottom: 14 },
      showHead: 'everyPage',
      didDrawPage: () => {
        document.setFontSize(8)
        document.setTextColor(90, 100, 115)
        document.text('CAMVIA Attendance Statement', 14, 8)
      },
    })
  }

  document.save(makeFilename(data.kind, data.student.studentId, data.timeZone))
}

function attendanceStatusLabel(status: AttendanceStatus): string {
  if (status === 'PRESENT') return 'Present'
  if (status === 'ABSENT') return 'Absent'
  return 'Late'
}

export function StatementsPage({
  user,
  students,
  studentsLoading,
  studentsError,
  onRetryStudents,
  kind,
}: StatementsPageProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const today = schoolDateKey(user.schoolTimezone)
  const firstDayOfMonth = `${today.slice(0, 7)}-01`
  const [studentId, setStudentId] = useState(searchParams.get('studentId') ?? '')
  const [dateFrom, setDateFrom] = useState(() => firstDayOfMonth)
  const [dateTo, setDateTo] = useState(() => today)
  const [feePeriod, setFeePeriod] = useState('')
  const [className, setClassName] = useState('')
  const [section, setSection] = useState('')
  const [statement, setStatement] = useState<StatementData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pdfError, setPdfError] = useState('')

  const mayView = kind === 'account'
    ? canViewAccountStatement(user.role)
    : canViewAttendanceStatement(user.role)
  const selectableStudents = useMemo(() => students.filter((student) =>
    user.role !== 'teacher' || isStudentInActiveTeacherAssignment(student, user),
  ), [students, user])
  const selectedStudent = selectableStudents.find((student) => student.id === studentId)
  const attendanceClasses = selectedStudent ? [selectedStudent.className] : []
  const attendanceSections = selectedStudent ? [selectedStudent.section] : []

  const accountSummary = statement?.kind === 'account'
    ? getFeeStatementMetrics(
      statement.state,
      statement.student,
      statement.accessUser,
      ...statementMonths(statement.dateFrom, statement.dateTo, statement.feePeriod),
    )
    : null
  const accountLedger = statement?.kind === 'account' ? buildAccountLedgerRows(statement) : []
  const attendanceSummary = statement?.kind === 'attendance'
    ? getAttendanceCountsFromStatuses(statement.records.map((record) => record.status))
    : null

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setPdfError('')
    setStatement(null)
    if (!selectedStudent) {
      setError('Choose a student who is available in your account.')
      return
    }
    if (dateFrom > dateTo) {
      setError('Date From must be before Date To.')
      return
    }
    if (feePeriod && (feePeriod < dateFrom.slice(0, 7) || feePeriod > dateTo.slice(0, 7))) {
      setError('Fee Period / Month must fall within the selected date range.')
      return
    }

    setLoading(true)
    try {
      if (kind === 'account') {
        const [fromMonth, toMonth] = statementMonths(dateFrom, dateTo, feePeriod)
        const state = await fetchAccountStatementState(selectedStudent, fromMonth, toMonth)
        setStatement({ kind, student: selectedStudent, accessUser: user, dateFrom, dateTo, feePeriod, timeZone: user.schoolTimezone, state })
      } else {
        const records = await fetchAttendanceStatementRecords(
          selectedStudent,
          dateFrom,
          dateTo,
          className,
          section,
        )
        setStatement({ kind, student: selectedStudent, dateFrom, dateTo, className, section, timeZone: user.schoolTimezone, records })
      }
    } catch (requestError) {
      console.error(`[Statements] ${kind} statement could not be loaded:`, requestError)
      setError('Statement could not be loaded. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!statement) return
    setPdfError('')
    try {
      await downloadPdf(statement)
    } catch (downloadError) {
      console.error('[Statements] PDF could not be generated:', downloadError)
      setPdfError('PDF could not be generated. Please try again.')
    }
  }

  if (!mayView) {
    return <section className="statement-page"><p role="alert">This statement is not available for your account.</p></section>
  }

  return (
    <section className="statement-page">
      <header className="statement-page-heading statement-no-print">
        <div>
          <button
            type="button"
            className="back-link"
            onClick={() => navigate(kind === 'account' ? (user.role === 'principal' ? '/dashboard' : '/fees') : '/attendance')}
          >
            <ArrowLeft size={16} /> {kind === 'account' ? (user.role === 'principal' ? 'Dashboard' : 'Fees & Collections') : 'Attendance'}
          </button>
          <p className="eyebrow">CAMVIA · STUDENT RECORDS</p>
          <h1>{kind === 'account' ? 'Account Statement' : 'Attendance Statement'}</h1>
          <p>Choose a student and date range to view a print-ready statement.</p>
        </div>
      </header>

      <form className="statement-filters statement-no-print" onSubmit={handleGenerate}>
        {studentsError ? (
          <div className="statement-error" role="alert">
            <span>{studentsError}</span>
            <button type="button" className="secondary-button compact-button" onClick={onRetryStudents}>Retry</button>
          </div>
        ) : null}
        <label>
          Student
          <select
            required
            value={studentId}
            onChange={(event) => {
              setStudentId(event.target.value)
              setStatement(null)
            }}
            disabled={studentsLoading}
          >
            <option value="">{studentsLoading ? 'Loading students…' : 'Select a student'}</option>
            {selectableStudents.map((student) => (
              <option key={student.id} value={student.id}>
                {student.firstName} {student.lastName} · {student.studentId} · {student.className}-{student.section}
              </option>
            ))}
          </select>
        </label>
        <label>Date From<input required type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>Date To<input required type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} /></label>
        {kind === 'account' ? (
          <label>Fee Period / Month (optional)<input type="month" value={feePeriod} onChange={(event) => setFeePeriod(event.target.value)} /></label>
        ) : (
          <>
            <label>Class (optional)<select value={className} onChange={(event) => setClassName(event.target.value)}>
              <option value="">All classes</option>
              {attendanceClasses.map((item) => <option key={item}>{item}</option>)}
            </select></label>
            <label>Section (optional)<select value={section} onChange={(event) => setSection(event.target.value)}>
              <option value="">All sections</option>
              {attendanceSections.map((item) => <option key={item}>{item}</option>)}
            </select></label>
          </>
        )}
        <div className="statement-filter-actions">
          <button type="submit" className="primary-button small-button" disabled={loading || studentsLoading || !selectableStudents.length}>
            <FileText size={16} /> {loading ? 'Loading statement…' : 'View Statement'}
          </button>
        </div>
      </form>

      {error ? <p className="statement-error" role="alert">{error}</p> : null}
      {pdfError ? <p className="statement-error" role="alert">{pdfError}</p> : null}
      {!studentsLoading && !studentsError && selectableStudents.length === 0
        ? <p className="statement-empty" role="status">No students are available for this statement.</p>
        : null}

      {statement ? (
        <div className="statement-preview">
          <div className="statement-toolbar statement-no-print">
            <span><CalendarDays size={16} /> {formatDate(statement.dateFrom)} – {formatDate(statement.dateTo)}</span>
            <div>
              <button type="button" className="secondary-button small-button" onClick={() => void handleDownload()}>
                <Download size={16} /> Download PDF
              </button>
              <button type="button" className="secondary-button small-button" onClick={() => window.print()}>
                <Printer size={16} /> Print Statement
              </button>
            </div>
          </div>
          <article className="statement-paper">
            <StatementHeader statement={statement} />
            {statement.kind === 'account' && accountSummary ? (
              <AccountStatementContent
                statement={statement}
                summary={accountSummary}
                rows={accountLedger}
              />
            ) : null}
            {statement.kind === 'attendance' && attendanceSummary ? (
              <AttendanceStatementContent statement={statement} summary={attendanceSummary} />
            ) : null}
            <footer className="statement-generated">Generated {formatDate(schoolDateKey(user.schoolTimezone))} · CAMVIA</footer>
          </article>
        </div>
      ) : null}
    </section>
  )
}

function StatementHeader({ statement }: { statement: StatementData }) {
  return (
    <header className="statement-document-header">
      <img src={camviaLogo} alt="CAMVIA" />
      <div className="statement-document-title">
        <div>
          <p className="eyebrow">{statement.student.school || statement.student.campus}</p>
          <h2>{statement.kind === 'account' ? 'Account Statement' : 'Attendance Statement'}</h2>
        </div>
        <span className="statement-campus">{statement.student.campus}</span>
      </div>
      <dl className="statement-student-details">
        <div><dt>Student</dt><dd>{statement.student.firstName} {statement.student.lastName}</dd></div>
        <div><dt>Student ID</dt><dd>{statement.student.studentId}</dd></div>
        <div><dt>Class</dt><dd>{statement.student.className}</dd></div>
        <div><dt>Section</dt><dd>{statement.student.section}</dd></div>
        {statement.kind === 'account' && statement.student.guardian.name
          ? <div><dt>Guardian</dt><dd>{statement.student.guardian.name}</dd></div>
          : null}
        <div><dt>Date From</dt><dd>{formatDate(statement.dateFrom)}</dd></div>
        <div><dt>Date To</dt><dd>{formatDate(statement.dateTo)}</dd></div>
      </dl>
    </header>
  )
}

function AccountStatementContent({
  statement,
  summary,
  rows,
}: {
  statement: Extract<StatementData, { kind: 'account' }>
  summary: ReturnType<typeof getFeeStatementMetrics>
  rows: AccountLedgerRow[]
}) {
  return (
    <>
      <section className="statement-summary" aria-label="Account summary">
        <SummaryCard label="Total Invoiced" value={formatCurrency(summary.totalInvoiced)} />
        <SummaryCard label="Total Paid" value={formatCurrency(summary.totalPaid)} />
        <SummaryCard label="Outstanding Balance" value={formatCurrency(summary.outstanding)} />
        {summary.cancelledInvoices > 0 ? <SummaryCard label="Cancelled Invoice Amount" value={formatCurrency(summary.cancelledInvoices)} /> : null}
        {summary.cancelledPayments > 0 ? <SummaryCard label="Cancelled Payment Amount" value={formatCurrency(summary.cancelledPayments)} /> : null}
      </section>
      {!rows.length ? (
        <p className="statement-empty" role="status">No financial records found for the selected period.</p>
      ) : (
        <div className="statement-table-scroll">
          <table className="statement-table">
            <thead>
              <tr><th>Date</th><th>Description</th><th>Invoice Amount</th><th>Payment Amount</th><th>Status</th><th>Balance</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.date}-${index}`}>
                  <td>{formatDate(row.date)}</td>
                  <td>
                    <span>{row.description}</span>
                    {row.cancellationReason ? <small>Cancellation Reason: {row.cancellationReason}</small> : null}
                  </td>
                  <td>{row.invoiceAmount === null ? '—' : formatCurrency(row.invoiceAmount)}</td>
                  <td>{row.paymentAmount === null ? '—' : formatCurrency(row.paymentAmount)}</td>
                  <td><span className={`statement-status ${row.status === 'Cancelled' ? 'cancelled' : ''}`}>{row.status}</span></td>
                  <td>{formatCurrency(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {statement.feePeriod ? <p className="statement-period-note">Fee Period / Month: {statement.feePeriod}</p> : null}
    </>
  )
}

function AttendanceStatementContent({
  statement,
  summary,
}: {
  statement: Extract<StatementData, { kind: 'attendance' }>
  summary: ReturnType<typeof getAttendanceCountsFromStatuses>
}) {
  return (
    <>
      <section className="statement-summary" aria-label="Attendance summary">
        <SummaryCard label="Total Recorded Days" value={String(summary.total)} />
        <SummaryCard label="Present Days" value={String(summary.present)} />
        <SummaryCard label="Absent Days" value={String(summary.absent)} />
        <SummaryCard label="Late Days" value={String(summary.late)} />
        <SummaryCard label="Attendance Percentage" value={`${summary.rate ?? 0}%`} />
      </section>
      {!statement.records.length ? (
        <p className="statement-empty" role="status">No attendance records found for the selected period.</p>
      ) : (
        <div className="statement-table-scroll">
          <table className="statement-table attendance-statement-table">
            <thead><tr><th>Date</th><th>Status</th><th>Class / Section</th></tr></thead>
            <tbody>
              {statement.records.map((record, index) => (
                <tr key={`${record.date}-${index}`}>
                  <td>{formatDate(record.date)}</td>
                  <td><span className="statement-status">{attendanceStatusLabel(record.status)}</span></td>
                  <td>{record.className} / {record.section}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="statement-summary-card"><span>{label}</span><strong>{value}</strong></div>
}
