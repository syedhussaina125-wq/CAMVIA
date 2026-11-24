import { useState, useMemo, type SubmitEvent } from 'react'
import { FileSpreadsheet, Plus, Search } from 'lucide-react'
import type { Role, SchoolUser, SessionUser, UserStatus } from './mockData'
import type {
  AdministrationSnapshot,
  CampusSettingsRecord,
  SchoolSettingsRecord,
} from './services/administration'
import type { SchoolUserInput, TeacherAssignmentScope } from './services/userManagement'

const roleLabels: Record<Role, string> = {
  admin: 'Admin / School Owner',
  principal: 'Principal',
  finance: 'Finance Manager',
  teacher: 'Teacher',
}

type SchoolProfileCardProps = Readonly<{
  school: SchoolSettingsRecord
  canEdit: boolean
  onSaveSchool: (values: Pick<SchoolSettingsRecord, 'name' | 'short_name' | 'email' | 'phone' | 'address' | 'timezone'>) => Promise<void>
}>

function SchoolProfileCard({ school, canEdit, onSaveSchool }: SchoolProfileCardProps) {
  const [form, setForm] = useState<Partial<Pick<SchoolSettingsRecord, 'name' | 'short_name' | 'email' | 'phone' | 'address' | 'timezone'>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSaved(false)
    setSaving(true)
    try {
      await onSaveSchool({
        name: (form.name ?? school.name).trim(),
        short_name: (form.short_name ?? school.short_name).trim(),
        email: (form.email ?? school.email ?? '').trim() || null,
        phone: (form.phone ?? school.phone ?? '').trim() || null,
        address: (form.address ?? school.address ?? '').trim() || null,
        timezone: (form.timezone ?? school.timezone ?? '').trim() || null,
      })
      setSaved(true)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save school settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel-card">
      <div className="panel-header">
        <div>
          <h3>School profile</h3>
          <p className="student-muted" style={{ margin: '4px 0 0' }}>Core organizational details and global school parameters.</p>
        </div>
      </div>
      <form className="user-form" onSubmit={handleSubmit}>
        <label><span>School name</span><input required maxLength={160} disabled={!canEdit || saving} value={form.name ?? school.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
        <label><span>Short name</span><input required maxLength={80} disabled={!canEdit || saving} value={form.short_name ?? school.short_name} onChange={(event) => setForm((current) => ({ ...current, short_name: event.target.value }))} /></label>
        <label><span>Email</span><input type="email" maxLength={254} disabled={!canEdit || saving} value={form.email ?? school.email ?? ''} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
        <label><span>Phone</span><input maxLength={40} disabled={!canEdit || saving} value={form.phone ?? school.phone ?? ''} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></label>
        <label><span>Address</span><input maxLength={240} disabled={!canEdit || saving} value={form.address ?? school.address ?? ''} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} /></label>
        <label><span>Timezone</span><input maxLength={80} disabled={!canEdit || saving} value={form.timezone ?? school.timezone ?? ''} onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))} /></label>
        {canEdit ? <button type="submit" className="primary-button admin-save-btn" disabled={saving}>{saving ? 'Saving…' : 'Save school settings'}</button> : null}
        {error ? <p className="communication-feedback error" role="alert">{error}</p> : null}
        {saved ? <output className="communication-feedback success">School settings saved successfully.</output> : null}
        <p className="student-muted" style={{ fontSize: '12px' }}>Last updated {new Date(school.updated_at).toLocaleString()}.</p>
      </form>
    </div>
  )
}

type CampusSettingsCardProps = Readonly<{
  campuses: CampusSettingsRecord[]
  canEdit: boolean
  onSaveCampus: (campusId: string, values: Pick<CampusSettingsRecord, 'name' | 'code' | 'address' | 'status'>) => Promise<void>
}>

type CampusSettingsFormProps = Readonly<{
  campus: CampusSettingsRecord
  canEdit: boolean
  onSave: (campusId: string, values: Pick<CampusSettingsRecord, 'name' | 'code' | 'address' | 'status'>) => Promise<void>
}>

