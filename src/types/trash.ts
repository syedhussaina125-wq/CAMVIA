export type TrashedRecordType =
  | 'STUDENT'
  | 'GUARDIAN'
  | 'COMMUNICATION_DRAFT'
  | 'STUDENT_ARCHIVED'
  | 'GUARDIAN_ARCHIVED'
  | 'ATTENDANCE_SESSION'
  | 'CANCELLED_INVOICE'
  | 'CANCELLED_PAYMENT'

export type TrashedItem = {
  id: string
  record_type: TrashedRecordType
  name: string
  identifier: string
  detail: string
  deleted_at: string
  deleted_by: string
  deleted_by_name: string
  delete_reason: string
  purge_after: string | null
  days_remaining: number | null
  is_tombstoned: boolean
  restorable?: boolean
}
