import { useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, CalendarDays, ClipboardCheck, FileText, Search, Users } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { AttendanceClass, AttendanceState, AttendanceStatus, AttendanceSubmission, AttendanceUser } from './attendanceData'
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
import { correctAttendanceSession } from './services/attendance'
import { trashAttendanceSession } from './services/trash'

type AttendancePageProps = {
  user: AttendanceUser
  students: Student[]
  attendance: AttendanceState
  loading: boolean
  error: string
  onRetry: () => void
  onPrepareMessage?: (studentId: string) => void
  onCorrectAttendance?: (payload: {
    sessionId: string
    records: AttendanceCorrectionRecord[]
    reason: string
  }) => Promise<void>
  onRefresh?: () => void
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

export function AttendancePage({ user, students, attendance, loading, error, onRetry, onPrepareMessage, onCorrectAttendance, onRefresh }: AttendancePageProps) {
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
  const [correctingSession, setCorrectingSession] = useState<{
    sessionId: string
    className: string
    section: string
    date: string
    records: AttendanceCorrectionRecord[]
  } | null>(null)

  const handleTrashAttendance = async (sessionId: string, className: string, section: string) => {
    const reason = window.prompt(`Why are you moving ${className}-${section} attendance to Trash?`)?.trim()
    if (!reason) return
    if (!window.confirm(`Move the ${formatAttendanceDate(date)} attendance for ${className}-${section} to Trash?`)) return
    setTrashError('')
    try {
      await trashAttendanceSession(sessionId, reason)
      onRefresh?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Attendance could not be moved to Trash.'
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
        <button type="button" className="secondary-button small-button" onClick={() => navigate('/statements/attendance')}>
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
        <div className="attendance-empty-notice" role="status">
          {attendance.sessions.length === 0
            ? 'No attendance records yet.'
            : `No attendance has been recorded for ${formatAttendanceDate(date)}${classFilter ? ` in ${classFilter}` : ' across all classes'}${sectionFilter ? `, section ${sectionFilter}` : ''}.`}
        </div>
      ) : null}

      <div className="attendance-summary-grid">
        <AttendanceMetric label="Present" value={String(counts.present)} tone="green" />
        <AttendanceMetric label="Absent" value={String(counts.absent)} tone="red" />
        <AttendanceMetric label="Late" value={String(counts.late)} tone="amber" />
        <AttendanceMetric label="Attendance Rate" value={counts.rate === null ? '0%' : `${counts.rate}%`} tone="blue" />
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
                  const isTrashed = Boolean(session && session.studentCount === 0)
                  const status = isTrashed
                    ? 'In Trash'
                    : !session
                      ? 'Not Marked'
                      : session.status === 'COMPLETED'
                        ? 'Completed'
                        : 'In Progress'
                  const classActions: ActionItem[] = []
                  if (user.role !== 'finance' && session?.status === 'COMPLETED' && sessionRecords.length > 0) {
                    classActions.push({
                      label: 'Correct Attendance',
                      onClick: () => {
                        setCorrectingSession({
                          sessionId: session.id,
                          className: attendanceClass.className,
                          section: attendanceClass.section,
                          date,
                          records: attendanceClass.students.map((student) => {
                            const rec = sessionRecords.find((item) => item.studentId === student.id)
                            return {
                              student_id: student.id,
                              student_name: `${student.firstName} ${student.lastName}`,
                              status: (rec?.status ?? 'PRESENT') as 'PRESENT' | 'ABSENT' | 'LATE',
                              note: rec?.note ?? '',
                            }
                          }),
                        })
                      },
                    })
                  }
                  if (user.role === 'admin' && session && sessionRecords.length > 0) {
                    classActions.push({
                      label: 'Move Attendance to Trash',
                      danger: true,
                      onClick: () => { void handleTrashAttendance(session.id, attendanceClass.className, attendanceClass.section) },
                    })
                  }
                  return (
                    <tr key={attendanceClass.id}>
                      <td><strong>{attendanceClass.className}</strong></td>
                      <td>{attendanceClass.section}</td>
                      <td>{attendanceClass.students.length}</td>
                      <td>{session && !isTrashed ? summary.present : '—'}</td>
                      <td>{session && !isTrashed ? summary.absent : '—'}</td>
                      <td>{session && !isTrashed ? summary.late : '—'}</td>
                      <td>{isTrashed || summary.rate === null ? '—' : `${summary.rate}%`}</td>
                      <td><span className={`attendance-status ${status.toLowerCase().replace(' ', '-')}`}>{status}</span></td>
                      <td>
                        {user.role === 'finance' ? (
                          'View only'
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {isTrashed
                              ? user.role === 'admin'
                                ? <button type="button" className="student-link" onClick={() => navigate('/trash')}>View Trash</button>
                                : <span className="student-muted">In Trash</span>
                              : <button
                                type="button"
                                className="student-link"
                                onClick={() => navigate(`/attendance/take/${encodeURIComponent(attendanceClass.id)}?date=${date}`)}
                              >
                                {session ? 'View / Edit' : 'Take Attendance'}
                              </button>}
                            {classActions.length > 0 && <RecordActionMenu actions={classActions} />}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <AttendanceEmptyState title={classes.length === 0 ? 'No classes available yet.' : 'No classes match these filters.'} detail={classes.length === 0 ? 'Classes will appear here once students are enrolled.' : 'Choose another class or section.'} />}
        <div className="attendance-class-cards">
          {visibleClasses.map((attendanceClass) => {
            const session = getSessionForClass(attendance, date, attendanceClass)
            const sessionRecords = session ? getSessionRecords(attendance, session.id) : []
            return (
              <AttendanceClassCard
                key={attendanceClass.id}
                attendanceClass={attendanceClass}
                date={date}
                attendance={attendance}
                canEdit={user.role !== 'finance'}
                onOpen={() => navigate(session?.studentCount === 0
                  ? '/trash'
                  : `/attendance/take/${encodeURIComponent(attendanceClass.id)}?date=${date}`)}
                canViewTrash={user.role === 'admin'}
                onTrash={session && sessionRecords.length > 0 && user.role === 'admin'
                  ? () => { void handleTrashAttendance(session.id, attendanceClass.className, attendanceClass.section) }
                  : undefined}
                onCorrect={session?.status === 'COMPLETED' && sessionRecords.length > 0 && user.role !== 'finance' ? () => {
                  setCorrectingSession({
                    sessionId: session.id,
                    className: attendanceClass.className,
                    section: attendanceClass.section,
                    date,
                    records: attendanceClass.students.map((student) => {
                      const rec = sessionRecords.find((item) => item.studentId === student.id)
                      return {
                        student_id: student.id,
                        student_name: `${student.firstName} ${student.lastName}`,
                        status: (rec?.status ?? 'PRESENT') as 'PRESENT' | 'ABSENT' | 'LATE',
                        note: rec?.note ?? '',
                      }
                    }),
                  })
                } : undefined}
              />
            )
          })}
        </div>
      </section>

      <AttendanceAttentionPanel attendance={attendance} user={user} students={students} onOpenStudent={(id) => navigate(`/students/${encodeURIComponent(id)}`)} onOpenClass={(id) => navigate(`/attendance/take/${encodeURIComponent(id)}?date=${date}`)} onPrepareMessage={onPrepareMessage} />

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

export function TakeAttendancePage(props: TakeAttendancePageProps) {
  const { user, students, attendance, loading, error, onRetry, onSave, onCorrectAttendance, onRefresh } = props
  const navigate = useNavigate()
  const { classId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const today = attendanceDateKey(user.schoolTimezone)
  const requestedDate = searchParams.get('date') ?? today
  const attendanceClass = useMemo(() => canAccessAttendanceClass(students, classId), [students, classId])
  const teacherHasClassAssignment = Boolean(attendanceClass && user.teacherAssignments?.some((assignment) =>
    assignment.active &&
    assignment.school_id === attendanceClass.schoolId &&
    assignment.campus_id === attendanceClass.campusId &&
    assignment.class_name === attendanceClass.className &&
    assignment.section === attendanceClass.section,
  ))
  const hasClassAttendanceAccess = Boolean(attendanceClass && (
    user.role === 'admin' ||
    user.role === 'principal' ||
    (user.role === 'teacher' && teacherHasClassAssignment)
  ))
  const [date, setDate] = useState(() => {
    const parsedDate = new Date(`${requestedDate}T00:00:00`)
    return !Number.isNaN(parsedDate.getTime()) &&
      localDateKey(parsedDate) === requestedDate &&
      requestedDate <= today
      ? requestedDate
      : today
  })
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
  const canCorrectAttendance = Boolean(
    existingSession?.status === 'COMPLETED' &&
    (user.role === 'admin' || user.role === 'principal' || (user.role === 'teacher' && teacherHasClassAssignment)),
  )
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
      event.returnValue = ''
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

  if (loading) return <AttendanceLoadingState />
  if (error) return <AttendanceErrorState detail={error} onRetry={onRetry} />
  if (!attendanceClass || !hasClassAttendanceAccess) {
    const isUnassignedTeacherClass = user.role === 'teacher' && attendanceClass !== null
    const detail = isUnassignedTeacherClass
      ? 'This class is not assigned to you.'
      : 'This class is not included in your authorized attendance scope.'
    return <AttendanceEmptyState title={isUnassignedTeacherClass ? 'Class not assigned' : 'Class not found'} detail={detail} onBack={() => navigate('/attendance')} />
  }
  if (existingSession?.studentCount === 0) {
    return <AttendanceEmptyState title="Attendance is in Trash" detail="Restore this attendance session from Trash before opening or editing it." onBack={() => navigate(user.role === 'admin' ? '/trash' : '/attendance')} />
  }

  const filteredStudents = attendanceClass.students.filter((student) =>
    `${student.firstName} ${student.lastName} ${student.studentId} ${attendanceClass.className}`.toLowerCase().includes(query.trim().toLowerCase()),
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
    navigate(to)
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
      navigate(destination.to)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (dirtyStudentIds.length === 0) return
    if (date > attendanceDateKey(user.schoolTimezone)) {
      setSaveError('Attendance cannot be recorded for a future date.')
      return
    }
    const changedStatuses: Record<string, AttendanceStatus> = {}
    for (const studentId of dirtyStudentIds) {
      const status = statuses[studentId]
      if (!status || !isAttendanceStatus(status)) continue
      changedStatuses[studentId] = status
    }
    if (Object.keys(changedStatuses).length !== dirtyStudentIds.length) {
      setSaveError('Select Present, Absent, or Late for each changed student before saving.')
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
        changedStudentIds: dirtyStudentIds,
        statuses: changedStatuses,
        notes: Object.fromEntries(dirtyStudentIds.map((studentId) => [studentId, notes[studentId] ?? ''])),
      })
      setDraft({ key: draftKey, statuses: {}, notes: {} })
      setSaveSuccess('All changes saved.')
    } catch (error) {
      console.error('[CAMVIA Attendance] Attendance save failed:', error)
      setSaveError('Some attendance changes could not be saved. Your unsaved selections are still here; check your connection and try again.')
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  return (
    <>
      <form className="take-attendance-page" onSubmit={submit}>
        <button type="button" className="back-link" onClick={() => requestNavigation('/attendance')}><ArrowLeft size={16} /> Attendance</button>
        <header className="take-attendance-heading">
          <div>
            <p className="eyebrow">{existingSession ? 'Edit attendance' : 'Take attendance'}</p>
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
          {filteredStudents.map((student) => {
            const summary = getStudentAttendance(student, attendance)
            return (
            <article className={`attendance-student-row${dirtyStudentIds.includes(student.id) ? ' changed' : ''}`} key={student.id}>
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
                        status: statuses[student.id] ?? 'UNMARKED',
                        date,
                        rate: summary.counts.rate,
                        recordedDays: summary.counts.total,
                      },
                    }}
                  />
                  {statuses[student.id] === 'UNMARKED'
                    ? <span className="attendance-row-state">Unmarked</span>
                    : dirtyStudentIds.includes(student.id)
                      ? <span className="attendance-row-state">Unsaved change</span>
                      : null}
                </div>
              </div>
              <div className="attendance-segmented" role="group" aria-label={`Attendance for ${student.firstName} ${student.lastName}`}>
                {statusOptions.map((option) => (
                  <button type="button" key={option.status} disabled={saving} aria-pressed={statuses[student.id] === option.status} className={`${statuses[student.id] === option.status ? 'selected' : ''} ${option.status.toLowerCase()}`} onClick={() => {
                    setSaveSuccess('')
                    setSaveError('')
                    setDraft((current) => ({
                      key: draftKey,
                      statuses: { ...(current.key === draftKey ? current.statuses : {}), [student.id]: option.status },
                      notes: current.key === draftKey ? current.notes : {},
                    }))
                  }}>{option.label}</button>
                ))}
              </div>
              {statuses[student.id] === 'ABSENT' || statuses[student.id] === 'LATE' ? (
                <input className="attendance-note" disabled={saving} value={notes[student.id] ?? ''} onChange={(event) => {
                  setSaveSuccess('')
                  setSaveError('')
                  setDraft((current) => ({
                    key: draftKey,
                    statuses: current.key === draftKey ? current.statuses : { ...defaultStatuses },
                    notes: { ...(current.key === draftKey ? current.notes : {}), [student.id]: event.target.value },
                  }))
                }} placeholder="Optional note" aria-label={`Optional note for ${student.firstName} ${student.lastName}`} />
              ) : null}
            </article>
            )
          })}
        </div>

        {saveError ? <div className="attendance-empty-notice" role="alert">{saveError}</div> : null}
        <footer className="attendance-save-footer">
          <div className="attendance-totals">
            <span><i className="total-dot present-dot" /> Present: <strong>{totals.present}</strong></span>
            <span><i className="total-dot absent-dot" /> Absent: <strong>{totals.absent}</strong></span>
            <span><i className="total-dot late-dot" /> Late: <strong>{totals.late}</strong></span>
            <span>Unmarked: <strong>{unmarkedCount}</strong></span>
            {dirtyStudentIds.length > 0
              ? <span className="attendance-unsaved-count">{dirtyStudentIds.length} unsaved {dirtyStudentIds.length === 1 ? 'change' : 'changes'}</span>
              : saveSuccess ? <span className="attendance-saved-count" role="status">{saveSuccess}</span> : null}
          </div>
          <div className="attendance-save-actions">
            {canCorrectAttendance && (
              <button
                type="button"
                className="secondary-button"
                disabled={saving || existingRecords.length === 0}
                onClick={() => setShowCorrectionModal(true)}
              >
                Audited Correction
              </button>
            )}
            <button type="submit" className="primary-button attendance-save-button" disabled={saving || dirtyStudentIds.length === 0}>
              {saving ? 'Saving...' : 'Save Attendance'}
            </button>
          </div>
        </footer>
      </form>

      {pendingDiscard && (
        <div className="attendance-discard-backdrop" role="presentation">
          <section className="attendance-discard-dialog" role="alertdialog" aria-modal="true" aria-labelledby="attendance-discard-title">
            <h2 id="attendance-discard-title">Discard unsaved attendance?</h2>
            <p>You have unsaved attendance changes. Continue without saving?</p>
            <div>
              <button type="button" className="secondary-button" onClick={() => setPendingDiscard(null)}>Cancel</button>
              <button type="button" className="primary-button" onClick={discardAndContinue}>Discard Changes</button>
            </div>
          </section>
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
            navigate(`/attendance?date=${date}`)
          }}
        />
      )}
    </>
  )
}

