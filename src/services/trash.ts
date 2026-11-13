import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type {
  PermanentlyDeletableTrashRecordType,
  PermanentTrashDeleteResult,
  TrashedItem,
} from '../types/trash'
import { TEST_HANDOVER_PURGE_CONFIRMATION } from '../types/trash'
import { fetchRejectedAdmissions, type RejectedAdmission } from './admissions'
import { mutationConfirmationError, runMutation } from './mutations'

const client = supabase as any

export type TrashedRecordsResult = {
  items: TrashedItem[]
}

export type TrashDirectoryResult = {
  items: TrashedItem[]
  categoryErrors: { category: 'records' | 'admissions'; error: unknown }[]
}

function mapRejectedAdmission(application: RejectedAdmission): TrashedItem {
  return {
    id: application.id,
    record_type: 'REJECTED_ADMISSION',
    name: application.student_name,
    identifier: application.application_reference,
    detail: application.applying_class,
    deleted_at: application.rejected_at ?? application.submitted_at,
    deleted_by: '',
    deleted_by_name: application.rejected_by_name,
    delete_reason: application.rejection_reason,
    purge_after: null,
    days_remaining: null,
    is_tombstoned: false,
    restorable: true,
    application_reference: application.application_reference,
    applying_class: application.applying_class,
    guardian_name: application.guardian_name,
    guardian_phone: application.guardian_phone,
    submitted_at: application.submitted_at,
    rejected_at: application.rejected_at ?? undefined,
    source: 'Parent Registration',
  }
}

function requireSupabase() {
  if (!isSupabaseConfigured || !client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return client
}

export async function fetchTrashedRecords(recordType: string = 'ALL'): Promise<TrashedRecordsResult> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('get_unified_trash_records', {
    p_record_type: recordType,
  })
  if (error) throw error
  return { items: (data ?? []) as TrashedItem[] }
}

export async function fetchTrashDirectory(): Promise<TrashDirectoryResult> {
  const [recordsResult, admissionsResult] = await Promise.allSettled([
    fetchTrashedRecords('ALL'),
    fetchRejectedAdmissions(),
  ])
  const categoryErrors: TrashDirectoryResult['categoryErrors'] = []
  let items: TrashedItem[] = []

  if (recordsResult.status === 'fulfilled') {
    items = recordsResult.value.items
  } else {
    categoryErrors.push({ category: 'records', error: recordsResult.reason })
  }

  if (admissionsResult.status === 'fulfilled') {
    items = [...items, ...admissionsResult.value.map(mapRejectedAdmission)]
  } else {
    categoryErrors.push({ category: 'admissions', error: admissionsResult.reason })
  }

  return { items, categoryErrors }
}

export async function trashStudent(studentId: string, reason: string): Promise<void> {
  const db = requireSupabase()
  const data = await runMutation<{ student_id: string; deleted_at: string }>('trash_student', studentId, () => db.rpc('trash_student', {
    p_student_id: studentId,
    p_reason: reason,
  }), true)
  if (!data || data.student_id !== studentId || !data.deleted_at) {
    throw mutationConfirmationError('trash_student', studentId, 'trash_student did not confirm the requested student was moved to Trash.')
  }
}

export async function trashGuardian(guardianId: string, reason: string): Promise<void> {
  const db = requireSupabase()
  const data = await runMutation<{ guardian_id: string; deleted_at: string }>('trash_guardian', guardianId, () => db.rpc('trash_guardian', {
    p_guardian_id: guardianId,
    p_reason: reason,
  }), true)
  if (!data || data.guardian_id !== guardianId || !data.deleted_at) {
    throw mutationConfirmationError('trash_guardian', guardianId, 'trash_guardian did not confirm the requested guardian was moved to Trash.')
  }
}

export async function trashCommunicationDraft(messageId: string, reason: string): Promise<void> {
  const db = requireSupabase()
  const data = await runMutation<{ message_id: string; deleted_at: string }>('trash_communication_draft', messageId, () => db.rpc('trash_communication_draft', {
    p_message_id: messageId,
    p_reason: reason,
  }), true)
  if (!data || data.message_id !== messageId || !data.deleted_at) {
    throw mutationConfirmationError('trash_communication_draft', messageId, 'trash_communication_draft did not confirm the requested message was moved to Trash.')
  }
}

export async function restoreTrashedStudent(studentId: string): Promise<void> {
  const db = requireSupabase()
  const data = await runMutation<{ student_id: string; restored_at: string }>('restore_trashed_student', studentId, () => db.rpc('restore_trashed_student', {
    p_student_id: studentId,
  }), true)
  if (!data || data.student_id !== studentId || !data.restored_at) {
    throw mutationConfirmationError('restore_trashed_student', studentId, 'restore_trashed_student did not confirm the requested student was restored.')
  }
}

