import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { TrashedItem } from '../types/trash'

const client = supabase as any

function requireSupabase() {
  if (!isSupabaseConfigured || !client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return client
}

export async function fetchTrashedRecords(recordType: string = 'ALL'): Promise<TrashedItem[]> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('get_trashed_records', {
    p_record_type: recordType,
  })
  if (error) throw error
  return (data ?? []) as TrashedItem[]
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

