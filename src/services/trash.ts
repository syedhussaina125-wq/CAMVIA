import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { TrashedItem } from '../types/trash'

const client = supabase as any

export type TrashedRecordsResult = {
  items: TrashedItem[]
  legacyOnly: boolean
}

function isUnifiedTrashRpcMissing(error: { code?: unknown; message?: unknown }) {
  return error.code === 'PGRST202' ||
    error.code === '42883' ||
    (typeof error.message === 'string' &&
      /get_unified_trash_records.*(not found|does not exist|schema cache)/i.test(error.message))
}

function requireSupabase() {
  if (!isSupabaseConfigured || !client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return client
}

export async function fetchTrashedRecords(recordType: string = 'ALL'): Promise<TrashedRecordsResult> {
  const db = requireSupabase()
  const unifiedResult = await db.rpc('get_unified_trash_records', {
    p_record_type: recordType,
  })
  if (!unifiedResult.error) {
    return { items: (unifiedResult.data ?? []) as TrashedItem[], legacyOnly: false }
  }
  if (!isUnifiedTrashRpcMissing(unifiedResult.error)) throw unifiedResult.error

  console.warn('[Supabase] Unified Trash RPC is not installed; loading legacy Trash records.')
  const legacyResult = await db.rpc('get_trashed_records', {
    p_record_type: recordType,
  })
  if (legacyResult.error) throw legacyResult.error
  return { items: (legacyResult.data ?? []) as TrashedItem[], legacyOnly: true }
}

export async function trashStudent(studentId: string, reason: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('trash_student', {
    p_student_id: studentId,
    p_reason: reason,
  })
  if (error) throw error
}

export async function trashGuardian(guardianId: string, reason: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('trash_guardian', {
    p_guardian_id: guardianId,
    p_reason: reason,
  })
  if (error) throw error
}

export async function trashCommunicationDraft(messageId: string, reason: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('trash_communication_draft', {
    p_message_id: messageId,
    p_reason: reason,
  })
  if (error) throw error
}

export async function restoreTrashedStudent(studentId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('restore_trashed_student', {
    p_student_id: studentId,
  })
  if (error) throw error
}

export async function restoreTrashedGuardian(guardianId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('restore_trashed_guardian', {
    p_guardian_id: guardianId,
  })
  if (error) throw error
}

export async function restoreTrashedCommunication(messageId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('restore_trashed_communication', {
    p_message_id: messageId,
  })
  if (error) throw error
}

export async function trashAttendanceSession(sessionId: string, reason: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('trash_attendance_session', {
    p_session_id: sessionId,
    p_reason: reason,
  })
  if (error) throw error
}

export async function restoreTrashedAttendanceSession(sessionId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('restore_trashed_attendance_session', {
    p_session_id: sessionId,
  })
  if (error) throw error
}
