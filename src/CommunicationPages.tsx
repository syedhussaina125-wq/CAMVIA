import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, Check, FilePlus2, MessageSquareText, Search, Send, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { Student } from './studentData'
import {
  canCreateCommunication,
  communicationChannels,
  communicationTypes,
  createAttendanceMessageTemplate,
  createFeeMessageTemplate,
  getAccessibleCommunication,
  type CommunicationChannel,
  type CommunicationDraftSubmission,
  type CommunicationMessageView,
  type CommunicationOperation,
  type CommunicationState,
  type CommunicationStatus,
  type CommunicationType,
  type CommunicationUser,
} from './communicationData'
import type { AttendanceState } from './attendanceData'
import type { FeeState } from './feeData'
import type { SchoolUser } from './mockData'

type CommunicationPageProps = {
  user: CommunicationUser
  students: Student[]
  state: CommunicationState
  attendance: AttendanceState
  fees: FeeState
  users: SchoolUser[]
  loading: boolean
  loadError: string
  onRetry: () => void
  onSaveDraft: (draft: CommunicationDraftSubmission, submit: boolean) => Promise<{ messageId?: string; error?: string }>
  onOperation: (operation: CommunicationOperation) => Promise<boolean>
}

type CommunicationTab = 'Drafts' | 'Awaiting Approval' | 'Sent'
type DraftFormState = {
  studentId: string
  guardianId: string
  guardianName: string
  type: CommunicationType
  channel: CommunicationChannel
  message: string
  sourceType: 'ATTENDANCE' | 'FEE' | 'STUDENT' | 'MANUAL'
  sourceId: string
  messageId: string
  status?: CommunicationStatus
}

const tabs: CommunicationTab[] = ['Drafts', 'Awaiting Approval', 'Sent']

