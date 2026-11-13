import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, Check, Copy, Download, LoaderCircle, QrCode, X } from 'lucide-react'
import { useParams } from 'react-router-dom'
import camviaLogo from './assets/camvia-dark-logo.png'
import {
  approveAdmissionApplication,
  createSchoolRegistrationLink,
  editAdmissionApplication,
  fetchAdmissionApplications,
  getSchoolRegistrationLink,
  lookupPublicRegistration,
  rejectAdmissionApplication,
  setSchoolRegistrationEnabled,
  submitPublicRegistration,
  RegistrationLinkServiceError,
  type AdmissionApplication,
  type AdmissionApplicationDetails,
  type PublicRegistrationDetails,
  type SchoolRegistrationLink,
} from './services/admissions'
import { normalizeWhatsAppPhone } from './utils/whatsapp'
import type { Student } from './studentData'
import { fetchSchoolStudentsForDuplicateCheck, type StudentCampusOption } from './services/students'
import { checkStudentDuplicate, studentToCandidate, type StudentCandidate } from './utils/studentDuplicates'
import { formatRpcErrorMessage } from './utils/errorMapping'

const emptyDetails: PublicRegistrationDetails = {
  studentName: '',
  dateOfBirth: '',
  gender: '',
  applyingClass: '',
  preferredSection: '',
  guardianName: '',
  guardianRelationship: '',
  guardianPhone: '',
  whatsappPhone: '',
  guardianEmail: '',
  guardianAddress: '',
  secondaryGuardianName: '',
  secondaryGuardianRelationship: '',
  secondaryGuardianPhone: '',
  secondaryGuardianEmail: '',
}
const today = new Date()
const registrationMaxDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

export function PublicRegistrationPage() {
  const { token = '' } = useParams()
  return <PublicRegistrationForm key={token} token={token} />
}

