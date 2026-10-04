import { isSupabaseConfigured, supabase } from '../lib/supabase'
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

export async function fetchAttendanceState(): Promise<AttendanceState> {
  const db = requireSupabase()
  const sessions: SessionRow[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from('attendance_sessions')
      .select('id, organization_id, school_id, campus_id, class_name, section, attendance_date, created_by, updated_by, status, created_at, updated_at')
      .order('attendance_date', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const batch = (data ?? []) as SessionRow[]
    sessions.push(...batch)
    if (batch.length < pageSize) break
  }

  const sessionIds = sessions.map((session) => session.id)
  const records: RecordRow[] = []
  for (let start = 0; start < sessionIds.length; start += idBatchSize) {
    const sessionBatch = sessionIds.slice(start, start + idBatchSize)
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await db
        .from('attendance_records')
        .select('id, attendance_session_id, student_id, status, note, marked_by, created_at, updated_at')
        .in('attendance_session_id', sessionBatch)
        .range(offset, offset + pageSize - 1)
      if (error) throw error
      const batch = (data ?? []) as RecordRow[]
      records.push(...batch)
      if (batch.length < pageSize) break
    }
  }

  const studentCounts = new Map<string, number>()
  for (const record of records) {
    studentCounts.set(record.attendance_session_id, (studentCounts.get(record.attendance_session_id) ?? 0) + 1)
  }

  return {
    sessions: sessions.map((session) => toSession(session, studentCounts.get(session.id) ?? 0)),
    records: records.map(toRecord),
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
  const submittedIds = Object.keys(submission.statuses)
  if (submission.classId !== attendanceClass.id ||
    submittedIds.length !== rosterIds.size ||
    submittedIds.some((studentId) => !rosterIds.has(studentId))) {
    throw new Error('Attendance must include exactly every student in the selected class.')
  }
  if (submittedIds.some((studentId) => !['PRESENT', 'ABSENT', 'LATE'].includes(submission.statuses[studentId]))) {
    throw new Error('One or more attendance statuses are invalid.')
  }

  const { error } = await db.rpc('save_attendance_session', {
    target_organization_id: user.organizationId,
    target_school_id: attendanceClass.schoolId,
    target_campus_id: attendanceClass.campusId,
    target_class_name: attendanceClass.className,
    target_section: attendanceClass.section,
    target_attendance_date: submission.date,
    target_records: attendanceClass.students.map((student) => ({
      student_id: student.id,
      status: submission.statuses[student.id],
      note: (submission.notes[student.id] ?? '').trim(),
    })),
  })
  if (error) throw error

  return fetchAttendanceState()
}
