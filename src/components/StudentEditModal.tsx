import React, { useState } from 'react'
import type { Student } from '../studentData'
import type { Role } from '../mockData'

type StudentEditModalProps = {
  isOpen: boolean
  student: Student
  userRole: Role
  campuses: Array<{ id: string; name: string }>
  onClose: () => void
  onSave: (payload: {
    studentId: string
    campusId: string
    firstName: string
    lastName: string
    className: string
    section: string
    rollNumber: string
    dateOfBirth: string
    gender: string
    reason: string
  }) => Promise<void>
}

export function StudentEditModal({
  isOpen,
  student,
  userRole,
  campuses,
  onClose,
  onSave,
}: StudentEditModalProps) {
  const [firstName, setFirstName] = useState(student.firstName)
  const [lastName, setLastName] = useState(student.lastName)
  const [className, setClassName] = useState(student.className)
  const [section, setSection] = useState(student.section)
  const [rollNumber, setRollNumber] = useState(student.rollNumber)
  const [dateOfBirth, setDateOfBirth] = useState(student.dateOfBirth)
  const [gender, setGender] = useState(student.gender)
  const [campusId, setCampusId] = useState(student.campusId ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (!isOpen) return null

  const isTeacher = userRole === 'teacher'
  const isPrincipal = userRole === 'principal'
  const isAdmin = userRole === 'admin'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) {
      setError('A mandatory audit reason is required.')
      return
    }
    setError('')
    setSaving(true)
    try {
      await onSave({
        studentId: student.id,
        campusId: campusId || student.campusId || '',
        firstName: isTeacher ? student.firstName : firstName.trim(),
        lastName: isTeacher ? student.lastName : lastName.trim(),
        className: isTeacher ? student.className : className.trim(),
        section: isTeacher ? student.section : section.trim(),
        rollNumber: rollNumber.trim(),
        dateOfBirth: isTeacher || isPrincipal ? student.dateOfBirth : dateOfBirth,
        gender: isTeacher || isPrincipal ? student.gender : gender,
        reason: reason.trim(),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update student.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fee-modal-overlay" role="dialog" aria-modal="true">
      <div className="fee-modal" style={{ maxWidth: '520px' }}>
        <div className="fee-modal-header">
          <h2>{isTeacher ? 'Update Roll Number' : 'Edit Student Record'}</h2>
          <button type="button" className="fee-modal-close" onClick={onClose} disabled={saving}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="fee-form">
          {isTeacher && (
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 12px 0' }}>
              Teachers may update student roll numbers for assigned classes. Identity and class fields are read-only.
            </p>
          )}

          {isPrincipal && (
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 12px 0' }}>
              Principals may update class, section, campus, and roll numbers. Student identity fields require Admin authorization.
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label>
              First Name
              <input
                type="text"
                value={isTeacher ? student.firstName : firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={isTeacher || isPrincipal || saving}
                required
              />
            </label>
            <label>
              Last Name
              <input
                type="text"
                value={isTeacher ? student.lastName : lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={isTeacher || isPrincipal || saving}
                required
              />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <label>
              Class
              <input
                type="text"
                value={isTeacher ? student.className : className}
                onChange={(e) => setClassName(e.target.value)}
                disabled={isTeacher || saving}
                required
              />
            </label>
            <label>
              Section
              <input
                type="text"
                value={isTeacher ? student.section : section}
                onChange={(e) => setSection(e.target.value)}
                disabled={isTeacher || saving}
                required
              />
            </label>
            <label>
              Roll Number
              <input
                type="text"
                value={rollNumber}
                onChange={(e) => setRollNumber(e.target.value)}
                disabled={saving}
              />
            </label>
          </div>

          {(isAdmin || isPrincipal) && campuses.length > 0 && (
            <label>
              Campus
              <select
                value={campusId}
                onChange={(e) => setCampusId(e.target.value)}
                disabled={isTeacher || saving}
              >
                {campuses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}

          {isAdmin && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label>
                Date of Birth
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  disabled={saving}
                />
              </label>
              <label>
                Gender
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  disabled={saving}
                >
                  <option value="">Unspecified</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </label>
            </div>
          )}

          <label>
            Reason for correction (required)
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="State reason for edit (e.g., corrected spelling per registrar verification)"
              disabled={saving}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
            />
          </label>

          {error && <p className="fee-form-error" role="alert">{error}</p>}

          <div className="fee-form-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={saving || !reason.trim()}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

