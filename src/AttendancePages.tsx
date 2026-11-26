import { useCallback, useContext, useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react'
import { ArrowLeft, CalendarDays, CheckCircle2, ClipboardCheck, Clock, FileText, Search, TrendingUp, UserX, Users, type LucideIcon } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type {
  AttendanceAttention,
  AttendanceClass,
  AttendanceRecord,
  AttendanceSession,
  AttendanceState,
  AttendanceStatus,
  AttendanceSubmission,
  AttendanceUser,
} from './attendanceData'
import {
  attendanceDateKey,
  canAccessAttendanceClass,
  getAttendanceAttention,
  formatAttendanceDate,
  getAttendanceClasses,
  getAttendanceCounts,
  getStudentAttendance,
  getSessionForClass,
  getSessionRecords,
  localDateKey,
} from './attendanceData'
import type { Student } from './studentData'
import { RecordActionMenu, type ActionItem } from './components/RecordActionControls'
import { WhatsAppComposer } from './components/WhatsAppComposer'
import { AttendanceCorrectionModal, type AttendanceCorrectionRecord } from './components/AttendanceCorrectionModal'
import { AttendanceNavigationGuardContext } from './components/AttendanceNavigationGuard'
import { correctAttendanceSession, AttendanceServiceError, getAttendanceErrorMessage } from './services/attendance'
import { trashAttendanceSession } from './services/trash'
import { formatRpcErrorMessage } from './utils/errorMapping'
import { compareClassNames, compareNaturalText } from './utils/sortOrder'

type AttendancePageProps = {
  user: AttendanceUser
  students: Student[]
  attendance: AttendanceState
  loading: boolean
  error: string
  onRetry: () => void
  onCorrectAttendance?: (payload: {
    sessionId: string
    records: AttendanceCorrectionRecord[]
    reason: string
  }) => Promise<void>
  onRefresh?: () => void
}

type AttendanceOverviewProps = AttendancePageProps & {
  onPrepareMessage?: (studentId: string) => void
}

interface TakeAttendancePageProps extends AttendancePageProps {
  onSave: (submission: AttendanceSubmission) => Promise<AttendanceState>
}

const statusOptions: { status: AttendanceStatus; label: string }[] = [
  { status: 'PRESENT', label: 'Present' },
  { status: 'ABSENT', label: 'Absent' },
  { status: 'LATE', label: 'Late' },
]

type AttendanceDraftStatus = AttendanceStatus | 'UNMARKED'

type PendingDiscard = { kind: 'date'; date: string } | { kind: 'navigate'; to: string; onDiscard?: () => void }

type CorrectingSessionState = {
  sessionId: string
  className: string
  section: string
  date: string
  records: AttendanceCorrectionRecord[]
}

function isAttendanceStatus(status: AttendanceDraftStatus): status is AttendanceStatus {
  return status !== 'UNMARKED'
}

function getAttendanceDraftKey(attendanceClass: AttendanceClass | null, date: string): string {
  if (!attendanceClass) return `unavailable|${date}`
  return [
    attendanceClass.schoolId,
    attendanceClass.campusId,
    attendanceClass.className,
    attendanceClass.section,
    date,
  ].join('|')
}

function getAttendanceStatusLabel(isTrashed: boolean, session: AttendanceSession | undefined): string {
  if (isTrashed) return 'In Trash'
  if (!session || session.studentCount === 0) return 'Not Marked'
  return session.status === 'COMPLETED' ? 'Completed' : 'In Progress'
}

function getAttendanceEmptyNotice(
  sessionCount: number,
  date: string,
  classFilter: string,
  sectionFilter: string,
): string {
  if (sessionCount === 0) return 'No attendance records yet.'
  const classScope = classFilter ? ` in ${classFilter}` : ' across all classes'
  const sectionScope = sectionFilter ? `, section ${sectionFilter}` : ''
  return `No attendance has been recorded for ${formatAttendanceDate(date)}${classScope}${sectionScope}.`
}

function buildCorrectionRecords(
  attendanceClass: AttendanceClass,
  sessionRecords: AttendanceRecord[],
): AttendanceCorrectionRecord[] {
  return attendanceClass.students.map((student) => {
    const rec = sessionRecords.find((item) => item.studentId === student.id)
    return {
      student_id: student.id,
      student_name: `${student.firstName} ${student.lastName}`,
      status: (rec?.status ?? 'PRESENT') as 'PRESENT' | 'ABSENT' | 'LATE',
      note: rec?.note ?? '',
    }
  })
}

function buildClassAttendanceActions(params: {
  canCorrect: boolean
  canTrash: boolean
  onCorrect: () => void
  onTrash: () => void
}): ActionItem[] {
  const actions: ActionItem[] = []
  if (params.canCorrect) {
    actions.push({ label: 'Correct Attendance', onClick: params.onCorrect })
  }
  if (params.canTrash) {
    actions.push({ label: 'Move Attendance to Trash', danger: true, onClick: params.onTrash })
  }
  return actions
}

function AttendanceRowAction({
  isTrashed,
  canEdit,
  canViewTrash,
  hasSession,
  onOpen,
  onViewTrash,
}: Readonly<{
  isTrashed: boolean
  canEdit: boolean
  canViewTrash: boolean
  hasSession: boolean
  onOpen: () => void
  onViewTrash: () => void
}>) {
  if (isTrashed) {
    return canViewTrash
      ? <button type="button" className="student-link" onClick={onViewTrash}>View Trash</button>
      : <span className="student-muted">In Trash</span>
  }
  if (!canEdit) {
    return <span className="student-muted">View only</span>
  }
  return (
    <button type="button" className="student-link" onClick={onOpen}>
      {hasSession ? 'View / Edit' : 'Take Attendance'}
    </button>
  )
}

function AttendanceClassTable({
  visibleClasses,
  attendance,
  date,
  userRole,
  onOpenClass,
  onOpenTrash,
  onCorrectSession,
  onTrashSession,
}: Readonly<{
  visibleClasses: AttendanceClass[]
  attendance: AttendanceState
  date: string
  userRole: AttendanceUser['role']
  onOpenClass: (classId: string) => void
  onOpenTrash: () => void
  onCorrectSession: (session: CorrectingSessionState) => void
  onTrashSession: (sessionId: string, className: string, section: string) => void
}>) {
  const canEdit = userRole !== 'finance'
  const canViewTrash = userRole === 'admin'

  return (
    <div className="attendance-table-wrap">
      <table className="attendance-table">
        <thead>
          <tr>
            <th>Class</th>
            <th>Section</th>
            <th className="is-numeric">Students</th>
            <th className="is-numeric">Present</th>
            <th className="is-numeric">Absent</th>
            <th className="is-numeric">Late</th>
            <th className="is-numeric">Rate</th>
            <th className="is-status">Status</th>
            <th className="is-action">Action</th>
          </tr>
        </thead>
        <tbody>
          {visibleClasses.map((attendanceClass) => {
            const session = getSessionForClass(attendance, date, attendanceClass)
            const sessionRecords = session ? getSessionRecords(attendance, session.id) : []
            const summary = getAttendanceCounts(sessionRecords)
            const isTrashed = Boolean(session?.studentCount === 0 && session?.hasTrashedRecords)
            const status = getAttendanceStatusLabel(isTrashed, session)
            const hasSessionValues = Boolean(session && !isTrashed && session.studentCount > 0)
            const rateDisplay = isTrashed || summary.rate === null ? '—' : `${summary.rate}%`
            const isLowRate = hasSessionValues && summary.rate !== null && summary.rate < 75
            const classActions = buildClassAttendanceActions({
              canCorrect: Boolean(canEdit && session?.status === 'COMPLETED' && sessionRecords.length > 0),
              canTrash: Boolean(userRole === 'admin' && session && sessionRecords.length > 0),
              onCorrect: () => {
                if (!session) return
                onCorrectSession({
                  sessionId: session.id,
                  className: attendanceClass.className,
                  section: attendanceClass.section,
                  date,
                  records: buildCorrectionRecords(attendanceClass, sessionRecords),
                })
              },
              onTrash: () => {
                if (session) onTrashSession(session.id, attendanceClass.className, attendanceClass.section)
              },
            })

            return (
              <tr key={attendanceClass.id}>
                <td><strong>{attendanceClass.className}</strong></td>
                <td>{attendanceClass.section}</td>
                <td className="is-numeric">{attendanceClass.students.length}</td>
                <td className="is-numeric">{hasSessionValues ? summary.present : '—'}</td>
                <td className="is-numeric">{hasSessionValues ? summary.absent : '—'}</td>
                <td className="is-numeric">{hasSessionValues ? summary.late : '—'}</td>
                <td className={`is-numeric${isLowRate ? ' is-low-rate' : ''}`}>{rateDisplay}</td>
                <td className="is-status"><span className={`attendance-status ${status.toLowerCase().replace(' ', '-')}`}>{status}</span></td>
                <td className="is-action">
                  {canEdit ? (
                    <div>
                      <AttendanceRowAction
                        isTrashed={isTrashed}
                        canEdit={canEdit}
                        canViewTrash={canViewTrash}
                        hasSession={hasSessionValues}
                        onOpen={() => onOpenClass(attendanceClass.id)}
                        onViewTrash={onOpenTrash}
                      />
                      {classActions.length > 0 && <RecordActionMenu actions={classActions} />}
                    </div>
                  ) : 'View only'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function AttendancePage({
  user,
  students,
  attendance,
  loading,
  error,
  onRetry,
  onPrepareMessage,
  onCorrectAttendance,
  onRefresh,
}: Readonly<AttendanceOverviewProps>) {
  const navigate = useNavigate()
  const [trashError, setTrashError] = useState('')
  const [searchParams] = useSearchParams()
  const today = attendanceDateKey(user.schoolTimezone)
  const classes = useMemo(() => getAttendanceClasses(students), [students])
  const [date, setDate] = useState(searchParams.get('date') ?? today)
  const [classFilter, setClassFilter] = useState(() =>
    user.role === 'teacher' && classes.length === 1 ? classes[0].className : '',
  )
  const [sectionFilter, setSectionFilter] = useState(() =>
    user.role === 'teacher' && classes.length === 1 ? classes[0].section : '',
  )
  const [correctingSession, setCorrectingSession] = useState<CorrectingSessionState | null>(null)

  const handleTrashAttendance = async (sessionId: string, className: string, section: string) => {
    const reason = window.prompt(`Why are you moving ${className}-${section} attendance to Trash?`)?.trim()
    if (!reason) return
    if (!window.confirm(`Move the ${formatAttendanceDate(date)} attendance for ${className}-${section} to Trash?`)) return
    setTrashError('')
    try {
      await trashAttendanceSession(sessionId, reason)
      onRefresh?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Attendance could not be moved to Trash.'
      console.error('[Supabase] Attendance trash failed:', message)
      setTrashError('Attendance could not be moved to Trash. Check your access and try again.')
    }
  }

  if (loading) return <AttendanceLoadingState />
  if (error) return <AttendanceErrorState detail={error} onRetry={onRetry} />

  if (user.role === 'teacher' && classes.length === 0) {
    return <AttendanceEmptyState title="No classes are assigned to you." detail="Ask your school administrator to review your class assignments." />
  }

  const visibleClasses = classes.filter((attendanceClass) =>
    (!classFilter || attendanceClass.className === classFilter) &&
    (!sectionFilter || attendanceClass.section === sectionFilter),
  )
  const todaysRecords = visibleClasses.flatMap((attendanceClass) => {
    const session = getSessionForClass(attendance, date, attendanceClass)
    return session ? getSessionRecords(attendance, session.id) : []
  })
  const counts = getAttendanceCounts(todaysRecords)
  const classOptions = [...new Set(classes.map((attendanceClass) => attendanceClass.className))].sort(compareClassNames)
  const sectionOptions = [...new Set(classes
    .filter((attendanceClass) => !classFilter || attendanceClass.className === classFilter)
    .map((attendanceClass) => attendanceClass.section),
  )].sort(compareNaturalText)
  const emptyTitle = classes.length === 0 ? 'No classes available yet.' : 'No classes match these filters.'
  const emptyDetail = classes.length === 0
    ? 'Classes will appear here once students are enrolled.'
    : 'Choose another class or section.'

  return (
    <section className="attendance-page">
      <header className="attendance-heading">
        <div>
          <h1>Attendance</h1>
          <p>Track today&apos;s attendance and identify students who need attention.</p>
        </div>
        <button type="button" className="secondary-button small-button" onClick={() => void navigate('/statements/attendance')}>
          <FileText size={16} /> Attendance Statement
        </button>
      </header>

      <div className="help-banner">
        <strong>Helpful tip:</strong> Mark All Present, then update exceptions.
      </div>
      {trashError ? <p className="communication-feedback error" role="alert">{trashError}</p> : null}

      <div className="attendance-controls">
        <label><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label><span>Class</span><select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setSectionFilter('') }}><option value="">All classes</option>{classOptions.map((className) => <option key={className}>{className}</option>)}</select></label>
        <label><span>Section</span><select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}><option value="">All sections</option>{sectionOptions.map((section) => <option key={section}>{section}</option>)}</select></label>
      </div>

      {counts.total === 0 ? (
        <output className="attendance-empty-notice" style={{ display: 'block' }}>
          {getAttendanceEmptyNotice(attendance.sessions.length, date, classFilter, sectionFilter)}
        </output>
      ) : null}

      <div className="attendance-summary-grid">
        <AttendanceMetric label="Present" value={String(counts.present)} tone="green" icon={CheckCircle2} />
        <AttendanceMetric label="Absent" value={String(counts.absent)} tone="red" icon={UserX} />
        <AttendanceMetric label="Late" value={String(counts.late)} tone="amber" icon={Clock} />
        <AttendanceMetric label="Attendance Rate" value={counts.rate === null ? '0%' : `${counts.rate}%`} tone="blue" icon={TrendingUp} />
      </div>

      <section className="attendance-section">
        <div className="attendance-section-heading">
          <div><h2>Class attendance</h2><p>{formatAttendanceDate(date)}</p></div>
          <span>{visibleClasses.length} classes</span>
        </div>
        {visibleClasses.length ? (
          <AttendanceClassTable
            visibleClasses={visibleClasses}
            attendance={attendance}
            date={date}
            userRole={user.role}
            onOpenClass={(id) => void navigate(`/attendance/take/${encodeURIComponent(id)}?date=${date}`)}
            onOpenTrash={() => void navigate('/trash')}
            onCorrectSession={setCorrectingSession}
            onTrashSession={(sessionId, clsName, sec) => { void handleTrashAttendance(sessionId, clsName, sec) }}
          />
        ) : <AttendanceEmptyState title={emptyTitle} detail={emptyDetail} />}
        <div className="attendance-class-cards">
          {visibleClasses.map((attendanceClass) => {
            const session = getSessionForClass(attendance, date, attendanceClass)
            const sessionRecords = session ? getSessionRecords(attendance, session.id) : []
            const canCorrectCard = Boolean(session?.status === 'COMPLETED' && sessionRecords.length > 0 && user.role !== 'finance')
            const canTrashCard = Boolean(session && sessionRecords.length > 0 && user.role === 'admin')
            return (
              <AttendanceClassCard
                key={attendanceClass.id}
                attendanceClass={attendanceClass}
                date={date}
                attendance={attendance}
                canEdit={user.role !== 'finance'}
                onOpen={() => void navigate(session?.studentCount === 0 && session?.hasTrashedRecords
                  ? '/trash'
                  : `/attendance/take/${encodeURIComponent(attendanceClass.id)}?date=${date}`)}
                canViewTrash={user.role === 'admin'}
                onTrash={canTrashCard && session
                  ? () => { void handleTrashAttendance(session.id, attendanceClass.className, attendanceClass.section) }
                  : undefined}
                onCorrect={canCorrectCard && session ? () => {
                  setCorrectingSession({
                    sessionId: session.id,
                    className: attendanceClass.className,
                    section: attendanceClass.section,
                    date,
                    records: buildCorrectionRecords(attendanceClass, sessionRecords),
                  })
                } : undefined}
              />
            )
          })}
        </div>
      </section>

      <AttendanceAttentionPanel
        attendance={attendance}
        user={user}
        students={students}
        onOpenStudent={(id) => void navigate(`/students/${encodeURIComponent(id)}`)}
        onOpenClass={(id) => void navigate(`/attendance/take/${encodeURIComponent(id)}?date=${date}`)}
        onPrepareMessage={onPrepareMessage}
      />

      {correctingSession && (
        <AttendanceCorrectionModal
          isOpen={Boolean(correctingSession)}
          sessionId={correctingSession.sessionId}
          className={correctingSession.className}
          section={correctingSession.section}
          date={correctingSession.date}
          records={correctingSession.records}
          onClose={() => setCorrectingSession(null)}
          onSave={async (payload) => {
            if (onCorrectAttendance) {
              await onCorrectAttendance(payload)
            } else {
              await correctAttendanceSession(payload, { role: user.role, route: window.location.pathname })
              if (onRefresh) onRefresh()
            }
          }}
        />
      )}
    </section>
  )
}

function getRowStateLabel(status: AttendanceDraftStatus, isDirty: boolean): string | null {
  if (status === 'UNMARKED') return 'Unmarked'
  if (isDirty) return 'Unsaved change'
  return null
}

function TakeAttendanceStudentRow({
  student,
  user,
  attendance,
  status,
  note,
  date,
  isDirty,
  saving,
  onSelectStatus,
  onChangeNote,
}: Readonly<{
  student: Student
  user: AttendanceUser
  attendance: AttendanceState
  status: AttendanceDraftStatus
  note: string
  date: string
  isDirty: boolean
  saving: boolean
  onSelectStatus: (status: AttendanceStatus) => void
  onChangeNote: (note: string) => void
}>) {
  const summary = getStudentAttendance(student, attendance)
  const stateLabel = getRowStateLabel(status, isDirty)
  const showNoteInput = status === 'ABSENT' || status === 'LATE'

  return (
    <article className={`attendance-student-row${isDirty ? ' changed' : ''}`}>
      <div className="attendance-student-person">
        <div className="student-avatar"><Users size={17} /></div>
        <div>
          <strong>{student.firstName} {student.lastName}</strong>
          <span>{student.studentId} · Roll {student.rollNumber}</span>
          <WhatsAppComposer
            student={student}
            user={user}
            initialTemplate="Attendance Alert"
            buttonLabel="Message guardian"
            context={{
              attendance: {
                status,
                date,
                rate: summary.counts.rate,
                recordedDays: summary.counts.total,
              },
            }}
          />
          {stateLabel ? <span className="attendance-row-state">{stateLabel}</span> : null}
        </div>
      </div>
      <fieldset className="attendance-segmented" style={{ margin: 0 }} aria-label={`Attendance for ${student.firstName} ${student.lastName}`}>
        {statusOptions.map((option) => (
          <button
            type="button"
            key={option.status}
            disabled={saving}
            aria-pressed={status === option.status}
            className={`${status === option.status ? 'selected' : ''} ${option.status.toLowerCase()}`}
            onClick={() => onSelectStatus(option.status)}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
      {showNoteInput ? (
        <input
          className="attendance-note"
          disabled={saving}
          value={note}
          onChange={(event) => onChangeNote(event.target.value)}
          placeholder="Optional note"
          aria-label={`Optional note for ${student.firstName} ${student.lastName}`}
        />
      ) : null}
    </article>
  )
}

function TakeAttendanceFooter({
  totals,
  unmarkedCount,
  dirtyCount,
  saveSuccess,
  canCorrectAttendance,
  saving,
  hasExistingRecords,
  onOpenCorrection,
}: Readonly<{
  totals: { present: number; absent: number; late: number }
  unmarkedCount: number
  dirtyCount: number
  saveSuccess: string
  canCorrectAttendance: boolean
  saving: boolean
  hasExistingRecords: boolean
  onOpenCorrection: () => void
}>) {
  return (
    <footer className="attendance-save-footer">
      <div className="attendance-totals">
        <span><i className="total-dot present-dot" /> Present: <strong>{totals.present}</strong></span>
        <span><i className="total-dot absent-dot" /> Absent: <strong>{totals.absent}</strong></span>
        <span><i className="total-dot late-dot" /> Late: <strong>{totals.late}</strong></span>
        <span>Unmarked: <strong>{unmarkedCount}</strong></span>
        {dirtyCount > 0 ? (
          <span className="attendance-unsaved-count">{dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'}</span>
        ) : null}
        {dirtyCount === 0 && saveSuccess ? (
          <output className="attendance-saved-count">{saveSuccess}</output>
        ) : null}
      </div>
      <div className="attendance-save-actions">
        {canCorrectAttendance && (
          <button
            type="button"
            className="secondary-button"
            disabled={saving || !hasExistingRecords}
            onClick={onOpenCorrection}
          >
            Audited Correction
          </button>
        )}
        <button type="submit" className="primary-button attendance-save-button" disabled={saving || dirtyCount === 0}>
          {saving ? 'Saving...' : 'Save Attendance'}
        </button>
      </div>
    </footer>
  )
}

function resolveInitialAttendanceDate(requestedDate: string, today: string): string {
  const parsedDate = new Date(`${requestedDate}T00:00:00`)
  const isValid = !Number.isNaN(parsedDate.getTime()) && localDateKey(parsedDate) === requestedDate
  return isValid && requestedDate <= today ? requestedDate : today
}

function hasTeacherClassAccess(attendanceClass: AttendanceClass | null, user: AttendanceUser): boolean {
  if (!attendanceClass) return false
  if (user.role === 'admin' || user.role === 'principal') return true
  if (user.role !== 'teacher') return false
  return Boolean(user.teacherAssignments?.some((assignment) =>
    assignment.active &&
    assignment.school_id === attendanceClass.schoolId &&
    assignment.campus_id === attendanceClass.campusId &&
    assignment.class_name === attendanceClass.className &&
    assignment.section === attendanceClass.section,
  ))
}

function formatAttendanceSaveError(err: unknown, targetDate?: string): string {
  const detail = err instanceof AttendanceServiceError
    ? getAttendanceErrorMessage(err)
    : formatRpcErrorMessage(err)
  if (detail === 'The attendance scope or submission is invalid.' && targetDate) {
    const utcToday = new Date().toISOString().slice(0, 10)
    if (targetDate > utcToday) {
      return `The database server is still on ${utcToday} (UTC), so ${targetDate} was rejected as a future date. Apply Supabase migration 032/037 for school-timezone saves, or switch the date to ${utcToday}. Your unsaved selections are still here.`
    }
  }
  if (detail && detail !== 'An unexpected error occurred.') {
    return `${detail} Your unsaved selections are still here.`
  }
  return 'Some attendance changes could not be saved. Your unsaved selections are still here; check your connection and try again.'
}

function renderTakeAttendanceGate(params: {
  loading: boolean
  error: string
  onRetry: () => void
  attendanceClass: AttendanceClass | null
  hasClassAccess: boolean
  userRole: AttendanceUser['role']
  existingSession: AttendanceSession | undefined
  onNavigate: (path: string) => void
}) {
  if (params.loading) return <AttendanceLoadingState />
  if (params.error) return <AttendanceErrorState detail={params.error} onRetry={params.onRetry} />
  if (!params.attendanceClass || !params.hasClassAccess) {
    const isUnassignedTeacherClass = params.userRole === 'teacher' && params.attendanceClass !== null
    const detail = isUnassignedTeacherClass
      ? 'This class is not assigned to you.'
      : 'This class is not included in your authorized attendance scope.'
    return (
      <AttendanceEmptyState
        title={isUnassignedTeacherClass ? 'Class not assigned' : 'Class not found'}
        detail={detail}
        onBack={() => params.onNavigate('/attendance')}
      />
    )
  }
  if (params.existingSession?.studentCount === 0 && params.existingSession?.hasTrashedRecords) {
    return (
      <AttendanceEmptyState
        title="Attendance is in Trash"
        detail="Restore this attendance session from Trash before opening or editing it."
        onBack={() => params.onNavigate(params.userRole === 'admin' ? '/trash' : '/attendance')}
      />
    )
  }
  return null
}

export function TakeAttendancePage(props: Readonly<TakeAttendancePageProps>) {
  const { user, students, attendance, loading, error, onRetry, onSave, onCorrectAttendance, onRefresh } = props
  const navigate = useNavigate()
  const { classId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const today = attendanceDateKey(user.schoolTimezone)
  const requestedDate = searchParams.get('date') ?? today
  const attendanceClass = useMemo(() => canAccessAttendanceClass(students, classId), [students, classId])
  const hasClassAccess = hasTeacherClassAccess(attendanceClass, user)
  const [date, setDate] = useState(() => resolveInitialAttendanceDate(requestedDate, today))
  const [showCorrectionModal, setShowCorrectionModal] = useState(false)
  const [draft, setDraft] = useState<{
    key: string
    statuses: Record<string, AttendanceDraftStatus>
    notes: Record<string, string>
  }>({ key: '', statuses: {}, notes: {} })
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState('')
  const saveInFlight = useRef(false)
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null)
  const attendanceNavigationGuard = useContext(AttendanceNavigationGuardContext)
  const existingSession = attendanceClass ? getSessionForClass(attendance, date, attendanceClass) : undefined
  const existingRecords = existingSession ? getSessionRecords(attendance, existingSession.id) : []
  const draftKey = getAttendanceDraftKey(attendanceClass, date)
  const recordsByStudentId = new Map(existingRecords.map((record) => [record.studentId, record]))
  const canCorrectAttendance = Boolean(existingSession?.status === 'COMPLETED' && hasClassAccess && user.role !== 'finance')
  const defaultStatuses = Object.fromEntries(attendanceClass?.students.map((student) => [
    student.id,
    recordsByStudentId.get(student.id)?.status ?? 'UNMARKED',
  ]) ?? []) as Record<string, AttendanceDraftStatus>
  const defaultNotes = Object.fromEntries(attendanceClass?.students.map((student) => {
    const record = recordsByStudentId.get(student.id)
    return [student.id, record?.note ?? '']
  }) ?? [])
  const statuses = draft.key === draftKey ? { ...defaultStatuses, ...draft.statuses } : defaultStatuses
  const notes = draft.key === draftKey ? { ...defaultNotes, ...draft.notes } : defaultNotes
  const dirtyStudentIds = attendanceClass?.students
    .filter((student) => statuses[student.id] !== defaultStatuses[student.id] ||
      (notes[student.id] ?? '') !== (defaultNotes[student.id] ?? ''))
    .map((student) => student.id) ?? []
  const unmarkedCount = attendanceClass?.students.filter((student) => statuses[student.id] === 'UNMARKED').length ?? 0

  useEffect(() => {
    if (dirtyStudentIds.length === 0) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [dirtyStudentIds.length])

  const shouldBlockNavigation = useCallback((destination: string, onDiscard?: () => void) => {
    if (dirtyStudentIds.length === 0) return false
    setPendingDiscard({ kind: 'navigate', to: destination, onDiscard })
    return true
  }, [dirtyStudentIds.length])

  useEffect(() => attendanceNavigationGuard.registerGuard(shouldBlockNavigation), [
    attendanceNavigationGuard,
    shouldBlockNavigation,
  ])

  const gateView = renderTakeAttendanceGate({
    loading,
    error,
    onRetry,
    attendanceClass,
    hasClassAccess,
    userRole: user.role,
    existingSession,
    onNavigate: (path) => { void navigate(path) },
  })
  if (gateView) return gateView
  if (!attendanceClass) return null

  const filteredStudents = attendanceClass.students
    .filter((student) =>
      `${student.firstName} ${student.lastName} ${student.studentId} ${attendanceClass.className}`.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((left, right) =>
      compareNaturalText(left.studentId, right.studentId) ||
      compareNaturalText(left.firstName, right.firstName),
    )
  const visibleRecords = attendanceClass.students.map((student) => ({
    ...student,
    status: statuses[student.id] ?? 'UNMARKED',
  }))
  const totals = {
    present: visibleRecords.filter((student) => student.status === 'PRESENT').length,
    absent: visibleRecords.filter((student) => student.status === 'ABSENT').length,
    late: visibleRecords.filter((student) => student.status === 'LATE').length,
  }
  const requestDateChange = (nextDate: string) => {
    if (!nextDate || nextDate === date) return
    if (dirtyStudentIds.length > 0) {
      setPendingDiscard({ kind: 'date', date: nextDate })
      return
    }
    setDate(nextDate)
    setDraft({ key: getAttendanceDraftKey(attendanceClass, nextDate), statuses: {}, notes: {} })
    setSaveError('')
    setSaveSuccess('')
  }
  const requestNavigation = (to: string) => {
    if (shouldBlockNavigation(to)) return
    void navigate(to)
  }
  const discardAndContinue = () => {
    if (!pendingDiscard) return
    const destination = pendingDiscard
    setPendingDiscard(null)
    setDraft({ key: '', statuses: {}, notes: {} })
    if (destination.kind === 'date') {
      setDate(destination.date)
      setDraft({ key: getAttendanceDraftKey(attendanceClass, destination.date), statuses: {}, notes: {} })
      setSaveError('')
      setSaveSuccess('')
      return
    }
    if (destination.onDiscard) {
      destination.onDiscard()
    } else {
      void navigate(destination.to)
    }
  }

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (dirtyStudentIds.length === 0) return
    if (date > attendanceDateKey(user.schoolTimezone)) {
      setSaveError('Attendance cannot be recorded for a future date.')
      return
    }
    const allStudentIds = attendanceClass.students.map((student) => student.id)
    const allStatuses: Record<string, AttendanceStatus> = {}
    for (const studentId of allStudentIds) {
      const status = statuses[studentId]
      if (!status || !isAttendanceStatus(status)) continue
      allStatuses[studentId] = status
    }
    const remainingUnmarked = allStudentIds.length - Object.keys(allStatuses).length
    if (remainingUnmarked > 0) {
      setSaveError(`Select Present, Absent, or Late for every student before saving (${remainingUnmarked} unmarked).`)
      return
    }
    if (saveInFlight.current) return
    saveInFlight.current = true
    setSaving(true)
    setSaveError('')
    setSaveSuccess('')
    try {
      await onSave({
        date,
        classId: attendanceClass.id,
        changedStudentIds: allStudentIds,
        statuses: allStatuses,
        notes: Object.fromEntries(allStudentIds.map((studentId) => [studentId, notes[studentId] ?? ''])),
      })
      setDraft({ key: draftKey, statuses: {}, notes: {} })
      setSaveSuccess('All changes saved.')
    } catch (err) {
      console.error('[CAMVIA Attendance] Attendance save failed:', err)
      setSaveError(formatAttendanceSaveError(err, date))
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  return (
    <>
      <form className="take-attendance-page" onSubmit={(event) => void submit(event)}>
        <button type="button" className="back-link" onClick={() => requestNavigation('/attendance')}><ArrowLeft size={16} /> Attendance</button>
        <header className="take-attendance-heading">
          <div>
            <h1>{attendanceClass.className}-{attendanceClass.section}</h1>
            <p><Users size={15} /> {attendanceClass.students.length} Students <span>·</span> <CalendarDays size={15} /> {formatAttendanceDate(date)}</p>
          </div>
          <label className="take-date-control"><span>Date</span><input type="date" max={today} value={date} disabled={saving} onChange={(event) => requestDateChange(event.target.value)} /></label>
        </header>

        <div className="take-attendance-toolbar">
          <label className="attendance-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or student ID" aria-label="Search class students" /></label>
          <button type="button" className="secondary-button small-button" disabled={saving} onClick={() => {
            setSaveSuccess('')
            setSaveError('')
            setDraft({
              key: draftKey,
              statuses: Object.fromEntries(attendanceClass.students.map((student) => [student.id, 'PRESENT'])),
              notes: { ...notes },
            })
          }}>
            <ClipboardCheck size={16} /> Mark All Present
          </button>
        </div>

        <div className="attendance-student-list">
          {filteredStudents.map((student) => (
            <TakeAttendanceStudentRow
              key={student.id}
              student={student}
              user={user}
              attendance={attendance}
              status={statuses[student.id] ?? 'UNMARKED'}
              note={notes[student.id] ?? ''}
              date={date}
              isDirty={dirtyStudentIds.includes(student.id)}
              saving={saving}
              onSelectStatus={(nextStatus) => {
                setSaveSuccess('')
                setSaveError('')
                setDraft((current) => ({
                  key: draftKey,
                  statuses: { ...(current.key === draftKey ? current.statuses : {}), [student.id]: nextStatus },
                  notes: current.key === draftKey ? current.notes : {},
                }))
              }}
              onChangeNote={(nextNote) => {
                setSaveSuccess('')
                setSaveError('')
                setDraft((current) => ({
                  key: draftKey,
                  statuses: current.key === draftKey ? current.statuses : { ...defaultStatuses },
                  notes: { ...(current.key === draftKey ? current.notes : {}), [student.id]: nextNote },
                }))
              }}
            />
          ))}
        </div>

        {saveError ? <div className="attendance-empty-notice" role="alert">{saveError}</div> : null}
        <TakeAttendanceFooter
          totals={totals}
          unmarkedCount={unmarkedCount}
          dirtyCount={dirtyStudentIds.length}
          saveSuccess={saveSuccess}
          canCorrectAttendance={canCorrectAttendance}
          saving={saving}
          hasExistingRecords={existingRecords.length > 0}
          onOpenCorrection={() => setShowCorrectionModal(true)}
        />
      </form>

      {pendingDiscard && (
        <div className="attendance-discard-backdrop">
          <dialog open className="attendance-discard-dialog" aria-modal="true" aria-labelledby="attendance-discard-title">
            <h2 id="attendance-discard-title">Discard unsaved attendance?</h2>
            <p>You have unsaved attendance changes. Continue without saving?</p>
            <div>
              <button type="button" className="secondary-button" onClick={() => setPendingDiscard(null)}>Cancel</button>
              <button type="button" className="primary-button" onClick={discardAndContinue}>Discard Changes</button>
            </div>
          </dialog>
        </div>
      )}

      {showCorrectionModal && canCorrectAttendance && existingSession?.status === 'COMPLETED' && (
        <AttendanceCorrectionModal
          isOpen={showCorrectionModal}
          sessionId={existingSession.id}
          className={attendanceClass.className}
          section={attendanceClass.section}
          date={date}
          records={attendanceClass.students.map((student) => {
            const status = statuses[student.id] ?? 'UNMARKED'
            return {
              student_id: student.id,
              student_name: `${student.firstName} ${student.lastName}`,
              status: isAttendanceStatus(status) ? status : 'PRESENT',
              note: notes[student.id] ?? '',
            }
          })}
          originalRecords={attendanceClass.students.flatMap((student) => {
            const record = recordsByStudentId.get(student.id)
            if (!record) return []
            return [{
              student_id: student.id,
              student_name: `${student.firstName} ${student.lastName}`,
              status: record.status,
              note: record.note,
            }]
          })}
          onClose={() => setShowCorrectionModal(false)}
          onSave={async (payload) => {
            if (onCorrectAttendance) {
              await onCorrectAttendance(payload)
            } else {
              await correctAttendanceSession(payload, { role: user.role, route: window.location.pathname })
              if (onRefresh) onRefresh()
            }
            void navigate(`/attendance?date=${date}`)
          }}
        />
      )}
    </>
  )
}

function AttendanceClassCard({
  attendanceClass,
  date,
  attendance,
  canEdit,
  canViewTrash,
  onOpen,
  onCorrect,
  onTrash,
}: Readonly<{
  attendanceClass: AttendanceClass
  date: string
  attendance: AttendanceState
  canEdit: boolean
  canViewTrash: boolean
  onOpen: () => void
  onCorrect?: () => void
  onTrash?: () => void
}>) {
  const session = getSessionForClass(attendance, date, attendanceClass)
  const records = session ? getSessionRecords(attendance, session.id) : []
  const counts = getAttendanceCounts(records)
  const isTrashed = Boolean(session?.studentCount === 0 && session?.hasTrashedRecords)
  const status = getAttendanceStatusLabel(isTrashed, session)
  const hasSessionValues = Boolean(session && !isTrashed && session.studentCount > 0)
  const rateDisplay = isTrashed || counts.rate === null ? '—' : `${counts.rate}%`
  const actions = buildClassAttendanceActions({
    canCorrect: Boolean(canEdit && session?.status === 'COMPLETED' && records.length === attendanceClass.students.length && onCorrect),
    canTrash: Boolean(onTrash),
    onCorrect: () => onCorrect?.(),
    onTrash: () => onTrash?.(),
  })

  return (
    <article className="attendance-class-card">
      <div className="attendance-class-card-heading">
        <strong>{attendanceClass.className}-{attendanceClass.section}</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className={`attendance-status ${status.toLowerCase().replace(' ', '-')}`}>{status}</span>
          {actions.length > 0 && <RecordActionMenu actions={actions} />}
        </div>
      </div>
      <div className="attendance-class-card-grid">
        <span>Students <strong>{attendanceClass.students.length}</strong></span>
        <span>Present <strong>{hasSessionValues ? counts.present : '—'}</strong></span>
        <span>Absent <strong>{hasSessionValues ? counts.absent : '—'}</strong></span>
        <span>Late <strong>{hasSessionValues ? counts.late : '—'}</strong></span>
        <span>Rate <strong>{rateDisplay}</strong></span>
      </div>
      <AttendanceRowAction
        isTrashed={isTrashed}
        canEdit={canEdit}
        canViewTrash={canViewTrash}
        hasSession={hasSessionValues}
        onOpen={onOpen}
        onViewTrash={onOpen}
      />
    </article>
  )
}

function openAttentionItem(
  item: AttendanceAttention,
  onOpenStudent: (id: string) => void,
  onOpenClass: (id: string) => void,
) {
  if (item.kind === 'student' && item.studentId) {
    onOpenStudent(item.studentId)
    return
  }
  if (item.classId) {
    onOpenClass(item.classId)
  }
}

function AttendanceAttentionPanel({
  attendance,
  user,
  students,
  onOpenStudent,
  onOpenClass,
  onPrepareMessage,
}: Readonly<{
  attendance: AttendanceState
  user: AttendanceUser
  students: Student[]
  onOpenStudent: (id: string) => void
  onOpenClass: (id: string) => void
  onPrepareMessage?: (studentId: string) => void
}>) {
  const items = useMemo(() => getAttendanceAttention(attendance, students), [attendance, students])
  return (
    <section className="attendance-section">
      <div className="attendance-section-heading"><div><h2>Needs attention</h2><p>Based on recorded attendance only.</p></div><span>{items.length} items</span></div>
      {items.length ? (
        <ul className="attendance-attention-list">
          {items.map((item) => {
            const canPrepareMessage = Boolean(
              item.kind === 'student' &&
              item.studentId &&
              onPrepareMessage &&
              (user.role === 'admin' || user.role === 'teacher'),
            )
            return (
              <li key={`${item.kind}-${item.level}-${item.studentId ?? item.classId}`}>
                <span className={`level-badge ${item.level.toLowerCase()}`}>
                  {item.level.charAt(0).toUpperCase() + item.level.slice(1).toLowerCase()}
                </span>
                <div><strong>{item.title}</strong><small>{item.detail}</small></div>
                <div className="attendance-attention-actions">
                  <button
                    type="button"
                    className="student-link"
                    onClick={() => openAttentionItem(item, onOpenStudent, onOpenClass)}
                  >
                    {item.kind === 'student' ? 'View Student' : 'View Class'}
                  </button>
                  {canPrepareMessage && item.studentId
                    ? <button type="button" className="student-link" onClick={() => onPrepareMessage?.(item.studentId!)}>Prepare Parent Message</button>
                    : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : <p className="attendance-no-alerts">No attendance items need attention.</p>}
    </section>
  )
}

function AttendanceMetric({ label, value, tone, icon: Icon }: Readonly<{ label: string; value: string; tone: string; icon?: LucideIcon }>) {
  return (
    <article className={`attendance-metric ${tone}`}>
      <div className="attendance-metric-header">
        <span>{label}</span>
        {Icon ? (
          <span className="attendance-metric-icon" aria-hidden="true">
            <Icon size={16} />
          </span>
        ) : null}
      </div>
      <strong>{value}</strong>
    </article>
  )
}

function AttendanceLoadingState() {
  return <section className="attendance-loading" aria-label="Loading attendance"><div className="skeleton attendance-title-skeleton" /><div className="attendance-summary-grid">{[1, 2, 3, 4].map((item) => <div className="skeleton attendance-metric-skeleton" key={item} />)}</div><div className="skeleton attendance-list-skeleton" /></section>
}

function AttendanceErrorState({ detail, onRetry }: Readonly<{ detail: string; onRetry: () => void }>) {
  return <AttendanceEmptyState title="We couldn't load attendance." detail={detail} onRetry={onRetry} />
}

function AttendanceEmptyState({ title, detail, onRetry, onBack }: Readonly<{ title: string; detail?: string; onRetry?: () => void; onBack?: () => void }>) {
  const navigate = useNavigate()
  return (
    <section className="attendance-empty-state">
      <div className="empty-icon"><ClipboardCheck size={22} /></div>
      <h1>{title}</h1>
      {detail ? <p>{detail}</p> : null}
      {onRetry ? <button type="button" className="primary-button small-button" onClick={onRetry}>Try Again</button> : null}
      {onBack ? <button type="button" className="primary-button small-button" onClick={onBack}><ArrowLeft size={15} /> Back to Attendance</button> : null}
      {!onRetry && !onBack ? <button type="button" className="primary-button small-button" onClick={() => void navigate('/attendance')}>Open Attendance</button> : null}
    </section>
  )
}
