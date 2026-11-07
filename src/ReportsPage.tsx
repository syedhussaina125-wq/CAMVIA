import { useMemo } from 'react'
import { ClipboardCheck, ShieldCheck, Users, Wallet, type LucideIcon } from 'lucide-react'
import type { SessionUser } from './mockData'
import type { Student } from './studentData'
import type { AttendanceState } from './attendanceData'
import type { FeeState } from './feeData'
import type { CommunicationState } from './communicationData'
import { getAccessibleStudents } from './studentData'
import { getAttendanceAttention } from './attendanceData'
import { getFeeInvoices, getFeeMetrics } from './feeData'
import { getCommunicationSummary } from './communicationData'

type StatItem = {
  label: string
  value: string
  subLabel: string
  tone: 'blue' | 'cyan' | 'green' | 'purple' | 'amber' | 'red'
  icon: LucideIcon
}

function formatFeeCurrency(amount: number): string {
  return `PKR ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(amount)}`
}

function StatCard({ stat }: { stat: StatItem }) {
  const Icon = stat.icon
  const label = stat.label.toLowerCase()
  const accent = label.includes('student')
    ? 'students'
    : label.includes('alert')
      ? 'alerts'
      : label.includes('attendance')
        ? 'attendance'
        : label.includes('collected')
          ? 'collected'
          : label.includes('outstanding')
            ? 'outstanding'
            : label.includes('overdue')
              ? 'overdue'
              : label.includes('communication') || label.includes('approval')
                ? 'communications'
                : 'default'

  return (
    <article className={`stat-card ${stat.tone} metric-${accent}`}>
      <div className="stat-card-main">
        <span className="stat-icon-box">
          <Icon size={19} strokeWidth={2.2} />
        </span>
        <div className="stat-card-text">
          <span className="stat-label">{stat.label}</span>
          <strong className="stat-value">{stat.value}</strong>
          <small className="stat-sublabel">{stat.subLabel}</small>
        </div>
      </div>
      <span className="stat-spark" aria-hidden="true" />
      <span className="stat-decoration" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </article>
  )
}

export function ReportsPage({
  user,
  students,
  attendance,
  fees,
  communication,
}: {
  user: SessionUser
  students: Student[]
  attendance: AttendanceState
  fees: FeeState
  communication: CommunicationState
}) {
  const accessibleStudents = useMemo(() => getAccessibleStudents(students, user), [students, user])
  const attendanceAttention = useMemo(() => getAttendanceAttention(attendance, students), [attendance, students])
  const feeInvoices = useMemo(() => getFeeInvoices(fees, students, user), [fees, students, user])
  const feeMetrics = useMemo(() => getFeeMetrics(feeInvoices), [feeInvoices])
  const communicationSummary = useMemo(
    () => getCommunicationSummary(communication, students, user),
    [communication, students, user]
  )

  return (
    <section className="dashboard-page">
      <div className="panel-header flex-header">
        <div>
          <p className="eyebrow">Operational overview</p>
          <h1>Reports</h1>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          stat={{
            label: 'Students in scope',
            value: String(accessibleStudents.length),
            subLabel: 'Accessible records',
            tone: 'blue',
            icon: Users,
          }}
        />
        <StatCard
          stat={{
            label: 'Attendance alerts',
            value: String(attendanceAttention.length),
            subLabel: 'Follow-ups needed',
            tone: 'amber',
            icon: ClipboardCheck,
          }}
        />
        <StatCard
          stat={{
            label: 'Outstanding fees',
            value: formatFeeCurrency(feeMetrics.outstanding),
            subLabel: 'Current balance',
            tone: 'purple',
            icon: Wallet,
          }}
        />
        <StatCard
          stat={{
            label: 'Pending approvals',
            value: String(communicationSummary.awaitingApproval),
            subLabel: 'Waiting review',
            tone: 'green',
            icon: ShieldCheck,
          }}
        />
      </div>

      <div className="dashboard-grid">
        <div className="panel-card">
          <h3>School summary</h3>
          <p className="student-muted">
            The latest pilot overview highlights student coverage, fee exposure, and communication review load.
          </p>
        </div>
        <div className="panel-card">
          <h3>Top priorities</h3>
          <ul className="list-stack">
            <li><span>Attendance follow-up</span><strong>{attendanceAttention.length}</strong></li>
            <li><span>Outstanding fees</span><strong>{formatFeeCurrency(feeMetrics.outstanding)}</strong></li>
            <li><span>Communication approvals</span><strong>{communicationSummary.awaitingApproval}</strong></li>
          </ul>
        </div>
      </div>
    </section>
  )
}

export default ReportsPage
