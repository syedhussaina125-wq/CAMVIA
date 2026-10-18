/**
 * CAMVIA User-Facing Error Message Mapper
 * Maps raw database codes and technical exception strings to simple, friendly messages.
 */

export function formatRpcErrorMessage(error: unknown): string {
  if (!error) return 'An unexpected error occurred.'

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : (error as any)?.message || ''

  // 1. Permission / Access Denied (SQLSTATE 42501)
  if (
    message.includes('42501') ||
    /permission|not authorized|access denied|insufficient privilege|only administrators|only an active/i.test(message)
  ) {
    return "You don't have permission to perform this action."
  }

  // 2. Trashed Entities
  if (/student.*trash|student.*is in trash/i.test(message)) {
    return 'This student is in Trash and cannot be used.'
  }
  if (/guardian.*trash|guardian.*is in trash/i.test(message)) {
    return 'This guardian is in Trash and cannot be used.'
  }
  if (/communication.*trash|draft.*trash/i.test(message)) {
    return 'This communication draft is in Trash and cannot be used.'
  }

  // 3. Cancelled Financial Records
  if (/payment.*already.*voided|payment.*already.*cancel/i.test(message)) {
    return 'This payment has already been cancelled.'
  }
  if (/invoice.*already.*voided|invoice.*already.*cancel/i.test(message)) {
    return 'This invoice has already been cancelled.'
  }

  // 4. Trash Recovery Period Expiry
  if (/recovery period has expired|no longer be restored|still within its 30-day/i.test(message)) {
    if (/still within its 30-day/i.test(message)) {
      return 'This record is still within its 30-day recovery period.'
    }
    return 'This record can no longer be restored because the 30-day recovery period has expired.'
  }

  // 5. Archived Student Operational Lock
  if (/archived student/i.test(message)) {
    return 'This student is archived and cannot be modified.'
  }

  // 6. Generic clean fallback
  return message.replace(/^(error:\s*)+/i, '').trim() || 'An unexpected error occurred.'
}

