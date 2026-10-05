import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { ArrowLeft, CalendarDays, FileUp, Search, UserRound, Users } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Role, SchoolUser } from './mockData'
import type { AlertItem } from './alertsData'
import { getStudentAttendance, type AttendanceState, type AttendanceStatus } from './attendanceData'
import { getFeeInvoices, getFeeMetrics, localDateKey, type FeeInvoiceView, type FeePayment, type FeeState } from './feeData'
import {
  canCreateCommunication,
  getAccessibleCommunication,
  type CommunicationState,
} from './communicationData'
import {
  canViewStudentTab,
  type NewStudent,
  type Student,
} from './studentData'
import { fetchStudentById, fetchStudentCreationOptions, type StudentCampusOption, type TeacherAssignment } from './services/students'

type StudentPageUser = {
  id: number
  name: string
  role: Role
  email: string
  schoolName: string
  campusName: string
  organizationId?: string | null
  schoolId?: string | null
  campusId?: string | null
  teacherAssignments?: TeacherAssignment[]
}

type StudentsPageProps = {
  user: StudentPageUser
  students: Student[]
  loading: boolean
  error: string
  onRetry: () => void
  onAddStudent: (student: NewStudent, campusId: string) => Promise<void>
  onImportStudents: (students: NewStudent[]) => boolean
}

type DetailPageProps = {
  user: StudentPageUser
  students: Student[]
  attendance: AttendanceState
  attendanceLoading: boolean
  attendanceError: string
  fees: FeeState
  feesLoading: boolean
  feesError: string
  onRetryFees: () => void
  communication: CommunicationState
  users: SchoolUser[]
  alerts: AlertItem[]
  alertsLoading: boolean
  alertsError: string
}

type StudentTab = 'Overview' | 'Attendance' | 'Fees' | 'Communication'
const currentDateKey = localDateKey()

const emptyStudentForm: NewStudent = {
  firstName: '',
  lastName: '',
  studentId: '',
  className: '',
  section: '',
  rollNumber: '',
  dateOfBirth: '',
  gender: '',
  guardian: { name: '', phone: '', email: '' },
}

const studentCsvFields: (keyof NewStudent | 'guardianName' | 'guardianPhone' | 'guardianEmail')[] = [
  'firstName',
  'lastName',
  'studentId',
  'className',
  'section',
  'rollNumber',
  'dateOfBirth',
  'gender',
  'guardianName',
  'guardianPhone',
  'guardianEmail',
]

