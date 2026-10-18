import React, { useState } from 'react'
import type { FeeInvoiceView } from '../feeData'

type InvoiceEditModalProps = {
  isOpen: boolean
  invoice: FeeInvoiceView
  onClose: () => void
  onSave: (payload: {
    invoiceId: string
    dueDate: string
    lineItems: Array<{ label: string; amount: number }>
    reason: string
  }) => Promise<void>
}

export function InvoiceEditModal({
  isOpen,
  invoice,
  onClose,
  onSave,
}: InvoiceEditModalProps) {
  const [dueDate, setDueDate] = useState(invoice.dueDate)
  const [lineItems, setLineItems] = useState<Array<{ label: string; amount: number }>>(
    invoice.lineItems.map((item) => ({ label: item.label, amount: item.amount }))
  )
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (!isOpen) return null

  const handleItemChange = (index: number, field: 'label' | 'amount', value: string) => {
    setLineItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item
        return {
          ...item,
          [field]: field === 'amount' ? Math.max(0, parseFloat(value) || 0) : value,
        }
      })
    )
  }

  const handleAddItem = () => {
    setLineItems((prev) => [...prev, { label: '', amount: 0 }])
  }

  const handleRemoveItem = (index: number) => {
    if (lineItems.length <= 1) return
    setLineItems((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) {
      setError('A mandatory edit reason is required.')
      return
    }
    if (lineItems.some((item) => !item.label.trim() || item.amount <= 0)) {
      setError('All line items must have a non-empty description and positive amount.')
      return
    }
    setError('')
    setSaving(true)
    try {
      await onSave({
        invoiceId: invoice.id,
        dueDate,
        lineItems,
        reason: reason.trim(),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update invoice.')
    } finally {
      setSaving(false)
    }
  }

  const total = lineItems.reduce((sum, item) => sum + (item.amount || 0), 0)

  return (
    <div className="fee-modal-overlay" role="dialog" aria-modal="true">
      <div className="fee-modal" style={{ maxWidth: '520px' }}>
        <div className="fee-modal-header">
          <div>
            <h2>Edit Fee Invoice</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              {invoice.student.firstName} {invoice.student.lastName} · {invoice.month}
            </p>
          </div>
          <button type="button" className="fee-modal-close" onClick={onClose} disabled={saving}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="fee-form">
          <label>
            Due Date
            <input
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={saving}
            />
          </label>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>Line Items</span>
              <button
                type="button"
                className="secondary-button"
                style={{ padding: '2px 8px', fontSize: '12px' }}
                onClick={handleAddItem}
                disabled={saving}
              >
                + Add Item
              </button>
            </div>

            {lineItems.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input
                  type="text"
                  required
                  placeholder="Item description"
                  value={item.label}
                  onChange={(e) => handleItemChange(idx, 'label', e.target.value)}
                  disabled={saving}
                  style={{ flex: 2 }}
                />
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  placeholder="Amount"
                  value={item.amount || ''}
                  onChange={(e) => handleItemChange(idx, 'amount', e.target.value)}
                  disabled={saving}
                  style={{ flex: 1 }}
                />
                {lineItems.length > 1 && (
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '0 4px' }}
                    onClick={() => handleRemoveItem(idx)}
                    disabled={saving}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}

            <div style={{ textAlign: 'right', fontWeight: 600, marginTop: '8px', fontSize: '14px' }}>
              Total: PKR {total.toFixed(2)}
            </div>
          </div>

          <label>
            Reason for correction (required)
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="State reason for invoice change..."
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
              {saving ? 'Updating…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

