import { getAttendanceClassId } from './attendanceData'

export type AlertPriority = 'HIGH' | 'MEDIUM' | 'NOTICE'
export type AlertStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED'
export type AlertSourceType = 'ATTENDANCE' | 'FEE' | 'COMMUNICATION'

export type AlertItem = {
  id: string
  title: string
  detail: string
  priority: AlertPriority
  status: AlertStatus
  sourceType: AlertSourceType
  sourceId: string
  studentId?: string
  classId?: string
  parentMessageId?: string
  createdAt: string
}

export type LiveAlertRow = {
  id: string
  campus_id: string | null
  student_id: string | null
  class_name: string | null
  section: string | null
  priority: string
  status: string
  source_type: string
  source_id: string
  title: string
  detail: string
  created_at: string
  priority_rank: number
  status_rank: number
}

function isAlertPriority(value: string): value is AlertPriority {
  return value === 'HIGH' || value === 'MEDIUM' || value === 'NOTICE'
}

function isAlertStatus(value: string): value is AlertStatus {
  return value === 'OPEN' || value === 'IN_REVIEW' || value === 'RESOLVED'
}

function isAlertSourceType(value: string): value is AlertSourceType {
  return value === 'ATTENDANCE' || value === 'FEE' || value === 'COMMUNICATION'
}

export function mapLiveAlert(row: LiveAlertRow): AlertItem {
  if (!isAlertPriority(row.priority) || !isAlertStatus(row.status) || !isAlertSourceType(row.source_type)) {
    throw new Error(`Supabase returned an unsupported alert value for ${row.id}.`)
  }
  if (row.source_type === 'ATTENDANCE' && !row.student_id && (!row.campus_id || !row.class_name || !row.section)) {
    throw new Error(`Supabase returned an incomplete attendance alert scope for ${row.id}.`)
  }

  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    priority: row.priority,
    status: row.status,
    sourceType: row.source_type,
    sourceId: row.source_id,
    studentId: row.student_id ?? undefined,
    classId: !row.student_id && row.source_type === 'ATTENDANCE' && row.campus_id && row.class_name && row.section
      ? getAttendanceClassId(row.class_name, row.section, row.campus_id)
      : undefined,
    parentMessageId: row.source_type === 'COMMUNICATION' ? row.source_id : undefined,
    createdAt: row.created_at,
  }
}