export function StudentsPage({ user, students, loading, error, onRetry, onAddStudent, onImportStudents }: StudentsPageProps) {
  const navigate = useNavigate()
  const accessibleStudents = students
  const [query, setQuery] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState<NewStudent>(emptyStudentForm)
  const [campuses, setCampuses] = useState<StudentCampusOption[]>([])
  const [teacherScopes, setTeacherScopes] = useState<TeacherAssignment[]>([])
  const [creationOptionsLoading, setCreationOptionsLoading] = useState(user.role === 'admin' || user.role === 'teacher')
  const [creationOptionsError, setCreationOptionsError] = useState('')
  const [studentSaveError, setStudentSaveError] = useState('')
  const [studentSaving, setStudentSaving] = useState(false)
  const [campusId, setCampusId] = useState('')
  const [importPreview, setImportPreview] = useState<NewStudent[] | null>(null)
  const [importError, setImportError] = useState('')
  const classOptions = [...new Set(accessibleStudents.map((student) => student.className))].sort()
  const sectionOptions = [...new Set(
    accessibleStudents
      .filter((student) => !classFilter || student.className === classFilter)
      .map((student) => student.section),
  )].sort()
  const canCreateStudents = user.role === 'admin' || user.role === 'teacher'

  useEffect(() => {
    if (!canCreateStudents) return
    let active = true
    void fetchStudentCreationOptions(
      user.role as 'admin' | 'teacher',
      user.schoolId ?? null,
      user.organizationId ?? null,
      user.teacherAssignments ?? [],
    ).then((options) => {
      if (!active) return
      setCampuses(options.campuses)
      setTeacherScopes(options.teacherScopes)
      setCampusId((current) => options.campuses.some((campus) => campus.id === current) ? current : options.campuses[0]?.id ?? '')
    }).catch((optionsError: unknown) => {
      if (!active) return
      setCreationOptionsError(optionsError instanceof Error ? optionsError.message : 'Student creation options could not be loaded.')
    }).finally(() => {
      if (active) setCreationOptionsLoading(false)
    })
    return () => { active = false }
  }, [canCreateStudents, user.role, user.schoolId, user.organizationId, user.teacherAssignments])

  const filteredStudents = accessibleStudents.filter((student) => {
    const searchable = [
      student.firstName,
      student.lastName,
      student.studentId,
      student.className,
      student.section,
      student.rollNumber,
    ].join(' ').toLowerCase()
    return (
      searchable.includes(query.trim().toLowerCase()) &&
      (!classFilter || student.className === classFilter) &&
      (!sectionFilter || student.section === sectionFilter) &&
      (!statusFilter || student.status === statusFilter)
    )
  })

  const handleAddSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStudentSaveError('')
    setStudentSaving(true)
    try {
      await onAddStudent(form, campusId)
      setForm(emptyStudentForm)
      setShowAddForm(false)
    } catch (saveError) {
      setStudentSaveError(saveError instanceof Error ? saveError.message : 'Unable to create this student.')
    } finally {
      setStudentSaving(false)
    }
  }

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setImportError('')
    setImportPreview(null)
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setImportError('Excel preview is not enabled yet. Save the worksheet as CSV and upload it here.')
      event.target.value = ''
      return
    }

    try {
      const parsed = parseStudentCsv(await file.text())
      setImportPreview(parsed)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Unable to read this CSV file.')
    }
  }

  const confirmImport = () => {
    if (importPreview && onImportStudents(importPreview)) {
      setImportPreview(null)
      setImportError('')
    }
  }

  if (error) {
    return <StudentListState title="We couldn't load students." detail={error} isError onRetry={onRetry} />
  }

  if (loading) {
    return <StudentListState title="Loading students…" />
  }

  return (
    <section className="students-page">
      <div className="students-heading">
        <div>
          <p className="eyebrow">Student directory</p>
          <h1>Students</h1>
          <p className="students-intro">Find a student and open their school overview.</p>
        </div>
        {canCreateStudents ? (
          <div className="students-actions">
            {user.role === 'admin' ? <button type="button" className="secondary-button small-button" onClick={() => document.getElementById('student-import-file')?.click()}>
              <FileUp size={16} /> Import Students
            </button> : null}
            <button type="button" className="primary-button small-button" onClick={() => { setStudentSaveError(''); setShowAddForm((current) => !current) }}>
              + Add Student
            </button>
            {user.role === 'admin' ? <input
              id="student-import-file"
              className="visually-hidden"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleImportFile}
            /> : null}
          </div>
        ) : null}
      </div>
      {user.role === 'admin' ? (
        <p className="import-help-text">
          CSV import columns: firstName, lastName, studentId, className, section, rollNumber, dateOfBirth, gender, guardianName, guardianPhone, guardianEmail.
          Save Excel files as CSV before uploading.
        </p>
      ) : null}

      {canCreateStudents && showAddForm ? (
        <form className="student-form" onSubmit={(event) => void handleAddSubmit(event)}>
          <h2>Add Student</h2>
          {creationOptionsError ? <p className="communication-feedback error" role="alert">{creationOptionsError}</p> : null}
          {studentSaveError ? <p className="communication-feedback error" role="alert">{studentSaveError}</p> : null}
          <label>Campus<select required disabled={creationOptionsLoading || studentSaving || campuses.length === 0} value={campusId} onChange={(event) => { setCampusId(event.target.value); if (user.role === 'teacher') setForm((current) => ({ ...current, className: '', section: '' })) }}><option value="">Select campus</option>{campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></label>
          <label>First name<input required value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} /></label>
          <label>Last name<input required value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} /></label>
          <label>Student ID<input required value={form.studentId} onChange={(event) => setForm((current) => ({ ...current, studentId: event.target.value }))} /></label>
          {user.role === 'teacher' ? (
            <>
              <label>Class<select required disabled={studentSaving || teacherScopes.length === 0} value={form.className} onChange={(event) => setForm((current) => ({ ...current, className: event.target.value, section: '' }))}><option value="">Select assigned class</option>{[...new Set(teacherScopes.filter((scope) => scope.campus_id === campusId).map((scope) => scope.class_name))].sort().map((className) => <option key={className}>{className}</option>)}</select></label>
              <label>Section<select required disabled={studentSaving || !form.className} value={form.section} onChange={(event) => setForm((current) => ({ ...current, section: event.target.value }))}><option value="">Select assigned section</option>{[...new Set(teacherScopes.filter((scope) => scope.campus_id === campusId && scope.class_name === form.className).map((scope) => scope.section))].sort().map((section) => <option key={section}>{section}</option>)}</select></label>
            </>
          ) : (
            <>
              <label>Class<input required placeholder="e.g. Grade 8" value={form.className} onChange={(event) => setForm((current) => ({ ...current, className: event.target.value }))} /></label>
              <label>Section<input required value={form.section} onChange={(event) => setForm((current) => ({ ...current, section: event.target.value }))} /></label>
            </>
          )}
          <label>Roll number<input disabled={studentSaving} value={form.rollNumber} onChange={(event) => setForm((current) => ({ ...current, rollNumber: event.target.value }))} /></label>
          <label>Date of birth<input disabled={studentSaving} type="date" value={form.dateOfBirth} onChange={(event) => setForm((current) => ({ ...current, dateOfBirth: event.target.value }))} /></label>
          <label>Gender<select disabled={studentSaving} value={form.gender} onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))}><option value="">Select</option><option>Female</option><option>Male</option><option>Prefer not to say</option></select></label>
          <label>Guardian name<input disabled={studentSaving} value={form.guardian.name} onChange={(event) => setForm((current) => ({ ...current, guardian: { ...current.guardian, name: event.target.value } }))} /></label>
          <label>Guardian phone<input disabled={studentSaving} type="tel" value={form.guardian.phone} onChange={(event) => setForm((current) => ({ ...current, guardian: { ...current.guardian, phone: event.target.value } }))} /></label>
          <label>Guardian email<input disabled={studentSaving} type="email" value={form.guardian.email} onChange={(event) => setForm((current) => ({ ...current, guardian: { ...current.guardian, email: event.target.value } }))} /></label>
          <div className="student-form-actions">
            <button type="button" className="secondary-button small-button" disabled={studentSaving} onClick={() => setShowAddForm(false)}>Cancel</button>
            <button type="submit" className="primary-button small-button" disabled={studentSaving || creationOptionsLoading || Boolean(creationOptionsError) || campuses.length === 0 || !campusId}>{studentSaving ? 'Saving…' : 'Save Student'}</button>
          </div>
        </form>
      ) : null}

      {user.role === 'admin' && (importError || importPreview) ? (
        <section className={`import-panel ${importError ? 'import-error' : ''}`} aria-live="polite">
          {importError ? (
            <>
              <h2>Import needs attention</h2>
              <p>{importError}</p>
            </>
          ) : importPreview ? (
            <>
              <div className="panel-header">
                <div>
                  <h2>Preview import</h2>
                  <p>{importPreview.length} student records are ready to confirm.</p>
                </div>
                <div className="student-form-actions">
                  <button type="button" className="secondary-button small-button" onClick={() => setImportPreview(null)}>Cancel</button>
                  <button type="button" className="primary-button small-button" onClick={confirmImport}>Confirm Import</button>
                </div>
              </div>
              <div className="import-preview-list">
                {importPreview.slice(0, 5).map((student) => (
                  <div key={student.studentId}>
                    <strong>{student.firstName} {student.lastName}</strong>
                    <span>{student.studentId} · {student.className}-{student.section}</span>
                  </div>
                ))}
                {importPreview.length > 5 ? <p>And {importPreview.length - 5} more…</p> : null}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <div className="student-filters">
        <label className="student-search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ID, class or roll number" aria-label="Search students" />
        </label>
        <select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setSectionFilter('') }} aria-label="Filter by class">
          <option value="">All classes</option>
          {classOptions.map((className) => <option key={className}>{className}</option>)}
        </select>
        <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} aria-label="Filter by section">
          <option value="">All sections</option>
          {sectionOptions.map((section) => <option key={section}>{section}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option>Active</option>
          <option>Inactive</option>
          <option>Graduated</option>
        </select>
      </div>

      {filteredStudents.length === 0 ? (
        <StudentListState title={accessibleStudents.length ? 'No students match these filters.' : 'No students to show yet.'} detail={accessibleStudents.length ? 'Try another name or clear one of the filters.' : 'Students assigned to your access will appear here.'} />
      ) : (
        <>
          <div className="student-table-card">
            <table className="student-table">
              <thead>
                <tr><th>Student</th><th>Student ID</th><th>Class</th><th>Section</th><th>Roll number</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {filteredStudents.map((student) => (
                  <tr key={student.id}>
                    <td><strong>{student.firstName} {student.lastName}</strong></td>
                    <td>{student.studentId}</td><td>{student.className}</td><td>{student.section}</td><td>{student.rollNumber}</td>
                    <td><span className={`status-pill ${student.status === 'Active' ? 'success' : 'muted'}`}>{student.status}</span></td>
                    <td><button type="button" className="student-link" onClick={() => navigate(`/students/${encodeURIComponent(student.id)}`)}>View profile</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="student-mobile-list">
            {filteredStudents.map((student) => (
              <article className="student-mobile-card" key={student.id} onClick={() => navigate(`/students/${encodeURIComponent(student.id)}`)}>
                <div className="student-mobile-title">
                  <div className="student-avatar"><UserRound size={18} /></div>
                  <div><strong>{student.firstName} {student.lastName}</strong><span>{student.studentId}</span></div>
                  <span className={`status-pill ${student.status === 'Active' ? 'success' : 'muted'}`}>{student.status}</span>
                </div>
                <div className="student-mobile-meta"><span>{student.className}-{student.section}</span><span>Roll {student.rollNumber}</span></div>
                <button type="button" className="student-link" onClick={(event) => { event.stopPropagation(); navigate(`/students/${encodeURIComponent(student.id)}`) }}>Open Student 360</button>
              </article>
            ))}
          </div>
        </>
      )}
      <p className="student-result-count"><Users size={15} /> {filteredStudents.length} of {accessibleStudents.length} students</p>
    </section>
  )
}

export function StudentDetailPage({ user, students, attendance, attendanceLoading, attendanceError, fees, feesLoading, feesError, onRetryFees, communication, users, alerts, alertsLoading, alertsError }: DetailPageProps) {
  const navigate = useNavigate()
  const { studentId = '' } = useParams()
  const [pageState, setPageState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [authorizedStudent, setAuthorizedStudent] = useState<Student | null>(null)
  const [detailError, setDetailError] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const feeInvoices = useMemo(
    () => authorizedStudent
      ? getFeeInvoices(fees, students, user).filter((invoice) => invoice.studentId === authorizedStudent.id)
      : [],
    [authorizedStudent, fees, students, user],
  )
  const feePayments = fees.payments.filter((payment) =>
    feeInvoices.some((invoice) => invoice.id === payment.invoiceId),
  )
  const communicationMessages = authorizedStudent
    ? getAccessibleCommunication(communication, students, user).filter((message) => message.studentId === authorizedStudent.id)
    : []
  const [activeTab, setActiveTab] = useState<StudentTab>('Overview')

  useEffect(() => {
    let active = true
    setPageState('loading')
    setAuthorizedStudent(null)
    setDetailError('')
    void fetchStudentById(studentId)
      .then((record) => {
        if (!active) return
        setAuthorizedStudent(record)
        setPageState('ready')
      })
      .catch((error: unknown) => {
        if (!active) return
        const message = error instanceof Error ? error.message : 'Unknown Supabase request error'
        console.error('[Supabase] Student 360 request failed:', message)
        setDetailError('Student data could not be loaded from Supabase. Please retry.')
        setPageState('error')
      })
    return () => {
      active = false
    }
  }, [studentId, retryCount])

  if (pageState === 'loading') return <StudentListState title="Loading Student 360…" />
  if (pageState === 'error') return <StudentListState title="We couldn't load this student." detail={detailError} isError onRetry={() => setRetryCount((count) => count + 1)} />
  if (!authorizedStudent) {
    return (
      <section className="student-not-found">
        <div className="empty-icon"><UserRound size={22} /></div>
        <p className="eyebrow">Student record</p>
        <h1>Student not found</h1>
        <p>This student may not exist or may not be included in your authorized student access.</p>
        <button type="button" className="primary-button small-button" onClick={() => navigate('/students')}><ArrowLeft size={15} /> Back to Students</button>
      </section>
    )
  }

  const tabs: StudentTab[] = ['Overview', 'Attendance', 'Fees', 'Communication'].filter(
    (tab): tab is StudentTab => canViewStudentTab(user.role, tab as StudentTab),
  )
  const selectedTab = tabs.includes(activeTab) ? activeTab : 'Overview'

  return (
    <section className="student-detail-page">
      <button type="button" className="back-link" onClick={() => navigate('/students')}><ArrowLeft size={16} /> Students</button>
      <div className="student-detail-header">
        <div className="student-avatar student-avatar-large"><UserRound size={24} /></div>
        <div className="student-detail-name">
          <p className="eyebrow">Student 360</p>
          <h1>{authorizedStudent.firstName} {authorizedStudent.lastName}</h1>
          <p>{authorizedStudent.studentId} <span>·</span> {authorizedStudent.className}-{authorizedStudent.section}</p>
        </div>
        <span className={`status-pill ${authorizedStudent.status === 'Active' ? 'success' : 'muted'}`}>{authorizedStudent.status}</span>
      </div>

      <nav className="student-tabs" aria-label="Student information">
        {tabs.map((tab) => (
          <button type="button" key={tab} className={selectedTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>
        ))}
      </nav>

      {selectedTab === 'Overview' ? <StudentOverview student={authorizedStudent} role={user.role} attendance={attendance} attendanceLoading={attendanceLoading} attendanceError={attendanceError} feeInvoices={feeInvoices} feesLoading={feesLoading} feesError={feesError} alerts={alerts} alertsLoading={alertsLoading} alertsError={alertsError} /> : null}
      {selectedTab === 'Attendance' ? <StudentAttendance student={authorizedStudent} attendance={attendance} loading={attendanceLoading} error={attendanceError} /> : null}
      {selectedTab === 'Fees' && canViewStudentTab(user.role, 'Fees') ? <StudentFees invoices={feeInvoices} payments={feePayments} loading={feesLoading} error={feesError} onRetry={onRetryFees} /> : null}
      {selectedTab === 'Communication' ? <StudentCommunication student={authorizedStudent} messages={communicationMessages} user={user} invoices={feeInvoices} users={users} /> : null}
    </section>
  )
}

function StudentOverview({ student, role, attendance, attendanceLoading, attendanceError, feeInvoices, feesLoading, feesError, alerts, alertsLoading, alertsError }: {
  student: Student
  role: Role
  attendance: AttendanceState
  attendanceLoading: boolean
  attendanceError: string
  feeInvoices: FeeInvoiceView[]
  feesLoading: boolean
  feesError: string
  alerts: AlertItem[]
  alertsLoading: boolean
  alertsError: string
}) {
  const canViewSensitiveOverview = role !== 'finance'
  const canViewFees = canViewStudentTab(role, 'Fees')
  const summary = getStudentAttendance(student, attendance)
  const feeSummary = getFeeMetrics(feeInvoices)
  const openAlerts = alerts.filter((alert) =>
    alert.sourceType === 'ATTENDANCE' && alert.studentId === student.id && alert.status !== 'RESOLVED',
  ).length
  return (
    <div className="student-overview-grid">
      <section className="student-info-card">
        <h2>Student information</h2>
        <dl className="student-info-grid">
          <InfoField label="Student ID" value={student.studentId} />
          <InfoField label="School" value={student.school ?? ''} />
          <InfoField label="Campus" value={student.campus} />
          <InfoField label="Class" value={student.className} />
          <InfoField label="Section" value={student.section} />
          <InfoField label="Roll number" value={student.rollNumber} />
          {canViewSensitiveOverview ? <InfoField label="Date of birth" value={formatDate(student.dateOfBirth)} /> : null}
          {canViewSensitiveOverview ? <InfoField label="Gender" value={student.gender} /> : null}
        </dl>
      </section>
      {canViewSensitiveOverview ? (
        <>
          <section className="student-summary-card">
            <h2>Attendance summary</h2>
            {attendanceLoading ? <p role="status">Loading attendance…</p> : attendanceError ? <p role="alert">{attendanceError}</p> : (
              <>
                <strong>{summary.counts.rate === null ? '—' : `${summary.counts.rate}%`}</strong>
                <p>{summary.counts.present} present · {summary.counts.absent} absent · {summary.counts.late} late days</p>
              </>
            )}
          </section>
        </>
      ) : null}
      <section className="student-info-card">
        <h2>Guardian information</h2>
        <dl className="student-info-grid">
          <InfoField label="Name" value={student.guardian.name} />
          <InfoField label="Relationship" value={student.guardian.relationship ?? ''} />
          <InfoField label="Phone" value={student.guardian.phone} />
          <InfoField label="Email" value={student.guardian.email} />
        </dl>
      </section>
      {canViewFees ? (
        <section className="student-summary-card">
          <h2>Fee summary</h2>
          {feesLoading ? <p role="status">Loading fee information…</p> : feesError ? <p role="alert">{feesError}</p> : (
            <>
              <strong>{formatCurrency(feeSummary.outstanding)} outstanding</strong>
              <p>{formatCurrency(feeSummary.collected)} paid of {formatCurrency(feeSummary.expected)}</p>
            </>
          )}
        </section>
      ) : null}
      {canViewSensitiveOverview ? (
        <>
          <section className="student-summary-card">
            <h2>Open alerts</h2>
            {alertsLoading ? <p role="status">Loading alerts…</p> : alertsError ? <p role="alert">{alertsError}</p> : (
              <>
                <strong>{openAlerts}</strong>
                <p>{openAlerts ? 'Attendance items may need follow-up.' : 'No attendance alerts for this student.'}</p>
              </>
            )}
          </section>
          <section className="student-info-card student-activity-card">
            <h2>Recent activity</h2>
            <ActivityTimeline items={student.activity.filter((item) => !item.title.toLowerCase().includes('fee'))} />
          </section>
        </>
      ) : null}
    </div>
  )
}

function StudentAttendance({ student, attendance, loading, error }: {
  student: Student
  attendance: AttendanceState
  loading: boolean
  error: string
}) {
  const summary = getStudentAttendance(student, attendance)
  if (loading) return <StudentListState title="Loading attendance…" />
  if (error) return <StudentListState title="We couldn't load attendance." detail={error} isError />
  return (
    <div className="student-tab-content">
      <div className="student-summary-grid">
        <SummaryMetric label="Attendance" value={summary.counts.rate === null ? '—' : `${summary.counts.rate}%`} />
        <SummaryMetric label="Present days" value={String(summary.counts.present)} />
        <SummaryMetric label="Absent days" value={String(summary.counts.absent)} />
        <SummaryMetric label="Late days" value={String(summary.counts.late)} />
      </div>
      <section className="student-info-card">
        <h2>Attendance trend</h2>
        <AttendanceTrend data={summary.trend} />
      </section>
      <section className="student-info-card">
        <h2>Recent attendance</h2>
        {summary.recent.length ? (
          <div className="student-record-list">
            {summary.recent.map((record) => <div key={`${record.date}-${record.status}`}><span>{formatDate(record.date)}</span><span className={`attendance-mark ${record.status.toLowerCase()}`}>{displayAttendanceStatus(record.status)}</span></div>)}
          </div>
        ) : <p className="student-muted">No attendance has been recorded yet.</p>}
      </section>
    </div>
  )
}

function displayAttendanceStatus(status: AttendanceStatus): string {
  return status[0] + status.slice(1).toLowerCase()
}

function StudentFees({ invoices, payments, loading, error, onRetry }: { invoices: FeeInvoiceView[]; payments: FeePayment[]; loading: boolean; error: string; onRetry: () => void }) {
  if (loading) return <StudentListState title="Loading fee history…" />
  if (error) return <section className="student-state-card"><h2>We couldn't load fee history.</h2><p>{error}</p><button type="button" className="secondary-button small-button" onClick={onRetry}>Try again</button></section>
  const summary = getFeeMetrics(invoices)
  const today = currentDateKey
  const nextDueDate = invoices
    .filter((invoice) => invoice.outstandingAmount > 0 && invoice.dueDate >= today)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0]?.dueDate
  const invoiceNames = new Map(invoices.map((invoice) => [invoice.id, `${invoice.student.className} · ${formatMonthLabel(invoice.month)}`]))
  const sortedPayments = [...payments].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 5)
  return (
    <div className="student-tab-content">
      <div className="student-summary-grid">
        <SummaryMetric label="Expected" value={formatCurrency(summary.expected)} />
        <SummaryMetric label="Paid" value={formatCurrency(summary.collected)} />
        <SummaryMetric label="Outstanding" value={formatCurrency(summary.outstanding)} />
        <SummaryMetric label="Next due date" value={nextDueDate ? formatDate(nextDueDate) : 'Not set'} />
      </div>
      <section className="student-info-card">
        <h2>Recent fee transactions</h2>
        {sortedPayments.length ? (
          <div className="student-record-list">
            {sortedPayments.map((payment) => (
              <div key={payment.id}>
                <span><strong>{invoiceNames.get(payment.invoiceId) ?? 'Fee payment'}</strong><small>{formatDate(payment.date)} · {payment.method}</small></span>
                <span className="fee-transaction-amount">{formatCurrency(payment.amount)}</span>
              </div>
            ))}
          </div>
        ) : <p className="student-muted">{invoices.length ? 'No fee transactions are available.' : 'No fee records are available.'}</p>}
      </section>
    </div>
  )
}

function StudentCommunication({ student, messages, user, invoices, users }: {
  student: Student
  messages: ReturnType<typeof getAccessibleCommunication>
  user: StudentPageUser
  invoices: FeeInvoiceView[]
  users: SchoolUser[]
}) {
  const navigate = useNavigate()
  const createType = user.role === 'finance' ? 'Fee Reminder' : user.role === 'teacher' ? 'Attendance Reminder' : 'General Notice'
  const canCreate = canCreateCommunication(user, createType) &&
    (user.role !== 'finance' || invoices.some((invoice) => invoice.outstandingAmount > 0))
  const userNames = new Map(users.map((item) => [item.id, item.name]))
  const createHref = user.role === 'finance'
    ? (() => {
      const invoice = invoices.find((item) => item.outstandingAmount > 0)
      return invoice
        ? `/communication?studentId=${encodeURIComponent(student.id)}&sourceType=FEE&sourceId=${encodeURIComponent(invoice.id)}`
        : '/communication'
    })()
    : `/communication?studentId=${encodeURIComponent(student.id)}`
  return (
    <section className="student-info-card">
      <div className="student-communication-header"><h2>Recent Messages</h2>{canCreate ? <button type="button" className="secondary-button small-button" onClick={() => navigate(createHref)}>Create Message</button> : null}</div>
      {messages.length ? (
        <div className="student-record-list communication-list">
          {messages.slice(0, 10).map((entry) => (
            <article key={entry.id}>
              <div className="communication-heading"><strong>{entry.type}</strong><span className={`communication-status ${entry.status.toLowerCase()}`}>{entry.status.replaceAll('_', ' ')}</span></div>
              <p>{entry.message}</p>
              <small>{formatDate(entry.createdAt.slice(0, 10))} <span>·</span> {entry.channel} <span>·</span> {userNames.get(entry.createdByUserId) ?? 'School staff'}</small>
            </article>
          ))}
        </div>
      ) : <p className="student-muted">No communication history is recorded yet.</p>}
    </section>
  )
}

function ActivityTimeline({ items }: { items: Student['activity'] }) {
  if (!items.length) return <p className="student-muted">No recent activity.</p>
  return (
    <ol className="activity-timeline">
      {items.map((item) => <li key={`${item.date}-${item.title}`}><span className="timeline-dot" /><div><strong>{item.title}</strong><p>{item.detail}</p><small>{formatDate(item.date)}</small></div></li>)}
    </ol>
  )
}

function AttendanceTrend({ data }: { data: number[] }) {
  if (!data.length) return <p className="student-muted">Attendance trend will appear when records are available.</p>
  const points = data.map((value, index) => `${24 + index * (252 / Math.max(data.length - 1, 1))},${110 - value}`).join(' ')
  return (
    <div className="student-trend-chart">
      <svg viewBox="0 0 300 130" role="img" aria-label="Student attendance trend">
        <line x1="24" y1="110" x2="276" y2="110" />
        <polyline points={points} />
        {data.map((value, index) => {
          const x = 24 + index * (252 / Math.max(data.length - 1, 1))
          const y = 110 - value
          return <circle key={`${index}-${value}`} cx={x} cy={y} r="4" />
        })}
      </svg>
      <div className="student-trend-labels"><span>Earlier</span><span>Recent</span></div>
    </div>
  )
}

function InfoField({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value || '—'}</dd></div>
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <article className="student-metric"><span>{label}</span><strong>{value}</strong></article>
}

function StudentListState({ title, detail, isError = false, onRetry }: { title: string; detail?: string; isError?: boolean; onRetry?: () => void }) {
  return (
    <section className={`student-state-card ${isError ? 'error-card' : ''}`} role={isError ? 'alert' : 'status'}>
      <div className="empty-icon">{isError ? <CalendarDays size={21} /> : <Users size={21} />}</div>
      <h1>{title}</h1>
      {detail ? <p>{detail}</p> : null}
      {onRetry ? <button type="button" className="primary-button small-button" onClick={onRetry}>Try again</button> : null}
    </section>
  )
}

function parseStudentCsv(content: string): NewStudent[] {
  const rows = parseCsvRows(content)
  if (rows.length < 2) throw new Error('The CSV must include a header row and at least one student.')

  const normalizeHeader = (header: string) => header.trim().replace(/^\uFEFF/, '').toLowerCase().replaceAll('_', '').replaceAll('-', '').replaceAll(' ', '')
  const headers = rows[0].map(normalizeHeader)
  const requiredHeaders = studentCsvFields.map((field) => normalizeHeader(String(field)))
  const missing = requiredHeaders.filter((header) => !headers.includes(header))
  if (missing.length) throw new Error(`Missing CSV columns: ${missing.join(', ')}.`)

  const column = (row: string[], name: string) => row[headers.indexOf(name)]?.trim() ?? ''
  const parsed: NewStudent[] = rows.slice(1).filter((row) => row.some((value) => value.trim())).map((row, index) => {
    const student: NewStudent = {
      firstName: column(row, 'firstname'),
      lastName: column(row, 'lastname'),
      studentId: column(row, 'studentid'),
      className: column(row, 'classname'),
      section: column(row, 'section'),
      rollNumber: column(row, 'rollnumber'),
      dateOfBirth: column(row, 'dateofbirth'),
      gender: column(row, 'gender'),
      guardian: {
        name: column(row, 'guardianname'),
        phone: column(row, 'guardianphone'),
        email: column(row, 'guardianemail'),
      },
    }
    if (Object.values(student).some((value) => typeof value === 'string' && !value.trim()) ||
      Object.values(student.guardian).some((value) => !value.trim())) {
      throw new Error(`Student row ${index + 2} is missing required values.`)
    }
    return student
  })
  if (!parsed.length) throw new Error('The CSV does not contain any student rows.')
  return parsed
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (character === '"' && quoted && content[index + 1] === '"') {
      value += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && content[index + 1] === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }
  if (quoted) throw new Error('The CSV contains an unfinished quoted field.')
  row.push(value)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

function formatDate(date: string): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00`))
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 2 }).format(amount)
}

function formatMonthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00`)
  return Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(date)
}
