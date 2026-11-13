import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArchiveRestore, Eye, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react'
import {
  TEST_HANDOVER_PURGE_CONFIRMATION,
  type PermanentlyDeletableTrashRecordType,
  type TrashedItem,
  type TrashedRecordType,
} from './types/trash'

const TrashAdmissionModal = lazy(() => import('./components/TrashModals').then((m) => ({ default: m.TrashAdmissionModal })))
const TrashPermanentDeleteModal = lazy(() => import('./components/TrashModals').then((m) => ({ default: m.TrashPermanentDeleteModal })))
import {
  fetchTrashDirectory,
  restoreTrashedCommunication,
  restoreTrashedGuardian,
  restoreTrashedStudent,
  restoreTrashedAttendanceSession,
  permanentlyDeleteTrashItem,
  purgeTestHandoverStudent,
} from './services/trash'
import {
  restoreRejectedAdmissionToPending,
} from './services/admissions'
import { formatRpcErrorMessage } from './utils/errorMapping'

type TrashTab = 'ALL' | 'STUDENTS' | 'ADMISSIONS' | 'GUARDIANS' | 'ATTENDANCE' | 'FEES' | 'COMMUNICATIONS'
type TrashSort = 'NEWEST' | 'OLDEST' | 'NAME'
type FeeTrashFilter = 'ALL' | 'INVOICES' | 'PAYMENTS'

type TrashPageProps = {
  onRefreshAll?: () => void | Promise<void>
}

type TrashCategoryError = {
  category: 'records' | 'admissions'
  message: string
}

function isMissingRpc(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const rpcError = error as { code?: unknown }
  return rpcError.code === 'PGRST202' || rpcError.code === '42883'
}

function formatCategoryError(category: TrashCategoryError['category'], error: unknown): TrashCategoryError {
  const categoryName = category === 'admissions' ? 'Admissions' : 'Other Trash records'
  const message = isMissingRpc(error) && category === 'admissions'
    ? 'Admissions Trash is unavailable until migration 035_admission_recycle_bin.sql is applied after migration 034_parent_registration.sql.'
    : `${categoryName} could not be loaded: ${formatRpcErrorMessage(error)}`
  return { category, message }
}

function canRestore(item: TrashedItem): boolean {
  if (item.restorable !== undefined) return item.restorable
  return !item.is_tombstoned && (!item.purge_after || Date.parse(item.purge_after) > Date.now())
}

function canPermanentlyDelete(item: TrashedItem): boolean {
  if (item.record_type === 'REJECTED_ADMISSION') return true
  if (item.record_type === 'STUDENT') return !item.is_tombstoned
  if (item.record_type !== 'GUARDIAN' && item.record_type !== 'COMMUNICATION_DRAFT') return false
  const purgeAfter = item.purge_after
  return !item.is_tombstoned &&
    purgeAfter !== null &&
    purgeAfter !== undefined &&
    Date.parse(purgeAfter) <= Date.now()
}

function isPermanentDeleteType(
  type: TrashedRecordType,
): type is PermanentlyDeletableTrashRecordType {
  return type === 'STUDENT' ||
    type === 'GUARDIAN' ||
    type === 'COMMUNICATION_DRAFT' ||
    type === 'REJECTED_ADMISSION'
}

