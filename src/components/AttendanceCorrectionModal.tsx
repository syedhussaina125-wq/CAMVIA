import React, { useState } from 'react'

export type AttendanceCorrectionRecord = {
  student_id: string
  student_name: string
  status: 'PRESENT' | 'ABSENT' | 'LATE'
  note?: string
}

type AttendanceCorrectionModalProps = {
  isOpen: boolean
  sessionId: string
  className: string
  section: string
  date: string
  records: AttendanceCorrectionRecord[]
  onClose: () => void
  onSave: (payload: { sessionId: string; records: AttendanceCorrectionRecord[]; reason: string }) => Promise<void>
}

export function AttendanceCorrectionModal({
  isOpen,
  sessionId,
  className,
  section,
  date,
  records: initialRecords,
  onClose,
  onSave,
}: AttendanceCorrectionModalProps) {
  const [records, setRecords] = useState<AttendanceCorrectionRecord[]>(initialRecords)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (!isOpen) return null

  const handleStatusChange = (studentId: string, status: 'PRESENT' | 'ABSENT' | 'LATE') => {
    setRecords((prev) =>
      prev.map((r) => (r.student_id === studentId ? { ...r, status } : r))
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) {
      setError('A mandatory correction reason is required.')
      return
    }
    setError('')
    setSaving(true)
    try {
      await onSave({
        sessionId,
        records,
        reason: reason.trim(),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to correct attendance.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fee-modal-overlay" role="dialog" aria-modal="true">
      <div className="fee-modal" style={{ maxWidth: '580px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="fee-modal-header">
          <div>
            <h2>Correct Attendance Session</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              {className}-{section} · {date}
            </p>
          </div>
          <button type="button" className="fee-modal-close" onClick={onClose} disabled={saving}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="fee-form" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '8px' }}>
            <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                  <th style={{ padding: '6px' }}>Student</th>
                  <th style={{ padding: '6px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.student_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '6px' }}><strong>{r.student_name}</strong></td>
                    <td style={{ padding: '6px' }}>
                      <select
                        value={r.status}
                        onChange={(e) => handleStatusChange(r.student_id, e.target.value as any)}
                        disabled={saving}
                        style={{ padding: '4px', borderRadius: '4px' }}
                      >
                        <option value="PRESENT">Present</option>
                        <option value="ABSENT">Absent</option>
                        <option value="LATE">Late</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label>
            Correction reason (required)
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="State reason for correction (e.g., student arrived with excusal note)"
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
              {saving ? 'Submitting…' : 'Submit Correction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

