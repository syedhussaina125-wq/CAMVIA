import { useState, useMemo, type FormEvent } from 'react'
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
}: {
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
}) {
  const canEdit = user.role === 'admin'
  const [schoolForm, setSchoolForm] = useState<Partial<Pick<SchoolSettingsRecord, 'name' | 'short_name' | 'email' | 'phone' | 'address' | 'timezone'>>>({})
  const [campusId, setCampusId] = useState('')
  const [campusForm, setCampusForm] = useState<Partial<Pick<CampusSettingsRecord, 'name' | 'code' | 'address' | 'status'>>>({})
  const [schoolSaving, setSchoolSaving] = useState(false)
  const [campusSaving, setCampusSaving] = useState(false)
  const [schoolError, setSchoolError] = useState('')
  const [campusError, setCampusError] = useState('')
  const [schoolSaved, setSchoolSaved] = useState(false)
  const [campusSaved, setCampusSaved] = useState(false)
  const selectedCampusId = campusId || snapshot?.campuses[0]?.id || ''
  const selectedCampus = snapshot?.campuses.find((campus) => campus.id === selectedCampusId) ?? null

  const handleSchoolSave = async (event: FormEvent) => {
    event.preventDefault()
    setSchoolError('')
    setSchoolSaved(false)
    setSchoolSaving(true)
    try {
      await onSaveSchool({
        name: (schoolForm.name ?? snapshot?.school.name ?? '').trim(),
        short_name: (schoolForm.short_name ?? snapshot?.school.short_name ?? '').trim(),
        email: (schoolForm.email ?? snapshot?.school.email ?? '').trim() || null,
        phone: (schoolForm.phone ?? snapshot?.school.phone ?? '').trim() || null,
        address: (schoolForm.address ?? snapshot?.school.address ?? '').trim() || null,
        timezone: (schoolForm.timezone ?? snapshot?.school.timezone ?? '').trim() || null,
      })
      setSchoolSaved(true)
    } catch (saveError) {
      setSchoolError(saveError instanceof Error ? saveError.message : 'Unable to save school settings.')
    } finally {
      setSchoolSaving(false)
    }
  }

  const handleCampusSave = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedCampus) return
    setCampusError('')
    setCampusSaved(false)
    setCampusSaving(true)
    try {
      await onSaveCampus(selectedCampus.id, {
        name: (campusForm.name ?? selectedCampus.name).trim(),
        code: (campusForm.code ?? selectedCampus.code).trim(),
        address: (campusForm.address ?? selectedCampus.address ?? '').trim() || null,
        status: campusForm.status ?? selectedCampus.status,
      })
      setCampusSaved(true)
    } catch (saveError) {
      setCampusError(saveError instanceof Error ? saveError.message : 'Unable to save campus settings.')
    } finally {
      setCampusSaving(false)
    }
  }

  return (
    <section className="dashboard-page">
      <div className="panel-header flex-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Administration &amp; Settings</h1>
          <p className="student-muted">{canEdit ? 'Changes are saved to this school in Supabase.' : 'Settings are read-only for your role.'}</p>
        </div>
      </div>

      {loading ? <div className="empty-state-card" role="status">Loading school settings…</div> : null}
      {!loading && error ? <div className="empty-state-card error-card" role="alert"><p>{error}</p><button type="button" className="primary-button small-button" onClick={onRetry}>Try again</button></div> : null}
      {!loading && !error && !snapshot ? <div className="empty-state-card">School settings are not available.</div> : null}

      {!loading && !error && snapshot ? (
        <>
          <div className="dashboard-grid">
            <div className="panel-card">
              <div className="panel-header">
                <div>
                  <h3>School profile</h3>
                  <p className="student-muted" style={{ margin: '4px 0 0' }}>Core organizational details and global school parameters.</p>
                </div>
              </div>
              <form className="user-form" onSubmit={handleSchoolSave}>
                <label><span>School name</span><input required maxLength={160} disabled={!canEdit || schoolSaving} value={schoolForm.name ?? snapshot.school.name} onChange={(event) => setSchoolForm((current) => ({ ...current, name: event.target.value }))} /></label>
                <label><span>Short name</span><input required maxLength={80} disabled={!canEdit || schoolSaving} value={schoolForm.short_name ?? snapshot.school.short_name} onChange={(event) => setSchoolForm((current) => ({ ...current, short_name: event.target.value }))} /></label>
                <label><span>Email</span><input type="email" maxLength={254} disabled={!canEdit || schoolSaving} value={schoolForm.email ?? snapshot.school.email ?? ''} onChange={(event) => setSchoolForm((current) => ({ ...current, email: event.target.value }))} /></label>
                <label><span>Phone</span><input maxLength={40} disabled={!canEdit || schoolSaving} value={schoolForm.phone ?? snapshot.school.phone ?? ''} onChange={(event) => setSchoolForm((current) => ({ ...current, phone: event.target.value }))} /></label>
                <label><span>Address</span><input maxLength={240} disabled={!canEdit || schoolSaving} value={schoolForm.address ?? snapshot.school.address ?? ''} onChange={(event) => setSchoolForm((current) => ({ ...current, address: event.target.value }))} /></label>
                <label><span>Timezone</span><input maxLength={80} disabled={!canEdit || schoolSaving} value={schoolForm.timezone ?? snapshot.school.timezone ?? ''} onChange={(event) => setSchoolForm((current) => ({ ...current, timezone: event.target.value }))} /></label>
                {canEdit ? <button type="submit" className="primary-button admin-save-btn" disabled={schoolSaving}>{schoolSaving ? 'Saving…' : 'Save school settings'}</button> : null}
                {schoolError ? <p className="communication-feedback error" role="alert">{schoolError}</p> : null}
                {schoolSaved ? <p className="communication-feedback success" role="status">School settings saved successfully.</p> : null}
                <p className="student-muted" style={{ fontSize: '12px' }}>Last updated {new Date(snapshot.school.updated_at).toLocaleString()}.</p>
              </form>
            </div>

            <div className="panel-card">
              <div className="panel-header">
                <div>
                  <h3>Campus settings</h3>
                  <p className="student-muted" style={{ margin: '4px 0 0' }}>Campus metadata, operational identifiers, and lifecycle state.</p>
                </div>
              </div>
              {snapshot.campuses.length ? (
                <>
                  <label className="campus-selector-field"><span>Select campus</span><select disabled={campusSaving} value={selectedCampusId} onChange={(event) => { setCampusId(event.target.value); setCampusForm({}); setCampusSaved(false); setCampusError('') }}>{snapshot.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name} · {campus.code}</option>)}</select></label>
                  {selectedCampus ? (
                    <form className="user-form" onSubmit={handleCampusSave}>
                      <label><span>Campus name</span><input required maxLength={160} disabled={!canEdit || campusSaving} value={campusForm.name ?? selectedCampus.name} onChange={(event) => setCampusForm((current) => ({ ...current, name: event.target.value }))} /></label>
                      <label><span>Campus code</span><input required maxLength={40} disabled={!canEdit || campusSaving} value={campusForm.code ?? selectedCampus.code} onChange={(event) => setCampusForm((current) => ({ ...current, code: event.target.value }))} /></label>
                      <label><span>Address</span><input maxLength={240} disabled={!canEdit || campusSaving} value={campusForm.address ?? selectedCampus.address ?? ''} onChange={(event) => setCampusForm((current) => ({ ...current, address: event.target.value }))} /></label>
                      <label><span>Status</span><select disabled={!canEdit || campusSaving} value={campusForm.status ?? selectedCampus.status} onChange={(event) => setCampusForm((current) => ({ ...current, status: event.target.value as CampusSettingsRecord['status'] }))}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
                      {canEdit ? <button type="submit" className="primary-button admin-save-btn" disabled={campusSaving}>{campusSaving ? 'Saving…' : 'Save campus'}</button> : null}
                      {campusError ? <p className="communication-feedback error" role="alert">{campusError}</p> : null}
                      {campusSaved ? <p className="communication-feedback success" role="status">Campus settings saved successfully.</p> : null}
                    </form>
                  ) : null}
                </>
              ) : <p className="student-muted">No campus records are available in this school.</p>}
            </div>
          </div>

          <div className="panel-card" style={{ marginTop: '24px' }}>
            <div className="panel-header">
              <div>
                <h3>Integration metadata</h3>
                <p className="student-muted" style={{ margin: '4px 0 0' }}>Configuration metadata for delivery channels (Email, SMS, WhatsApp).</p>
              </div>
            </div>
            {snapshot.integrations.length ? (
              <div className="table-card">
                <table>
                  <thead><tr><th>Provider</th><th>Status</th><th>Non-secret identifier</th></tr></thead>
                  <tbody>{snapshot.integrations.map((item) => {
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
                  })}</tbody>
                </table>
              </div>
            ) : <p className="student-muted">No integration metadata is configured.</p>}
          </div>
        </>
      ) : null}

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
}: {
  user: SessionUser
  profiles: SchoolUser[]
  campuses: CampusSettingsRecord[]
  loading: boolean
  error: string
  onRetry: () => void
  onInviteUser: (input: SchoolUserInput) => Promise<void>
  onUpdateUser: (targetUserId: string, input: SchoolUserInput) => Promise<void>
  onDeactivateUser: (targetUserId: string) => Promise<void>
}) {
  const canManageUsers = user.role === 'admin'
  return (
    <section className="users-page">
      <div className="panel-header flex-header">
        <div>
          <p className="eyebrow">Access management</p>
          <h1>Users</h1>
          <p className="student-muted">{canManageUsers ? 'Manage school accounts and their authorized class scopes.' : 'Profile roles, campus, and account status are read-only for your role.'}</p>
        </div>
      </div>
      {loading ? <div className="empty-state-card" role="status">Loading profiles…</div> : null}
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

function UserManagementTable({
  currentUserId,
  profiles,
  campuses,
  canManage,
  onInviteUser,
  onUpdateUser,
  onDeactivateUser,
}: {
  currentUserId: string
  profiles: SchoolUser[]
  campuses: CampusSettingsRecord[]
  canManage: boolean
  onInviteUser: (input: SchoolUserInput) => Promise<void>
  onUpdateUser: (targetUserId: string, input: SchoolUserInput) => Promise<void>
  onDeactivateUser: (targetUserId: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [editing, setEditing] = useState<SchoolUser | null>(null)
  const [creating, setCreating] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [form, setForm] = useState<UserEditorState>({
    fullName: '',
    email: '',
    role: 'teacher',
    status: 'Active',
    campusId: campuses[0]?.id ?? '',
    assignments: [],
  })
  const [assignmentDraft, setAssignmentDraft] = useState({ campusId: campuses[0]?.id ?? '', className: '', section: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
    setError('')
    setForm({ fullName: '', email: '', role: 'teacher', status: 'Active', campusId: campuses[0]?.id ?? '', assignments: [] })
  }

  const openEdit = (profile: SchoolUser) => {
    setEditing(profile)
    setCreating(false)
    setReactivating(false)
    setError('')
    setForm({
      fullName: profile.name,
      email: profile.email,
      role: profile.role,
      status: profile.status,
      campusId: profile.campusId ?? '',
      assignments: (profile.assignmentScopes ?? []).map((scope) => ({
        campus_id: scope.campusId,
        class_name: scope.className,
        section: scope.section,
      })),
    })
  }

  const openReactivate = (profile: SchoolUser) => {
    if (!profile.authUserId) return
    setEditing(profile)
    setCreating(false)
    setReactivating(true)
    setError('')
    setForm({
      fullName: profile.name,
      email: profile.email,
      role: profile.role,
      status: 'Active',
      campusId: profile.campusId ?? '',
      assignments: (profile.assignmentScopes ?? [])
        .filter((scope) => scope.active)
        .map((scope) => ({
          campus_id: scope.campusId,
          class_name: scope.className,
          section: scope.section,
        })),
    })
  }

  const addAssignment = () => {
    const next = {
      campus_id: assignmentDraft.campusId,
      class_name: assignmentDraft.className.trim(),
      section: assignmentDraft.section.trim(),
    }
    if (!next.campus_id || !next.class_name || !next.section) {
      setError('Select a campus and enter a class and section before adding the assignment.')
      return
    }
    if (form.assignments.some((scope) => scope.campus_id === next.campus_id && scope.class_name === next.class_name && scope.section === next.section)) {
      setError('That teacher assignment has already been added.')
      return
    }
    setError('')
    setForm((current) => ({ ...current, assignments: [...current.assignments, next] }))
    setAssignmentDraft((current) => ({ ...current, className: '', section: '' }))
  }

  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
  const assignmentScopeKey = (scope: TeacherAssignmentScope) => `${scope.campus_id}|${scope.class_name.trim()}|${scope.section.trim()}`
  const originalAssignmentScopeKeys = editing ? (editing.assignmentScopes ?? []).map((scope) => assignmentScopeKey({ campus_id: scope.campusId, class_name: scope.className, section: scope.section })) : []
  const currentAssignmentScopeKeys = form.assignments.map((scope) => assignmentScopeKey(scope))
  const hasUserChanges = creating || !editing || (
    form.fullName.trim() !== editing.name.trim()
    || form.email.trim().toLowerCase() !== editing.email.trim().toLowerCase()
    || form.role !== editing.role
    || form.status !== editing.status
    || (form.campusId ?? '') !== (editing.campusId ?? '')
    || currentAssignmentScopeKeys.length !== originalAssignmentScopeKeys.length
    || currentAssignmentScopeKeys.some((scopeKey) => !originalAssignmentScopeKeys.includes(scopeKey))
  )
  const saveDisabled = saving || !form.fullName.trim() || !emailIsValid || (form.role === 'teacher' && form.status === 'Active' && form.assignments.length === 0) || (!creating && editing !== null && !hasUserChanges)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
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
      if (creating) await onInviteUser(input)
      else if (editing?.authUserId) await onUpdateUser(editing.authUserId, input)
      else throw new Error('This profile is missing its authenticated user ID and cannot be edited.')
      setCreating(false)
      setEditing(null)
      setReactivating(false)
      setForm({ fullName: '', email: '', role: 'teacher', status: 'Active', campusId: campuses[0]?.id ?? '', assignments: [] })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save user changes.')
    } finally {
      setSaving(false)
    }
  }

  const deactivate = async (profile: SchoolUser) => {
    if (!profile.authUserId || profile.authUserId === currentUserId) return
    if (!window.confirm('Deactivate this user? They will lose access, and their historical records will be retained.')) return
    setError('')
    setSaving(true)
    try {
      await onDeactivateUser(profile.authUserId)
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : 'Unable to deactivate this user.')
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
      <>
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
          <>
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
          </>
        ) : <div className="empty-state-card">{profiles.length ? 'No users match these filters.' : 'No profiles are visible in your authorized scope.'}</div>}
      </>

      {error && !creating && !editing ? <p className="communication-feedback error" role="alert">{error}</p> : null}
      {creating || editing ? (
        <div className="user-modal-backdrop" role="presentation">
          <section className="user-modal" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
            <div className="user-modal-heading">
              <div><p className="eyebrow">Access management</p><h2 id="user-modal-title">{creating ? 'Add User' : reactivating ? 'Reactivate User' : 'Edit User'}</h2></div>
              <button type="button" className="icon-button" aria-label="Close user form" disabled={saving} onClick={() => { setCreating(false); setEditing(null); setReactivating(false); setError('') }}>×</button>
            </div>
            <form className="user-editor-form" onSubmit={(event) => void submit(event)}>
              <label>Full name<input required maxLength={160} disabled={saving} value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} /></label>
              <label>Email<input required type="email" maxLength={254} disabled={saving} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
              <label>Role<select disabled={saving || (!creating && editing?.authUserId === currentUserId)} value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as Role, assignments: event.target.value === 'teacher' ? current.assignments : [] }))}>
                <option value="admin">Admin</option><option value="principal">Principal</option><option value="finance">Finance</option><option value="teacher">Teacher</option>
              </select></label>
              <label>Status<select disabled={saving || (!creating && editing?.authUserId === currentUserId)} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as UserStatus }))}>
                <option value="Active">Active</option><option value="Inactive">Inactive</option>
              </select></label>
              <label>Campus<select disabled={saving || (!creating && editing?.authUserId === currentUserId)} value={form.campusId} onChange={(event) => setForm((current) => ({ ...current, campusId: event.target.value }))}>
                <option value="">No campus assigned</option>{campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
              </select></label>
              {form.role === 'teacher' ? (
                <div className="teacher-scope-editor">
                  <h3>Teacher class assignments</h3>
                  <p>{reactivating ? 'Previously inactive assignments are not restored automatically. Add the current campus, class, and section scopes this teacher should receive.' : 'Active teachers must have at least one campus, class, and section assigned.'}</p>
                  {form.assignments.map((scope, index) => (
                    <div className="teacher-scope-row" key={`${scope.campus_id}-${scope.class_name}-${scope.section}-${index}`}>
                      <span>{campuses.find((campus) => campus.id === scope.campus_id)?.name ?? 'Campus'} · {scope.class_name} · {scope.section}</span>
                      <button type="button" className="user-deactivate-button" disabled={saving || (!creating && editing?.authUserId === currentUserId)} onClick={() => setForm((current) => ({ ...current, assignments: current.assignments.filter((_, rowIndex) => rowIndex !== index) }))}>Remove</button>
                    </div>
                  ))}
                  <div className="teacher-scope-inputs">
                    <select aria-label="Assignment campus" disabled={saving || (!creating && editing?.authUserId === currentUserId) || campuses.length === 0} value={assignmentDraft.campusId} onChange={(event) => setAssignmentDraft((current) => ({ ...current, campusId: event.target.value }))}>
                      <option value="">Select campus</option>{campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
                    </select>
                    <input aria-label="Assignment class" placeholder="Class" maxLength={100} disabled={saving || (!creating && editing?.authUserId === currentUserId)} value={assignmentDraft.className} onChange={(event) => setAssignmentDraft((current) => ({ ...current, className: event.target.value }))} />
                    <input aria-label="Assignment section" placeholder="Section" maxLength={40} disabled={saving || (!creating && editing?.authUserId === currentUserId)} value={assignmentDraft.section} onChange={(event) => setAssignmentDraft((current) => ({ ...current, section: event.target.value }))} />
                    <button type="button" className="secondary-button compact-button" disabled={saving || (!creating && editing?.authUserId === currentUserId)} onClick={addAssignment}>Add scope</button>
                  </div>
                </div>
              ) : null}
              {error ? <p className="communication-feedback error" role="alert">{error}</p> : null}
              {creating ? <p className="user-invite-note">The account is created through Supabase Auth and an invitation email is sent. The user sets their own password.</p> : null}
              <div className="user-modal-actions">
                <button type="button" className="secondary-button compact-button" disabled={saving} onClick={() => { setCreating(false); setEditing(null); setReactivating(false); setError('') }}>Cancel</button>
                <button type="submit" className="primary-button compact-button" disabled={saveDisabled}>{saving ? 'Saving…' : creating ? 'Send invitation' : reactivating ? 'Reactivate user' : 'Save changes'}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  )
}
