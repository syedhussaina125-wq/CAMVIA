import React, { useState } from 'react'

type GuardianModalProps = {
  isOpen: boolean
  mode: 'edit' | 'link'
  studentId: string
  guardian?: {
    id?: string
    name: string
    phone: string
    email: string
    relationship?: string
  }
  userRole: string
  onClose: () => void
  onUpdate: (payload: {
    guardianId: string
    firstName: string
    lastName: string
    phone?: string
    email?: string
    address?: string
    reason: string
  }) => Promise<void>
  onLink?: (payload: {
    studentId: string
    guardianId: string
    relationship: string
    isPrimary: boolean
    reason: string
  }) => Promise<void>
}

export function GuardianModal({
  isOpen,
  mode,
  studentId,
  guardian,
  userRole,
  onClose,
  onUpdate,
  onLink,
}: GuardianModalProps) {
  const nameParts = (guardian?.name ?? '').trim().split(/\s+/)
  const [firstName, setFirstName] = useState(nameParts[0] ?? '')
  const [lastName, setLastName] = useState(nameParts.slice(1).join(' ') || nameParts[0] || '')
  const [phone, setPhone] = useState(guardian?.phone ?? '')
  const [email, setEmail] = useState(guardian?.email ?? '')
  const [relationship, setRelationship] = useState(guardian?.relationship ?? 'Parent')
  const [guardianIdInput, setGuardianIdInput] = useState(guardian?.id ?? '')
  const [isPrimary, setIsPrimary] = useState(true)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!isOpen) return null

  const isPrincipal = userRole === 'principal'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) {
      setError('A mandatory audit reason is required.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      if (mode === 'edit') {
        if (!guardian?.id) throw new Error('Guardian ID is missing.')
        await onUpdate({
          guardianId: guardian.id,
          firstName: isPrincipal ? (nameParts[0] ?? '') : firstName.trim(),
          lastName: isPrincipal ? (nameParts.slice(1).join(' ') || nameParts[0] || '') : lastName.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          reason: reason.trim(),
        })
      } else if (mode === 'link' && onLink) {
        if (!guardianIdInput.trim()) throw new Error('Guardian ID is required.')
        await onLink({
          studentId,
          guardianId: guardianIdInput.trim(),
          relationship: relationship.trim(),
          isPrimary,
          reason: reason.trim(),
        })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Guardian operation failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fee-modal-overlay" role="dialog" aria-modal="true">
      <div className="fee-modal" style={{ maxWidth: '480px' }}>
        <div className="fee-modal-header">
          <h2>{mode === 'edit' ? 'Edit Guardian Details' : 'Link Guardian'}</h2>
          <button type="button" className="fee-modal-close" onClick={onClose} disabled={submitting}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="fee-form">
          {isPrincipal && mode === 'edit' && (
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 12px 0' }}>
              Principals may update phone and email contact details. Identity changes require Admin authorization.
            </p>
          )}

          {mode === 'link' ? (
            <>
              <label>
                Guardian UUID
                <input
                  type="text"
                  required
                  value={guardianIdInput}
                  onChange={(e) => setGuardianIdInput(e.target.value)}
                  placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                  disabled={submitting}
                />
              </label>
              <label>
                Relationship to Student
                <input
                  type="text"
                  required
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  placeholder="e.g. Father, Mother, Guardian, Uncle"
                  disabled={submitting}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isPrimary}
                  onChange={(e) => setIsPrimary(e.target.checked)}
                  disabled={submitting}
                />
                Set as Primary Guardian
              </label>
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label>
                  First Name
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={isPrincipal || submitting}
                  />
                </label>
                <label>
                  Last Name
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={isPrincipal || submitting}
                  />
                </label>
              </div>
              <label>
                Phone
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={submitting}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                />
              </label>
            </>
          )}

          <label>
            Reason for action (required)
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="State reason for audit log..."
              disabled={submitting}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
            />
          </label>

          {error && <p className="fee-form-error" role="alert">{error}</p>}

          <div className="fee-form-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={submitting || !reason.trim()}>
              {submitting ? 'Processing…' : mode === 'edit' ? 'Save Changes' : 'Link Guardian'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

