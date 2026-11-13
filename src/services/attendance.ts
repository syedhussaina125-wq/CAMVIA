import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { mapConcurrent } from './mapConcurrent'
import { runMutation } from './mutations'
import {
  getAttendanceClassId,
  type AttendanceClass,
  type AttendanceRecord,
  type AttendanceSession,
  type AttendanceState,
  type AttendanceSubmission,
  type AttendanceUser,
} from '../attendanceData'

const client = supabase as any
const pageSize = 1000
const idBatchSize = 100

export type AttendanceErrorKind =
  | 'AUTH_ERROR'
  | 'PERMISSION_ERROR'
  | 'SCHEMA_ERROR'
  | 'NETWORK_ERROR'
  | 'RPC_MISSING'
  | 'DATA_ERROR'

export type AttendanceRequestContext = {
  role?: string
  route?: string
}

export class AttendanceServiceError extends Error {
  readonly kind: AttendanceErrorKind
  readonly operation: string
  readonly code: string | undefined

  constructor(
    kind: AttendanceErrorKind,
    operation: string,
    code: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'AttendanceServiceError'
    this.kind = kind
    this.operation = operation
    this.code = code
  }
}

function classifyAttendanceError(error: unknown): AttendanceErrorKind {
  const value = typeof error === 'object' && error !== null
    ? error as { code?: unknown; status?: unknown; message?: unknown }
    : null
  const code = typeof value?.code === 'string' ? value.code : ''
  const status = typeof value?.status === 'number' ? value.status : 0
  const message = typeof value?.message === 'string' ? value.message : ''

  if (/supabase is not configured/i.test(message)) return 'SCHEMA_ERROR'
  if (code === 'PGRST202') return 'RPC_MISSING'
  if (code === '42501' || status === 403) return 'PERMISSION_ERROR'
  if (code === '28000' || code === '28P01' || status === 401) return 'AUTH_ERROR'
  if (code === '42P01' || code === '42703' || code === 'PGRST203' || code === 'PGRST204' || code === 'PGRST205') return 'SCHEMA_ERROR'
  if (/fetch failed|network|failed to fetch|load failed/i.test(message)) return 'NETWORK_ERROR'
  return 'DATA_ERROR'
}

export function getAttendanceErrorMessage(error: unknown): string {
  const kind = error instanceof AttendanceServiceError ? error.kind : classifyAttendanceError(error)
  switch (kind) {
    case 'AUTH_ERROR':
      return 'Your session has expired. Sign in again to load attendance.'
    case 'PERMISSION_ERROR':
      return "You don't have access to this attendance data."
    case 'NETWORK_ERROR':
      return 'Attendance could not be loaded. Check your connection and try again.'
    case 'SCHEMA_ERROR':
    case 'RPC_MISSING':
      return 'Attendance is temporarily unavailable.'
    case 'DATA_ERROR':
      return 'Attendance could not be loaded. Please try again.'
  }
}

type SessionRow = {
  id: string
  organization_id: string
  school_id: string
  campus_id: string
  class_name: string
  section: string
  attendance_date: string
  created_by: string
  updated_by: string
  status: 'IN_PROGRESS' | 'COMPLETED'
  created_at: string
  updated_at: string
}

type RecordRow = {
  id: string
  attendance_session_id: string
  student_id: string
  status: 'PRESENT' | 'ABSENT' | 'LATE'
  note: string
  marked_by: string
  created_at: string
  updated_at: string
}

function throwAttendanceQueryError(
  operation: string,
  error: { code?: string; message: string },
  context: AttendanceRequestContext,
): never {
  const kind = classifyAttendanceError(error)
  if (import.meta.env.DEV) {
    console.error('[Supabase] Attendance query failed:', {
      operation,
      route: context.route ?? window.location.pathname,
      role: context.role ?? 'unknown',
      code: error.code,
      kind,
      message: error.message,
    })
  }
  throw new AttendanceServiceError(kind, operation, error.code, error.message)
}