export function TrashPage({ onRefreshAll }: TrashPageProps) {
  const [tab, setTab] = useState<TrashTab>('ALL')
  const [feeFilter, setFeeFilter] = useState<FeeTrashFilter>('ALL')
  const [query, setQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sort, setSort] = useState<TrashSort>('NEWEST')
  const [items, setItems] = useState<TrashedItem[]>([])
  const [categoryErrors, setCategoryErrors] = useState<TrashCategoryError[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')
  const [restoringItem, setRestoringItem] = useState<TrashedItem | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [viewingAdmission, setViewingAdmission] = useState<TrashedItem | null>(null)
  const [deletingItem, setDeletingItem] = useState<TrashedItem | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [testHandoverConfirmation, setTestHandoverConfirmation] = useState('')
  const [testHandoverReason, setTestHandoverReason] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let active = true
    void fetchTrashDirectory()
      .then((data) => {
        if (!active) return
        setItems(data.items)
        const errors = data.categoryErrors.map(({ category, error }) => formatCategoryError(category, error))
        setCategoryErrors(errors)
        setError(errors.length === 2 ? 'Trash could not be fully loaded.' : '')
      })
      .catch((err: unknown) => {
        if (!active) return
        setError(formatRpcErrorMessage(err) || 'Failed to load trashed records.')
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
    setCategoryErrors([])
    try {
      const data = await fetchTrashDirectory()
      setItems(data.items)
      const errors = data.categoryErrors.map(({ category, error }) => formatCategoryError(category, error))
      setCategoryErrors(errors)
      setError(errors.length === 2 ? 'Trash could not be fully loaded.' : '')
    } catch (err) {
      setError(formatRpcErrorMessage(err) || 'Failed to load trashed records.')
    } finally {
      setLoading(false)
    }
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesTab =
        tab === 'ALL' ||
        (tab === 'STUDENTS' && ['STUDENT', 'STUDENT_ARCHIVED'].includes(item.record_type)) ||
        (tab === 'ADMISSIONS' && item.record_type === 'REJECTED_ADMISSION') ||
        (tab === 'GUARDIANS' && ['GUARDIAN', 'GUARDIAN_ARCHIVED'].includes(item.record_type)) ||
        (tab === 'ATTENDANCE' && item.record_type === 'ATTENDANCE_SESSION') ||
        (tab === 'FEES' && ['CANCELLED_INVOICE', 'CANCELLED_PAYMENT'].includes(item.record_type)) ||
        (tab === 'COMMUNICATIONS' && item.record_type === 'COMMUNICATION_DRAFT')
      const matchesFeeFilter = tab !== 'FEES' ||
        feeFilter === 'ALL' ||
        (feeFilter === 'INVOICES' && item.record_type === 'CANCELLED_INVOICE') ||
        (feeFilter === 'PAYMENTS' && item.record_type === 'CANCELLED_PAYMENT')

      const searchable = `${item.name} ${item.identifier} ${item.detail} ${item.deleted_by_name} ${item.delete_reason} ${item.guardian_name ?? ''} ${item.guardian_phone ?? ''}`.toLowerCase()
      const matchesQuery = !query.trim() || searchable.includes(query.trim().toLowerCase())
      const recordDate = (item.deleted_at ?? '').slice(0, 10)
      const matchesDate = (!dateFrom || recordDate >= dateFrom) && (!dateTo || recordDate <= dateTo)

      return matchesTab && matchesFeeFilter && matchesQuery && matchesDate
    })
    .sort((a, b) => sort === 'NAME'
      ? (a.name ?? '').localeCompare(b.name ?? '')
      : sort === 'OLDEST'
        ? (a.deleted_at ?? '').localeCompare(b.deleted_at ?? '')
        : (b.deleted_at ?? '').localeCompare(a.deleted_at ?? ''))
  }, [items, tab, feeFilter, query, dateFrom, dateTo, sort])

  const counts = useMemo(() => {
    let students = 0
    let admissions = 0
    let guardians = 0
    let attendance = 0
    let cancelledInvoices = 0
    let cancelledPayments = 0
    let comms = 0
    let expiringSoon = 0
    for (const item of items) {
      switch (item.record_type) {
        case 'STUDENT':
        case 'STUDENT_ARCHIVED':
          students += 1
          break
        case 'REJECTED_ADMISSION':
          admissions += 1
          break
        case 'GUARDIAN':
        case 'GUARDIAN_ARCHIVED':
          guardians += 1
          break
        case 'ATTENDANCE_SESSION':
          attendance += 1
          break
        case 'CANCELLED_INVOICE':
          cancelledInvoices += 1
          break
        case 'CANCELLED_PAYMENT':
          cancelledPayments += 1
          break
        case 'COMMUNICATION_DRAFT':
          comms += 1
          break
      }
      if (item.days_remaining !== null && item.days_remaining <= 7) expiringSoon += 1
    }
    return {
      total: items.length,
      students,
      admissions,
      guardians,
      attendance,
      fees: cancelledInvoices + cancelledPayments,
      cancelledInvoices,
      cancelledPayments,
      comms,
      expiringSoon,
    }
  }, [items])
  const selectedCategoryFailed = categoryErrors.some(({ category }) =>
    tab === 'ALL' ||
    (category === 'admissions' && tab === 'ADMISSIONS') ||
    (category === 'records' && tab !== 'ADMISSIONS'),
  )

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
      } else if (restoringItem.record_type === 'ATTENDANCE_SESSION') {
        await restoreTrashedAttendanceSession(restoringItem.id)
      } else if (restoringItem.record_type === 'REJECTED_ADMISSION') {
        await restoreRejectedAdmissionToPending(restoringItem.id)
      } else {
        return
      }

      setActionSuccess(restoringItem.record_type === 'REJECTED_ADMISSION'
        ? `${restoringItem.name} has been restored to Pending Admissions.`
        : `${restoringItem.name} has been restored successfully.`)
      setItems((current) => current.filter((item) =>
        !(item.id === restoringItem.id && item.record_type === restoringItem.record_type),
      ))
      setRestoringItem(null)
      await loadItems()
      if (onRefreshAll) await onRefreshAll()
    } catch (err) {
      setActionError(formatRpcErrorMessage(err))
    } finally {
      setRestoring(false)
    }
  }

  const handlePermanentDelete = async () => {
    if (
      !deletingItem ||
      !isPermanentDeleteType(deletingItem.record_type) ||
      (deletingItem.record_type === 'STUDENT' && deleteConfirmation !== 'DELETE')
    ) return
    setDeleting(true)
    setActionError('')
    setActionSuccess('')
    try {
      const result = await permanentlyDeleteTrashItem(
        deletingItem.record_type,
        deletingItem.id,
        deleteConfirmation,
      )
      if (!result.success) {
        setActionError(result.message)
        return
      }

      setItems((current) => current.filter((item) =>
        !(item.id === deletingItem.id && item.record_type === deletingItem.record_type),
      ))
      setDeletingItem(null)
      setDeleteConfirmation('')
      setTestHandoverConfirmation('')
      setTestHandoverReason('')
      setActionSuccess(deletingItem.record_type === 'STUDENT'
        ? 'Student permanently deleted.'
        : 'Record permanently deleted.')
      await onRefreshAll?.()
    } catch (err) {
      setActionError(err instanceof Error
        ? err.message
        : 'The record could not be permanently deleted. It remains in Trash; try again or contact an Admin.')
    } finally {
      setDeleting(false)
    }
  }

  const handleTestHandoverPurge = async () => {
    if (
      !deletingItem ||
      deletingItem.record_type !== 'STUDENT' ||
      testHandoverConfirmation !== TEST_HANDOVER_PURGE_CONFIRMATION ||
      testHandoverReason.trim().length < 10 ||
      testHandoverReason.trim().length > 500
    ) return
    setDeleting(true)
    setActionError('')
    setActionSuccess('')
    try {
      const result = await purgeTestHandoverStudent(
        deletingItem.id,
        testHandoverConfirmation,
        testHandoverReason,
      )
      if (!result.success) {
        setActionError(result.message)
        return
      }

      setItems((current) => current.filter((item) =>
        !(item.id === deletingItem.id && item.record_type === 'STUDENT'),
      ))
      setDeletingItem(null)
      setDeleteConfirmation('')
      setTestHandoverConfirmation('')
      setTestHandoverReason('')
      setActionSuccess('Confirmed test/handover student and temporary operational data purged.')
      await onRefreshAll?.()
    } catch (err) {
      setActionError(err instanceof Error
        ? err.message
        : 'The student could not be purged. The record remains in Trash.')
    } finally {
      setDeleting(false)
    }
  }

  const badgeClassFor = (type: TrashedRecordType) => {
    switch (type) {
      case 'STUDENT':
        return 'fee-status-badge fee-status-pending'
      case 'GUARDIAN':
        return 'fee-status-badge fee-status-partially-paid'
      case 'COMMUNICATION_DRAFT':
      case 'CANCELLED_INVOICE':
      case 'CANCELLED_PAYMENT':
        return 'fee-status-badge fee-status-cancelled'
      case 'ATTENDANCE_SESSION':
        return 'fee-status-badge fee-status-pending'
      case 'REJECTED_ADMISSION':
        return 'fee-status-badge fee-status-cancelled'
      case 'STUDENT_ARCHIVED':
      case 'GUARDIAN_ARCHIVED':
        return 'fee-status-badge fee-status-partially-paid'
      default:
        return 'fee-status-badge'
    }
  }

  const formatDaysRemaining = (days: number) => {
    if (days <= 0) return 'Expires today'
    if (days === 1) return '1 day remaining'
    return `${days} days remaining`
  }

  const recordTypeLabel = (type: TrashedRecordType) => ({
    STUDENT: 'STUDENT',
    GUARDIAN: 'GUARDIAN',
    COMMUNICATION_DRAFT: 'COMMUNICATION',
    STUDENT_ARCHIVED: 'STUDENT',
    GUARDIAN_ARCHIVED: 'GUARDIAN',
    ATTENDANCE_SESSION: 'ATTENDANCE',
    CANCELLED_INVOICE: 'INVOICE',
    CANCELLED_PAYMENT: 'PAYMENT',
    REJECTED_ADMISSION: 'ADMISSION',
  })[type]

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
            Removed records can be restored within 30 days. Rejected admissions and cancelled fees are retained for history.
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
        <strong>Recovery &amp; history:</strong> Eligible operational records remain recoverable for 30 days. Rejected admissions and cancelled fee records are preserved for audit history; rejected admissions can be restored to Pending Admissions.
      </div>

      <div className="attendance-summary-grid" style={{ marginBottom: '20px' }}>
        <article className="attendance-metric blue"><span>Total in Trash</span><strong>{counts.total}</strong></article>
        <article className="attendance-metric green"><span>Students</span><strong>{counts.students}</strong></article>
        <article className="attendance-metric amber"><span>Admissions</span><strong>{counts.admissions}</strong></article>
        <article className="attendance-metric purple"><span>Guardians</span><strong>{counts.guardians}</strong></article>
        <article className="attendance-metric amber"><span>Expiring Soon (≤ 7 days)</span><strong>{counts.expiringSoon}</strong></article>
      </div>

      {actionError && <p className="communication-feedback error" role="alert">{actionError}</p>}
      {actionSuccess && <p className="communication-feedback success" role="status">{actionSuccess}</p>}
      {error && <p className="communication-feedback error" role="alert">{error}</p>}
      {categoryErrors.map(({ category, message }) => (
        <p key={category} className="communication-feedback error" role="alert">{message}</p>
      ))}

      <div className="table-card" style={{ borderRadius: '18px', border: '1px solid #e9effb', boxShadow: '0 10px 22px rgba(19, 42, 77, 0.035)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', padding: '16px', borderBottom: '1px solid #edf2fb' }}>
          <div className="trash-category-tabs">
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
              className={tab === 'ADMISSIONS' ? 'primary-button small-button' : 'secondary-button small-button'}
              onClick={() => setTab('ADMISSIONS')}
            >
              Admissions ({counts.admissions})
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
              className={tab === 'ATTENDANCE' ? 'primary-button small-button' : 'secondary-button small-button'}
              onClick={() => setTab('ATTENDANCE')}
            >
              Attendance ({counts.attendance})
            </button>
            <button
              type="button"
              className={tab === 'FEES' ? 'primary-button small-button' : 'secondary-button small-button'}
              onClick={() => setTab('FEES')}
            >
              Fees ({counts.fees})
            </button>
            <button
              type="button"
              className={tab === 'COMMUNICATIONS' ? 'primary-button small-button' : 'secondary-button small-button'}
              onClick={() => setTab('COMMUNICATIONS')}
            >
              Communication ({counts.comms})
            </button>
          </div>
          {tab === 'FEES' ? (
            <div className="trash-fee-subcategories" aria-label="Cancelled fee records">
              <button type="button" className={feeFilter === 'ALL' ? 'is-active' : ''} onClick={() => setFeeFilter('ALL')}>
                All Fees ({counts.fees})
              </button>
              <button type="button" className={feeFilter === 'INVOICES' ? 'is-active' : ''} onClick={() => setFeeFilter('INVOICES')}>
                Cancelled Invoices ({counts.cancelledInvoices})
              </button>
              <button type="button" className={feeFilter === 'PAYMENTS' ? 'is-active' : ''} onClick={() => setFeeFilter('PAYMENTS')}>
                Cancelled Payments ({counts.cancelledPayments})
              </button>
            </div>
          ) : null}
          <div className="trash-filters" role="search" aria-label="Filter trash records">
            <div className="trash-search">
              <Search size={16} aria-hidden="true" />
              <label htmlFor="trash-search" className="visually-hidden">Search trash records</label>
              <input
                id="trash-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === 'ADMISSIONS' ? 'Search name, reference, guardian...' : 'Search by name, ID, or reason...'}
              />
            </div>
            <div className="trash-filter">
              <label htmlFor="trash-date-from">Date from</label>
              <input id="trash-date-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </div>
            <div className="trash-filter">
              <label htmlFor="trash-date-to">Date to</label>
              <input id="trash-date-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </div>
            <div className="trash-filter trash-filter-full">
              <label htmlFor="trash-sort">Sort</label>
              <select id="trash-sort" value={sort} onChange={(event) => setSort(event.target.value as TrashSort)}>
                <option value="NEWEST">Newest first</option>
                <option value="OLDEST">Oldest first</option>
                <option value="NAME">Name A–Z</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
            Loading Trash items…
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center' }}>
            <Trash2 size={32} style={{ color: '#94a3b8', margin: '0 auto 12px' }} />
            <h3 style={{ margin: '0 0 4px', fontSize: '16px', color: '#1e293b' }}>
              {selectedCategoryFailed
                ? 'This Trash category could not be loaded'
                : query
                  ? 'No matching trashed records found'
                  : tab === 'ADMISSIONS'
                    ? 'No rejected applications'
                    : tab === 'STUDENTS'
                      ? 'No students in Trash.'
                      : tab === 'GUARDIANS'
                        ? 'No guardians in Trash.'
                        : tab === 'ATTENDANCE'
                          ? 'No removed attendance records.'
                          : tab === 'FEES'
                            ? 'No cancelled financial records.'
                            : tab === 'COMMUNICATIONS'
                              ? 'No communication records in Trash.'
                              : 'Trash is empty'}
            </h3>
            <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>
              {selectedCategoryFailed
                ? 'Use Refresh to try again, or ask an Admin to verify the database migration and connection.'
                : query
                ? 'Try adjusting your search or tab filter.'
                : tab === 'ADMISSIONS'
                  ? 'Rejected applications will appear here and remain preserved for audit history.'
                  : 'Eligible records moved to Trash will appear here for 30 days.'}
            </p>
          </div>
        ) : (
          <div className="table-responsive trash-record-list">
            <table className="student-table trash-records-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Record Name</th>
                  <th>Identifier</th>
                  <th>Moved / Rejected By</th>
                  <th>Moved / Rejected Date</th>
                  <th>Retention Ends</th>
                  <th>Recovery Window</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const badgeStyle = daysBadgeColor(item.days_remaining ?? 30)
                  return (
                    <tr key={`${item.record_type}-${item.id}`}>
                      <td data-label="Type">
                        <span className={badgeClassFor(item.record_type)}>
                          {recordTypeLabel(item.record_type)}
                        </span>
                      </td>
                      <td data-label="Record">
                        <strong>{item.name}</strong>
                        {item.detail && (
                          <div style={{ fontSize: '12px', color: '#64748b' }}>{item.detail}</div>
                        )}
                        {item.record_type === 'REJECTED_ADMISSION' ? (
                          <>
                            <div style={{ fontSize: '12px', color: '#64748b' }}>Guardian: {item.guardian_name} · {item.guardian_phone}</div>
                            <div style={{ fontSize: '12px', color: '#64748b' }}>Source: {item.source}</div>
                          </>
                        ) : null}
                        {item.delete_reason && (
                          <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '2px' }}>
                            <em>Reason: {item.delete_reason}</em>
                          </div>
                        )}
                      </td>
                      <td data-label="Identifier">{item.identifier}</td>
                      <td data-label="Moved / Rejected By">{item.deleted_by_name}</td>
                      <td data-label="Date">{item.record_type === 'REJECTED_ADMISSION' ? (
                        <>
                          <div>Submitted: {item.submitted_at ? new Date(item.submitted_at).toLocaleDateString() : '—'}</div>
                          <div>Rejected: {item.rejected_at ? new Date(item.rejected_at).toLocaleDateString() : new Date(item.deleted_at).toLocaleDateString()}</div>
                        </>
                      ) : new Date(item.deleted_at).toLocaleDateString()}</td>
                      <td data-label="Retention Ends">{item.purge_after ? new Date(item.purge_after).toLocaleDateString() : '—'}</td>
                      <td data-label="Recovery Window">
                        {item.days_remaining === null ? (
                          <span>Kept for history</span>
                        ) : <span
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
                        </span>}
                      </td>
                      <td data-label="Action">
                        {item.record_type === 'REJECTED_ADMISSION' ? (
                          <div className="trash-admission-actions trash-record-actions">
                            <button
                              type="button"
                              className="secondary-button compact-button"
                              onClick={() => setViewingAdmission(item)}
                            >
                              <Eye size={13} /> View Details
                            </button>
                            <button
                              type="button"
                              className="secondary-button compact-button"
                              onClick={() => setRestoringItem(item)}
                            >
                              <RotateCcw size={13} /> Restore to Pending
                            </button>
                            <button
                              type="button"
                              className="danger-button compact-button"
                              onClick={() => {
                                setActionError('')
                                setDeleteConfirmation('')
                                setTestHandoverConfirmation('')
                                setTestHandoverReason('')
                                setDeletingItem(item)
                              }}
                            >
                              <Trash2 size={13} /> Permanent Delete
                            </button>
                          </div>
                        ) : item.record_type === 'ATTENDANCE_SESSION' ? (
                          <span className="trash-protected-note">Permanent deletion is not available for this attendance record.</span>
                        ) : ['CANCELLED_INVOICE', 'CANCELLED_PAYMENT'].includes(item.record_type) ? (
                          <span className="student-muted">Retained for financial audit history</span>
                        ) : (
                          <div className="trash-record-actions">
                            {canRestore(item) ? (
                              <button
                                type="button"
                                className="secondary-button compact-button"
                                onClick={() => setRestoringItem(item)}
                              >
                                <RotateCcw size={13} /> Restore
                              </button>
                            ) : null}
                            {canPermanentlyDelete(item) ? (
                              <button
                                type="button"
                                className="danger-button compact-button"
                                onClick={() => {
                                  setActionError('')
                                  setDeleteConfirmation('')
                                  setTestHandoverConfirmation('')
                                  setTestHandoverReason('')
                                  setDeletingItem(item)
                                }}
                              >
                                <Trash2 size={13} /> Permanent Delete
                              </button>
                            ) : !canRestore(item) ? (
                              <span className="student-muted">History only</span>
                            ) : null}
                          </div>
                        )}
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
                {restoringItem.record_type === 'REJECTED_ADMISSION'
                  ? <>Restore <strong>{restoringItem.name}</strong> to Pending Admissions? This will not create an active student.</>
                  : <>Are you sure you want to restore <strong>{restoringItem.name}</strong>? It will be returned to active operational views immediately.</>}
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
                  {restoring ? 'Restoring…' : restoringItem.record_type === 'REJECTED_ADMISSION' ? 'Restore to Pending' : 'Restore Record'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {viewingAdmission ? (
        <Suspense fallback={null}>
          <TrashAdmissionModal item={viewingAdmission} onClose={() => setViewingAdmission(null)} />
        </Suspense>
      ) : null}
      {deletingItem ? (
        <Suspense fallback={null}>
          <TrashPermanentDeleteModal
            item={deletingItem}
            recordTypeLabel={recordTypeLabel(deletingItem.record_type)}
            deleting={deleting}
            actionError={actionError}
            deleteConfirmation={deleteConfirmation}
            testHandoverConfirmation={testHandoverConfirmation}
            testHandoverReason={testHandoverReason}
            onDeleteConfirmationChange={setDeleteConfirmation}
            onTestHandoverConfirmationChange={setTestHandoverConfirmation}
            onTestHandoverReasonChange={setTestHandoverReason}
            onClose={() => {
              if (deleting) return
              setDeletingItem(null)
              setDeleteConfirmation('')
              setTestHandoverConfirmation('')
              setTestHandoverReason('')
            }}
            onPermanentDelete={() => void handlePermanentDelete()}
            onTestHandoverPurge={() => void handleTestHandoverPurge()}
          />
        </Suspense>
      ) : null}
    </section>
  )
}
