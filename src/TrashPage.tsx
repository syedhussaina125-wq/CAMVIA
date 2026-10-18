import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArchiveRestore, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react'
import type { TrashedItem, TrashedRecordType } from './types/trash'
import {
  fetchTrashedRecords,
  restoreTrashedCommunication,
  restoreTrashedGuardian,
  restoreTrashedStudent,
} from './services/trash'

type TrashTab = 'ALL' | 'STUDENTS' | 'GUARDIANS' | 'COMMUNICATIONS'

type TrashPageProps = {
  onRefreshAll?: () => void
}

export function TrashPage({ onRefreshAll }: TrashPageProps) {
  const [tab, setTab] = useState<TrashTab>('ALL')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<TrashedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')
  const [restoringItem, setRestoringItem] = useState<TrashedItem | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    let active = true
    void fetchTrashedRecords('ALL')
      .then((data) => {
        if (!active) return
        setItems(data)
      })
      .catch((err: unknown) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load trashed records.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const loadItems = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchTrashedRecords('ALL')
      setItems(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trashed records.')
    } finally {
      setLoading(false)
    }
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesTab =
        tab === 'ALL' ||
        (tab === 'STUDENTS' && item.record_type === 'STUDENT') ||
        (tab === 'GUARDIANS' && item.record_type === 'GUARDIAN') ||
        (tab === 'COMMUNICATIONS' && item.record_type === 'COMMUNICATION_DRAFT')

      const searchable = `${item.name} ${item.identifier} ${item.detail} ${item.deleted_by_name} ${item.delete_reason}`.toLowerCase()
      const matchesQuery = !query.trim() || searchable.includes(query.trim().toLowerCase())

      return matchesTab && matchesQuery
    })
  }, [items, tab, query])

  const counts = useMemo(() => {
    return {
      total: items.length,
      students: items.filter((i) => i.record_type === 'STUDENT').length,
      guardians: items.filter((i) => i.record_type === 'GUARDIAN').length,
      comms: items.filter((i) => i.record_type === 'COMMUNICATION_DRAFT').length,
      expiringSoon: items.filter((i) => i.days_remaining <= 7).length,
    }
  }, [items])

  const handleRestore = async () => {
    if (!restoringItem) return
    setRestoring(true)
    setActionError('')
    setActionSuccess('')
    try {
      if (restoringItem.record_type === 'STUDENT') {
        await restoreTrashedStudent(restoringItem.id)
      } else if (restoringItem.record_type === 'GUARDIAN') {
        await restoreTrashedGuardian(restoringItem.id)
      } else if (restoringItem.record_type === 'COMMUNICATION_DRAFT') {
        await restoreTrashedCommunication(restoringItem.id)
      }
      setActionSuccess(`${restoringItem.name} has been restored successfully.`)
      setRestoringItem(null)
      await loadItems()
      if (onRefreshAll) onRefreshAll()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to restore record.')
    } finally {
      setRestoring(false)
    }
  }

  const badgeClassFor = (type: TrashedRecordType) => {
    switch (type) {
      case 'STUDENT':
        return 'fee-status-badge fee-status-pending'
      case 'GUARDIAN':
        return 'fee-status-badge fee-status-partially-paid'
      case 'COMMUNICATION_DRAFT':
        return 'fee-status-badge fee-status-voided'
      default:
        return 'fee-status-badge'
    }
  }

  const formatDaysRemaining = (days: number) => {
    if (days <= 0) return 'Expires today'
    if (days === 1) return '1 day remaining'
    return `${days} days remaining`
  }

  const daysBadgeColor = (days: number) => {
    if (days <= 3) return { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' }
    if (days <= 7) return { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' }
    return { bg: '#ecfdf5', color: '#065f46', border: '#a7f3d0' }
  }

  return (
    <section className="students-page">
      <div className="students-heading">
        <div>
          <p className="eyebrow">Recovery &amp; Retention</p>
          <h1>Trash</h1>
          <p className="students-intro">
            Records moved to Trash are preserved for 30 days and can be restored. After 30 days, they cannot be recovered.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button small-button"
          onClick={() => void loadItems()}
          disabled={loading}
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div className="help-banner">
        <strong>Strict 30-Day Recovery Guarantee:</strong> Records remain safely recoverable for 30 days. Permanent deletion is locked until the recovery period ends.
      </div>

      <div className="attendance-summary-grid" style={{ marginBottom: '20px' }}>
        <article className="attendance-metric blue"><span>Total in Trash</span><strong>{counts.total}</strong></article>
        <article className="attendance-metric green"><span>Students</span><strong>{counts.students}</strong></article>
        <article className="attendance-metric purple"><span>Guardians</span><strong>{counts.guardians}</strong></article>
        <article className="attendance-metric amber"><span>Expiring Soon (≤ 7 days)</span><strong>{counts.expiringSoon}</strong></article>
      </div>

      {actionError && <p className="communication-feedback error" role="alert">{actionError}</p>}
      {actionSuccess && <p className="communication-feedback success" role="status">{actionSuccess}</p>}
      {error && <p className="communication-feedback error" role="alert">{error}</p>}

      <div className="table-card" style={{ borderRadius: '18px', border: '1px solid #e9effb', boxShadow: '0 10px 22px rgba(19, 42, 77, 0.035)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', padding: '16px', borderBottom: '1px solid #edf2fb' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className={tab === 'ALL' ? 'primary-button small-button' : 'secondary-button small-button'}
              onClick={() => setTab('ALL')}
            >
              All ({counts.total})
            </button>
            <button
              type="button"
              className={tab === 'STUDENTS' ? 'primary-button small-button' : 'secondary-button small-button'}
              onClick={() => setTab('STUDENTS')}
            >
              Students ({counts.students})
            </button>
            <button
              type="button"
              className={tab === 'GUARDIANS' ? 'primary-button small-button' : 'secondary-button small-button'}
              onClick={() => setTab('GUARDIANS')}
            >
              Guardians ({counts.guardians})
            </button>
            <button
              type="button"
              className={tab === 'COMMUNICATIONS' ? 'primary-button small-button' : 'secondary-button small-button'}
              onClick={() => setTab('COMMUNICATIONS')}
            >
              Communication Drafts ({counts.comms})
            </button>
          </div>

          <label className="student-search" style={{ margin: 0, width: '100%', maxWidth: '340px', minHeight: '40px' }}>
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, ID, or reason…"
              aria-label="Search trash"
            />
          </label>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
            Loading Trash items…
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center' }}>
            <Trash2 size={32} style={{ color: '#94a3b8', margin: '0 auto 12px' }} />
            <h3 style={{ margin: '0 0 4px', fontSize: '16px', color: '#1e293b' }}>
              {query ? 'No matching trashed records found' : 'Trash is empty'}
            </h3>
            <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>
              {query ? 'Try adjusting your search or tab filter.' : 'Eligible records moved to Trash will appear here for 30 days.'}
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="student-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Record Name</th>
                  <th>Identifier</th>
                  <th>Deleted By</th>
                  <th>Deleted Date</th>
                  <th>Purge After</th>
                  <th>Recovery Window</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const badgeStyle = daysBadgeColor(item.days_remaining)
                  return (
                    <tr key={`${item.record_type}-${item.id}`}>
                      <td>
                        <span className={badgeClassFor(item.record_type)}>
                          {item.record_type === 'COMMUNICATION_DRAFT' ? 'Draft' : item.record_type}
                        </span>
                      </td>
                      <td>
                        <strong>{item.name}</strong>
                        {item.detail && (
                          <div style={{ fontSize: '12px', color: '#64748b' }}>{item.detail}</div>
                        )}
                        {item.delete_reason && (
                          <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '2px' }}>
                            <em>Reason: {item.delete_reason}</em>
                          </div>
                        )}
                      </td>
                      <td><code>{item.identifier}</code></td>
                      <td>{item.deleted_by_name}</td>
                      <td>{new Date(item.deleted_at).toLocaleDateString()}</td>
                      <td>{new Date(item.purge_after).toLocaleDateString()}</td>
                      <td>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            fontSize: '12px',
                            fontWeight: 600,
                            backgroundColor: badgeStyle.bg,
                            color: badgeStyle.color,
                            border: `1px solid ${badgeStyle.border}`,
                          }}
                        >
                          {formatDaysRemaining(item.days_remaining)}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary-button compact-button"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          onClick={() => setRestoringItem(item)}
                        >
                          <RotateCcw size={13} /> Restore
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {restoringItem && (
        <div className="fee-modal-overlay" role="dialog" aria-modal="true">
          <div className="fee-modal" style={{ maxWidth: '440px' }}>
            <div className="fee-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ArchiveRestore size={20} color="#2563eb" />
                <h2 style={{ margin: 0, fontSize: '16px' }}>Restore Record</h2>
              </div>
              <button
                type="button"
                className="fee-modal-close"
                onClick={() => setRestoringItem(null)}
                disabled={restoring}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '16px' }}>
              <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#334155', lineHeight: 1.5 }}>
                Are you sure you want to restore <strong>{restoringItem.name}</strong>?
                It will be returned to active operational views immediately.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', backgroundColor: '#eff6ff', borderRadius: '6px', border: '1px solid #bfdbfe', fontSize: '12px', color: '#1e40af', marginBottom: '16px' }}>
                <AlertCircle size={16} />
                <span>Restoration will be recorded in the audit log.</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setRestoringItem(null)}
                  disabled={restoring}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleRestore}
                  disabled={restoring}
                >
                  {restoring ? 'Restoring…' : 'Restore Record'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