function PublicRegistrationForm({ token }: { token: string }) {
  const [schoolName, setSchoolName] = useState('')
  const [lookupStatus, setLookupStatus] = useState<'LOADING' | 'ACTIVE' | 'DISABLED' | 'INVALID' | 'ERROR'>('LOADING')
  const [lookupAttempt, setLookupAttempt] = useState(0)
  const [details, setDetails] = useState(emptyDetails)
  const [honeypot, setHoneypot] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [applicationReference, setApplicationReference] = useState('')
  const submissionKey = useRef<string>('')

  useEffect(() => {
    let active = true
    void lookupPublicRegistration(token)
      .then((result) => {
        if (!active) return
        setLookupStatus(result.status)
        if (result.status === 'ACTIVE') setSchoolName(result.schoolName)
      })
      .catch(() => {
        if (active) setLookupStatus('ERROR')
      })
    return () => { active = false }
  }, [token, lookupAttempt])

  const update = (key: keyof PublicRegistrationDetails, value: string) => {
    setDetails((current) => ({ ...current, [key]: value }))
    setFieldError('')
    setSubmitError('')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFieldError('')
    setSubmitError('')

    if (!details.studentName.trim() || !details.dateOfBirth || !details.applyingClass.trim()
      || !details.guardianName.trim() || !details.guardianRelationship.trim() || !details.guardianPhone.trim()) {
      setFieldError('Please complete the required fields.')
      return
    }
    if (new Date(`${details.dateOfBirth}T00:00:00`) >= new Date(new Date().toDateString())) {
      setFieldError('Please enter a valid date of birth.')
      return
    }
    if ([details.guardianEmail, details.secondaryGuardianEmail].some((email) =>
      email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()),
    )) {
      setFieldError('Please enter a valid email address.')
      return
    }
    const hasSecondaryGuardian = Boolean(details.secondaryGuardianName.trim()
      || details.secondaryGuardianRelationship.trim()
      || details.secondaryGuardianPhone.trim()
      || details.secondaryGuardianEmail.trim())
    if (hasSecondaryGuardian && (!details.secondaryGuardianName.trim() || !details.secondaryGuardianRelationship.trim())) {
      setFieldError('Enter the secondary guardian’s name and relationship, or leave all secondary guardian fields blank.')
      return
    }
    const guardianPhone = normalizeWhatsAppPhone(details.guardianPhone)
    const whatsappPhone = details.whatsappPhone.trim() ? normalizeWhatsAppPhone(details.whatsappPhone) : ''
    const secondaryGuardianPhone = details.secondaryGuardianPhone.trim()
      ? normalizeWhatsAppPhone(details.secondaryGuardianPhone)
      : ''
    if (!guardianPhone || whatsappPhone === null || secondaryGuardianPhone === null) {
      setFieldError('Please enter a valid mobile number.')
      return
    }
    setSubmitting(true)
    try {
      if (!submissionKey.current) submissionKey.current = crypto.randomUUID()
      const reference = await submitPublicRegistration(token, submissionKey.current, {
        ...details,
        studentName: details.studentName.trim(),
        dateOfBirth: details.dateOfBirth,
        applyingClass: details.applyingClass.trim(),
        preferredSection: details.preferredSection.trim(),
        guardianName: details.guardianName.trim(),
        guardianRelationship: details.guardianRelationship.trim(),
        guardianPhone,
        whatsappPhone,
        guardianEmail: details.guardianEmail.trim(),
        guardianAddress: details.guardianAddress.trim(),
        secondaryGuardianName: details.secondaryGuardianName.trim(),
        secondaryGuardianRelationship: details.secondaryGuardianRelationship.trim(),
        secondaryGuardianPhone,
        secondaryGuardianEmail: details.secondaryGuardianEmail.trim(),
      }, honeypot)
      setApplicationReference(reference)
    } catch {
      setSubmitError('We couldn’t submit the registration. Please review the information and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="public-registration-page">
      <header className="public-registration-brand">
        <img src={camviaLogo} alt="CAMVIA" />
        <span>Smarter Schools. Brighter Futures.</span>
      </header>
      {lookupStatus === 'LOADING' ? (
        <section className="public-registration-card" role="status">Loading registration form...</section>
      ) : lookupStatus === 'INVALID' ? (
        <section className="public-registration-card public-registration-invalid" role="alert">
          <h1>Registration link unavailable</h1>
          <p>This registration link is invalid.</p>
        </section>
      ) : lookupStatus === 'DISABLED' ? (
        <section className="public-registration-card public-registration-invalid" role="alert">
          <h1>Registration link unavailable</h1>
          <p>This registration link is no longer active.</p>
        </section>
      ) : lookupStatus === 'ERROR' ? (
        <section className="public-registration-card public-registration-invalid" role="alert">
          <h1>Registration form unavailable</h1>
          <p>Unable to load the registration link. Please try again.</p>
          <button type="button" className="secondary-button small-button" onClick={() => {
            setLookupStatus('LOADING')
            setLookupAttempt((attempt) => attempt + 1)
          }}>
            Try again
          </button>
        </section>
      ) : applicationReference ? (
        <section className="public-registration-card public-registration-success" role="status">
          <div className="registration-success-icon"><Check size={24} /></div>
          <p className="eyebrow">Registration submitted</p>
          <h1>Thank you</h1>
          <p>Your child’s information has been submitted to {schoolName} for review. This is not an admission approval.</p>
          <div className="registration-reference">
            <span>Application Reference</span>
            <strong>{applicationReference}</strong>
          </div>
        </section>
      ) : (
        <section className="public-registration-card">
          <div className="public-registration-title">
            <p className="eyebrow">{schoolName}</p>
            <h1>Student Registration</h1>
            <p>Please complete the form below to submit your child’s information to {schoolName} for review.</p>
          </div>
          <form className="public-registration-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
            <fieldset>
              <legend>Student Information</legend>
              <label>Student full name <span aria-hidden="true">*</span>
                <input required autoComplete="name" maxLength={160} value={details.studentName} onChange={(event) => update('studentName', event.target.value)} />
              </label>
              <div className="public-registration-grid">
                <label>Date of birth <span aria-hidden="true">*</span>
                  <input required type="date" max={registrationMaxDate} value={details.dateOfBirth} onChange={(event) => update('dateOfBirth', event.target.value)} />
                </label>
                <label>Gender
                  <select value={details.gender} onChange={(event) => update('gender', event.target.value)}>
                    <option value="">Select (optional)</option><option>Female</option><option>Male</option><option>Prefer not to say</option>
                  </select>
                </label>
                <label>Applying class / grade <span aria-hidden="true">*</span>
                  <input required maxLength={100} value={details.applyingClass} onChange={(event) => update('applyingClass', event.target.value)} />
                </label>
                <label>Preferred section
                  <input maxLength={40} value={details.preferredSection} onChange={(event) => update('preferredSection', event.target.value)} />
                </label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Primary Guardian Information</legend>
              <div className="public-registration-grid">
                <label>Guardian full name <span aria-hidden="true">*</span>
                  <input required autoComplete="name" maxLength={160} value={details.guardianName} onChange={(event) => update('guardianName', event.target.value)} />
                </label>
                <label>Relationship to student <span aria-hidden="true">*</span>
                  <input required maxLength={60} placeholder="e.g. Mother, Father, Guardian" value={details.guardianRelationship} onChange={(event) => update('guardianRelationship', event.target.value)} />
                </label>
                <label>Mobile number <span aria-hidden="true">*</span>
                  <input required type="tel" inputMode="tel" autoComplete="tel" maxLength={24} placeholder="0300 1234567" value={details.guardianPhone} onChange={(event) => update('guardianPhone', event.target.value)} />
                </label>
                <label>WhatsApp number (if different)
                  <input type="tel" inputMode="tel" maxLength={24} placeholder="Optional" value={details.whatsappPhone} onChange={(event) => update('whatsappPhone', event.target.value)} />
                </label>
                <label className="registration-grid-full">Email address
                  <input type="email" autoComplete="email" maxLength={254} value={details.guardianEmail} onChange={(event) => update('guardianEmail', event.target.value)} />
                </label>
                <label className="registration-grid-full">Address
                  <input autoComplete="street-address" maxLength={300} value={details.guardianAddress} onChange={(event) => update('guardianAddress', event.target.value)} />
                </label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Secondary Guardian (Optional)</legend>
              <div className="public-registration-grid">
                <label>Guardian full name
                  <input maxLength={160} value={details.secondaryGuardianName} onChange={(event) => update('secondaryGuardianName', event.target.value)} />
                </label>
                <label>Relationship to student
                  <input maxLength={60} value={details.secondaryGuardianRelationship} onChange={(event) => update('secondaryGuardianRelationship', event.target.value)} />
                </label>
                <label>Phone number
                  <input type="tel" inputMode="tel" maxLength={24} value={details.secondaryGuardianPhone} onChange={(event) => update('secondaryGuardianPhone', event.target.value)} />
                </label>
                <label>Email address
                  <input type="email" autoComplete="email" maxLength={254} value={details.secondaryGuardianEmail} onChange={(event) => update('secondaryGuardianEmail', event.target.value)} />
                </label>
              </div>
            </fieldset>

            <label className="registration-honeypot" aria-hidden="true" tabIndex={-1}>
              Leave this field empty
              <input autoComplete="off" tabIndex={-1} value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
            </label>
            <p className="registration-required-note">Fields marked * are required. Your information will be sent to the school for review.</p>
            {fieldError ? <p className="communication-feedback error" role="alert">{fieldError}</p> : null}
            {submitError ? <p className="communication-feedback error" role="alert">{submitError}</p> : null}
            <button type="submit" className="primary-button registration-submit" disabled={submitting}>
              {submitting ? <><LoaderCircle size={17} className="registration-spinner" /> Submitting…</> : 'Submit Registration'}
            </button>
          </form>
        </section>
      )}
      <footer className="public-registration-footer">Powered by CAMVIA</footer>
    </main>
  )
}

export function ParentRegistrationLinkModal({ onClose }: { onClose: () => void }) {
  const [registration, setRegistration] = useState<SchoolRegistrationLink | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [loadError, setLoadError] = useState<'configuration' | 'server' | null>(null)
  const [savingStatus, setSavingStatus] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let active = true
    void getSchoolRegistrationLink()
      .then((value) => {
        if (!active) return
        setRegistration(value)
        setLoadError(null)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setLoadError(cause instanceof RegistrationLinkServiceError && cause.kind === 'configuration'
          ? 'configuration'
          : 'server')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [loadAttempt])

  const publicOrigin = import.meta.env.PROD ? 'https://camvia.elvaveo.com' : window.location.origin
  const url = registration
    ? `${publicOrigin}/register/${registration.registrationToken}`
    : ''

  useEffect(() => {
    if (!url) return
    let active = true
    void import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(url, { width: 256, margin: 2, errorCorrectionLevel: 'M' }))
      .then((dataUrl) => { if (active) setQrDataUrl(dataUrl) })
      .catch(() => { if (active) setError('Unable to generate a QR code for this link.') })
    return () => { active = false }
  }, [url])

  const handleCopy = async () => {
    setError('')
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy the link. Select and copy the URL manually.')
    }
  }

  const handleCreate = async () => {
    setCreating(true)
    setLoadError(null)
    setError('')
    try {
      setRegistration(await createSchoolRegistrationLink())
    } catch (cause) {
      setLoadError(cause instanceof RegistrationLinkServiceError && cause.kind === 'configuration'
        ? 'configuration'
        : 'server')
    } finally {
      setCreating(false)
    }
  }

  const handleRetry = () => {
    setRegistration(null)
    setLoadError(null)
    setLoading(true)
    setLoadAttempt((attempt) => attempt + 1)
  }

  const handleToggle = async () => {
    if (!registration) return
    setSavingStatus(true)
    setError('')
    try {
      setRegistration(await setSchoolRegistrationEnabled(!registration.enabled))
    } catch {
      setError('Unable to update registration link status. Please try again.')
    } finally {
      setSavingStatus(false)
    }
  }

  const handlePrint = () => {
    const resetPrintMode = () => document.body.classList.remove('registration-qr-print')
    document.body.classList.add('registration-qr-print')
    window.addEventListener('afterprint', resetPrintMode, { once: true })
    window.print()
  }

  return (
    <div className="registration-modal-backdrop" role="presentation">
      <section className="registration-link-modal" role="dialog" aria-modal="true" aria-labelledby="registration-link-title">
        <header className="registration-modal-heading">
          <div><p className="eyebrow">Parent admissions</p><h2 id="registration-link-title">Parent Registration Link</h2></div>
          <button type="button" className="icon-button" aria-label="Close registration link" onClick={onClose}><X size={18} /></button>
        </header>
        {loading ? <p role="status">Loading registration link...</p> : registration ? (
          <>
            <p className="registration-school-name">{registration.schoolName}</p>
            <div className={`registration-link-status ${registration.enabled ? 'is-active' : 'is-disabled'}`}>
              Status: <strong>{registration.enabled ? 'Active' : 'Disabled'}</strong>
            </div>
            <label className="registration-link-field">Public registration URL
              <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <div className="registration-link-actions">
              <button type="button" className="secondary-button small-button" onClick={() => void handleCopy()}>
                {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy Link'}
              </button>
              <a className="secondary-button small-button" href={url} target="_blank" rel="noopener noreferrer">
                <ArrowUpRight size={16} /> Open Form
              </a>
            </div>
            <div className="registration-qr-section">
              {qrDataUrl ? <img src={qrDataUrl} alt="QR code for the public registration form" /> : <div className="registration-qr-placeholder"><QrCode size={28} /></div>}
              <div>
                <strong>Share the QR code</strong>
                <p>Parents can scan it to open the form.</p>
                <div className="registration-link-actions">
                  {qrDataUrl
                    ? <a className="secondary-button small-button" href={qrDataUrl} download="camvia-registration-qr.png"><Download size={16} /> Download QR</a>
                    : <button type="button" className="secondary-button small-button" disabled><Download size={16} /> Download QR</button>}
                  <button type="button" className="secondary-button small-button" onClick={handlePrint} disabled={!qrDataUrl}>Print QR</button>
                </div>
              </div>
            </div>
            <div className="registration-link-bottom">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Dear Parent,\n\nPlease use the following link to submit your child's registration details for ${registration.schoolName}:\n\n${url}\n\nThank you.`)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Share on WhatsApp
              </a>
              <button type="button" className="secondary-button small-button" onClick={() => void handleToggle()} disabled={savingStatus}>
                {savingStatus ? 'Updating…' : registration.enabled ? 'Disable Link' : 'Enable Link'}
              </button>
            </div>
          </>
        ) : loadError === 'configuration' ? (
          <p role="alert">Registration link configuration is incomplete.</p>
        ) : loadError === 'server' ? (
          <>
            <p role="alert">Unable to load the registration link. Please try again.</p>
            <button type="button" className="secondary-button small-button" onClick={handleRetry}>Try again</button>
          </>
        ) : (
          <>
            <p role="status">No registration link has been created yet.</p>
            <button type="button" className="primary-button small-button" onClick={() => void handleCreate()} disabled={creating}>
              {creating ? 'Creating link…' : 'Create Registration Link'}
            </button>
          </>
        )}
        {error ? <p className="communication-feedback error" role="alert">{error}</p> : null}
      </section>
    </div>
  )
}

export function PendingAdmissionsPanel({
  students,
  campuses,
  onRefreshStudents,
}: {
  students: Student[]
  campuses: StudentCampusOption[]
  onRefreshStudents: () => void
}) {
  const [applications, setApplications] = useState<AdmissionApplication[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState(false)
  const [editDetails, setEditDetails] = useState<AdmissionApplicationDetails | null>(null)
  const [campusId, setCampusId] = useState('')
  const [rollNumber, setRollNumber] = useState('')
  const [section, setSection] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [confirmingRejection, setConfirmingRejection] = useState(false)
  const [working, setWorking] = useState(false)
  const selectedIdRef = useRef(selectedId)
  const selected = applications.find((application) => application.id === selectedId) ?? null
  const pendingCount = applications.filter((application) => application.status === 'PENDING').length
  const selectedCampusId = campusId || campuses[0]?.id || ''

  const selectApplication = useCallback((application: AdmissionApplication | null) => {
    const nextSelectedId = application?.id ?? ''
    selectedIdRef.current = nextSelectedId
    setSelectedId(nextSelectedId)
    setEditing(false)
    setActionError('')
    setMessage('')
    setEditDetails(application ? {
      student_name: application.student_name,
      date_of_birth: application.date_of_birth,
      gender: application.gender,
      applying_class: application.applying_class,
      preferred_section: application.preferred_section,
      guardian_name: application.guardian_name,
      guardian_relationship: application.guardian_relationship,
      guardian_phone: application.guardian_phone,
      whatsapp_phone: application.whatsapp_phone,
      guardian_email: application.guardian_email,
      guardian_address: application.guardian_address,
      secondary_guardian_name: application.secondary_guardian_name,
      secondary_guardian_relationship: application.secondary_guardian_relationship,
      secondary_guardian_phone: application.secondary_guardian_phone,
      secondary_guardian_email: application.secondary_guardian_email,
    } : null)
    setCampusId((current) => campuses.some((campus) => campus.id === current) ? current : campuses[0]?.id ?? '')
    setRollNumber('')
    setSection(application?.preferred_section ?? '')
    setRejectionReason('')
  }, [campuses])

  const loadApplications = useCallback(() => fetchAdmissionApplications(), [])

  const refresh = useCallback(async () => {
    try {
      const rows = await loadApplications()
      setLoadError('')
      setApplications(rows)
      const current = rows.find((row) => row.id === selectedIdRef.current && row.status === 'PENDING')
      selectApplication(current ?? rows.find((row) => row.status === 'PENDING') ?? rows[0] ?? null)
    } catch {
      setLoadError('Unable to load pending admissions. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [loadApplications, selectApplication])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const rows = await loadApplications()
        if (!active) return
        setLoadError('')
        setApplications(rows)
        const current = rows.find((row) => row.id === selectedIdRef.current && row.status === 'PENDING')
        selectApplication(current ?? rows.find((row) => row.status === 'PENDING') ?? rows[0] ?? null)
      } catch {
        if (active) setLoadError('Unable to load pending admissions. Please try again.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [loadApplications, selectApplication])

  const updateEdit = (key: keyof AdmissionApplicationDetails, value: string) => {
    setEditDetails((current) => current ? { ...current, [key]: value } : current)
    setActionError('')
  }

  const saveEdit = async () => {
    if (!selected || !editDetails) return
    setWorking(true)
    setActionError('')
    setMessage('')
    try {
      const guardianPhone = normalizeWhatsAppPhone(editDetails.guardian_phone)
      const whatsappPhone = editDetails.whatsapp_phone ? normalizeWhatsAppPhone(editDetails.whatsapp_phone) : ''
      const secondaryGuardianPhone = editDetails.secondary_guardian_phone
        ? normalizeWhatsAppPhone(editDetails.secondary_guardian_phone)
        : ''
      if (!guardianPhone || (editDetails.whatsapp_phone && !whatsappPhone)
        || (editDetails.secondary_guardian_phone && !secondaryGuardianPhone)) {
        setActionError('Please enter a valid guardian mobile number.')
        return
      }
      const payload = {
        ...editDetails,
        guardian_phone: guardianPhone,
        whatsapp_phone: whatsappPhone,
        secondary_guardian_phone: secondaryGuardianPhone,
      }
      await editAdmissionApplication(selected.id, payload)
      setApplications((current) => current.map((row) => row.id === selected.id
        ? { ...row, ...payload }
        : row))
      setEditing(false)
      setMessage('Application changes saved and recorded.')
    } catch {
      setActionError('Unable to save application changes. Please check the required fields and try again.')
    } finally {
      setWorking(false)
    }
  }

  const approve = async () => {
    if (!selected) return
    setActionError('')
    setMessage('')

    let existingCandidates: StudentCandidate[] = students.map(studentToCandidate)
    try {
      const fullList = await fetchSchoolStudentsForDuplicateCheck()
      if (fullList.length > 0) existingCandidates = fullList
    } catch {
      // fallback to in-memory students
    }

    const nameParts = selected.student_name.trim().split(/\s+/)
    const candidate: StudentCandidate = {
      studentId: selected.application_reference,
      firstName: nameParts[0] ?? '',
      lastName: nameParts.slice(1).join(' ') || nameParts[0] || '',
      className: selected.applying_class,
      section: section.trim(),
      rollNumber: rollNumber.trim() || null,
      dateOfBirth: selected.date_of_birth,
    }

    const duplicate = checkStudentDuplicate(candidate, existingCandidates)
    if (duplicate.isDuplicate && duplicate.message) {
      setActionError(duplicate.message)
      return
    }

    if (!selectedCampusId || !section.trim()) {
      setActionError('Select a campus and section before approving this student.')
      return
    }
    setWorking(true)
    try {
      await approveAdmissionApplication(selected.id, selectedCampusId, rollNumber.trim(), section.trim())
      await refresh()
      setMessage('Application approved and student created.')
      onRefreshStudents()
    } catch (error) {
      setActionError(formatRpcErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  const reject = async () => {
    if (!selected) return
    if (!rejectionReason.trim()) {
      setActionError('Enter a rejection reason before rejecting this application.')
      return
    }
    setWorking(true)
    setActionError('')
    setMessage('')
    try {
      await rejectAdmissionApplication(selected.id, rejectionReason.trim())
      await refresh()
      setConfirmingRejection(false)
      setMessage('Application rejected and moved to Trash. It can be restored to Pending Admissions.')
    } catch {
      setActionError('Unable to reject this application. Refresh the list and try again.')
    } finally {
      setWorking(false)
    }
  }

  const editableField = (
    label: string,
    key: keyof AdmissionApplicationDetails,
    type = 'text',
    required = false,
  ) => (
    <label key={key}>{label}
      <input
        type={type}
        required={required}
        value={editDetails?.[key] ?? ''}
        onChange={(event) => updateEdit(key, event.target.value)}
      />
    </label>
  )

  if (loading) return <section className="pending-admissions-panel" role="status">Loading admissions…</section>

  return (
    <section className="pending-admissions-panel">
      <div className="pending-admissions-heading">
        <div><p className="eyebrow">Admissions review</p><h2>Pending Admissions</h2><p>{pendingCount} application{pendingCount === 1 ? '' : 's'} awaiting review</p></div>
        <button type="button" className="secondary-button small-button" onClick={() => void refresh()}>Refresh</button>
      </div>
      {loadError ? <p className="communication-feedback error" role="alert">{loadError}</p> : null}
      <div className="pending-admissions-layout">
        <div className="pending-admissions-list">
          {applications.length === 0 ? <p className="student-muted">No applications have been submitted.</p> : applications.map((application) => (
            <button
              type="button"
              key={application.id}
              className={`pending-admission-card ${selectedId === application.id ? 'is-selected' : ''}`}
              onClick={() => selectApplication(application)}
            >
              <span className={`admission-status admission-${application.status.toLowerCase()}`}>{application.status}</span>
              <strong>{application.student_name}</strong>
              <span>{application.applying_class}{application.preferred_section ? ` · ${application.preferred_section}` : ''}</span>
              <span>{application.guardian_name} · {application.guardian_phone}</span>
              <small>{new Date(application.submitted_at).toLocaleDateString()} · {application.application_reference}</small>
            </button>
          ))}
        </div>
        {selected ? (
          <article className="pending-admission-detail">
            <div className="pending-detail-title">
              <div><p className="eyebrow">{selected.application_reference}</p><h3>{selected.student_name}</h3></div>
              <span className={`admission-status admission-${selected.status.toLowerCase()}`}>{selected.status}</span>
            </div>
            <p className="admission-submitted-date">Submitted {new Date(selected.submitted_at).toLocaleString()} · Parent registration</p>
            {editing && selected.status === 'PENDING' && editDetails ? (
              <div className="admission-edit-form">
                {editableField('Student full name', 'student_name', 'text', true)}
                {editableField('Date of birth', 'date_of_birth', 'date', true)}
                {editableField('Gender', 'gender')}
                {editableField('Applying class', 'applying_class', 'text', true)}
                {editableField('Preferred section', 'preferred_section')}
                {editableField('Guardian name', 'guardian_name', 'text', true)}
                {editableField('Relationship', 'guardian_relationship', 'text', true)}
                {editableField('Mobile number', 'guardian_phone', 'tel', true)}
                {editableField('WhatsApp number', 'whatsapp_phone', 'tel')}
                {editableField('Email address', 'guardian_email', 'email')}
                {editableField('Address', 'guardian_address')}
                {editableField('Secondary guardian name', 'secondary_guardian_name')}
                {editableField('Secondary guardian relationship', 'secondary_guardian_relationship')}
                {editableField('Secondary guardian phone', 'secondary_guardian_phone', 'tel')}
                {editableField('Secondary guardian email', 'secondary_guardian_email', 'email')}
                <div className="student-form-actions">
                  <button type="button" className="secondary-button small-button" disabled={working} onClick={() => setEditing(false)}>Cancel edit</button>
                  <button type="button" className="primary-button small-button" disabled={working} onClick={() => void saveEdit()}>{working ? 'Saving…' : 'Save Edits'}</button>
                </div>
              </div>
            ) : (
              <dl className="admission-details">
                <div><dt>Date of birth</dt><dd>{selected.date_of_birth}</dd></div>
                <div><dt>Applying class</dt><dd>{selected.applying_class}</dd></div>
                <div><dt>Preferred section</dt><dd>{selected.preferred_section || 'Not specified'}</dd></div>
                <div><dt>Gender</dt><dd>{selected.gender || 'Not specified'}</dd></div>
                <div><dt>Guardian</dt><dd>{selected.guardian_name} · {selected.guardian_relationship}</dd></div>
                <div><dt>Mobile</dt><dd>{selected.guardian_phone}</dd></div>
                {selected.whatsapp_phone ? <div><dt>WhatsApp</dt><dd>{selected.whatsapp_phone}</dd></div> : null}
                {selected.guardian_email ? <div><dt>Email</dt><dd>{selected.guardian_email}</dd></div> : null}
                {selected.guardian_address ? <div><dt>Address</dt><dd>{selected.guardian_address}</dd></div> : null}
                {selected.secondary_guardian_name ? <div><dt>Secondary guardian</dt><dd>{selected.secondary_guardian_name} · {selected.secondary_guardian_relationship}</dd></div> : null}
                {selected.secondary_guardian_phone ? <div><dt>Secondary phone</dt><dd>{selected.secondary_guardian_phone}</dd></div> : null}
                {selected.secondary_guardian_email ? <div><dt>Secondary email</dt><dd>{selected.secondary_guardian_email}</dd></div> : null}
              </dl>
            )}
            {selected.status === 'REJECTED' && selected.rejection_reason ? <p className="admission-rejection-reason"><strong>Rejection reason:</strong> {selected.rejection_reason}</p> : null}
            {selected.status === 'APPROVED' ? <p className="admission-approved-note">Created student record using this application reference.</p> : null}
            {selected.status === 'PENDING' && !editing ? (
              <>
                <div className="admission-approval-fields">
                  <label>Campus<select required value={selectedCampusId} onChange={(event) => setCampusId(event.target.value)}><option value="">Select campus</option>{campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></label>
                  <label>Section <input required value={section} onChange={(event) => setSection(event.target.value)} placeholder="Required for enrollment" /></label>
                  <label>Roll number <input value={rollNumber} onChange={(event) => setRollNumber(event.target.value)} /></label>
                </div>
                <div className="admission-review-actions">
                  <button type="button" className="secondary-button small-button" disabled={working} onClick={() => setEditing(true)}>Edit Application</button>
                  <button type="button" className="secondary-button small-button admission-reject-button" disabled={working} onClick={() => {
                    setRejectionReason('')
                    setActionError('')
                    setConfirmingRejection(true)
                  }}>Reject</button>
                  <button type="button" className="primary-button small-button" disabled={working || campuses.length === 0} onClick={() => void approve()}>
                    {working ? 'Processing…' : 'Approve Student'}
                  </button>
                </div>
              </>
            ) : null}
            {actionError ? <p className="communication-feedback error" role="alert">{actionError}</p> : null}
            {message ? <p className="communication-feedback success" role="status">{message}</p> : null}
          </article>
        ) : null}
      </div>
      {confirmingRejection && selected ? (
        <div className="fee-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="reject-admission-title">
          <div className="fee-modal admission-reject-modal">
            <div className="fee-modal-header">
              <h2 id="reject-admission-title">Reject Application</h2>
              <button type="button" className="fee-modal-close" onClick={() => setConfirmingRejection(false)} disabled={working} aria-label="Close reject dialog">✕</button>
            </div>
            <div className="admission-reject-content">
              <p><strong>Student Name:</strong> {selected.student_name}</p>
              <p><strong>Application Reference:</strong> {selected.application_reference}</p>
              <label className="admission-rejection-input">Rejection Reason
                <textarea
                  rows={4}
                  maxLength={500}
                  required
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                />
              </label>
              <p className="admission-reject-note">This application will be moved to Trash and can be restored to Pending Admissions.</p>
              {actionError ? <p className="communication-feedback error" role="alert">{actionError}</p> : null}
              <div className="admission-review-actions">
                <button type="button" className="secondary-button small-button" disabled={working} onClick={() => setConfirmingRejection(false)}>Cancel</button>
                <button type="button" className="primary-button small-button admission-reject-button" disabled={working || !rejectionReason.trim()} onClick={() => void reject()}>
                  {working ? 'Rejecting…' : 'Reject Application'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
