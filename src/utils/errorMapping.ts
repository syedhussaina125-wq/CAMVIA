/**
 * CAMVIA User-Facing Error Message Mapper
 * Maps raw database codes and technical exception strings to simple, friendly messages.
 */

export function formatRpcErrorMessage(error: unknown): string {
  if (!error) return 'An unexpected error occurred.'

  const errorObject = typeof error === 'object' && error !== null
    ? error as Record<string, unknown>
    : null
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof errorObject?.message === 'string'
          ? errorObject.message
          : ''
  const code = typeof errorObject?.code === 'string' ? errorObject.code : ''
  const details = typeof errorObject?.details === 'string' ? errorObject.details : ''
  const hint = typeof errorObject?.hint === 'string' ? errorObject.hint : ''
  const status = typeof errorObject?.status === 'number' ? errorObject.status : undefined
  const errorText = `${message} ${details} ${hint}`
  if (typeof errorObject?.mutationOperation === 'string' && message.trim()) {
    return message.trim()
  }

  // 1. Permission / Access Denied (SQLSTATE 42501)
  if (/teacher assignment scope|assigned class|assigned campus|assigned section/i.test(errorText)) {
    return 'This class, section, or campus is not in your active teacher assignments. Ask an Admin to verify your assignment.'
  }
  if (/not assigned to a school|account is not assigned/i.test(errorText)) {
    return 'Your account is not assigned to a school. Ask an Admin to review your school access.'
  }
  if (
    code === '42501' ||
    errorText.includes('42501') ||
    /permission|not authorized|access denied|insufficient privilege|only administrators|only an active/i.test(errorText)
  ) {
    return "You don't have permission to perform this action."
  }

  if (
    code === '23505' ||
    /duplicate key|unique constraint/i.test(errorText)
  ) {
    if (/student ID already exists/i.test(errorText)) {
      return 'Student ID already exists.'
    }
    if (/roll number already exists/i.test(errorText)) {
      return message.trim() || 'Roll number already exists in this class and section.'
    }
    if (/possible duplicate student/i.test(errorText)) {
      return 'Possible duplicate student found. Review before creating.'
    }
    if (/students_school_code_unique/i.test(errorText)) {
      return 'Student ID already exists.'
    }
    return 'A record with one of these unique values already exists. Check the entered values and try again.'
  }

  if (code === '22023' && message) return message
  if (code === 'PGRST202' || code === '42883') {
    return 'The requested operation is not available on the connected database yet. Ask an Admin to verify the RPC deployment.'
  }
  if (status === 409) {
    return 'The database rejected this operation because it conflicts with an existing record or rule. Review the entered values and try again; contact an Admin if it continues.'
  }

  // 2. Trashed Entities
  if (/student.*trash|student.*is in trash/i.test(errorText)) {
    return 'This student is in Trash and cannot be used.'
  }
  if (/guardian.*trash|guardian.*is in trash/i.test(errorText)) {
    return 'This guardian is in Trash and cannot be used.'
  }
  if (/communication.*trash|draft.*trash/i.test(errorText)) {
    return 'This communication draft is in Trash and cannot be used.'
  }

  // 3. Cancelled Financial Records
  if (/payment.*already.*voided|payment.*already.*cancel/i.test(errorText)) {
    return 'This payment has already been cancelled.'
  }
  if (/invoice.*already.*voided|invoice.*already.*cancel/i.test(errorText)) {
    return 'This invoice has already been cancelled.'
  }

  // 4. Trash Recovery Period Expiry
  if (/recovery period has expired|no longer be restored|still within its 30-day/i.test(errorText)) {
    if (/still within its 30-day/i.test(errorText)) {
      return 'This record is still within its 30-day recovery period.'
    }
    return 'This record can no longer be restored because the 30-day recovery period has expired.'
  }

  // 5. Archived Student Operational Lock
  if (/archived student/i.test(errorText)) {
    return 'This student is archived and cannot be modified.'
  }

  // 6. Generic clean fallback
  const cleanMessage = message.replace(/^(error:\s*)+/i, '').trim()
  if (/^(unknown(?:\s+error)?|error)[.!]?$/i.test(cleanMessage)) {
    if (details) return details
    if (hint) return hint
    if (code) return `The server returned database error ${code}. Ask an Admin to review the database response.`
    if (status) return `The server returned HTTP ${status}. Check your connection and ask an Admin to review the error if it continues.`
    return 'Student creation failed without a useful server message. Verify the Student ID and assigned campus, class, and section. If it continues, ask an Admin to review the browser console.'
  }
  if (cleanMessage) return cleanMessage
  if (details) return details
  if (hint) return hint
  if (code) return `The server returned database error ${code}. Ask an Admin to review the database response.`
  if (status) return `The server returned HTTP ${status}. Check your connection and ask an Admin to review the error if it continues.`
  return 'The server returned an unrecognized error. Check the connection and ask an Admin to review the browser console.'
}
