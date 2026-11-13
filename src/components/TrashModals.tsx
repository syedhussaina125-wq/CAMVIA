import { Trash2, TriangleAlert } from 'lucide-react'
import { TEST_HANDOVER_PURGE_CONFIRMATION, type TrashedItem } from '../types/trash'

type TrashAdmissionModalProps = {
  item: TrashedItem
  onClose: () => void
}

export function TrashAdmissionModal({ item, onClose }: TrashAdmissionModalProps) {
  return (
    <div className="fee-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="admission-trash-detail-title">
      <div className="fee-modal admission-trash-detail">
        <div className="fee-modal-header">
          <h2 id="admission-trash-detail-title">Rejected Admission</h2>
          <button type="button" className="fee-modal-close" onClick={onClose} aria-label="Close details">✕</button>
        </div>
        <dl className="admission-details">
          <div><dt>Student Name</dt><dd>{item.name}</dd></div>
          <div><dt>Application Reference</dt><dd>{item.application_reference}</dd></div>
          <div><dt>Applying Class</dt><dd>{item.applying_class}</dd></div>
          <div><dt>Guardian Name</dt><dd>{item.guardian_name}</dd></div>
          <div><dt>Guardian Phone</dt><dd>{item.guardian_phone}</dd></div>
          <div><dt>Submitted Date</dt><dd>{item.submitted_at ? new Date(item.submitted_at).toLocaleString() : '—'}</dd></div>
          <div><dt>Rejected Date</dt><dd>{item.rejected_at ? new Date(item.rejected_at).toLocaleString() : new Date(item.deleted_at).toLocaleString()}</dd></div>
          <div><dt>Rejected By</dt><dd>{item.deleted_by_name}</dd></div>
          <div><dt>Rejection Reason</dt><dd>{item.delete_reason}</dd></div>
          <div><dt>Source</dt><dd>{item.source}</dd></div>
        </dl>
        <button type="button" className="secondary-button small-button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

type TrashPermanentDeleteModalProps = {
  item: TrashedItem
  recordTypeLabel: string
  deleting: boolean
  actionError: string
  deleteConfirmation: string
  testHandoverConfirmation: string
  testHandoverReason: string
  onDeleteConfirmationChange: (value: string) => void
  onTestHandoverConfirmationChange: (value: string) => void
  onTestHandoverReasonChange: (value: string) => void
  onClose: () => void
  onPermanentDelete: () => void
  onTestHandoverPurge: () => void
}

export function TrashPermanentDeleteModal({
  item,
  recordTypeLabel,
  deleting,
  actionError,
  deleteConfirmation,
  testHandoverConfirmation,
  testHandoverReason,
  onDeleteConfirmationChange,
  onTestHandoverConfirmationChange,
  onTestHandoverReasonChange,
  onClose,
  onPermanentDelete,
  onTestHandoverPurge,
}: TrashPermanentDeleteModalProps) {
  return (
    <div className="fee-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="trash-delete-title">
      <div className="fee-modal trash-delete-modal">
        <div className="fee-modal-header">
          <div className="trash-delete-heading">
            <TriangleAlert size={20} aria-hidden="true" />
            <h2 id="trash-delete-title">
              {item.record_type === 'STUDENT' ? 'Permanently Delete Student?' : 'Permanently Delete?'}
            </h2>
          </div>
          <button
            type="button"
            className="fee-modal-close"
            onClick={onClose}
            disabled={deleting}
            aria-label="Close confirmation"
          >
            ✕
          </button>
        </div>
        <div className="trash-delete-content">
          <p>
            {item.record_type === 'STUDENT'
              ? 'This student and eligible related data will be permanently deleted and cannot be restored.'
              : 'This record will be permanently deleted and cannot be restored.'}
          </p>
          <dl className="trash-delete-record">
            <div><dt>Record Name</dt><dd>{item.name}</dd></div>
            {item.record_type === 'STUDENT' ? (
              <>
                <div><dt>Student ID</dt><dd>{item.identifier || '—'}</dd></div>
                <div><dt>Class / Section</dt><dd>{item.detail.split(' · ')[0] || '—'}</dd></div>
              </>
            ) : (
              <>
                <div><dt>Record Type</dt><dd>{recordTypeLabel}</dd></div>
                <div>
                  <dt>{item.record_type === 'REJECTED_ADMISSION' ? 'Application Reference' : 'Identifier'}</dt>
                  <dd>{item.identifier || '—'}</dd>
                </div>
              </>
            )}
          </dl>
          {item.record_type === 'STUDENT' ? (
            <label className="trash-delete-confirm-label">
              Type <strong>DELETE</strong> to confirm
              <input
                value={deleteConfirmation}
                onChange={(event) => onDeleteConfirmationChange(event.target.value)}
                autoComplete="off"
                aria-label="Type DELETE to confirm permanent student deletion"
                disabled={deleting}
              />
            </label>
          ) : null}
          {item.record_type === 'STUDENT' ? (
            <details className="trash-exceptional-purge">
              <summary>Exceptional test/handover purge</summary>
              <p>
                Use only for confirmed non-production test or handover data. This path can also remove
                fee payment history; normal deletion will not remove payment records.
              </p>
              <label className="trash-delete-confirm-label">
                Type <strong>{TEST_HANDOVER_PURGE_CONFIRMATION}</strong> to confirm
                <input
                  value={testHandoverConfirmation}
                  onChange={(event) => onTestHandoverConfirmationChange(event.target.value)}
                  autoComplete="off"
                  aria-label={`Type ${TEST_HANDOVER_PURGE_CONFIRMATION} to confirm exceptional test/handover purge`}
                  disabled={deleting}
                />
              </label>
              <label className="trash-delete-confirm-label">
                Purge reason (10 to 500 characters)
                <input
                  value={testHandoverReason}
                  onChange={(event) => onTestHandoverReasonChange(event.target.value)}
                  maxLength={500}
                  autoComplete="off"
                  aria-label="Reason for exceptional test/handover purge"
                  disabled={deleting}
                />
              </label>
              <button
                type="button"
                className="danger-button-solid"
                onClick={onTestHandoverPurge}
                disabled={
                  deleting ||
                  testHandoverConfirmation !== TEST_HANDOVER_PURGE_CONFIRMATION ||
                  testHandoverReason.trim().length < 10 ||
                  testHandoverReason.trim().length > 500
                }
              >
                <Trash2 size={15} /> {deleting ? 'Purging…' : 'Purge confirmed test/handover student'}
              </button>
            </details>
          ) : null}
          {actionError ? <p className="communication-feedback error" role="alert">{actionError}</p> : null}
          <div className="trash-delete-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger-button-solid"
              onClick={onPermanentDelete}
              disabled={deleting || (item.record_type === 'STUDENT' && deleteConfirmation !== 'DELETE')}
            >
              <Trash2 size={15} /> {deleting ? 'Deleting…' : 'Permanently Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

