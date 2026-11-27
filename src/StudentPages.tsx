import { useEffect, useMemo, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react'
import { ArrowLeft, CalendarDays, FileText, FileUp, Link2, Search, UserRound, Users, X } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Role, SchoolUser } from './mockData'
import type { AlertItem } from './alertsData'
import { getStudentAttendance, type AttendanceState, type AttendanceStatus } from './attendanceData'
import { getFeeInvoices, getFeeMetrics, localDateKey, type FeeInvoiceView, type FeePayment, type FeeState } from './feeData'
import { addCalendarDays, schoolDateKey } from './utils/schoolTimezone'
import { compareClassNames, compareNaturalText } from './utils/sortOrder'
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
import {
  fetchStudentById,
  fetchStudentCampusOptions,
  fetchStudentCreationOptions,
  fetchStudentRosterPage,
  checkStudentCsvDuplicates,
  type StudentCampusOption,
  type StudentRosterPage,
  type TeacherAssignment,
  updateStudent,
  archiveStudent,
  updateGuardian,
  linkStudentGuardian,
  unlinkStudentGuardian,
} from './services/students'
import type { StudentRosterSortField } from './services/studentRoster'
import type { CsvSkippedRow } from './utils/studentDuplicates'
import { trashStudent } from './services/trash'
import { RecordActionMenu, DestructiveActionModal, type ActionItem } from './components/RecordActionControls'
import { StudentEditModal } from './components/StudentEditModal'
import { GuardianModal } from './components/GuardianModal'
import { WhatsAppComposer } from './components/WhatsAppComposer'
import { ParentRegistrationLinkModal, PendingAdmissionsPanel } from './RegistrationPages'
import { formatRpcErrorMessage } from './utils/errorMapping'

type StudentPageUser = {
  id: number
  name: string
  role: Role
  email: string
  schoolName: string
  campusName: string
  schoolTimezone?: string | null
  organizationId?: string | null
  schoolId?: string | null
  campusId?: string | null
  teacherAssignments?: TeacherAssignment[]
}

type StudentsPageProps = {
  user: StudentPageUser
  onAddStudent: (student: NewStudent, campusId: string) => Promise<void>
  onImportStudents: (students: NewStudent[], campusId: string) => Promise<boolean>
  onRefresh?: () => void | Promise<unknown>
}

type DetailPageProps = {
  user: StudentPageUser
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
  onRefresh?: () => void | Promise<unknown>
}

type StudentTab = 'Overview' | 'Attendance' | 'Fees' | 'Communication' | 'Statements'
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

type ImportStage = 'idle' | 'reading' | 'checking' | 'ready' | 'importing' | 'complete' | 'failed'

function getReadStepDetail(importStage: ImportStage, importTotalRows: number): string {
  if (importStage === 'failed' && importTotalRows === 0) return 'Could not read the selected CSV'
  if (importTotalRows > 0) return `${importTotalRows} student rows found`
  return 'Reading the selected CSV'
}

function getDuplicateStepDetail(
  importStage: ImportStage,
  importTotalRows: number,
  importPreview: NewStudent[] | null,
  importSkippedCount: number,
): string {
  if (importStage === 'checking') return 'Checking existing students and CSV rows'
  if (importStage === 'reading') return 'Waiting for the CSV to load'
  if (importStage === 'failed' && importTotalRows > 0 && !importPreview) return 'Duplicate check did not finish'
  if (importSkippedCount > 0) return `${importSkippedCount} duplicates skipped automatically`
  return 'No duplicates found'
}

function getImportStepDetail(
  importStage: ImportStage,
  importHasNoNewRows: boolean,
  previewCount: number,
): string {
  if (importHasNoNewRows) return 'All rows were duplicates'
  if (importStage === 'complete') return 'Import finished; check the result notification'
  if (importStage === 'importing') return `Importing ${previewCount} students`
  if (importStage === 'reading' || importStage === 'checking') return 'Waiting for duplicate check'
  return `${previewCount} students ready`
}

function buildImportProgressSteps(
  importStage: ImportStage,
  importTotalRows: number,
  importPreview: NewStudent[] | null,
  importSkippedCount: number,
  importHasNoNewRows: boolean,
) {
  const previewCount = importPreview?.length ?? 0
  return [
    {
      label: 'Read CSV file',
      complete: ['checking', 'ready', 'importing', 'complete'].includes(importStage),
      active: importStage === 'reading',
      failed: importStage === 'failed' && importTotalRows === 0,
      detail: getReadStepDetail(importStage, importTotalRows),
    },
    {
      label: 'Remove duplicates',
      complete: ['ready', 'importing', 'complete'].includes(importStage),
      active: importStage === 'checking',
      failed: importStage === 'failed' && importTotalRows > 0 && !importPreview,
      detail: getDuplicateStepDetail(importStage, importTotalRows, importPreview, importSkippedCount),
    },
    {
      label: importHasNoNewRows ? 'Nothing left to import' : 'Import remaining students',
      complete: importStage === 'complete' || importHasNoNewRows,
      active: importStage === 'importing',
      failed: importStage === 'failed' && Boolean(previewCount),
      detail: getImportStepDetail(importStage, importHasNoNewRows, previewCount),
    },
  ]
}

