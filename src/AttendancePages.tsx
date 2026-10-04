import { useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, CalendarDays, ClipboardCheck, Search, Users } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { AttendanceClass, AttendanceState, AttendanceStatus, AttendanceSubmission, AttendanceUser } from './attendanceData'
import {
  canAccessAttendanceClass,
  getAttendanceAttention,
  formatAttendanceDate,
  getAttendanceClasses,
  getAttendanceCounts,
  getSessionForClass,
  getSessionRecords,
  localDateKey,
} from './attendanceData'
import type { Student } from './studentData'

type AttendancePageProps = {
  user: AttendanceUser
  students: Student[]
  attendance: AttendanceState
  loading: boolean
  error: string
  onRetry: () => void
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

export function AttendancePage({ user, students, attendance, loading, error, onRetry, onPrepareMessage }: AttendancePageProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const classes = useMemo(() => getAttendanceClasses(students), [students])
  const [date, setDate] = useState(searchParams.get('date') ?? localDateKey())
  const [classFilter, setClassFilter] = useState(() =>
    user.role === 'teacher' && classes.length === 1 ? classes[0].className : '',
  )
  const [sectionFilter, setSectionFilter] = useState(() =>
    user.role === 'teacher' && classes.length === 1 ? classes[0].section : '',
  )
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
  const classOptions = [...new Set(classes.map((attendanceClass) => attendanceClass.className))].sort()
  const sectionOptions = [...new Set(classes
    .filter((attendanceClass) => !classFilter || attendanceClass.className === classFilter)
    .map((attendanceClass) => attendanceClass.section),
  )].sort()

  return (
    <section className="attendance-page">
      <header className="attendance-heading">
        <div>
          <p className="eyebrow">Daily operations</p>
          <h1>Attendance</h1>
          <p>Track today&apos;s attendance and identify students who need attention.</p>
        </div>
      </header>

      <div className="help-banner">
        <strong>Helpful tip:</strong> Mark All Present, then update exceptions.
      </div>

      <div className="attendance-controls">
        <label><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label><span>Class</span><select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setSectionFilter('') }}><option value="">All classes</option>{classOptions.map((className) => <option key={className}>{className}</option>)}</select></label>
        <label><span>Section</span><select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}><option value="">All sections</option>{sectionOptions.map((section) => <option key={section}>{section}</option>)}</select></label>
      </div>

      {counts.total === 0 ? (
        <div className="attendance-empty-notice" role="status">
          No attendance has been recorded for {formatAttendanceDate(date)}
          {classFilter ? ` in ${classFilter}` : ' across all classes'}
          {sectionFilter ? `, section ${sectionFilter}` : ''}.
        </div>
      ) : null}

      <div className="attendance-summary-grid">
        <AttendanceMetric label="Present" value={String(counts.present)} tone="green" />
        <AttendanceMetric label="Absent" value={String(counts.absent)} tone="red" />
        <AttendanceMetric label="Late" value={String(counts.late)} tone="amber" />
        <AttendanceMetric label="Attendance Rate" value={counts.rate === null ? '—' : `${counts.rate}%`} tone="blue" />
      </div>

      <section className="attendance-section">
        <div className="attendance-section-heading">
          <div><h2>Class attendance</h2><p>{formatAttendanceDate(date)}</p></div>
          <span>{visibleClasses.length} classes</span>
        </div>
        {visibleClasses.length ? (
          <div className="attendance-table-wrap">
            <table className="attendance-table">
              <thead><tr><th>Class</th><th>Section</th><th>Students</th><th>Present</th><th>Absent</th><th>Late</th><th>Rate</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {visibleClasses.map((attendanceClass) => {
                  const session = getSessionForClass(attendance, date, attendanceClass)
                  const sessionRecords = session ? getSessionRecords(attendance, session.id) : []
                  const summary = getAttendanceCounts(sessionRecords)
                  const status = !session ? 'Not Marked' : sessionRecords.length < attendanceClass.students.length ? 'In Progress' : 'Completed'
                  return (
                    <tr key={attendanceClass.id}>
                      <td><strong>{attendanceClass.className}</strong></td>
                      <td>{attendanceClass.section}</td>
                      <td>{attendanceClass.students.length}</td>
                      <td>{session ? summary.present : '—'}</td>
                      <td>{session ? summary.absent : '—'}</td>
                      <td>{session ? summary.late : '—'}</td>
                      <td>{summary.rate === null ? '—' : `${summary.rate}%`}</td>
                      <td><span className={`attendance-status ${status.toLowerCase().replace(' ', '-')}`}>{status}</span></td>
                      <td>{user.role === 'finance' ? 'View only' : <button type="button" className="student-link" onClick={() => navigate(`/attendance/take/${encodeURIComponent(attendanceClass.id)}?date=${date}`)}>{session ? 'View / Edit' : 'Take Attendance'}</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <AttendanceEmptyState title="No classes match these filters." detail="Choose another class or section." />}
        <div className="attendance-class-cards">
          {visibleClasses.map((attendanceClass) => (
            <AttendanceClassCard
              key={attendanceClass.id}
              attendanceClass={attendanceClass}
              date={date}
              attendance={attendance}
              canEdit={user.role !== 'finance'}
              onOpen={() => navigate(`/attendance/take/${encodeURIComponent(attendanceClass.id)}?date=${date}`)}
            />
          ))}
        </div>
      </section>

      <AttendanceAttentionPanel attendance={attendance} user={user} students={students} onOpenStudent={(id) => navigate(`/students/${encodeURIComponent(id)}`)} onOpenClass={(id) => navigate(`/attendance/take/${encodeURIComponent(id)}?date=${date}`)} onPrepareMessage={onPrepareMessage} />
    </section>
  )
}

export function TakeAttendancePage({ user, students, attendance, loading, error, onRetry, onSave }: TakeAttendancePageProps) {
  const navigate = useNavigate()
  const { classId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const requestedDate = searchParams.get('date') ?? localDateKey()
  const attendanceClass = useMemo(() => canAccessAttendanceClass(students, classId), [students, classId])
  const [date, setDate] = useState(requestedDate)
  const [draft, setDraft] = useState<{
    key: string
    statuses: Record<string, AttendanceStatus>
    notes: Record<string, string>
  }>({ key: '', statuses: {}, notes: {} })
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const existingSession = attendanceClass ? getSessionForClass(attendance, date, attendanceClass) : undefined
  const existingRecords = existingSession ? getSessionRecords(attendance, existingSession.id) : []
  const draftKey = `${classId}|${date}`
  const defaultStatuses = Object.fromEntries(attendanceClass?.students.map((student) => {
    const record = existingRecords.find((item) => item.studentId === student.id)
    return [student.id, record?.status ?? 'PRESENT']
  }) ?? []) as Record<string, AttendanceStatus>
  const defaultNotes = Object.fromEntries(attendanceClass?.students.map((student) => {
    const record = existingRecords.find((item) => item.studentId === student.id)
    return [student.id, record?.note ?? '']
  }) ?? [])
  const statuses = draft.key === draftKey ? { ...defaultStatuses, ...draft.statuses } : defaultStatuses
  const notes = draft.key === draftKey ? { ...defaultNotes, ...draft.notes } : defaultNotes

  if (loading) return <AttendanceLoadingState />
  if (error) return <AttendanceErrorState detail={error} onRetry={onRetry} />
  if (!attendanceClass || user.role === 'finance') {
    return <AttendanceEmptyState title="Class not found" detail="This class is not included in your authorized attendance scope." onBack={() => navigate('/attendance')} />
  }

  const filteredStudents = attendanceClass.students.filter((student) =>
    `${student.firstName} ${student.lastName} ${student.studentId} ${attendanceClass.className}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const visibleRecords = attendanceClass.students.map((student) => ({
    ...student,
    status: statuses[student.id] ?? 'PRESENT',
  }))
  const totals = {
    present: visibleRecords.filter((student) => student.status === 'PRESENT').length,
    absent: visibleRecords.filter((student) => student.status === 'ABSENT').length,
    late: visibleRecords.filter((student) => student.status === 'LATE').length,
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setSaveError('')
    try {
      await onSave({ date, classId: attendanceClass.id, statuses, notes })
      navigate(`/attendance?date=${date}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Attendance could not be saved.'
      console.error('[Supabase] Attendance save failed:', message)
      setSaveError('Attendance could not be saved. Check your connection and class access, then try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="take-attendance-page" onSubmit={submit}>
      <button type="button" className="back-link" onClick={() => navigate('/attendance')}><ArrowLeft size={16} /> Attendance</button>
      <header className="take-attendance-heading">
        <div>
          <p className="eyebrow">{existingSession ? 'Edit attendance' : 'Take attendance'}</p>
          <h1>{attendanceClass.className}-{attendanceClass.section}</h1>
          <p><Users size={15} /> {attendanceClass.students.length} Students <span>·</span> <CalendarDays size={15} /> {formatAttendanceDate(date)}</p>
        </div>
        <label className="take-date-control"><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      </header>

      <div className="take-attendance-toolbar">
        <label className="attendance-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or student ID" aria-label="Search class students" /></label>
        <button type="button" className="secondary-button small-button" onClick={() => setDraft({
          key: draftKey,
          statuses: Object.fromEntries(attendanceClass.students.map((student) => [student.id, 'PRESENT'])),
          notes: draft.key === draftKey ? draft.notes : {},
        })}>
          <ClipboardCheck size={16} /> Mark All Present
        </button>
      </div>

      <div className="attendance-student-list">
        {filteredStudents.map((student) => (
          <article className="attendance-student-row" key={student.id}>
            <div className="attendance-student-person">
              <div className="student-avatar"><Users size={17} /></div>
              <div><strong>{student.firstName} {student.lastName}</strong><span>{student.studentId} · Roll {student.rollNumber}</span></div>
            </div>
            <div className="attendance-segmented" role="group" aria-label={`Attendance for ${student.firstName} ${student.lastName}`}>
              {statusOptions.map((option) => (
                <button type="button" key={option.status} aria-pressed={(statuses[student.id] ?? 'PRESENT') === option.status} className={`${(statuses[student.id] ?? 'PRESENT') === option.status ? 'selected' : ''} ${option.status.toLowerCase()}`} onClick={() => setDraft((current) => ({
                  key: draftKey,
                  statuses: { ...(current.key === draftKey ? current.statuses : {}), [student.id]: option.status },
                  notes: current.key === draftKey ? current.notes : {},
                }))}>{option.label}</button>
              ))}
            </div>
            {statuses[student.id] !== 'PRESENT' ? (
              <input className="attendance-note" value={notes[student.id] ?? ''} onChange={(event) => setDraft((current) => ({
                key: draftKey,
                statuses: current.key === draftKey ? current.statuses : {},
                notes: { ...(current.key === draftKey ? current.notes : {}), [student.id]: event.target.value },
              }))} placeholder="Optional note" aria-label={`Optional note for ${student.firstName} ${student.lastName}`} />
            ) : null}
          </article>
        ))}
      </div>

      {saveError ? <div className="attendance-empty-notice" role="alert">{saveError}</div> : null}
      <footer className="attendance-save-footer">
        <div className="attendance-totals">
          <span><i className="total-dot present-dot" /> Present: <strong>{totals.present}</strong></span>
          <span><i className="total-dot absent-dot" /> Absent: <strong>{totals.absent}</strong></span>
          <span><i className="total-dot late-dot" /> Late: <strong>{totals.late}</strong></span>
        </div>
        <button type="submit" className="primary-button attendance-save-button" disabled={saving}>{saving ? 'Saving…' : existingSession ? 'Save Changes' : 'Save Attendance'}</button>
      </footer>
    </form>
  )
}

function AttendanceClassCard({ attendanceClass, date, attendance, canEdit, onOpen }: {
  attendanceClass: AttendanceClass
  date: string
  attendance: AttendanceState
  canEdit: boolean
  onOpen: () => void
}) {
  const session = getSessionForClass(attendance, date, attendanceClass)
  const records = session ? getSessionRecords(attendance, session.id) : []
  const counts = getAttendanceCounts(records)
  const status = !session ? 'Not Marked' : records.length < attendanceClass.students.length ? 'In Progress' : 'Completed'
  return (
    <article className="attendance-class-card">
      <div className="attendance-class-card-heading"><strong>{attendanceClass.className}-{attendanceClass.section}</strong><span className={`attendance-status ${status.toLowerCase().replace(' ', '-')}`}>{status}</span></div>
      <div className="attendance-class-card-grid">
        <span>Students <strong>{attendanceClass.students.length}</strong></span>
        <span>Present <strong>{session ? counts.present : '—'}</strong></span>
        <span>Absent <strong>{session ? counts.absent : '—'}</strong></span>
        <span>Late <strong>{session ? counts.late : '—'}</strong></span>
        <span>Rate <strong>{counts.rate === null ? '—' : `${counts.rate}%`}</strong></span>
      </div>
      {canEdit ? <button type="button" className="student-link" onClick={onOpen}>{session ? 'View / Edit' : 'Take Attendance'}</button> : <span className="student-muted">View only</span>}
    </article>
  )
}

function AttendanceAttentionPanel({ attendance, user, students, onOpenStudent, onOpenClass, onPrepareMessage }: {
  attendance: AttendanceState
  user: AttendanceUser
  students: Student[]
  onOpenStudent: (id: string) => void
  onOpenClass: (id: string) => void
  onPrepareMessage?: (studentId: string) => void
}) {
  const items = useMemo(() => getAttendanceAttention(attendance, students), [attendance, students])
  return (
    <section className="attendance-section">
      <div className="attendance-section-heading"><div><h2>Needs attention</h2><p>Based on recorded attendance only.</p></div><span>{items.length} items</span></div>
      {items.length ? (
        <ul className="attendance-attention-list">
          {items.map((item) => (
            <li key={`${item.kind}-${item.level}-${item.studentId ?? item.classId}`}>
              <span className={`level-badge ${item.level.toLowerCase()}`}>{item.level}</span>
              <div><strong>{item.title}</strong><small>{item.detail}</small></div>
              <div className="attendance-attention-actions">
                <button type="button" className="student-link" onClick={() => item.kind === 'student' && item.studentId ? onOpenStudent(item.studentId) : item.classId ? onOpenClass(item.classId) : undefined}>{item.kind === 'student' ? 'View Student' : 'View Class'}</button>
                {item.kind === 'student' && item.studentId && onPrepareMessage && (user.role === 'admin' || user.role === 'teacher')
                  ? <button type="button" className="student-link" onClick={() => onPrepareMessage(item.studentId!)}>Prepare Parent Message</button>
                  : null}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="attendance-no-alerts">No attendance items need attention.</p>}
    </section>
  )
}

function AttendanceMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <article className={`attendance-metric ${tone}`}><span>{label}</span><strong>{value}</strong></article>
}

function AttendanceLoadingState() {
  return <section className="attendance-loading" aria-label="Loading attendance"><div className="skeleton attendance-title-skeleton" /><div className="attendance-summary-grid">{[1, 2, 3, 4].map((item) => <div className="skeleton attendance-metric-skeleton" key={item} />)}</div><div className="skeleton attendance-list-skeleton" /></section>
}

function AttendanceErrorState({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  return <AttendanceEmptyState title="We couldn't load attendance." detail={detail} onRetry={onRetry} />
}

function AttendanceEmptyState({ title, detail, onRetry, onBack }: { title: string; detail?: string; onRetry?: () => void; onBack?: () => void }) {
  const navigate = useNavigate()
  return (
    <section className="attendance-empty-state">
      <div className="empty-icon"><ClipboardCheck size={22} /></div>
      <h1>{title}</h1>
      {detail ? <p>{detail}</p> : null}
      {onRetry ? <button type="button" className="primary-button small-button" onClick={onRetry}>Try Again</button> : null}
      {onBack ? <button type="button" className="primary-button small-button" onClick={onBack}><ArrowLeft size={15} /> Back to Attendance</button> : null}
      {!onRetry && !onBack ? <button type="button" className="primary-button small-button" onClick={() => navigate('/attendance')}>Open Attendance</button> : null}
    </section>
  )
}