function CampusSettingsForm({ campus, canEdit, onSave }: CampusSettingsFormProps) {
  const [form, setForm] = useState<Partial<Pick<CampusSettingsRecord, 'name' | 'code' | 'address' | 'status'>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSaved(false)
    setSaving(true)
    try {
      const addressValue = (form.address ?? campus.address ?? '').trim()
      await onSave(campus.id, {
        name: (form.name ?? campus.name).trim(),
        code: (form.code ?? campus.code).trim(),
        address: addressValue || null,
        status: form.status ?? campus.status,
      })
      setSaved(true)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save campus settings.')
    } finally {
      setSaving(false)
    }
  }

  const isFieldDisabled = !canEdit || saving

  return (
    <form className="user-form" onSubmit={handleSubmit}>
      <label>
        <span>Campus name</span>
        <input
          required
          maxLength={160}
          disabled={isFieldDisabled}
          value={form.name ?? campus.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        />
      </label>
      <label>
        <span>Campus code</span>
        <input
          required
          maxLength={40}
          disabled={isFieldDisabled}
          value={form.code ?? campus.code}
          onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
        />
      </label>
      <label>
        <span>Address</span>
        <input
          maxLength={240}
          disabled={isFieldDisabled}
          value={form.address ?? campus.address ?? ''}
          onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
        />
      </label>
      <label>
        <span>Status</span>
        <select
          disabled={isFieldDisabled}
          value={form.status ?? campus.status}
          onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as CampusSettingsRecord['status'] }))}
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </label>
      {canEdit ? (
        <button type="submit" className="primary-button admin-save-btn" disabled={saving}>
          {saving ? 'Saving…' : 'Save campus'}
        </button>
      ) : null}
      {error ? <p className="communication-feedback error" role="alert">{error}</p> : null}
      {saved ? <output className="communication-feedback success">Campus settings saved successfully.</output> : null}
    </form>
  )
}

function CampusSettingsCard({ campuses, canEdit, onSaveCampus }: CampusSettingsCardProps) {
  const [campusId, setCampusId] = useState('')

  const selectedCampusId = campusId || campuses[0]?.id || ''
  const selectedCampus = campuses.find((campus) => campus.id === selectedCampusId) ?? null

  if (!campuses.length) {
    return (
      <div className="panel-card">
        <div className="panel-header">
          <div>
            <h3>Campus settings</h3>
            <p className="student-muted" style={{ margin: '4px 0 0' }}>Campus metadata, operational identifiers, and lifecycle state.</p>
          </div>
        </div>
        <p className="student-muted">No campus records are available in this school.</p>
      </div>
    )
  }

  return (
    <div className="panel-card">
      <div className="panel-header">
        <div>
          <h3>Campus settings</h3>
          <p className="student-muted" style={{ margin: '4px 0 0' }}>Campus metadata, operational identifiers, and lifecycle state.</p>
        </div>
      </div>
      <label className="campus-selector-field">
        <span>Select campus</span>
        <select
          value={selectedCampusId}
          onChange={(event) => setCampusId(event.target.value)}
        >
          {campuses.map((campus) => (
            <option key={campus.id} value={campus.id}>{campus.name} · {campus.code}</option>
          ))}
        </select>
      </label>
      {selectedCampus ? (
        <CampusSettingsForm
          key={selectedCampus.id}
          campus={selectedCampus}
          canEdit={canEdit}
          onSave={onSaveCampus}
        />
      ) : null}
    </div>
  )
}

type IntegrationMetadataCardProps = Readonly<{
  integrations: AdministrationSnapshot['integrations']
}>