function SkippedRowsNotice({
  importSkipped,
  heading,
}: Readonly<{
  importSkipped: CsvSkippedRow[]
  heading: string
}>) {
  if (!importSkipped.length) return null
  return (
    <div style={{ margin: '12px 0', padding: '12px', background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '6px' }}>
      <p style={{ fontWeight: 600, color: '#92400e', margin: '0 0 6px 0' }}>{heading}</p>
      <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem', color: '#78350f', maxHeight: '160px', overflowY: 'auto' }}>
        {importSkipped.map((item) => (
          <li key={`${item.rowNumber}-${item.student.studentId}`}>
            <strong>Row {item.rowNumber}</strong> ({item.student.studentId} - {item.student.firstName} {item.student.lastName}): {item.reason}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ImportErrorPanel({
  importError,
  importSkipped,
  importPreview,
  importing,
  campusId,
  onReset,
  onConfirmImport,
}: Readonly<{
  importError: string
  importSkipped: CsvSkippedRow[]
  importPreview: NewStudent[] | null
  importing: boolean
  campusId: string
  onReset: () => void
  onConfirmImport: () => void
}>) {
  return (
    <>
      <h2>Import needs attention</h2>
      <p>{importError}</p>
      <SkippedRowsNotice importSkipped={importSkipped} heading={`${importSkipped.length} duplicate row(s) skipped:`} />
      <div className="student-form-actions" style={{ marginTop: '12px' }}>
        <button type="button" className="secondary-button small-button" onClick={onReset}>
          Dismiss
        </button>
        {importPreview ? (
          <button
            type="button"
            className="primary-button small-button"
            disabled={importing || !campusId}
            onClick={onConfirmImport}
          >
            Retry Import
          </button>
        ) : null}
      </div>
    </>
  )
}

function ImportPreviewPanel({
  importStage,
  importPreview,
  importSkipped,
  importing,
  campuses,
  campusId,
  onChangeCampusId,
  onReset,
  onConfirmImport,
}: Readonly<{
  importStage: ImportStage
  importPreview: NewStudent[]
  importSkipped: CsvSkippedRow[]
  importing: boolean
  campuses: StudentCampusOption[]
  campusId: string
  onChangeCampusId: (value: string) => void
  onReset: () => void
  onConfirmImport: () => void
}>) {
  const isComplete = importStage === 'complete'
  const summaryText = isComplete
    ? 'The import request completed. Check the result notification for the exact count.'
    : `${importPreview.length} student records are ready to confirm.`

  return (
    <>
      <div className="panel-header">
        <div>
          <h2>{isComplete ? 'Import finished' : 'Preview import'}</h2>
          <p>{summaryText}</p>
        </div>
        {campuses.length > 0 ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', color: '#183252' }}>
            <label htmlFor="import-campus-select"><strong>Campus:</strong></label>
            {campuses.length > 1 ? (
              <select
                id="import-campus-select"
                disabled={importing}
                value={campusId}
                onChange={(event) => onChangeCampusId(event.target.value)}
                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                {campuses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            ) : (
              <span>{campuses[0].name}</span>
            )}
          </div>
        ) : null}
        <div className="student-form-actions">
          <button type="button" className="secondary-button small-button" disabled={importing} onClick={onReset}>
            {isComplete ? 'Done' : 'Cancel'}
          </button>
          {!isComplete ? (
            <button
              type="button"
              className="primary-button small-button"
              disabled={importing || !campusId}
              onClick={onConfirmImport}
            >
              {importing ? `Importing ${importPreview.length} students…` : `Confirm Import (${importPreview.length} students)`}
            </button>
          ) : null}
        </div>
      </div>
      <SkippedRowsNotice importSkipped={importSkipped} heading={`${importSkipped.length} duplicate row(s) detected and skipped:`} />
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
  )
}

function StudentImportSection({
  importStage,
  importProgressSteps,
  importError,
  importPreview,
  importSkipped,
  importing,
  campuses,
  campusId,
  onChangeCampusId,
  onReset,
  onConfirmImport,
}: Readonly<{
  importStage: ImportStage
  importProgressSteps: ReturnType<typeof buildImportProgressSteps>
  importError: string
  importPreview: NewStudent[] | null
  importSkipped: CsvSkippedRow[]
  importing: boolean
  campuses: StudentCampusOption[]
  campusId: string
  onChangeCampusId: (value: string) => void
  onReset: () => void
  onConfirmImport: () => void
}>) {
  let body: React.ReactNode = null
  if (importError) {
    body = (
      <ImportErrorPanel
        importError={importError}
        importSkipped={importSkipped}
        importPreview={importPreview}
        importing={importing}
        campusId={campusId}
        onReset={onReset}
        onConfirmImport={onConfirmImport}
      />
    )
  } else if (importPreview) {
    body = (
      <ImportPreviewPanel
        importStage={importStage}
        importPreview={importPreview}
        importSkipped={importSkipped}
        importing={importing}
        campuses={campuses}
        campusId={campusId}
        onChangeCampusId={onChangeCampusId}
        onReset={onReset}
        onConfirmImport={onConfirmImport}
      />
    )
  }

  return (
    <section className={`import-panel ${importError ? 'import-error' : ''}`} aria-live="polite">
      {importStage !== 'idle' ? (
        <ol className="import-progress" aria-label="Student import progress">
          {importProgressSteps.map((step, index) => (
            <li
              key={step.label}
              className={`${step.complete ? 'is-complete' : ''} ${step.active ? 'is-active' : ''} ${step.failed ? 'is-failed' : ''}`}
              aria-current={step.active ? 'step' : undefined}
            >
              <span className="import-progress-indicator" aria-hidden="true">
                {step.complete ? '✓' : index + 1}
              </span>
              <span className="import-progress-copy">
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {body}
    </section>
  )
}

function AddStudentFormSection({
  userRole,
  form,
  setForm,
  campuses,
  campusId,
  onChangeCampusId,
  teacherScopes,
  activeTeacherScopes,
  creationOptionsLoading,
  creationOptionsError,
  studentSaveError,
  studentSaving,
  onCancel,
  onSubmit,
}: Readonly<{
  userRole: Role
  form: NewStudent
  setForm: React.Dispatch<React.SetStateAction<NewStudent>>
  campuses: StudentCampusOption[]
  campusId: string
  onChangeCampusId: (value: string) => void
  teacherScopes: TeacherAssignment[]
  activeTeacherScopes: TeacherAssignment[]
  creationOptionsLoading: boolean
  creationOptionsError: string
  studentSaveError: string
  studentSaving: boolean
  onCancel: () => void
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void
}>) {
  const isTeacher = userRole === 'teacher'
  const showNoScopesError = isTeacher && !creationOptionsLoading && !creationOptionsError && activeTeacherScopes.length === 0
  const showNoCampusError = isTeacher && !creationOptionsLoading && !creationOptionsError && activeTeacherScopes.length > 0 && campuses.length === 0
  const teacherClassOptions = [...new Set(teacherScopes.filter((scope) => scope.campus_id === campusId).map((scope) => scope.class_name))].sort(compareClassNames)
  const teacherSectionOptions = [...new Set(teacherScopes.filter((scope) => scope.campus_id === campusId && scope.class_name === form.className).map((scope) => scope.section))].sort(compareNaturalText)

  return (
    <form className="student-form" onSubmit={onSubmit}>
      <h2>Add Student</h2>
      {creationOptionsError ? <p className="communication-feedback error" role="alert">{creationOptionsError}</p> : null}
      {studentSaveError ? <p className="communication-feedback error" role="alert">{studentSaveError}</p> : null}
      {showNoScopesError ? <p className="communication-feedback error" role="alert">No active class assignments were found for your account. Ask an Admin to assign a campus, class, and section before creating a student.</p> : null}
      {showNoCampusError ? <p className="communication-feedback error" role="alert">No active campus is available for your class assignments. Ask an Admin to review the assigned campus.</p> : null}
      <label>Campus<select required disabled={creationOptionsLoading || studentSaving || campuses.length === 0} value={campusId} onChange={(event) => { onChangeCampusId(event.target.value); if (isTeacher) setForm((current) => ({ ...current, className: '', section: '' })) }}><option value="">Select campus</option>{campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></label>
      <label>First name<input required value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} /></label>
      <label>Last name<input required value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} /></label>
      <label>Student ID<input required value={form.studentId} onChange={(event) => setForm((current) => ({ ...current, studentId: event.target.value }))} /></label>
      {isTeacher ? (
        <>
          <label>Class<select required disabled={studentSaving || teacherScopes.length === 0} value={form.className} onChange={(event) => setForm((current) => ({ ...current, className: event.target.value, section: '' }))}><option value="">Select assigned class</option>{teacherClassOptions.map((className) => <option key={className}>{className}</option>)}</select></label>
          <label>Section<select required disabled={studentSaving || !form.className} value={form.section} onChange={(event) => setForm((current) => ({ ...current, section: event.target.value }))}><option value="">Select assigned section</option>{teacherSectionOptions.map((section) => <option key={section}>{section}</option>)}</select></label>
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
      {userRole === 'admin' ? (
        <>
          <label>Guardian name<input disabled={studentSaving} value={form.guardian.name} onChange={(event) => setForm((current) => ({ ...current, guardian: { ...current.guardian, name: event.target.value } }))} /></label>
          <label>Guardian phone<input disabled={studentSaving} type="tel" value={form.guardian.phone} onChange={(event) => setForm((current) => ({ ...current, guardian: { ...current.guardian, phone: event.target.value } }))} /></label>
          <label>Guardian email<input disabled={studentSaving} type="email" value={form.guardian.email} onChange={(event) => setForm((current) => ({ ...current, guardian: { ...current.guardian, email: event.target.value } }))} /></label>
        </>
      ) : (
        <p className="student-muted" style={{ gridColumn: '1 / -1', margin: '0.5rem 0' }}>
          Guardian information must be added by an Admin.
        </p>
      )}
      <div className="student-form-actions">
        <button type="button" className="secondary-button small-button" disabled={studentSaving} onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary-button small-button" disabled={studentSaving || creationOptionsLoading || Boolean(creationOptionsError) || campuses.length === 0 || !campusId}>{studentSaving ? 'Saving…' : 'Save Student'}</button>
      </div>
    </form>
  )
}

function StudentDirectorySection({
  query,
  setQuery,
  classFilter,
  setClassFilter,
  sectionFilter,
  setSectionFilter,
  campusFilter,
  setCampusFilter,
  genderFilter,
  setGenderFilter,
  statusFilter,
  setStatusFilter,
  sortField,
  setSortField,
  sortDirection,
  setSortDirection,
  campusOptions,
  directoryStudents,
  totalCount,
  page,
  totalPages,
  setPage,
  loading,
  error,
  onRetry,
  getStudentActions,
  onOpenStudent,
}: Readonly<{
  query: string
  setQuery: (value: string) => void
  classFilter: string
  setClassFilter: (value: string) => void
  sectionFilter: string
  setSectionFilter: (value: string) => void
  campusFilter: string
  setCampusFilter: (value: string) => void
  genderFilter: string
  setGenderFilter: (value: string) => void
  statusFilter: string
  setStatusFilter: (value: string) => void
  sortField: StudentRosterSortField
  setSortField: (value: StudentRosterSortField) => void
  sortDirection: 'asc' | 'desc'
  setSortDirection: (value: 'asc' | 'desc') => void
  campusOptions: StudentCampusOption[]
  directoryStudents: Student[]
  totalCount: number
  page: number
  totalPages: number
  setPage: (page: number) => void
  loading: boolean
  error: string
  onRetry: () => void
  getStudentActions: (student: Student) => ActionItem[]
  onOpenStudent: (studentId: string) => void
}>) {
  return (
    <>
      <div className="student-filters">
        <div className="student-search" role="search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, ID, class or roll number"
            aria-label="Search students"
          />
          {query ? (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setQuery('')}
              aria-label="Clear student search"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
        <input value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setSectionFilter('') }} placeholder="All classes" aria-label="Filter by class" />
        <input value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} placeholder="All sections" aria-label="Filter by section" />
        <select value={campusFilter} onChange={(event) => setCampusFilter(event.target.value)} aria-label="Filter by campus">
          <option value="">All campuses</option>
          {campusOptions.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
        </select>
        <select value={genderFilter} onChange={(event) => setGenderFilter(event.target.value)} aria-label="Filter by gender">
          <option value="">All genders</option>
          <option>Female</option>
          <option>Male</option>
          <option>Prefer not to say</option>
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ALUMNI">Graduated</option>
        </select>
        <select value={sortField} onChange={(event) => {
          const value = event.target.value
          if (value === 'directory' || value === 'name' || value === 'studentId' || value === 'className' || value === 'section' || value === 'status') setSortField(value)
        }} aria-label="Sort students">
          <option value="directory">Default order</option>
          <option value="name">Name</option>
          <option value="studentId">Student ID</option>
          <option value="className">Class</option>
          <option value="section">Section</option>
          <option value="status">Status</option>
        </select>
        <select value={sortDirection} onChange={(event) => {
          if (event.target.value === 'asc' || event.target.value === 'desc') setSortDirection(event.target.value)
        }} aria-label="Sort direction">
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </div>

      {loading ? (
        <StudentListState title="Loading students…" />
      ) : error ? (
        <StudentListState title="We couldn't load students." detail={error} isError onRetry={onRetry} />
      ) : directoryStudents.length === 0 ? (
        <StudentListState
          title={totalCount ? 'No students on this page.' : 'No students match these filters.'}
          detail={totalCount ? 'Try a previous page or adjust your filters.' : 'Try another name or clear one of the filters.'}
        />
      ) : (
        <>
          <div className="student-table-card">
            <table className="student-table">
              <thead>
                <tr><th>Student</th><th>Student ID</th><th>Class</th><th>Section</th><th>Roll number</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {directoryStudents.map((student) => {
                  const studentActions = getStudentActions(student)
                  return (
                    <tr key={student.id}>
                      <td><strong>{student.firstName} {student.lastName}</strong></td>
                      <td>{student.studentId}</td><td>{student.className}</td><td>{student.section}</td><td>{student.rollNumber}</td>
                      <td><span className={`status-pill ${student.status === 'Active' ? 'success' : 'muted'}`}>{student.status}</span></td>
                      <td>
                        <div className="table-actions">
                          <button type="button" className="student-link" onClick={() => onOpenStudent(student.id)}>View profile</button>
                          {studentActions.length > 0 && <RecordActionMenu actions={studentActions} />}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="student-mobile-list">
            {directoryStudents.map((student) => {
              const studentActions = getStudentActions(student)
              return (
                <article className="student-mobile-card" key={student.id}>
                  <div className="student-mobile-title">
                    <div className="student-avatar"><UserRound size={18} /></div>
                    <div><strong>{student.firstName} {student.lastName}</strong><span>{student.studentId}</span></div>
                    <span className={`status-pill ${student.status === 'Active' ? 'success' : 'muted'}`}>{student.status}</span>
                  </div>
                  <div className="student-mobile-meta"><span>{student.className}-{student.section}</span><span>Roll {student.rollNumber}</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
                    <button type="button" className="student-link" onClick={() => onOpenStudent(student.id)}>Open Student 360</button>
                    {studentActions.length > 0 && <RecordActionMenu actions={studentActions} />}
                  </div>
                </article>
              )
            })}
          </div>
          {totalPages > 1 && (
            <div className="pagination-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', gap: '12px' }}>
              <button
                type="button"
                className="secondary-button compact-button"
                disabled={page <= 1}
                onClick={() => setPage(Math.max(1, page - 1))}
              >
                Previous
              </button>
              <span className="student-muted" style={{ fontSize: '0.875rem' }}>
                Page {page} of {totalPages} ({totalCount} students)
              </span>
              <button
                type="button"
                className="secondary-button compact-button"
                disabled={page >= totalPages}
                onClick={() => setPage(Math.min(totalPages, page + 1))}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
      {!loading && !error ? <p className="student-result-count"><Users size={15} /> Showing {directoryStudents.length} of {totalCount} matching students</p> : null}
    </>
  )
}

export function StudentsPage({ user, onAddStudent, onImportStudents, onRefresh }: Readonly<StudentsPageProps>) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const searchDebounceTimer = useRef<number | null>(null)
  const [classFilter, setClassFilter] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [campusFilter, setCampusFilter] = useState('')
  const [genderFilter, setGenderFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortField, setSortField] = useState<StudentRosterSortField>('directory')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [directoryPage, setDirectoryPage] = useState<StudentRosterPage | null>(null)
  const [directoryLoading, setDirectoryLoading] = useState(Boolean(user.organizationId && user.schoolId))
  const [directoryError, setDirectoryError] = useState('')
  const [directoryReload, setDirectoryReload] = useState(0)
  const [directoryCampuses, setDirectoryCampuses] = useState<StudentCampusOption[]>([])
  const [directoryCampusesError, setDirectoryCampusesError] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [showRegistrationLink, setShowRegistrationLink] = useState(false)
  const [adminStudentView, setAdminStudentView] = useState<'students' | 'admissions'>('students')
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [archivingStudent, setArchivingStudent] = useState<Student | null>(null)
  const [trashingStudent, setTrashingStudent] = useState<Student | null>(null)
  const [actionError, setActionError] = useState('')
  const [form, setForm] = useState<NewStudent>(emptyStudentForm)
  const [campuses, setCampuses] = useState<StudentCampusOption[]>([])
  const [teacherScopes, setTeacherScopes] = useState<TeacherAssignment[]>([])
  const [creationOptionsLoading, setCreationOptionsLoading] = useState(user.role === 'admin' || user.role === 'teacher')
  const [creationOptionsError, setCreationOptionsError] = useState('')
  const [studentSaveError, setStudentSaveError] = useState('')
  const [studentSaving, setStudentSaving] = useState(false)
  const [campusId, setCampusId] = useState('')
  const [importPreview, setImportPreview] = useState<NewStudent[] | null>(null)
  const [importSkipped, setImportSkipped] = useState<CsvSkippedRow[]>([])
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importStage, setImportStage] = useState<'idle' | 'reading' | 'checking' | 'ready' | 'importing' | 'complete' | 'failed'>('idle')
  const [importTotalRows, setImportTotalRows] = useState(0)
  const canCreateStudents = user.role === 'admin' || user.role === 'teacher'
  const activeTeacherScopes = teacherScopes.filter((scope) =>
    scope.active && scope.school_id === user.schoolId,
  )
  const importBusy = ['reading', 'checking', 'importing'].includes(importStage)
  const importHasNoNewRows = importStage === 'ready' && importTotalRows > 0 && !importPreview && importSkipped.length === importTotalRows
  const importProgressSteps = buildImportProgressSteps(
    importStage,
    importTotalRows,
    importPreview,
    importSkipped.length,
    importHasNoNewRows,
  )

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
      setCreationOptionsError(formatRpcErrorMessage(optionsError))
    }).finally(() => {
      if (active) setCreationOptionsLoading(false)
    })
    return () => { active = false }
  }, [canCreateStudents, user.role, user.schoolId, user.organizationId, user.teacherAssignments])

  const [page, setPage] = useState(1)
  const pageSize = 50

  useEffect(() => () => {
    if (searchDebounceTimer.current !== null) window.clearTimeout(searchDebounceTimer.current)
  }, [])

  useEffect(() => {
    let active = true
    if (!user.organizationId || !user.schoolId) return () => { active = false }

    void fetchStudentCampusOptions({
      organizationId: user.organizationId,
      schoolId: user.schoolId,
    }).then((options) => {
      if (!active) return
      setDirectoryCampuses(options)
      setDirectoryCampusesError('')
    }).catch((campusError: unknown) => {
      if (!active) return
      const message = campusError instanceof Error ? campusError.message : 'Unable to load campuses.'
      console.error('[Supabase] Student directory campuses request failed:', message)
      setDirectoryCampuses([])
      setDirectoryCampusesError('Campus filters could not be loaded.')
    })
    return () => { active = false }
  }, [user.organizationId, user.schoolId])

  useEffect(() => {
    let active = true
    if (!user.organizationId || !user.schoolId) return () => { active = false }

    void fetchStudentRosterPage({
      organizationId: user.organizationId,
      schoolId: user.schoolId,
    }, {
      page,
      pageSize,
      search: debouncedQuery,
      className: classFilter,
      section: sectionFilter,
      campusId: campusFilter,
      gender: genderFilter === 'Female' || genderFilter === 'Male' || genderFilter === 'Prefer not to say'
        ? genderFilter
        : '',
      status: statusFilter === 'ACTIVE' || statusFilter === 'INACTIVE' || statusFilter === 'ALUMNI'
        ? statusFilter
        : '',
      sort: sortField,
      direction: sortDirection,
    }).then((result) => {
      if (!active) return
      setDirectoryPage(result)
      const lastPage = Math.max(1, result.totalPages)
      if (page > lastPage) setPage(lastPage)
    }).catch((loadError: unknown) => {
      if (!active) return
      const message = loadError instanceof Error ? loadError.message : 'Unable to load students.'
      console.error('[Supabase] Bounded student directory request failed:', message)
      setDirectoryError('Students could not be loaded. Please retry.')
    }).finally(() => {
      if (active) setDirectoryLoading(false)
    })
    return () => { active = false }
  }, [
    user.organizationId,
    user.schoolId,
    page,
    pageSize,
    debouncedQuery,
    classFilter,
    sectionFilter,
    campusFilter,
    genderFilter,
    statusFilter,
    sortField,
    sortDirection,
    directoryReload,
  ])

  const directoryStudents = directoryPage?.students ?? []
  const totalCount = directoryPage?.total ?? 0
  const totalPages = Math.max(1, directoryPage?.totalPages ?? 0)
  const visibleDirectoryError = user.organizationId && user.schoolId
    ? directoryError
    : 'Your account is not assigned to a school.'
  const refreshDirectory = async () => {
    setDirectoryLoading(true)
    setDirectoryError('')
    setDirectoryReload((current) => current + 1)
    if (onRefresh) await onRefresh()
  }
  const retryDirectory = () => {
    setDirectoryLoading(true)
    setDirectoryError('')
    setDirectoryReload((current) => current + 1)
  }
  const setDirectoryFilter = (setter: (value: string) => void, value: string) => {
    setDirectoryLoading(true)
    setDirectoryError('')
    setter(value)
    setPage(1)
  }
  const changeDirectorySearch = (value: string) => {
    setQuery(value)
    setDirectoryLoading(true)
    setDirectoryError('')
    if (searchDebounceTimer.current !== null) window.clearTimeout(searchDebounceTimer.current)
    searchDebounceTimer.current = window.setTimeout(() => {
      setDebouncedQuery(value)
      setPage(1)
    }, 300)
  }
  const changeDirectoryPage = (nextPage: number) => {
    setDirectoryLoading(true)
    setDirectoryError('')
    setPage(nextPage)
  }
  const changeDirectorySort = (field: StudentRosterSortField) => {
    setDirectoryLoading(true)
    setDirectoryError('')
    setSortField(field)
    setPage(1)
  }
  const changeDirectorySortDirection = (direction: 'asc' | 'desc') => {
    setDirectoryLoading(true)
    setDirectoryError('')
    setSortDirection(direction)
    setPage(1)
  }

  const handleAddSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStudentSaveError('')

    if (user.role === 'teacher' && !activeTeacherScopes.some((scope) =>
      scope.campus_id === campusId &&
      scope.class_name === form.className.trim() &&
      scope.section === form.section.trim(),
    )) {
      setStudentSaveError('This class, section, or campus is not in your active teacher assignments. Ask an Admin to verify your assignment.')
      return
    }
    setStudentSaving(true)
    const submissionPayload: NewStudent = user.role === 'teacher'
      ? {
        ...form,
        guardian: { name: '', phone: '', email: '' },
      }
      : form
    try {
      await onAddStudent(submissionPayload, campusId)
      await refreshDirectory()
      setForm(emptyStudentForm)
      setShowAddForm(false)
    } catch (saveError) {
      setStudentSaveError(formatRpcErrorMessage(saveError))
    } finally {
      setStudentSaving(false)
    }
  }

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setImportError('')
    setImportPreview(null)
    setImportSkipped([])
    setImportTotalRows(0)
    setImportStage(file ? 'reading' : 'idle')
    if (!file) return

    const MAX_CSV_SIZE_BYTES = 2 * 1024 * 1024 // 2MB
    if (file.size > MAX_CSV_SIZE_BYTES) {
      setImportError('The selected file exceeds the 2MB size limit.')
      setImportStage('failed')
      event.target.value = ''
      return
    }

    const lowerName = file.name.toLowerCase()
    if (!lowerName.endsWith('.csv')) {
      setImportError('Excel preview is not enabled yet. Save the worksheet as CSV and upload it here.')
      setImportStage('failed')
      event.target.value = ''
      return
    }

    const dangerousMimes = ['application/x-msdownload', 'application/javascript', 'text/html', 'application/x-sh']
    if (file.type && dangerousMimes.includes(file.type.toLowerCase())) {
      setImportError('Invalid file format. Upload a valid CSV file.')
      setImportStage('failed')
      event.target.value = ''
      return
    }

    try {
      setImportError('')
      const parsed = parseStudentCsv(await file.text())
      setImportTotalRows(parsed.length)
      setImportStage('checking')

      const { validRows, skippedRows } = await checkStudentCsvDuplicates(parsed)
      setImportSkipped(skippedRows)

      if (validRows.length === 0) {
        setImportPreview(null)
        setImportError(`All ${parsed.length} rows in this CSV are duplicates and cannot be imported.`)
      } else {
        setImportPreview(validRows)
      }
      setImportStage('ready')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Unable to read this CSV file.')
      setImportStage('failed')
    }
  }

  const confirmImport = async () => {
    if (!importPreview || importPreview.length === 0) return
    if (!campusId) {
      setImportError('Please select a campus before importing students.')
      return
    }
    setImporting(true)
    setImportError('')
    setImportStage('importing')
    try {
      const ok = await onImportStudents(importPreview, campusId)
      if (ok) {
        await refreshDirectory()
        setImportStage('complete')
        const fileInput = document.getElementById('student-import-file') as HTMLInputElement | null
        if (fileInput) fileInput.value = ''
      } else {
        setImportError('The import did not complete. Please retry.')
        setImportStage('failed')
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Unable to complete student import.')
      setImportStage('failed')
    } finally {
      setImporting(false)
    }
  }

  const handleEditStudent = async (payload: {
    studentId: string
    campusId: string
    firstName: string
    lastName: string
    className: string
    section: string
    rollNumber: string
    dateOfBirth?: string | null
    gender?: string | null
    reason: string
  }) => {
    setActionError('')
    await updateStudent(payload)
    await refreshDirectory()
  }

  const handleArchiveStudent = async (reason: string) => {
    if (!archivingStudent) return
    setActionError('')
    await archiveStudent(archivingStudent.id, reason)
    await refreshDirectory()
  }

  const handleTrashStudent = async (reason: string) => {
    if (!trashingStudent) return
    setActionError('')
    await trashStudent(trashingStudent.id, reason)
    await refreshDirectory()
  }

  const getStudentActions = (student: Student): ActionItem[] => {
    if (student.status === 'Archived') return []
    const actions: ActionItem[] = []

    if (user.role === 'admin') {
      actions.push(
        {
          label: 'Edit Student',
          onClick: () => setEditingStudent(student),
        },
        {
          label: 'Archive Student',
          danger: false,
          onClick: () => setArchivingStudent(student),
        },
        {
          label: 'Move to Trash',
          danger: true,
          onClick: () => setTrashingStudent(student),
        },
      )
    } else if (user.role === 'principal') {
      actions.push({
        label: 'Edit Class & Section',
        onClick: () => setEditingStudent(student),
      })
    } else if (user.role === 'teacher') {
      actions.push({
        label: 'Quick Edit Roll No.',
        onClick: () => setEditingStudent(student),
      })
    }
    return actions
  }

  return (
    <section className="students-page">
      <div className="students-heading">
        <div>
          <h1>Students</h1>
          <p className="students-intro">Find a student and open their school overview.</p>
          {actionError ? <p className="communication-feedback error" role="alert">{actionError}</p> : null}
        </div>
        {canCreateStudents ? (
          <div className="students-actions">
            {user.role === 'admin' ? <button type="button" className="secondary-button small-button" disabled={importBusy} onClick={() => document.getElementById('student-import-file')?.click()}>
              <FileUp size={16} /> Import Students
            </button> : null}
            <button type="button" className="primary-button small-button" onClick={() => { setStudentSaveError(''); setShowAddForm((current) => !current) }}>
              + Add Student
            </button>
            {user.role === 'admin' ? <button type="button" className="secondary-button small-button" onClick={() => setShowRegistrationLink(true)}>
              <Link2 size={16} /> Parent Registration Link
            </button> : null}
            {user.role === 'admin' ? <input
              id="student-import-file"
              className="visually-hidden"
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={importBusy}
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
        <AddStudentFormSection
          userRole={user.role}
          form={form}
          setForm={setForm}
          campuses={campuses}
          campusId={campusId}
          onChangeCampusId={setCampusId}
          teacherScopes={teacherScopes}
          activeTeacherScopes={activeTeacherScopes}
          creationOptionsLoading={creationOptionsLoading}
          creationOptionsError={creationOptionsError}
          studentSaveError={studentSaveError}
          studentSaving={studentSaving}
          onCancel={() => setShowAddForm(false)}
          onSubmit={(event) => void handleAddSubmit(event)}
        />
      ) : null}

      {user.role === 'admin' && (importError || importPreview || importStage !== 'idle') ? (
        <StudentImportSection
          importStage={importStage}
          importProgressSteps={importProgressSteps}
          importError={importError}
          importPreview={importPreview}
          importSkipped={importSkipped}
          importing={importing}
          campuses={campuses}
          campusId={campusId}
          onChangeCampusId={setCampusId}
          onReset={() => {
            setImportError('')
            setImportPreview(null)
            setImportSkipped([])
            setImportTotalRows(0)
            setImportStage('idle')
            const fileInput = document.getElementById('student-import-file') as HTMLInputElement | null
            if (fileInput) fileInput.value = ''
          }}
          onConfirmImport={() => void confirmImport()}
        />
      ) : null}

      {user.role === 'admin' ? (
        <div className="admissions-view-tabs" role="tablist" aria-label="Student records">
          <button type="button" role="tab" aria-selected={adminStudentView === 'students'} className={adminStudentView === 'students' ? 'is-active' : ''} onClick={() => setAdminStudentView('students')}>Active Students</button>
          <button type="button" role="tab" aria-selected={adminStudentView === 'admissions'} className={adminStudentView === 'admissions' ? 'is-active' : ''} onClick={() => setAdminStudentView('admissions')}>Pending Admissions</button>
        </div>
      ) : null}

      {user.role === 'admin' && adminStudentView === 'admissions' ? (
        <PendingAdmissionsPanel
          campuses={campuses}
          onRefreshStudents={() => refreshDirectory()}
        />
      ) : (
        <StudentDirectorySection
          query={query}
          setQuery={changeDirectorySearch}
          classFilter={classFilter}
          setClassFilter={(value) => setDirectoryFilter(setClassFilter, value)}
          sectionFilter={sectionFilter}
          setSectionFilter={(value) => setDirectoryFilter(setSectionFilter, value)}
          campusFilter={campusFilter}
          setCampusFilter={(value) => setDirectoryFilter(setCampusFilter, value)}
          genderFilter={genderFilter}
          setGenderFilter={(value) => setDirectoryFilter(setGenderFilter, value)}
          statusFilter={statusFilter}
          setStatusFilter={(value) => setDirectoryFilter(setStatusFilter, value)}
          sortField={sortField}
          setSortField={changeDirectorySort}
          sortDirection={sortDirection}
          setSortDirection={changeDirectorySortDirection}
          campusOptions={directoryCampuses}
          directoryStudents={directoryStudents}
          totalCount={totalCount}
          page={page}
          totalPages={totalPages}
          setPage={changeDirectoryPage}
          loading={directoryLoading}
          error={visibleDirectoryError}
          onRetry={retryDirectory}
          getStudentActions={getStudentActions}
          onOpenStudent={(studentId) => void navigate(`/students/${encodeURIComponent(studentId)}`)}
        />
      )}
      {directoryCampusesError ? <p className="communication-feedback error" role="alert">{directoryCampusesError}</p> : null}

      {editingStudent && (
        <StudentEditModal
          isOpen={Boolean(editingStudent)}
          student={editingStudent}
          userRole={user.role}
          campuses={campuses}
          onClose={() => setEditingStudent(null)}
          onSave={handleEditStudent}
        />
      )}

      {archivingStudent && (
        <DestructiveActionModal
          isOpen={Boolean(archivingStudent)}
          title="Archive Student"
          prompt={`Are you sure you want to archive ${archivingStudent.firstName} ${archivingStudent.lastName} (${archivingStudent.studentId})? The student will become non-operational, blocking new attendance, invoices, and communications, while preserving historical records.`}
          confirmLabel="Archive Student"
          danger
          onClose={() => setArchivingStudent(null)}
          onConfirm={handleArchiveStudent}
        />
      )}

      {trashingStudent && (
        <DestructiveActionModal
          isOpen={Boolean(trashingStudent)}
          title="Move Student to Trash"
          prompt="This record will be moved to Trash and can be restored for 30 days. After that, it cannot be recovered."
          confirmLabel="Move to Trash"
          danger
          onClose={() => setTrashingStudent(null)}
          onConfirm={handleTrashStudent}
        />
      )}
      {showRegistrationLink ? <ParentRegistrationLinkModal onClose={() => setShowRegistrationLink(false)} /> : null}
    </section>
  )
}

function normalizeScopeValue(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function isTeacherAssignedToStudent(user: StudentPageUser, student: Student): boolean {
  if (user.role !== 'teacher') return true
  return (user.teacherAssignments ?? []).some((assignment) =>
    assignment.active &&
    assignment.school_id === student.schoolId &&
    assignment.campus_id === student.campusId &&
    normalizeScopeValue(assignment.class_name) === normalizeScopeValue(student.className) &&
    normalizeScopeValue(assignment.section) === normalizeScopeValue(student.section),
  )
}

function buildStudentDetailActions(
  role: Role,
  status: Student['status'],
  handlers: { onEdit: () => void; onArchive: () => void; onTrash: () => void },
): ActionItem[] {
  if (status === 'Archived') return []
  if (role === 'admin') {
    return [
      { label: 'Edit Student', onClick: handlers.onEdit },
      { label: 'Archive Student', danger: false, onClick: handlers.onArchive },
      { label: 'Move to Trash', danger: true, onClick: handlers.onTrash },
    ]
  }
  if (role === 'principal') {
    return [{ label: 'Edit Class & Section', onClick: handlers.onEdit }]
  }
  if (role === 'teacher') {
    return [{ label: 'Edit Roll Number / DOB', onClick: handlers.onEdit }]
  }
  return []
}

export function StudentDetailPage({ user, attendance, attendanceLoading, attendanceError, fees, feesLoading, feesError, onRetryFees, communication, users, alerts, alertsLoading, alertsError, onRefresh }: Readonly<DetailPageProps>) {
  const navigate = useNavigate()
  const { studentId = '' } = useParams()
  const [pageState, setPageState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [authorizedStudent, setAuthorizedStudent] = useState<Student | null>(null)
  const [detailError, setDetailError] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [prevStudentId, setPrevStudentId] = useState(studentId)
  const [activeTab, setActiveTab] = useState<StudentTab>('Overview')
  const [editingStudent, setEditingStudent] = useState(false)
  const [archivingStudent, setArchivingStudent] = useState(false)
  const [trashingStudent, setTrashingStudent] = useState(false)
  const [guardianModalMode, setGuardianModalMode] = useState<'edit' | 'link' | null>(null)
  const [unlinkingGuardian, setUnlinkingGuardian] = useState(false)
  const [campuses, setCampuses] = useState<StudentCampusOption[]>([])
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (user.role === 'admin' || user.role === 'principal') {
      void fetchStudentCreationOptions(
        'admin',
        user.schoolId ?? null,
        user.organizationId ?? null,
        user.teacherAssignments ?? [],
      ).then((options) => setCampuses(options.campuses)).catch(() => { })
    }
  }, [user.role, user.schoolId, user.organizationId, user.teacherAssignments])

  if (prevStudentId !== studentId) {
    setPrevStudentId(studentId)
    setPageState('loading')
    setAuthorizedStudent(null)
    setDetailError('')
  }

  const detailStudentScope = useMemo(
    () => authorizedStudent ? [authorizedStudent] : [],
    [authorizedStudent],
  )
  const feeInvoices = useMemo(
    () => authorizedStudent
      ? getFeeInvoices(fees, detailStudentScope, user).filter((invoice) => invoice.studentId === authorizedStudent.id && !invoice.voidedAt)
      : [],
    [authorizedStudent, detailStudentScope, fees, user],
  )
  const feePayments = fees.payments.filter((payment) =>
    !payment.voidedAt && feeInvoices.some((invoice) => invoice.id === payment.invoiceId),
  )
  const communicationMessages = authorizedStudent
    ? getAccessibleCommunication(communication, detailStudentScope, user).filter((message) => message.studentId === authorizedStudent.id)
    : []

  useEffect(() => {
    let active = true
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
        <h1>Student not found</h1>
        <p>This student may not exist or may not be included in your authorized student access.</p>
        <button type="button" className="primary-button small-button" onClick={() => navigate('/students')}><ArrowLeft size={15} /> Back to Students</button>
      </section>
    )
  }

  const canViewStatementTab = isTeacherAssignedToStudent(user, authorizedStudent)
  const studentAttendanceSummary = getStudentAttendance(authorizedStudent, attendance)
  const latestAttendance = studentAttendanceSummary.recent[0]
  const feeReminderInvoice = feeInvoices.find((invoice) => invoice.outstandingAmount > 0)
  const allTabs: StudentTab[] = ['Overview', 'Attendance', 'Fees', 'Communication', 'Statements']
  const tabs = allTabs.filter(
    (tab) => canViewStudentTab(user.role, tab) &&
      (tab !== 'Statements' || canViewStatementTab),
  )
  const selectedTab = tabs.includes(activeTab) ? activeTab : tabs[0] ?? 'Overview'

  const handleEditStudent = async (payload: {
    studentId: string
    campusId: string
    firstName: string
    lastName: string
    className: string
    section: string
    rollNumber: string
    dateOfBirth?: string | null
    gender?: string | null
    reason: string
  }) => {
    setActionError('')
    const updated = await updateStudent(payload)
    setAuthorizedStudent(updated)
    if (onRefresh) await onRefresh()
  }

  const handleArchiveStudent = async (reason: string) => {
    if (!authorizedStudent) return
    setActionError('')
    await archiveStudent(authorizedStudent.id, reason)
    if (onRefresh) await onRefresh()
    void navigate('/students')
  }

  const handleTrashStudent = async (reason: string) => {
    if (!authorizedStudent) return
    setActionError('')
    await trashStudent(authorizedStudent.id, reason)
    if (onRefresh) await onRefresh()
    void navigate('/students')
  }

  const handleUpdateGuardian = async (payload: {
    guardianId: string
    firstName: string
    lastName: string
    phone?: string
    email?: string
    address?: string
    reason: string
  }) => {
    setActionError('')
    await updateGuardian(payload)
    const updated = await fetchStudentById(authorizedStudent.id)
    setAuthorizedStudent(updated)
    if (onRefresh) await onRefresh()
  }

  const handleLinkGuardian = async (payload: {
    studentId: string
    guardianId: string
    relationship: string
    isPrimary: boolean
    reason: string
  }) => {
    setActionError('')
    await linkStudentGuardian(payload)
    const updated = await fetchStudentById(authorizedStudent.id)
    setAuthorizedStudent(updated)
    if (onRefresh) await onRefresh()
  }

  const handleUnlinkGuardian = async (reason: string) => {
    if (!authorizedStudent?.guardian.id) return
    setActionError('')
    await unlinkStudentGuardian({
      studentId: authorizedStudent.id,
      guardianId: authorizedStudent.guardian.id,
      reason,
    })
    const updated = await fetchStudentById(authorizedStudent.id)
    setAuthorizedStudent(updated)
    if (onRefresh) await onRefresh()
  }

  const studentActions = buildStudentDetailActions(user.role, authorizedStudent.status, {
    onEdit: () => setEditingStudent(true),
    onArchive: () => setArchivingStudent(true),
    onTrash: () => setTrashingStudent(true),
  })

  return (
    <section className="student-detail-page">
      <button type="button" className="back-link" onClick={() => navigate('/students')}><ArrowLeft size={16} /> Students</button>
      {actionError ? <p className="communication-feedback error" role="alert">{actionError}</p> : null}
      <div className="student-detail-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="student-avatar student-avatar-large"><UserRound size={24} /></div>
          <div className="student-detail-name">
            <h1>{authorizedStudent.firstName} {authorizedStudent.lastName}</h1>
            <p>{authorizedStudent.studentId} <span>·</span> {authorizedStudent.className}-{authorizedStudent.section}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className={`status-pill ${authorizedStudent.status === 'Active' ? 'success' : 'muted'}`}>{authorizedStudent.status}</span>
          <WhatsAppComposer
            student={authorizedStudent}
            user={user}
            context={{
              attendance: {
                status: latestAttendance?.status ?? null,
                date: latestAttendance?.date,
                rate: studentAttendanceSummary.counts.rate,
                recordedDays: studentAttendanceSummary.counts.total,
              },
              fee: feeReminderInvoice
                ? { outstandingAmount: feeReminderInvoice.outstandingAmount, dueDate: feeReminderInvoice.dueDate }
                : undefined,
            }}
          />
          {studentActions.length > 0 && <RecordActionMenu actions={studentActions} />}
        </div>
      </div>

      <nav className="student-tabs" aria-label="Student information">
        {tabs.map((tab) => (
          <button type="button" key={tab} className={selectedTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>
        ))}
      </nav>

      {editingStudent && (
        <StudentEditModal
          isOpen={editingStudent}
          student={authorizedStudent}
          userRole={user.role}
          campuses={campuses}
          onClose={() => setEditingStudent(false)}
          onSave={handleEditStudent}
        />
      )}

      {archivingStudent && (
        <DestructiveActionModal
          isOpen={archivingStudent}
          title="Archive Student"
          prompt={`Are you sure you want to archive ${authorizedStudent.firstName} ${authorizedStudent.lastName} (${authorizedStudent.studentId})? The student will become non-operational, blocking new attendance, invoices, and communications, while preserving historical records.`}
          confirmLabel="Archive Student"
          danger
          onClose={() => setArchivingStudent(false)}
          onConfirm={handleArchiveStudent}
        />
      )}

      {trashingStudent && (
        <DestructiveActionModal
          isOpen={trashingStudent}
          title="Move Student to Trash"
          prompt="This record will be moved to Trash and can be restored for 30 days. After that, it cannot be recovered."
          confirmLabel="Move to Trash"
          danger
          onClose={() => setTrashingStudent(false)}
          onConfirm={handleTrashStudent}
        />
      )}

      {guardianModalMode && (
        <GuardianModal
          isOpen={Boolean(guardianModalMode)}
          mode={guardianModalMode}
          studentId={authorizedStudent.id}
          guardian={authorizedStudent.guardian}
          userRole={user.role}
          onClose={() => setGuardianModalMode(null)}
          onUpdate={handleUpdateGuardian}
          onLink={handleLinkGuardian}
        />
      )}

      {unlinkingGuardian && (
        <DestructiveActionModal
          isOpen={unlinkingGuardian}
          title="Unlink Guardian"
          prompt={`Are you sure you want to unlink ${authorizedStudent.guardian.name} from ${authorizedStudent.firstName} ${authorizedStudent.lastName}? If this guardian has no other active student links, they will be archived automatically.`}
          confirmLabel="Unlink Guardian"
          danger
          onClose={() => setUnlinkingGuardian(false)}
          onConfirm={handleUnlinkGuardian}
        />
      )}

      {selectedTab === 'Overview' ? (
        <StudentOverview
          student={authorizedStudent}
          role={user.role}
          attendance={attendance}
          attendanceLoading={attendanceLoading}
          attendanceError={attendanceError}
          feeInvoices={feeInvoices}
          feesLoading={feesLoading}
          feesError={feesError}
          alerts={alerts}
          alertsLoading={alertsLoading}
          alertsError={alertsError}
          onEditGuardian={() => setGuardianModalMode('edit')}
          onLinkGuardian={() => setGuardianModalMode('link')}
          onUnlinkGuardian={() => setUnlinkingGuardian(true)}
        />
      ) : null}
      {selectedTab === 'Attendance' ? <StudentAttendance student={authorizedStudent} attendance={attendance} loading={attendanceLoading} error={attendanceError} timeZone={user.schoolTimezone} /> : null}
      {selectedTab === 'Fees' && canViewStudentTab(user.role, 'Fees') ? <StudentFees invoices={feeInvoices} payments={feePayments} loading={feesLoading} error={feesError} onRetry={onRetryFees} /> : null}
      {selectedTab === 'Communication' ? <StudentCommunication student={authorizedStudent} messages={communicationMessages} user={user} invoices={feeInvoices} users={users} /> : null}
      {selectedTab === 'Statements' ? (
        <section className="student-statements-panel">
          <div>
            <p className="eyebrow">Student records</p>
            <h2>Statements</h2>
            <p>View or download a dated statement for this student.</p>
          </div>
          <div className="student-statements-actions">
            {['admin', 'principal', 'finance'].includes(user.role) ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate(`/statements/account?studentId=${encodeURIComponent(authorizedStudent.id)}`)}
              >
                <FileText size={17} /> Account Statement
              </button>
            ) : null}
            {['admin', 'principal', 'teacher'].includes(user.role) ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate(`/statements/attendance?studentId=${encodeURIComponent(authorizedStudent.id)}`)}
              >
                <FileText size={17} /> Attendance Statement
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </section>
  )
}

function OverviewSummaryCard({
  title,
  loading,
  loadingText,
  error,
  value,
  detail,
}: Readonly<{
  title: string
  loading: boolean
  loadingText: string
  error: string
  value: string | number
  detail: string
}>) {
  let content: React.ReactNode
  if (loading) {
    content = <output>{loadingText}</output>
  } else if (error) {
    content = <p role="alert">{error}</p>
  } else {
    content = (
      <>
        <strong>{value}</strong>
        <p>{detail}</p>
      </>
    )
  }
  return (
    <section className="student-summary-card">
      <h2>{title}</h2>
      {content}
    </section>
  )
}

function GuardianInfoCard({
  student,
  role,
  onEditGuardian,
  onLinkGuardian,
  onUnlinkGuardian,
}: Readonly<{
  student: Student
  role: Role
  onEditGuardian?: () => void
  onLinkGuardian?: () => void
  onUnlinkGuardian?: () => void
}>) {
  const isActiveStudent = student.status !== 'Archived'
  const canEditGuardian = isActiveStudent && (role === 'admin' || role === 'principal') && Boolean(student.guardian.id)
  const canManageGuardian = isActiveStudent && role === 'admin'

  return (
    <section className="student-info-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 style={{ margin: 0 }}>Guardian information</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canEditGuardian ? (
            <button
              type="button"
              className="secondary-button icon-only-button"
              style={{ padding: '4px 8px', fontSize: '12px' }}
              onClick={onEditGuardian}
            >
              Edit Details
            </button>
          ) : null}
          {canManageGuardian ? (
            <>
              <button
                type="button"
                className="secondary-button icon-only-button"
                style={{ padding: '4px 8px', fontSize: '12px' }}
                onClick={onLinkGuardian}
              >
                Link New
              </button>
              {student.guardian.id ? (
                <button
                  type="button"
                  className="secondary-button icon-only-button"
                  style={{ padding: '4px 8px', fontSize: '12px', color: '#dc2626' }}
                  onClick={onUnlinkGuardian}
                >
                  Unlink
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <dl className="student-info-grid">
        <InfoField label="Name" value={student.guardian.name || 'No guardian assigned'} />
        <InfoField label="Relationship" value={student.guardian.relationship ?? ''} />
        <InfoField label="Phone" value={student.guardian.phone || '—'} />
        <InfoField label="Email" value={student.guardian.email || '—'} />
      </dl>
    </section>
  )
}

function StudentOverview({
  student,
  role,
  attendance,
  attendanceLoading,
  attendanceError,
  feeInvoices,
  feesLoading,
  feesError,
  alerts,
  alertsLoading,
  alertsError,
  onEditGuardian,
  onLinkGuardian,
  onUnlinkGuardian,
}: Readonly<{
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
  onEditGuardian?: () => void
  onLinkGuardian?: () => void
  onUnlinkGuardian?: () => void
}>) {
  const canViewSensitiveOverview = role !== 'finance'
  const canViewFees = canViewStudentTab(role, 'Fees')
  const summary = getStudentAttendance(student, attendance)
  const feeSummary = getFeeMetrics(feeInvoices)
  const openAlerts = alerts.filter((alert) =>
    alert.sourceType === 'ATTENDANCE' && alert.studentId === student.id && alert.status !== 'RESOLVED',
  ).length
  const attendanceValue = summary.counts.rate === null ? '—' : `${summary.counts.rate}%`
  const attendanceDetail = `${summary.counts.present} present · ${summary.counts.absent} absent · ${summary.counts.late} late days`
  const alertDetail = openAlerts ? 'Attendance items may need follow-up.' : 'No attendance alerts for this student.'

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
        <OverviewSummaryCard
          title="Attendance summary"
          loading={attendanceLoading}
          loadingText="Loading attendance…"
          error={attendanceError}
          value={attendanceValue}
          detail={attendanceDetail}
        />
      ) : null}
      <GuardianInfoCard
        student={student}
        role={role}
        onEditGuardian={onEditGuardian}
        onLinkGuardian={onLinkGuardian}
        onUnlinkGuardian={onUnlinkGuardian}
      />
      {canViewFees ? (
        <OverviewSummaryCard
          title="Fee summary"
          loading={feesLoading}
          loadingText="Loading fee information…"
          error={feesError}
          value={`${formatCurrency(feeSummary.outstanding)} outstanding`}
          detail={`${formatCurrency(feeSummary.collected)} paid of ${formatCurrency(feeSummary.expected)}`}
        />
      ) : null}
      {canViewSensitiveOverview ? (
        <>
          <OverviewSummaryCard
            title="Open alerts"
            loading={alertsLoading}
            loadingText="Loading alerts…"
            error={alertsError}
            value={openAlerts}
            detail={alertDetail}
          />
          <section className="student-info-card student-activity-card">
            <h2>Recent activity</h2>
            <ActivityTimeline items={student.activity.filter((item) => !item.title.toLowerCase().includes('fee'))} />
          </section>
        </>
      ) : null}
    </div>
  )
}

function StudentAttendance({ student, attendance, loading, error, timeZone }: Readonly<{
  student: Student
  attendance: AttendanceState
  loading: boolean
  error: string
  timeZone?: string | null
}>) {
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
      <section className="student-info-card student-attendance-trend-card">
        <h2>Attendance trend</h2>
        <AttendanceTrend data={summary.trend} timeZone={timeZone} />
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

function StudentFees({ invoices, payments, loading, error, onRetry }: Readonly<{ invoices: FeeInvoiceView[]; payments: FeePayment[]; loading: boolean; error: string; onRetry: () => void }>) {
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

function getCommunicationCreateType(role: Role): 'Fee Reminder' | 'Attendance Reminder' | 'General Notice' {
  if (role === 'finance') return 'Fee Reminder'
  if (role === 'teacher') return 'Attendance Reminder'
  return 'General Notice'
}

function StudentCommunication({ student, messages, user, invoices, users }: Readonly<{
  student: Student
  messages: ReturnType<typeof getAccessibleCommunication>
  user: StudentPageUser
  invoices: FeeInvoiceView[]
  users: SchoolUser[]
}>) {
  const navigate = useNavigate()
  const createType = getCommunicationCreateType(user.role)
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
      <div className="student-communication-header"><h2>Recent Messages</h2>{canCreate ? <button type="button" className="secondary-button small-button" onClick={() => void navigate(createHref)}>Create Message</button> : null}</div>
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

function ActivityTimeline({ items }: Readonly<{ items: Student['activity'] }>) {
  if (!items.length) return <p className="student-muted">No recent activity.</p>
  return (
    <ol className="activity-timeline">
      {items.map((item) => <li key={`${item.date}-${item.title}`}><span className="timeline-dot" /><div><strong>{item.title}</strong><p>{item.detail}</p><small>{formatDate(item.date)}</small></div></li>)}
    </ol>
  )
}

function buildRoundedColumnPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 4,
): string {
  if (height <= 0) return ''
  const r = Math.min(radius, width / 2, height)
  const bottom = y + height
  const right = x + width
  return `M ${x},${bottom} L ${x},${y + r} Q ${x},${y} ${x + r},${y} L ${right - r},${y} Q ${right},${y} ${right},${y + r} L ${right},${bottom} Z`
}

function getAttendanceTrendTooltip(params: {
  activePoint: { date: string; value: number } | null
  activeIndex: number | null
  left: number
  top: number
  width: number
  height: number
  slotWidth: number
  plotHeight: number
}) {
  const { activePoint, activeIndex, left, top, width, height, slotWidth, plotHeight } = params
  if (!activePoint || activeIndex === null) return null
  const slotCenterX = left + slotWidth * (activeIndex + 0.5)
  const clamped = Math.max(0, Math.min(100, activePoint.value))
  const barHeight = (clamped / 100) * plotHeight
  const barY = top + plotHeight - barHeight
  return {
    point: activePoint,
    leftPct: Math.min(84, Math.max(16, (slotCenterX / width) * 100)),
    topPct: Math.max(6, Math.min(72, (barY / height) * 100)),
    placeBelowTop: barY / height < 0.42,
  }
}

function AttendanceTrend({ data, timeZone }: Readonly<{
  data: { date: string; value: number }[]
  timeZone?: string | null
}>) {
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const [today] = useState(() => schoolDateKey(timeZone))
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const year = Number(today.slice(0, 4))
  const startDate = period === 'week'
    ? addCalendarDays(today, -6)
    : `${today.slice(0, 7)}-01`
  const visibleData = data.filter((point) => point.date >= startDate && point.date <= today)
  const width = 800
  const height = 240
  const left = 48
  const right = 20
  const top = 16
  const bottom = 30
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const slotWidth = plotWidth / Math.max(visibleData.length, 1)
  const barWidth = Math.min(44, Math.max(10, slotWidth * 0.56))
  const monthLabel = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${today.slice(0, 7)}-01T00:00:00Z`),
  )
  const periodLabel = period === 'week' ? 'Last 7 days' : `${monthLabel} ${year}`
  const activePoint = activeIndex === null ? null : visibleData[activeIndex] ?? null
  const tooltip = getAttendanceTrendTooltip({
    activePoint,
    activeIndex,
    left,
    top,
    width,
    height,
    slotWidth,
    plotHeight,
  })

  return (
    <div className="student-trend-chart">
      <div className="student-trend-controls">
        <span>{periodLabel}</span>
        <fieldset className="student-trend-filters" aria-label="Attendance graph date range" style={{ border: 0, padding: 0, margin: 0 }}>
          <button type="button" className={period === 'week' ? 'active' : ''} aria-pressed={period === 'week'} onClick={() => { setPeriod('week'); setActiveIndex(null) }}>Weekly</button>
          <button type="button" className={period === 'month' ? 'active' : ''} aria-pressed={period === 'month'} onClick={() => { setPeriod('month'); setActiveIndex(null) }}>Monthly</button>
        </fieldset>
      </div>
      {visibleData.length ? (
        <div className="attendance-chart-wrap">
          {tooltip ? (
            <output
              className="attendance-chart-tooltip"
              style={{
                left: `${tooltip.leftPct}%`,
                top: `${tooltip.topPct}%`,
                transform: tooltip.placeBelowTop ? 'translate(-50%, 8px)' : 'translate(-50%, calc(-100% - 8px))',
              }}
            >
              <strong>{formatDate(tooltip.point.date)}</strong>
              <span>{tooltip.point.value}% attendance</span>
            </output>
          ) : null}
          <svg className="attendance-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Student attendance trend for ${periodLabel}`}>
            {[0, 25, 50, 75, 100].map((tick) => {
              const y = top + ((100 - tick) / 100) * plotHeight
              return (
                <g key={tick}>
                  <line className={tick === 0 ? 'attendance-chart-baseline' : 'attendance-chart-gridline'} x1={left} y1={y} x2={width - right} y2={y} />
                  <text className="student-trend-y-label" x={left - 10} y={y + 4} textAnchor="end">{tick}%</text>
                </g>
              )
            })}
            {visibleData.map((point, index) => {
              const slotCenterX = left + slotWidth * (index + 0.5)
              const barX = slotCenterX - barWidth / 2
              const clamped = Math.max(0, Math.min(100, point.value))
              const barHeight = (clamped / 100) * plotHeight
              const barY = top + plotHeight - barHeight
              const barPath = buildRoundedColumnPath(barX, barY, barWidth, barHeight, 4)
              const isActive = activeIndex === index
              const showLabel = period === 'week' || visibleData.length <= 10 || index % 5 === 0 || index === visibleData.length - 1
              return (
                <g
                  key={point.date}
                  className={`attendance-chart-column-group${isActive ? ' is-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  onFocus={() => setActiveIndex(index)}
                  onBlur={() => setActiveIndex(null)}
                  onTouchStart={() => setActiveIndex(index)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${formatDate(point.date)}: ${point.value}% attendance`}
                >
                  <rect className="attendance-chart-column-hit" x={barX - 4} y={top} width={barWidth + 8} height={plotHeight} />
                  {barPath ? <path className="attendance-chart-column" d={barPath} style={{ fill: '#3B82F6' }} /> : null}
                  {showLabel ? (
                    <text className="attendance-chart-day student-trend-date-label" x={slotCenterX} y={height - 8} textAnchor="middle">
                      {period === 'week' ? formatTrendDate(point.date) : point.date.slice(-2)}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </svg>
        </div>
      ) : (
        <p className="student-muted">No attendance records for {period === 'week' ? 'the last 7 days' : 'this month'}.</p>
      )}
    </div>
  )
}

function formatTrendDate(date: string): string {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${monthNames[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`
}

function InfoField({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><dt>{label}</dt><dd>{value || '—'}</dd></div>
}

function SummaryMetric({ label, value }: Readonly<{ label: string; value: string }>) {
  return <article className="student-metric"><span>{label}</span><strong>{value}</strong></article>
}

function StudentListState({ title, detail, isError = false, onRetry }: Readonly<{ title: string; detail?: string; isError?: boolean; onRetry?: () => void }>) {
  return (
    <section className={`student-state-card ${isError ? 'error-card' : ''}`} role={isError ? 'alert' : 'status'}>
      <div className="empty-icon">{isError ? <CalendarDays size={21} /> : <Users size={21} />}</div>
      <h1>{title}</h1>
      {detail ? <p>{detail}</p> : null}
      {onRetry ? <button type="button" className="primary-button small-button" onClick={onRetry}>Try again</button> : null}
    </section>
  )
}

function sanitizeCsvCell(value: string): string {
  let cell = value.trim()
  while (cell && ['=', '+', '-', '@', '\t', '\r'].includes(cell[0])) {
    cell = cell.slice(1).trim()
  }
  return cell
}

function isValidEmailAddress(email: string): boolean {
  if (/\s/.test(email)) return false
  const atIndex = email.indexOf('@')
  if (atIndex <= 0 || atIndex !== email.lastIndexOf('@')) return false
  const domain = email.slice(atIndex + 1)
  const dotIndex = domain.lastIndexOf('.')
  return dotIndex > 0 && dotIndex < domain.length - 1
}

function parseStudentCsv(content: string): NewStudent[] {
  const rows = parseCsvRows(content)
  if (rows.length < 2) throw new Error('The CSV must include a header row and at least one student.')

  const MAX_IMPORT_ROWS = 1500
  const dataRows = rows.slice(1).filter((row) => row.some((value) => value.trim()))
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`The CSV contains ${dataRows.length} rows, which exceeds the maximum limit of ${MAX_IMPORT_ROWS} students per import.`)
  }
  if (!dataRows.length) throw new Error('The CSV does not contain any student rows.')

  const normalizeHeader = (header: string) => header.trim().replace(/^\uFEFF/, '').toLowerCase().replaceAll('_', '').replaceAll('-', '').replaceAll(' ', '')
  const headers = rows[0].map(normalizeHeader)
  const requiredHeaders = studentCsvFields.map((field) => normalizeHeader(String(field)))
  const missing = requiredHeaders.filter((header) => !headers.includes(header))
  if (missing.length) throw new Error(`Missing CSV columns: ${missing.join(', ')}.`)

  const column = (row: string[], name: string) => sanitizeCsvCell(row[headers.indexOf(name)] ?? '')
  const parsed: NewStudent[] = dataRows.map((row, index) => {
    const studentId = column(row, 'studentid')
    const firstName = column(row, 'firstname')
    const lastName = column(row, 'lastname')
    const className = column(row, 'classname')
    const section = column(row, 'section')
    const rollNumber = column(row, 'rollnumber')
    const dateOfBirth = column(row, 'dateofbirth')
    const gender = column(row, 'gender')
    const guardianName = column(row, 'guardianname')
    const guardianPhone = column(row, 'guardianphone')
    const guardianEmail = column(row, 'guardianemail')

    if (!studentId || !firstName || !lastName || !className || !section || !guardianName) {
      throw new Error(`Student row ${index + 2} is missing required values.`)
    }
    if (studentId.length > 40 || !/^[a-zA-Z0-9_-]+$/.test(studentId)) {
      throw new Error(`Student row ${index + 2} has an invalid Student ID format (alphanumeric, dashes, underscores only up to 40 characters).`)
    }
    if (firstName.length > 100 || lastName.length > 100 || className.length > 100 || section.length > 40) {
      throw new Error(`Student row ${index + 2} exceeds maximum allowed character length for names or class.`)
    }
    if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      throw new Error(`Student row ${index + 2} has an invalid date of birth format (must be YYYY-MM-DD).`)
    }
    if (guardianEmail && !isValidEmailAddress(guardianEmail)) {
      throw new Error(`Student row ${index + 2} has an invalid guardian email address.`)
    }

    const student: NewStudent = {
      firstName,
      lastName,
      studentId,
      className,
      section,
      rollNumber,
      dateOfBirth,
      gender,
      guardian: {
        name: guardianName,
        phone: guardianPhone,
        email: guardianEmail,
      },
    }
    return student
  })
  return parsed
}

function pushNonEmptyCsvRow(rows: string[][], row: string[], lastValue: string) {
  row.push(lastValue)
  if (row.some((cell) => cell.trim())) rows.push(row)
}

type CsvParseState = {
  rows: string[][]
  row: string[]
  value: string
  quoted: boolean
}

function advanceCsvIndex(state: CsvParseState, content: string, index: number): number {
  const character = content[index]
  if (character === '"') {
    if (state.quoted && content[index + 1] === '"') {
      state.value += '"'
      return index + 1
    }
    state.quoted = !state.quoted
    return index
  }
  if (!state.quoted && character === ',') {
    state.row.push(state.value)
    state.value = ''
    return index
  }
  if (!state.quoted && (character === '\n' || character === '\r')) {
    pushNonEmptyCsvRow(state.rows, state.row, state.value)
    state.row = []
    state.value = ''
    return character === '\r' && content[index + 1] === '\n' ? index + 1 : index
  }
  state.value += character
  return index
}

function parseCsvRows(content: string): string[][] {
  const state: CsvParseState = { rows: [], row: [], value: '', quoted: false }
  for (let index = 0; index < content.length; index += 1) {
    index = advanceCsvIndex(state, content, index)
  }
  if (state.quoted) throw new Error('The CSV contains an unfinished quoted field.')
  pushNonEmptyCsvRow(state.rows, state.row, state.value)
  return state.rows
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