export async function restoreTrashedGuardian(guardianId: string): Promise<void> {
  const db = requireSupabase()
  const data = await runMutation<{ guardian_id: string; restored_at: string }>('restore_trashed_guardian', guardianId, () => db.rpc('restore_trashed_guardian', {
    p_guardian_id: guardianId,
  }), true)
  if (!data || data.guardian_id !== guardianId || !data.restored_at) {
    throw mutationConfirmationError('restore_trashed_guardian', guardianId, 'restore_trashed_guardian did not confirm the requested guardian was restored.')
  }
}

export async function restoreTrashedCommunication(messageId: string): Promise<void> {
  const db = requireSupabase()
  const data = await runMutation<{ message_id: string; restored_at: string }>('restore_trashed_communication', messageId, () => db.rpc('restore_trashed_communication', {
    p_message_id: messageId,
  }), true)
  if (!data || data.message_id !== messageId || !data.restored_at) {
    throw mutationConfirmationError('restore_trashed_communication', messageId, 'restore_trashed_communication did not confirm the requested message was restored.')
  }
}

export async function trashAttendanceSession(sessionId: string, reason: string): Promise<void> {
  const db = requireSupabase()
  const data = await runMutation<{ records_moved: number }>('trash_attendance_session', sessionId, () => db.rpc('trash_attendance_session', {
    p_session_id: sessionId,
    p_reason: reason,
  }), true)
  if (!data || typeof data.records_moved !== 'number' || data.records_moved < 1) {
    throw mutationConfirmationError('trash_attendance_session', sessionId, 'trash_attendance_session did not confirm any attendance records were moved to Trash.')
  }
}

export async function restoreTrashedAttendanceSession(sessionId: string): Promise<void> {
  const db = requireSupabase()
  const data = await runMutation<{ records_restored: number }>('restore_trashed_attendance_session', sessionId, () => db.rpc('restore_trashed_attendance_session', {
    p_session_id: sessionId,
  }), true)
  if (!data || typeof data.records_restored !== 'number' || data.records_restored < 1) {
    throw mutationConfirmationError('restore_trashed_attendance_session', sessionId, 'restore_trashed_attendance_session did not confirm any attendance records were restored.')
  }
}

async function callPermanentDeleteRpc(
  rpcName: string,
  args: Record<string, string>,
  unavailableMessage: string,
): Promise<PermanentTrashDeleteResult> {
  const db = requireSupabase()
  let data
  try {
    data = await runMutation<{ success: boolean; message?: string }>(rpcName, String(args.p_student_id ?? args.p_record_id ?? ''), () =>
      db.rpc(rpcName, args), true)
  } catch (error) {
    const rpcError = error as { code?: string }
    if (rpcError.code === 'PGRST202' || rpcError.code === '42883') {
      throw new Error(unavailableMessage)
    }
    throw error
  }

  if (
    data &&
    typeof data === 'object' &&
    typeof data.success === 'boolean'
  ) {
    if (data.success) return { success: true }
    if (typeof data.message === 'string') return { success: false, message: data.message }
  }

  throw new Error('The server returned an unexpected response. The record remains in Trash.')
}

export async function permanentlyDeleteTrashItem(
  recordType: PermanentlyDeletableTrashRecordType,
  recordId: string,
  confirmation = '',
): Promise<PermanentTrashDeleteResult> {
  if (recordType === 'STUDENT') {
    if (confirmation !== 'DELETE') {
      return {
        success: false,
        message: 'Type DELETE in the Trash confirmation to permanently delete this student.',
      }
    }
    return callPermanentDeleteRpc(
      'permanently_delete_trashed_student',
      { p_student_id: recordId, p_confirmation: confirmation },
      'Student permanent deletion is unavailable until 040_student_permanent_delete.sql is applied.',
    )
  }

  return callPermanentDeleteRpc(
    'permanently_delete_trash_item',
    { p_record_type: recordType, p_record_id: recordId },
    'Permanent deletion is unavailable until 038_trash_permanent_delete.sql is applied after its prerequisite migrations.',
  )
}

export async function purgeTestHandoverStudent(
  studentId: string,
  confirmation: string,
  reason: string,
): Promise<PermanentTrashDeleteResult> {
  if (confirmation !== TEST_HANDOVER_PURGE_CONFIRMATION) {
    return {
      success: false,
      message: `Type ${TEST_HANDOVER_PURGE_CONFIRMATION} to confirm this exceptional purge.`,
    }
  }

  if (reason.trim().length < 10 || reason.trim().length > 500) {
    return {
      success: false,
      message: 'Provide a test/handover purge reason of 10 to 500 characters.',
    }
  }

  return callPermanentDeleteRpc(
    'purge_test_handover_student',
    {
      p_student_id: studentId,
      p_confirmation: confirmation,
      p_reason: reason,
    },
    'The exceptional test/handover purge is unavailable until 040_student_permanent_delete.sql is applied.',
  )
}