function requireSupabase() {
  if (!isSupabaseConfigured || !client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return client
}

function toSession(row: SessionRow, studentCount: number): AttendanceSession {
  return {
    id: row.id,
    date: row.attendance_date,
    classId: getAttendanceClassId(row.class_name, row.section, row.campus_id),
    className: row.class_name,
    section: row.section,
    schoolId: row.school_id,
    campusId: row.campus_id,
    status: row.status,
    markedByUserId: row.created_by,
    completedAt: row.status === 'COMPLETED' ? row.updated_at : null,
    studentCount,
  }
}

function toRecord(row: RecordRow): AttendanceRecord {
  return {
    id: row.id,
    sessionId: row.attendance_session_id,
    studentId: row.student_id,
    status: row.status,
    note: row.note,
    markedByUserId: row.marked_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history: [],
  }
}

function isMissingTrashColumn(error: { code?: string; message?: string }): boolean {
  return error.code === '42703' && /trashed_at/i.test(error.message ?? '')
}

function logOptionalTrashColumnMissing(context: AttendanceRequestContext): void {
  if (import.meta.env.DEV) {
    console.warn('[CAMVIA Attendance] Attendance Trash migration is not installed; loading legacy attendance records.', {
      operation: 'attendance_records.select',
      route: context.route ?? window.location.pathname,
      role: context.role ?? 'unknown',
      column: 'attendance_records.trashed_at',
    })
  }
}

async function loadAttendanceState(context: AttendanceRequestContext): Promise<AttendanceState> {
  let db
  try {
    db = requireSupabase()
  } catch (error) {
    throwAttendanceQueryError('attendance.client', {
      message: error instanceof Error ? error.message : 'Supabase is not configured.',
    }, context)
  }
  const sessions: SessionRow[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from('attendance_sessions')
      .select('id, organization_id, school_id, campus_id, class_name, section, attendance_date, created_by, updated_by, status, created_at, updated_at')
      .order('attendance_date', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) throwAttendanceQueryError('attendance_sessions.select', error, context)
    const batch = (data ?? []) as SessionRow[]
    sessions.push(...batch)
    if (batch.length < pageSize) break
  }

  if (sessions.length === 0) return { sessions: [], records: [] }

  const sessionIds = sessions.map((session) => session.id)
  const sessionBatches = Array.from({ length: Math.ceil(sessionIds.length / idBatchSize) }, (_, index) =>
    sessionIds.slice(index * idBatchSize, (index + 1) * idBatchSize),
  )
  let trashColumnAvailable = true
  const recordBatches = await mapConcurrent(sessionBatches, async (sessionBatch) => {
    const records: RecordRow[] = []
    for (let offset = 0; ; offset += pageSize) {
      const request = () => db
        .from('attendance_records')
        .select('id, attendance_session_id, student_id, status, note, marked_by, created_at, updated_at')
        .in('attendance_session_id', sessionBatch)
        .range(offset, offset + pageSize - 1)
      let result = trashColumnAvailable ? await request().is('trashed_at', null) : await request()
      if (result.error && trashColumnAvailable && isMissingTrashColumn(result.error)) {
        trashColumnAvailable = false
        logOptionalTrashColumnMissing(context)
        result = await request()
      }
      if (result.error) throwAttendanceQueryError('attendance_records.select', result.error, context)
      const { data } = result
      const batch = (data ?? []) as RecordRow[]
      records.push(...batch)
      if (batch.length < pageSize) break
    }
    return records
  })
  const records = recordBatches.flat()

  const studentCounts = new Map<string, number>()
  for (const record of records) {
    studentCounts.set(record.attendance_session_id, (studentCounts.get(record.attendance_session_id) ?? 0) + 1)
  }

  return {
    sessions: sessions.map((session) => toSession(session, studentCounts.get(session.id) ?? 0)),
    records: records.map(toRecord),
  }
}

export async function fetchAttendanceState(context: AttendanceRequestContext = {}): Promise<AttendanceState> {
  try {
    return await loadAttendanceState(context)
  } catch (error) {
    if (error instanceof AttendanceServiceError) throw error
    const value = typeof error === 'object' && error !== null
      ? error as { code?: unknown; message?: unknown; status?: unknown }
      : null
    const code = typeof value?.code === 'string' ? value.code : undefined
    const message = typeof value?.message === 'string'
      ? value.message
      : error instanceof Error ? error.message : 'Attendance request failed.'
    const kind = classifyAttendanceError(error)
    if (import.meta.env.DEV) {
      console.error('[CAMVIA Attendance] Attendance load failed:', {
        operation: 'attendance.load',
        route: context.route ?? window.location.pathname,
        role: context.role ?? 'unknown',
        code,
        kind,
        message,
      })
    }
    throw new AttendanceServiceError(kind, 'attendance.load', code, message)
  }
}

export async function saveAttendance(
  user: AttendanceUser,
  attendanceClass: AttendanceClass,
  submission: AttendanceSubmission,
): Promise<AttendanceState> {
  const db = requireSupabase()
  if (!user.organizationId || !user.schoolId) {
    throw new Error('Your active profile has no attendance school scope.')
  }

  const parsedDate = new Date(`${submission.date}T00:00:00`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(submission.date) ||
    Number.isNaN(parsedDate.getTime()) ||
    `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}-${String(parsedDate.getDate()).padStart(2, '0')}` !== submission.date) {
    throw new Error('Choose a valid attendance date.')
  }

  const rosterIds = new Set(attendanceClass.students.map((student) => student.id))
  const submittedIds = submission.changedStudentIds
  if (submission.classId !== attendanceClass.id ||
    submittedIds.length === 0 ||
    new Set(submittedIds).size !== submittedIds.length ||
    submittedIds.some((studentId) => !rosterIds.has(studentId)) ||
    submittedIds.some((studentId) => !Object.prototype.hasOwnProperty.call(submission.statuses, studentId))) {
    throw new Error('Attendance changes must include one or more students in the selected class.')
  }
  if (submittedIds.some((studentId) => !['PRESENT', 'ABSENT', 'LATE'].includes(submission.statuses[studentId]))) {
    throw new Error('One or more attendance statuses are invalid.')
  }

  await runMutation('save_attendance_session', submission.classId, () => db.rpc('save_attendance_session', {
    target_organization_id: user.organizationId,
    target_school_id: attendanceClass.schoolId,
    target_campus_id: attendanceClass.campusId,
    target_class_name: attendanceClass.className,
    target_section: attendanceClass.section,
    target_attendance_date: submission.date,
    target_records: submittedIds.map((studentId) => ({
      student_id: studentId,
      status: submission.statuses[studentId],
      note: (submission.notes[studentId] ?? '').trim(),
    })),
  }))

  return fetchAttendanceState({ role: user.role, route: window.location.pathname })
}

export async function correctAttendanceSession(payload: {
  sessionId: string
  records: Array<{ student_id: string; status: 'PRESENT' | 'ABSENT' | 'LATE'; note?: string }>
  reason: string
}, context: AttendanceRequestContext = {}): Promise<AttendanceState> {
  const db = requireSupabase()
  await runMutation('correct_attendance_session', payload.sessionId, () => db.rpc('correct_attendance_session', {
    p_session_id: payload.sessionId,
    p_records: payload.records.map((r) => ({
      student_id: r.student_id,
      status: r.status,
      note: (r.note ?? '').trim(),
    })),
    p_reason: payload.reason,
  }))
  return fetchAttendanceState(context)
}
