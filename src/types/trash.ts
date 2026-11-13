export type TrashedRecordType =
  | 'STUDENT'
  | 'GUARDIAN'
  | 'COMMUNICATION_DRAFT'
  | 'STUDENT_ARCHIVED'
  | 'GUARDIAN_ARCHIVED'
  | 'ATTENDANCE_SESSION'
  | 'CANCELLED_INVOICE'
  | 'CANCELLED_PAYMENT'
  | 'REJECTED_ADMISSION'

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
  application_reference?: string
  applying_class?: string
  guardian_name?: string
  guardian_phone?: string
  submitted_at?: string
  rejected_at?: string
  source?: string
}

export type PermanentTrashDeleteResult =
  | { success: true }
  | { success: false; message: string }

export type PermanentlyDeletableTrashRecordType =
  | 'STUDENT'
  | 'GUARDIAN'
  | 'COMMUNICATION_DRAFT'
  | 'REJECTED_ADMISSION'

export const TEST_HANDOVER_PURGE_CONFIRMATION = 'PURGE TEST/HANDOVER'
