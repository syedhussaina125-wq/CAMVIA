import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type {
  CommunicationAction,
  CommunicationDraftSubmission,
  CommunicationMessage,
  CommunicationOperation,
  CommunicationState,
} from '../communicationData'
import type { Student } from '../studentData'

const client = supabase as any
const pageSize = 1000
const idBatchSize = 100

type MessageRow = {
  id: string
  organization_id: string
  school_id: string
  campus_id: string
  student_id: string
  created_by: string
  message_type: CommunicationMessage['type']
  channel: CommunicationMessage['channel']
  body: string
  source_type: CommunicationMessage['sourceType']
  source_id: string
  status: CommunicationMessage['status']
  requires_approval: boolean
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string
  sent_by: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

type RecipientRow = { message_id: string; guardian_id: string }
type EventRow = { message_id: string; actor_id: string; action: CommunicationAction; created_at: string }
type GuardianRow = { id: string; first_name: string; last_name: string }

function requireSupabase() {
  if (!isSupabaseConfigured || !client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return client
}

function displayId(uuid: string): number {
  return uuid.split('').reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0)
}

async function fetchByIds<T>(table: string, columns: string, key: string, ids: string[]): Promise<T[]> {
  if (!ids.length) return []
  const db = requireSupabase()
  const result: T[] = []
  for (let start = 0; start < ids.length; start += idBatchSize) {
    const batch = ids.slice(start, start + idBatchSize)
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await db
        .from(table)
        .select(columns)
        .in(key, batch)
        .range(offset, offset + pageSize - 1)
      if (error) throw error
      const rows = (data ?? []) as T[]
      result.push(...rows)
      if (rows.length < pageSize) break
    }
  }
  return result
}

export async function fetchCommunicationState(students: Student[]): Promise<CommunicationState> {
  const db = requireSupabase()
  const messageRows: MessageRow[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from('communication_messages')
      .select('id, organization_id, school_id, campus_id, student_id, created_by, message_type, channel, body, source_type, source_id, status, requires_approval, submitted_at, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, sent_by, sent_at, created_at, updated_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const rows = (data ?? []) as MessageRow[]
    messageRows.push(...rows)
    if (rows.length < pageSize) break
  }

  const ids = messageRows.map((message) => message.id)
  const [recipients, events] = await Promise.all([
    fetchByIds<RecipientRow>('communication_recipients', 'message_id, guardian_id', 'message_id', ids),
    fetchByIds<EventRow>('communication_events', 'message_id, actor_id, action, created_at', 'message_id', ids),
  ])
  const guardianIds = [...new Set(recipients.map((recipient) => recipient.guardian_id))]
  const guardians = await fetchByIds<GuardianRow>('guardians', 'id, first_name, last_name', 'id', guardianIds)

  const studentById = new Map(students.map((student) => [student.id, student]))
  const guardianById = new Map(guardians.map((guardian) => [guardian.id, guardian]))
  const guardianForMessage = new Map<string, string>()
  for (const recipient of recipients) {
    if (!guardianForMessage.has(recipient.message_id)) guardianForMessage.set(recipient.message_id, recipient.guardian_id)
  }
  const eventsByMessage = new Map<string, EventRow[]>()
  for (const event of events) {
    const list = eventsByMessage.get(event.message_id) ?? []
    list.push(event)
    eventsByMessage.set(event.message_id, list)
  }

  return {
    messages: messageRows.flatMap((row) => {
      const student = studentById.get(row.student_id)
      const guardianId = guardianForMessage.get(row.id)
      if (!student || !guardianId) return []
      const guardian = guardianById.get(guardianId)
      const messageEvents = eventsByMessage.get(row.id) ?? []
      return [{
        id: row.id,
        guardianId,
        schoolName: student.school ?? '',
        campusId: student.campusId ?? row.campus_id,
        studentId: row.student_id,
        guardianName: guardian
          ? `${guardian.first_name} ${guardian.last_name}`.trim()
          : student.guardian.name,
        type: row.message_type,
        channel: row.channel,
        message: row.body,
        status: row.status,
        sourceType: row.source_type,
        sourceId: row.source_id,
        createdByUserId: displayId(row.created_by),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        submittedAt: row.submitted_at,
        approvedByUserId: row.approved_by ? displayId(row.approved_by) : null,
        approvedAt: row.approved_at,
        rejectedByUserId: row.rejected_by ? displayId(row.rejected_by) : null,
        rejectedAt: row.rejected_at,
        rejectionReason: row.rejection_reason,
        sentByUserId: row.sent_by ? displayId(row.sent_by) : null,
        sentAt: row.sent_at,
        deliveryStatus: null,
        history: messageEvents.map((event) => ({
          action: event.action,
          userId: displayId(event.actor_id),
          userName: '',
          timestamp: event.created_at,
        })),
      }]
    }),
  }
}

export async function saveCommunicationDraft(
  submission: CommunicationDraftSubmission,
  submit: boolean,
  students: Student[],
): Promise<{ messageId: string; state: CommunicationState }> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('save_communication_draft', {
    target_student_id: submission.studentId,
    target_guardian_id: submission.guardianId,
    target_message_type: submission.type,
    target_channel: submission.channel,
    target_body: submission.message,
    target_source_type: submission.sourceType ?? 'STUDENT',
    target_source_id: submission.sourceId ?? submission.studentId,
    target_message_id: submission.messageId ?? null,
    target_submit: submit,
  })
  if (error) throw error
  if (typeof data !== 'string') throw new Error('Supabase did not return a saved communication ID.')
  return { messageId: data, state: await fetchCommunicationState(students) }
}

export async function transitionCommunication(
  operation: CommunicationOperation,
  students: Student[],
): Promise<CommunicationState> {
  const db = requireSupabase()
  const { error } = await db.rpc('transition_communication_message', {
    target_message_id: operation.messageId,
    target_operation: operation.type,
    target_rejection_reason: operation.type === 'reject' ? operation.reason : '',
  })
  if (error) throw error
  return fetchCommunicationState(students)
}