function AttendanceClassCard({ attendanceClass, date, attendance, canEdit, canViewTrash, onOpen, onCorrect, onTrash }: {
  attendanceClass: AttendanceClass
  date: string
  attendance: AttendanceState
  canEdit: boolean
  canViewTrash: boolean
  onOpen: () => void
  onCorrect?: () => void
  onTrash?: () => void
}) {
  const session = getSessionForClass(attendance, date, attendanceClass)
  const records = session ? getSessionRecords(attendance, session.id) : []
  const counts = getAttendanceCounts(records)
  const isTrashed = Boolean(session && session.studentCount === 0)
  const status = isTrashed
    ? 'In Trash'
    : !session
      ? 'Not Marked'
      : session.status === 'COMPLETED'
        ? 'Completed'
        : 'In Progress'
  const actions: ActionItem[] = []
  if (canEdit && session?.status === 'COMPLETED' && records.length === attendanceClass.students.length && onCorrect) {
    actions.push({
      label: 'Correct Attendance',
      onClick: onCorrect,
    })
  }
  if (onTrash) {
    actions.push({ label: 'Move Attendance to Trash', danger: true, onClick: onTrash })
  }
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
        <span>Present <strong>{session && !isTrashed ? counts.present : '—'}</strong></span>
        <span>Absent <strong>{session && !isTrashed ? counts.absent : '—'}</strong></span>
        <span>Late <strong>{session && !isTrashed ? counts.late : '—'}</strong></span>
        <span>Rate <strong>{isTrashed || counts.rate === null ? '—' : `${counts.rate}%`}</strong></span>
      </div>
      {isTrashed
        ? canViewTrash
          ? <button type="button" className="student-link" onClick={onOpen}>View Trash</button>
          : <span className="student-muted">In Trash</span>
        : canEdit
          ? <button type="button" className="student-link" onClick={onOpen}>{session ? 'View / Edit' : 'Take Attendance'}</button>
          : <span className="student-muted">View only</span>}
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
