export type TrashedRecordType = 'STUDENT' | 'GUARDIAN' | 'COMMUNICATION_DRAFT'

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
  purge_after: string
  days_remaining: number
  is_tombstoned: boolean
}