function IntegrationMetadataCard({ integrations }: IntegrationMetadataCardProps) {
  return (
    <div className="panel-card" style={{ marginTop: '24px' }}>
      <div className="panel-header">
        <div>
          <h3>Integration metadata</h3>
          <p className="student-muted" style={{ margin: '4px 0 0' }}>Configuration metadata for delivery channels (Email, SMS, WhatsApp).</p>
        </div>
      </div>
      {integrations.length ? (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Status</th>
                <th>Non-secret identifier</th>
              </tr>
            </thead>
            <tbody>
              {integrations.map((item) => {
                const isConfigured = item.status === 'CONFIGURED'
                return (
                  <tr key={item.id}>
                    <td><strong>{item.provider_key}</strong></td>
                    <td>
                      <span className={`status-pill ${isConfigured ? 'success' : 'muted'}`}>
                        {item.status === 'NOT_CONFIGURED' ? 'Not configured' : item.status.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td><code>{item.external_identifier ?? '—'}</code></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="student-muted">No integration metadata is configured.</p>
      )}
    </div>
  )
}

function ImportHistoryCard() {
  return (
    <div className="panel-card" style={{ marginTop: '24px' }}>
      <div className="panel-header">
        <div>
          <h3>Import history</h3>
          <p className="student-muted" style={{ margin: '4px 0 0' }}>Roster ingestion audit log and historical file upload batch records.</p>
        </div>
      </div>
      <div className="empty-state">
        <div className="empty-state-icon">
          <FileSpreadsheet size={28} />
        </div>
        <h3>No imports yet</h3>
        <p>No live import-history records are available. CSV upload currently supports preview only; it does not import records or create an integration connection.</p>
      </div>
    </div>
  )
}

export function AdministrationPage({
  user,
  snapshot,
  loading,
  error,
  profiles,
  profilesLoading,
  profilesError,
  onRetryProfiles,
  onRetry,
  onSaveSchool,
  onSaveCampus,
  onInviteUser,
  onUpdateUser,
  onDeactivateUser,
}: Readonly<{
  user: SessionUser
  snapshot: AdministrationSnapshot | null
  loading: boolean
  error: string
  profiles: SchoolUser[]
  profilesLoading: boolean
  profilesError: string
  onRetryProfiles: () => void
  onRetry: () => void
  onSaveSchool: (values: Pick<SchoolSettingsRecord, 'name' | 'short_name' | 'email' | 'phone' | 'address' | 'timezone'>) => Promise<void>
  onSaveCampus: (campusId: string, values: Pick<CampusSettingsRecord, 'name' | 'code' | 'address' | 'status'>) => Promise<void>
  onInviteUser: (input: SchoolUserInput) => Promise<void>
  onUpdateUser: (targetUserId: string, input: SchoolUserInput) => Promise<void>
  onDeactivateUser: (targetUserId: string) => Promise<void>
}>) {
  const canEdit = user.role === 'admin'

  return (
    <section className="dashboard-page">
      <div className="panel-header flex-header">
        <div>
          <h1>Administration &amp; Settings</h1>
          <p className="student-muted">{canEdit ? 'Changes are saved to this school in Supabase.' : 'Settings are read-only for your role.'}</p>
        </div>
      </div>

      {loading ? <output className="empty-state-card">Loading school settings…</output> : null}
      {!loading && error ? <div className="empty-state-card error-card" role="alert"><p>{error}</p><button type="button" className="primary-button small-button" onClick={onRetry}>Try again</button></div> : null}
      {!loading && !error && !snapshot ? <div className="empty-state-card">School settings are not available.</div> : null}

      {!loading && !error && snapshot ? (
        <>
          <div className="dashboard-grid">
            <SchoolProfileCard school={snapshot.school} canEdit={canEdit} onSaveSchool={onSaveSchool} />
            <CampusSettingsCard campuses={snapshot.campuses} canEdit={canEdit} onSaveCampus={onSaveCampus} />
          </div>
          <IntegrationMetadataCard integrations={snapshot.integrations} />
        </>
      ) : null}

      <ImportHistoryCard />

      {canEdit ? (
        <ProfilesDirectoryPage
          user={user}
          profiles={profiles}
          campuses={snapshot?.campuses ?? []}
          loading={profilesLoading}
          error={profilesError}
          onRetry={onRetryProfiles}
          onInviteUser={onInviteUser}
          onUpdateUser={onUpdateUser}
          onDeactivateUser={onDeactivateUser}
        />
      ) : null}
    </section>
  )
}

export function ProfilesDirectoryPage({
  user,
  profiles,
  campuses,
  loading,
  error,
  onRetry,
  onInviteUser,
  onUpdateUser,
  onDeactivateUser,
}: Readonly<{
  user: SessionUser
  profiles: SchoolUser[]
  campuses: CampusSettingsRecord[]
  loading: boolean
  error: string
  onRetry: () => void
  onInviteUser: (input: SchoolUserInput) => Promise<void>
  onUpdateUser: (targetUserId: string, input: SchoolUserInput) => Promise<void>
  onDeactivateUser: (targetUserId: string) => Promise<void>
}>) {
  const canManageUsers = user.role === 'admin'
  return (
    <section className="users-page">
      <div className="panel-header flex-header">
        <div>
          <h1>Users</h1>
          <p className="student-muted">{canManageUsers ? 'Manage school accounts and their authorized class scopes.' : 'Profile roles, campus, and account status are read-only for your role.'}</p>
        </div>
      </div>
      {loading ? <output className="empty-state-card">Loading profiles…</output> : null}
      {!loading && error ? <div className="empty-state-card error-card" role="alert"><p>{error}</p><button type="button" className="primary-button small-button" onClick={onRetry}>Try again</button></div> : null}
      {!loading && !error && profiles.length === 0 && !canManageUsers ? <div className="empty-state-card">No profiles are visible in your authorized scope.</div> : null}
      {!loading && !error ? (
        <UserManagementTable
          currentUserId={user.authUserId}
          profiles={profiles}
          campuses={campuses}
          canManage={canManageUsers}
          onInviteUser={onInviteUser}
          onUpdateUser={onUpdateUser}
          onDeactivateUser={onDeactivateUser}
        />
      ) : null}
    </section>
  )
}

type UserEditorState = {
  fullName: string
  email: string
  role: Role
  status: UserStatus
  campusId: string
  assignments: TeacherAssignmentScope[]
}

type TeacherScopeEditorProps = Readonly<{
  campuses: CampusSettingsRecord[]
  assignments: TeacherAssignmentScope[]
  disabled: boolean
  isReactivating: boolean
  onAdd: (scope: TeacherAssignmentScope) => void
  onRemove: (index: number) => void
}>

function TeacherScopeEditor({
  campuses,
  assignments,
  disabled,
  isReactivating,
  onAdd,
  onRemove,
}: TeacherScopeEditorProps) {
  const [draft, setDraft] = useState({ campusId: campuses[0]?.id ?? '', className: '', section: '' })
  const [error, setError] = useState('')

  const handleAdd = () => {
    const campusId = draft.campusId
    const className = draft.className.trim()
    const section = draft.section.trim()

    if (!campusId || !className || !section) {
      setError('Select a campus and enter a class and section before adding the assignment.')
      return
    }
    setError('')
    onAdd({ campus_id: campusId, class_name: className, section })
    setDraft((current) => ({ ...current, className: '', section: '' }))
  }

  return (
    <div className="teacher-scope-editor">
      <h3>Teacher class assignments</h3>
      <p>{isReactivating ? 'Previously inactive assignments are not restored automatically. Add the current campus, class, and section scopes this teacher should receive.' : 'Active teachers must have at least one campus, class, and section assigned.'}</p>
      {assignments.map((scope, index) => (
        <div className="teacher-scope-row" key={`${scope.campus_id}-${scope.class_name}-${scope.section}-${index}`}>
          <span>{campuses.find((campus) => campus.id === scope.campus_id)?.name ?? 'Campus'} · {scope.class_name} · {scope.section}</span>
          <button type="button" className="user-deactivate-button" disabled={disabled} onClick={() => onRemove(index)}>Remove</button>
        </div>
      ))}
      <div className="teacher-scope-inputs">
        <select aria-label="Assignment campus" disabled={disabled || campuses.length === 0} value={draft.campusId} onChange={(event) => setDraft((current) => ({ ...current, campusId: event.target.value }))}>
          <option value="">Select campus</option>{campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
        </select>
        <input aria-label="Assignment class" placeholder="Class" maxLength={100} disabled={disabled} value={draft.className} onChange={(event) => setDraft((current) => ({ ...current, className: event.target.value }))} />
        <input aria-label="Assignment section" placeholder="Section" maxLength={40} disabled={disabled} value={draft.section} onChange={(event) => setDraft((current) => ({ ...current, section: event.target.value }))} />
        <button type="button" className="secondary-button compact-button" disabled={disabled} onClick={handleAdd}>Add scope</button>
      </div>
      {error ? <p className="communication-feedback error" role="alert">{error}</p> : null}
    </div>
  )
}

type UserEditModalProps = Readonly<{
  creating: boolean
  reactivating: boolean
  editing: SchoolUser | null
  currentUserId: string
  campuses: CampusSettingsRecord[]
  onClose: () => void
  onSave: (input: SchoolUserInput, targetAuthUserId?: string) => Promise<void>
}>

function UserEditModal({
  creating,
  reactivating,
  editing,
  currentUserId,
  campuses,
  onClose,
  onSave,
}: UserEditModalProps) {
  const [form, setForm] = useState<UserEditorState>(() => {
    if (editing) {
      return {
        fullName: editing.name,
        email: editing.email,
        role: editing.role,
        status: reactivating ? 'Active' : editing.status,
        campusId: editing.campusId ?? '',
        assignments: (editing.assignmentScopes ?? [])
          .filter((scope) => !reactivating || scope.active)
          .map((scope) => ({
            campus_id: scope.campusId,
            class_name: scope.className,
            section: scope.section,
          })),
      }
    }
    return {
      fullName: '',
      email: '',
      role: 'teacher',
      status: 'Active',
      campusId: campuses[0]?.id ?? '',
      assignments: [],
    }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
  const isSelf = !creating && editing?.authUserId === currentUserId
  const isFieldDisabled = saving || isSelf

  const hasUserChanges = useMemo(() => {
    if (creating || !editing) return true
    if (form.fullName.trim() !== editing.name.trim()) return true
    if (form.email.trim().toLowerCase() !== editing.email.trim().toLowerCase()) return true
    if (form.role !== editing.role) return true
    if (form.status !== editing.status) return true
    if ((form.campusId ?? '') !== (editing.campusId ?? '')) return true

    const assignmentKey = (scope: { campus_id: string; class_name: string; section: string }) =>
      `${scope.campus_id}|${scope.class_name.trim()}|${scope.section.trim()}`
    const originalKeys = (editing.assignmentScopes ?? []).map((scope) =>
      assignmentKey({ campus_id: scope.campusId, class_name: scope.className, section: scope.section })
    )
    const currentKeys = form.assignments.map(assignmentKey)
    if (currentKeys.length !== originalKeys.length) return true
    return currentKeys.some((key) => !originalKeys.includes(key))
  }, [creating, editing, form])

  const saveDisabled = saving
    || !form.fullName.trim()
    || !emailIsValid
    || (form.role === 'teacher' && form.status === 'Active' && form.assignments.length === 0)
    || (!creating && editing !== null && !hasUserChanges)

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const trimmedFullName = form.fullName.trim()
    const trimmedEmail = form.email.trim()

    if (!trimmedFullName) {
      setError('Full name is required.')
      return
    }
    if (!trimmedEmail || !emailIsValid) {
      setError('Enter a valid email address.')
      return
    }
    if (form.role === 'teacher' && form.status === 'Active' && form.assignments.length === 0) {
      setError('Add at least one campus, class, and section before activating a teacher.')
      return
    }
    if (!creating && editing && !hasUserChanges) {
      setError('No changes were made. Nothing to save.')
      return
    }

    setSaving(true)
    const input: SchoolUserInput = {
      fullName: trimmedFullName,
      email: trimmedEmail,
      role: form.role,
      status: form.status,
      campusId: form.campusId || null,
      assignments: form.role === 'teacher' ? form.assignments : [],
    }

    try {
      if (creating) {
        await onSave(input)
      } else if (editing?.authUserId) {
        await onSave(input, editing.authUserId)
      } else {
        throw new Error('This profile is missing its authenticated user ID and cannot be edited.')
      }
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save user changes.')
    } finally {
      setSaving(false)
    }
  }

  const handleAddAssignment = (scope: TeacherAssignmentScope) => {
    if (form.assignments.some((s) => s.campus_id === scope.campus_id && s.class_name === scope.class_name && s.section === scope.section)) {
      setError('That teacher assignment has already been added.')
      return
    }
    setError('')
    setForm((current) => ({ ...current, assignments: [...current.assignments, scope] }))
  }

  const handleRemoveAssignment = (index: number) => {
    setForm((current) => ({ ...current, assignments: current.assignments.filter((_, rowIndex) => rowIndex !== index) }))
  }

  return (
    <div className="user-modal-backdrop" role="presentation">
      <section className="user-modal" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
        <div className="user-modal-heading">
          <div><h2 id="user-modal-title">{creating ? 'Add User' : reactivating ? 'Reactivate User' : 'Edit User'}</h2></div>
          <button type="button" className="icon-button" aria-label="Close user form" disabled={saving} onClick={onClose}>×</button>
        </div>
        <form className="user-editor-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>Full name<input required maxLength={160} disabled={saving} value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} /></label>
          <label>Email<input required type="email" maxLength={254} disabled={saving} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
          <label>Role<select disabled={isFieldDisabled} value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as Role, assignments: event.target.value === 'teacher' ? current.assignments : [] }))}>
            <option value="admin">Admin</option><option value="principal">Principal</option><option value="finance">Finance</option><option value="teacher">Teacher</option>
          </select></label>
          <label>Status<select disabled={isFieldDisabled} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as UserStatus }))}>
            <option value="Active">Active</option><option value="Inactive">Inactive</option>
          </select></label>
          <label>Campus<select disabled={isFieldDisabled} value={form.campusId} onChange={(event) => setForm((current) => ({ ...current, campusId: event.target.value }))}>
            <option value="">No campus assigned</option>{campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
          </select></label>
          {form.role === 'teacher' ? (
            <TeacherScopeEditor
              campuses={campuses}
              assignments={form.assignments}
              disabled={isFieldDisabled}
              isReactivating={reactivating}
              onAdd={handleAddAssignment}
              onRemove={handleRemoveAssignment}
            />
          ) : null}
          {error ? <p className="communication-feedback error" role="alert">{error}</p> : null}
          {creating ? <p className="user-invite-note">The account is created through Supabase Auth and an invitation email is sent. The user sets their own password.</p> : null}
          <div className="user-modal-actions">
            <button type="button" className="secondary-button compact-button" disabled={saving} onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button compact-button" disabled={saveDisabled}>{saving ? 'Saving…' : creating ? 'Send invitation' : reactivating ? 'Reactivate user' : 'Save changes'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function UserManagementTable({
  currentUserId,
  profiles,
  campuses,
  canManage,
  onInviteUser,
  onUpdateUser,
  onDeactivateUser,
}: Readonly<{
  currentUserId: string
  profiles: SchoolUser[]
  campuses: CampusSettingsRecord[]
  canManage: boolean
  onInviteUser: (input: SchoolUserInput) => Promise<void>
  onUpdateUser: (targetUserId: string, input: SchoolUserInput) => Promise<void>
  onDeactivateUser: (targetUserId: string) => Promise<void>
}>) {
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [editing, setEditing] = useState<SchoolUser | null>(null)
  const [creating, setCreating] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tableError, setTableError] = useState('')

  const filteredProfiles = useMemo(() => profiles.filter((profile) => {
    const searchable = `${profile.name} ${profile.email}`.toLowerCase()
    return searchable.includes(query.trim().toLowerCase())
      && (!roleFilter || profile.role === roleFilter)
      && (!statusFilter || profile.status === statusFilter)
  }), [profiles, query, roleFilter, statusFilter])

  const openAdd = () => {
    setEditing(null)
    setCreating(true)
    setReactivating(false)
    setTableError('')
  }

  const openEdit = (profile: SchoolUser) => {
    setEditing(profile)
    setCreating(false)
    setReactivating(false)
    setTableError('')
  }

  const openReactivate = (profile: SchoolUser) => {
    if (!profile.authUserId) return
    setEditing(profile)
    setCreating(false)
    setReactivating(true)
    setTableError('')
  }

  const closeModal = () => {
    setCreating(false)
    setEditing(null)
    setReactivating(false)
  }

  const handleSaveModal = async (input: SchoolUserInput, targetAuthUserId?: string) => {
    if (creating) {
      await onInviteUser(input)
    } else if (targetAuthUserId) {
      await onUpdateUser(targetAuthUserId, input)
    }
  }

  const deactivate = async (profile: SchoolUser) => {
    if (!profile.authUserId || profile.authUserId === currentUserId) return
    if (!window.confirm('Deactivate this user? They will lose access, and their historical records will be retained.')) return
    setTableError('')
    setSaving(true)
    try {
      await onDeactivateUser(profile.authUserId)
    } catch (deactivateError) {
      setTableError(deactivateError instanceof Error ? deactivateError.message : 'Unable to deactivate this user.')
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return (
      <div className="table-card user-directory-table">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Campus</th><th>Status</th></tr></thead>
          <tbody>{filteredProfiles.map((profile) => (
            <tr key={profile.authUserId ?? profile.email}>
              <td>{profile.name}</td><td>{profile.email}</td><td>{roleLabels[profile.role]}</td><td>{profile.campus}</td>
              <td><span className={`status-pill ${profile.status === 'Active' ? 'success' : 'muted'}`}>{profile.status}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="user-management">
      <div className="user-directory-toolbar">
        <label className="user-directory-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or email…" aria-label="Search users" />
        </label>
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label="Filter users by role">
          <option value="">All roles</option>
          <option value="admin">Admin</option>
          <option value="principal">Principal</option>
          <option value="finance">Finance</option>
          <option value="teacher">Teacher</option>
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter users by status">
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
        <span className="user-count">{filteredProfiles.length} of {profiles.length} users</span>
        <button type="button" className="primary-button add-user-button" onClick={openAdd}>
          <Plus size={16} /> Add User
        </button>
      </div>
      {filteredProfiles.length ? (
        <div className="table-card user-directory-table">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Campus</th><th>Actions</th></tr></thead>
            <tbody>{filteredProfiles.map((profile) => {
              const isSelf = profile.authUserId === currentUserId
              return (
                <tr key={profile.authUserId ?? profile.email}>
                  <td><strong>{profile.name}</strong>{isSelf ? <small className="current-user-label">You</small> : null}</td>
                  <td>{profile.email}</td>
                  <td>{roleLabels[profile.role]}</td>
                  <td><span className={`status-pill ${profile.status === 'Active' ? 'success' : 'muted'}`}>{profile.status}</span></td>
                  <td>{profile.campus}</td>
                  <td><div className="user-row-actions">
                    <button type="button" className="secondary-button compact-button" disabled={!profile.authUserId || saving} onClick={() => openEdit(profile)}>Edit</button>
                    {profile.status === 'Inactive' ? (
                      <button type="button" className="primary-button compact-button" disabled={saving || !profile.authUserId} onClick={() => openReactivate(profile)}>Reactivate</button>
                    ) : (
                      <button type="button" className="danger-button compact-button user-deactivate-btn" disabled={isSelf || saving || !profile.authUserId} onClick={() => void deactivate(profile)}>Deactivate</button>
                    )}
                  </div></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      ) : <div className="empty-state-card">{profiles.length ? 'No users match these filters.' : 'No profiles are visible in your authorized scope.'}</div>}

      {tableError ? <p className="communication-feedback error" role="alert">{tableError}</p> : null}
      {creating || editing ? (
        <UserEditModal
          creating={creating}
          reactivating={reactivating}
          editing={editing}
          currentUserId={currentUserId}
          campuses={campuses}
          onClose={closeModal}
          onSave={handleSaveModal}
        />
      ) : null}
    </div>
  )
}