export function CommunicationPage(props: CommunicationPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<CommunicationTab>('Drafts')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [editing, setEditing] = useState<DraftFormState | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const authorizedStudents = useMemo(
    () => props.students.filter((student) =>
      (!props.user.organizationId || student.organizationId === props.user.organizationId) &&
      (!props.user.schoolId || student.schoolId === props.user.schoolId) &&
      (props.user.role !== 'teacher' || props.user.teacherAssignments?.some((assignment) =>
        assignment.active &&
        assignment.campus_id === student.campusId &&
        assignment.class_name === student.className &&
        assignment.section === student.section,
      )),
    ),
    [props.students, props.user],
  )
  const messages = useMemo(
    () => getAccessibleCommunication(props.state, props.students, props.user),
    [props.state, props.students, props.user],
  )
  const userNames = useMemo(() => new Map(props.users.map((user) => [user.id, user.name])), [props.users])
  const pendingPrefill = useMemo(
    () => buildPrefill(searchParams, authorizedStudents, props.fees),
    [searchParams, authorizedStudents, props.fees],
  )
  const canCreate = communicationTypes.some((type) => canCreateCommunication(props.user, type))
  const isReviewer = props.user.role === 'admin' || props.user.role === 'principal'

  useEffect(() => {
    if (!pendingPrefill || editing) return
    const timeout = window.setTimeout(() => {
      setEditing(pendingPrefill)
      setTab('Drafts')
      setSearchParams({}, { replace: true })
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [pendingPrefill, editing, setSearchParams])

  if (props.loading) return <CommunicationLoadingState />
  if (props.loadError) return <CommunicationErrorState error={props.loadError} onRetry={props.onRetry} />

  const visibleMessages = messages.filter((message) => {
    const inTab = tab === 'Drafts'
      ? message.status === 'DRAFT' || message.status === 'REJECTED'
      : tab === 'Awaiting Approval'
        ? message.status === 'AWAITING_APPROVAL' || message.status === 'APPROVED'
        : message.status === 'SENT'
    const searchable = `${message.student.firstName} ${message.student.lastName} ${message.guardianName}`.toLowerCase()
    return inTab &&
      searchable.includes(query.trim().toLowerCase()) &&
      (!statusFilter || message.status === statusFilter) &&
      (!typeFilter || message.type === typeFilter) &&
      (!channelFilter || message.channel === channelFilter)
  })
  const draftsCount = messages.filter((message) => message.status === 'DRAFT' || message.status === 'REJECTED').length
  const approvalCount = messages.filter((message) => message.status === 'AWAITING_APPROVAL').length
  const sentToday = messages.filter((message) => message.status === 'SENT' && message.sentAt?.slice(0, 10) === localDateKey()).length
  const deliveryIssues = messages.filter((message) => message.status === 'SENT' && message.deliveryStatus === 'FAILED').length

  const openNewDraft = () => {
    setEditing(createBlankDraft(props.user))
    setTab('Drafts')
    setSelectedMessageId('')
    setError('')
    setSuccess('')
  }

  const editMessage = (message: CommunicationMessageView) => {
    setEditing({
      studentId: message.studentId,
      guardianId: message.guardianId,
      guardianName: message.guardianName,
      type: message.type,
      channel: message.channel,
      message: message.message,
      sourceType: message.sourceType,
      sourceId: message.sourceId,
      messageId: message.id,
      status: message.status,
    })
    setSelectedMessageId('')
    setError('')
    setSuccess('')
  }

  const saveDraft = async (submit: boolean) => {
    if (!editing || saving) return
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      const result = await props.onSaveDraft({
        studentId: editing.studentId,
        guardianId: editing.guardianId,
        type: editing.type,
        channel: editing.channel,
        message: editing.message,
        sourceType: editing.sourceType,
        sourceId: editing.sourceId,
        messageId: editing.messageId || undefined,
      }, submit)
      if (result.error || !result.messageId) {
        setError(result.error ?? 'We could not save this draft. Check the student and message details.')
        return
      }
      setEditing(null)
      if (submit) {
        setTab('Awaiting Approval')
        setSuccess('Message submitted for approval.')
      } else {
        setTab('Drafts')
        setSuccess('Draft saved.')
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The communication could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const runOperation = async (operation: CommunicationOperation, nextTab?: CommunicationTab) => {
    setError('')
    setSuccess('')
    const completed = await props.onOperation(operation)
    if (!completed) {
      setError('The communication workflow action could not be completed.')
      return
    }
    if (nextTab) setTab(nextTab)
    setSelectedMessageId('')
    setRejectReason('')
    setSuccess(operation.type === 'approve'
      ? 'Message approved.'
      : operation.type === 'reject'
        ? 'Message rejected and retained in history.'
        : operation.type === 'send'
          ? 'Message marked as sent.'
          : 'Message submitted for approval.')
  }

  const selectTab = (nextTab: CommunicationTab) => {
    setTab(nextTab)
    setEditing(null)
    setSelectedMessageId('')
    setError('')
    setSuccess('')
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const nextTab = tabs[nextIndex]
    if (!nextTab) return
    selectTab(nextTab)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <section className="communication-page">
      <header className="communication-heading">
        <div><p className="eyebrow">School to home</p><h1>Parent Communication</h1><p>Prepare, review and track parent messages.</p></div>
        {canCreate ? <button type="button" className="primary-button small-button" onClick={openNewDraft}><FilePlus2 size={16} /> New Message</button> : null}
      </header>

      <div className="communication-summary-grid">
        <CommunicationMetric label="Drafts" value={draftsCount} tone="blue" />
        <CommunicationMetric label="Awaiting Approval" value={approvalCount} tone="amber" />
        <CommunicationMetric label="Sent Today" value={sentToday} tone="green" />
        <CommunicationMetric label="Delivery Issues" value={deliveryIssues} tone="red" />
      </div>

      <section className="communication-panel">
        <div className="communication-toolbar">
          <div className="communication-tabs" role="tablist" aria-label="Communication status">
            {tabs.map((item, index) => (
              <button
                type="button"
                role="tab"
                ref={(element) => { tabRefs.current[index] = element }}
                id={`communication-tab-${index}`}
                aria-selected={tab === item}
                aria-controls="communication-tabpanel"
                tabIndex={tab === item ? 0 : -1}
                key={item}
                className={tab === item ? 'active' : ''}
                onClick={() => selectTab(item)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {item}
              </button>
            ))}
          </div>
          <label className="communication-search"><Search size={16} /><input aria-label="Search communication" placeholder="Search student or guardian" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        </div>

        <div
          id="communication-tabpanel"
          role="tabpanel"
          aria-labelledby={`communication-tab-${tabs.indexOf(tab)}`}
          tabIndex={0}
        >
        <div className="communication-filters">
          <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT'].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">All types</option>{communicationTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Channel<select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}><option value="">All channels</option>{communicationChannels.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>

        {error ? <p className="communication-feedback error" role="alert">{error}</p> : null}
        {success ? <p className="communication-feedback success" role="status">{success}</p> : null}

        {editing ? <CommunicationEditor
          form={editing}
          students={authorizedStudents}
            fees={props.fees}
            user={props.user}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSubmit={saveDraft}
            saving={saving}
          /> : null}

        {selectedMessageId ? (() => {
          const message = messages.find((item) => item.id === selectedMessageId)
          return message ? <CommunicationReview
            message={message}
            user={props.user}
            userNames={userNames}
            rejectReason={rejectReason}
            onRejectReason={setRejectReason}
            onEdit={() => editMessage(message)}
            onOperation={runOperation}
            isReviewer={isReviewer}
          /> : null
        })() : null}

        {visibleMessages.length ? <CommunicationMessageList
          messages={visibleMessages}
          userNames={userNames}
          user={props.user}
          onSelect={(message) => {
            setSelectedMessageId(message.id)
            setEditing(null)
            setError('')
            setSuccess('')
          }}
          onEdit={editMessage}
          tab={tab}
        /> : <CommunicationEmptyState tab={tab} />}
        </div>
      </section>
    </section>
  )
}

function CommunicationEditor({ form, students, fees, user, onChange, onCancel, onSubmit, saving }: {
  form: DraftFormState
  students: Student[]
  fees: FeeState
  user: CommunicationUser
  onChange: (form: DraftFormState) => void
  onCancel: () => void
  onSubmit: (submit: boolean) => void
  saving: boolean
}) {
  const allowedStudents = students
  const selectedStudent = allowedStudents.find((student) => student.id === form.studentId)
  const allowedTypes = communicationTypes.filter((type) => canCreateCommunication(user, type))
  return (
    <form className="communication-editor" onSubmit={(event) => {
      event.preventDefault()
      onSubmit(false)
    }}>
      <div className="communication-editor-heading"><div><p className="eyebrow">{form.messageId ? 'Edit draft' : 'New message draft'}</p><h2>Message details</h2></div><button type="button" className="icon-button" aria-label="Close editor" onClick={onCancel}><X size={17} /></button></div>
      <div className="communication-form-grid">
        <label>Student<select required value={form.studentId} onChange={(event) => {
          const student = allowedStudents.find((item) => item.id === event.target.value)
          const invoice = fees.invoices.find((item) => item.studentId === student?.id && item.totalAmount > item.paidAmount)
          const nextSourceType = user.role === 'finance' ? 'FEE' : form.sourceType === 'MANUAL' ? 'STUDENT' : form.sourceType
          const nextSourceId = user.role === 'finance' ? invoice?.id ?? '' : form.sourceType === 'MANUAL' ? student?.id ?? '' : form.sourceId
          onChange({
            ...form,
            studentId: event.target.value,
            guardianId: student?.guardian.id ?? '',
            guardianName: student?.guardian.name ?? '',
            sourceType: nextSourceType,
            sourceId: nextSourceId,
            message: form.message || (user.role === 'finance' && invoice && student
              ? createFeeMessageTemplate(student, invoice.totalAmount - invoice.paidAmount, invoice.dueDate)
              : templateFor(form.type, student)),
          })
        }}><option value="">Select student</option>{allowedStudents.map((student) => <option key={student.id} value={student.id}>{student.firstName} {student.lastName} · {student.className}-{student.section}</option>)}</select></label>
        <label>Guardian<input readOnly value={selectedStudent?.guardian.name ?? form.guardianName} /></label>
        {form.studentId && !form.guardianId ? <p className="communication-feedback error" role="alert">No authorized guardian is linked to this student.</p> : null}
        <label>Message type<select required value={form.type} onChange={(event) => onChange({ ...form, type: event.target.value as CommunicationType, message: form.message || templateFor(event.target.value as CommunicationType, selectedStudent) })}>{allowedTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label>Channel<select required value={form.channel} onChange={(event) => onChange({ ...form, channel: event.target.value as CommunicationChannel })}>{communicationChannels.map((channel) => <option key={channel}>{channel}</option>)}</select></label>
        {user.role === 'finance' ? <label className="communication-message-field">Related fee invoice<select required value={form.sourceId} onChange={(event) => onChange({ ...form, sourceType: 'FEE', sourceId: event.target.value })}><option value="">Select invoice</option>{fees.invoices.filter((invoice) => invoice.studentId === form.studentId && invoice.totalAmount > invoice.paidAmount).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.month} · PKR {new Intl.NumberFormat('en-PK').format(invoice.totalAmount - invoice.paidAmount)} due {formatDate(invoice.dueDate)}</option>)}</select></label> : null}
        <label className="communication-message-field">Message<textarea required rows={7} value={form.message} onChange={(event) => onChange({ ...form, message: event.target.value })} /></label>
      </div>
      <p className="communication-template-note">Draft source: deterministic template. No AI or external messaging service is used.</p>
      <div className="communication-editor-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Cancel</button><button type="submit" className="secondary-button" disabled={saving || !form.guardianId}>{saving ? 'Saving…' : form.status === 'AWAITING_APPROVAL' ? 'Save Changes' : 'Save Draft'}</button>{form.status !== 'AWAITING_APPROVAL' ? <button type="button" className="primary-button" disabled={saving || !form.guardianId} onClick={(event) => {
        const formElement = event.currentTarget.closest('form')
        if (formElement instanceof HTMLFormElement && formElement.reportValidity()) onSubmit(true)
      }}>Submit for Approval</button> : null}</div>
    </form>
  )
}

function CommunicationMessageList({ messages, userNames, user, onSelect, onEdit, tab }: {
  messages: CommunicationMessageView[]
  userNames: Map<number, string>
  user: CommunicationUser
  onSelect: (message: CommunicationMessageView) => void
  onEdit: (message: CommunicationMessageView) => void
  tab: CommunicationTab
}) {
  return (
    <>
      <div className="communication-table-wrap">
        <table className="communication-table">
          <thead><tr><th>Student</th><th>Guardian</th><th>Type</th><th>Channel</th><th>Status</th><th>Created By</th><th>Date</th><th>Action</th></tr></thead>
          <tbody>{messages.map((message) => <tr key={message.id}>
            <td><strong>{message.student.firstName} {message.student.lastName}</strong><small>{message.student.studentId}</small></td>
            <td>{message.guardianName}</td><td>{message.type}</td><td>{message.channel}</td>
            <td><span className={`communication-status ${message.status.toLowerCase()}`}>{displayStatus(message.status)}</span></td>
            <td>{userNames.get(message.createdByUserId) ?? 'School staff'}</td><td>{formatDate(message.createdAt)}</td>
            <td><button type="button" className="text-button" onClick={() => {
              if ((message.status === 'DRAFT' || message.status === 'REJECTED') && (message.createdByUserId === user.id || user.role === 'admin')) onEdit(message)
              else onSelect(message)
            }}>{tab === 'Drafts' ? 'Edit' : 'Review'}</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="communication-mobile-list">{messages.map((message) => <article className="communication-mobile-card" key={message.id}>
        <div className="communication-mobile-heading"><div><strong>{message.student.firstName} {message.student.lastName}</strong><small>{message.student.studentId} · {message.guardianName}</small></div><span className={`communication-status ${message.status.toLowerCase()}`}>{displayStatus(message.status)}</span></div>
        <div className="communication-mobile-meta"><span>{message.type}</span><span>{message.channel}</span><span>{userNames.get(message.createdByUserId) ?? 'School staff'}</span><span>{formatDate(message.createdAt)}</span></div>
        <button type="button" className="secondary-button small-button" onClick={() => {
          if ((message.status === 'DRAFT' || message.status === 'REJECTED') && (message.createdByUserId === user.id || user.role === 'admin')) onEdit(message)
          else onSelect(message)
        }}>{tab === 'Drafts' ? 'Edit' : 'Review'}</button>
      </article>)}</div>
    </>
  )
}

function CommunicationReview({ message, user, userNames, rejectReason, onRejectReason, onEdit, onOperation, isReviewer }: {
  message: CommunicationMessageView
  user: CommunicationUser
  userNames: Map<number, string>
  rejectReason: string
  onRejectReason: (reason: string) => void
  onEdit: () => void
  onOperation: (operation: CommunicationOperation, tab?: CommunicationTab) => void
  isReviewer: boolean
}) {
  const mayEdit = ['DRAFT', 'REJECTED', 'AWAITING_APPROVAL'].includes(message.status) &&
    (message.createdByUserId === user.id || user.role === 'admin' || user.role === 'principal')
  return (
    <section className="communication-review-card">
      <div className="communication-review-heading"><div><p className="eyebrow">Message review</p><h2>{message.student.firstName} {message.student.lastName}</h2><p>{message.guardianName} · {message.type} · {message.channel}</p></div><span className={`communication-status ${message.status.toLowerCase()}`}>{displayStatus(message.status)}</span></div>
      <pre className="communication-message-body">{message.message}</pre>
      {message.rejectionReason ? <p className="communication-rejection-reason"><strong>Rejection reason:</strong> {message.rejectionReason}</p> : null}
      <div className="communication-audit-history"><strong>History</strong>{message.history.map((entry, index) => <span key={`${entry.action}-${entry.timestamp}-${index}`}>{entry.action} · {entry.userName || userNames.get(entry.userId) || 'School staff'} · {formatDateTime(entry.timestamp)}</span>)}</div>
      <div className="communication-review-actions">
        {mayEdit ? <button type="button" className="secondary-button" onClick={onEdit}>Edit</button> : null}
        {message.status === 'DRAFT' && (message.createdByUserId === user.id || user.role === 'admin') ? <button type="button" className="primary-button" onClick={() => onOperation({ type: 'submit', messageId: message.id }, 'Awaiting Approval')}>Submit for Approval</button> : null}
        {isReviewer && message.status === 'AWAITING_APPROVAL' ? <>
          <button type="button" className="secondary-button reject-button" onClick={() => onOperation({ type: 'reject', messageId: message.id, reason: rejectReason }, 'Drafts')}><X size={15} /> Reject</button>
          <label className="rejection-reason-input">Rejection reason<input value={rejectReason} onChange={(event) => onRejectReason(event.target.value)} placeholder="Optional" /></label>
          <button type="button" className="primary-button" onClick={() => onOperation({ type: 'approve', messageId: message.id }, 'Awaiting Approval')}><Check size={15} /> Approve</button>
        </> : null}
        {isReviewer && message.status === 'APPROVED' ? <button type="button" className="primary-button" onClick={() => onOperation({ type: 'send', messageId: message.id }, 'Sent')}><Send size={15} /> Mark as Sent</button> : null}
        {message.status === 'SENT' ? <span className={`delivery-result ${message.deliveryStatus?.toLowerCase()}`}>Delivery: {message.deliveryStatus}</span> : null}
      </div>
    </section>
  )
}

function buildPrefill(searchParams: URLSearchParams, students: Student[], fees: FeeState): DraftFormState | null {
  const studentId = searchParams.get('studentId') ?? ''
  if (!studentId) return null
  const student = students.find((item) => item.id === studentId)
  if (!student) return null
  const rawSource = searchParams.get('sourceType')
  const sourceType = rawSource === 'FEE' ? 'FEE' : rawSource === 'ATTENDANCE' ? 'ATTENDANCE' : 'STUDENT'
  const sourceId = searchParams.get('sourceId') ?? student.id
  const type: CommunicationType = sourceType === 'FEE' ? 'Fee Reminder' : sourceType === 'ATTENDANCE' ? 'Attendance Reminder' : 'Follow-up'
  const invoice = sourceType === 'FEE'
    ? fees.invoices.find((item) => item.id === sourceId && item.studentId === student.id)
    : undefined
  const amount = invoice ? Math.max(0, invoice.totalAmount - invoice.paidAmount) : 0
  return {
    studentId: student.id,
    guardianId: student.guardian.id ?? '',
    guardianName: student.guardian.name,
    type,
    channel: sourceType === 'FEE' ? 'Email' : 'WhatsApp',
    message: sourceType === 'FEE' && invoice
      ? createFeeMessageTemplate(student, amount, invoice.dueDate)
      : sourceType === 'ATTENDANCE'
        ? createAttendanceMessageTemplate(student, 3)
        : `Dear Parent,\nPlease contact the school regarding ${student.firstName} ${student.lastName}.`,
    sourceType,
    sourceId,
    messageId: '',
  }
}

function createBlankDraft(user: CommunicationUser): DraftFormState {
  const preferredType = user.role === 'finance' ? 'Fee Reminder' : user.role === 'teacher' ? 'Attendance Reminder' : 'General Notice'
  return {
    studentId: '',
    guardianId: '',
    guardianName: '',
    type: preferredType,
    channel: 'Email',
    message: '',
    sourceType: 'MANUAL',
    sourceId: '',
    messageId: '',
  }
}

function templateFor(type: CommunicationType, student?: Student): string {
  if (!student) return ''
  if (type === 'Attendance Reminder') return createAttendanceMessageTemplate(student, 3)
  if (type === 'Fee Reminder') return 'Dear Parent,\nPlease review the outstanding fee balance for your child. Contact the school finance office if payment has already been made.'
  if (type === 'General Notice') return `Dear Parent,\nPlease review this school update regarding ${student.firstName} ${student.lastName}.`
  return `Dear Parent,\nPlease contact the school regarding ${student.firstName} ${student.lastName}.`
}

function CommunicationMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <article className={`communication-metric ${tone}`}><span>{label}</span><strong>{value}</strong></article>
}

function CommunicationEmptyState({ tab }: { tab: CommunicationTab }) {
  const text = tab === 'Drafts' ? 'No message drafts yet.' : tab === 'Awaiting Approval' ? 'No messages are awaiting approval.' : 'No messages have been sent yet.'
  return <div className="communication-empty"><div className="communication-empty-icon"><MessageSquareText size={20} /></div><strong>{text}</strong></div>
}

function CommunicationLoadingState() {
  return <section className="communication-page" aria-label="Loading communication"><div className="skeleton communication-heading-skeleton" /><div className="communication-summary-grid">{[1, 2, 3, 4].map((item) => <div className="skeleton communication-card-skeleton" key={item} />)}</div><div className="skeleton communication-list-skeleton" /></section>
}

function CommunicationErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <section className="communication-error"><div className="communication-empty-icon"><AlertTriangle size={20} /></div><h1>We couldn't load communication.</h1><p>{error}</p><button type="button" className="primary-button small-button" onClick={onRetry}>Try Again</button></section>
}

function displayStatus(status: CommunicationStatus): string {
  return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date))
}

function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(date))
}

function localDateKey(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
