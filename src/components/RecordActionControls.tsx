import React, { useState } from 'react'
import { MoreVertical, ShieldAlert } from 'lucide-react'
import { formatRpcErrorMessage } from '../utils/errorMapping'

export type ActionItem = {
  label: string
  icon?: React.ComponentType<{ size?: number; className?: string }>
  danger?: boolean
  onClick: () => void
}

type RecordActionMenuProps = {
  actions: ActionItem[]
}

export function RecordActionMenu({ actions }: RecordActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false)

  if (actions.length === 0) return null

  return (
    <div className="record-action-menu-container" style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="secondary-button icon-only-button"
        style={{ padding: '4px 8px', minWidth: 'auto', borderRadius: '4px', border: '1px solid #cbd5e1' }}
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}
        aria-label="Actions"
      >
        <MoreVertical size={16} />
      </button>

      {isOpen && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 100 }}
            onClick={(e) => {
              e.stopPropagation()
              setIsOpen(false)
            }}
          />
          <div
            className="action-dropdown"
            style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              marginTop: '4px',
              backgroundColor: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
              zIndex: 101,
              minWidth: '160px',
              padding: '4px 0',
            }}
          >
            {actions.map((action, idx) => (
              <button
                key={idx}
                type="button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: '13px',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: action.danger ? '#dc2626' : '#1e293b',
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  setIsOpen(false)
                  action.onClick()
                }}
              >
                {action.icon && <action.icon size={14} />}
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

type DestructiveActionModalProps = {
  isOpen: boolean
  title: string
  prompt: string
  confirmLabel?: string
  danger?: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
}

export function DestructiveActionModal({
  isOpen,
  title,
  prompt,
  confirmLabel = 'Confirm',
  danger = true,
  onClose,
  onConfirm,
}: DestructiveActionModalProps) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) {
      setError('A mandatory reason is required for auditing purposes.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await onConfirm(reason.trim())
      onClose()
    } catch (err) {
      setError(formatRpcErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fee-modal-overlay" role="dialog" aria-modal="true">
      <div className="fee-modal" style={{ maxWidth: '440px' }}>
        <div className="fee-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {danger && <ShieldAlert size={20} color="#dc2626" />}
            <h2>{title}</h2>
          </div>
          <button type="button" className="fee-modal-close" onClick={onClose} disabled={submitting}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="fee-form">
          <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#475569' }}>{prompt}</p>

          <label>
            Reason for action (required)
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Provide a specific audit reason for this change..."
              disabled={submitting}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
            />
          </label>

          {error && <p className="fee-form-error" role="alert">{error}</p>}

          <div className="fee-form-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className={danger ? 'danger-button' : 'primary-button'}
              style={danger ? { backgroundColor: '#dc2626', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' } : {}}
              disabled={submitting || !reason.trim()}
            >
              {submitting ? 'Processing…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
