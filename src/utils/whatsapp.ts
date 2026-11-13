import type { Role } from '../mockData'
import type { Student } from '../studentData'
import type { AttendanceStatus } from '../attendanceData'

export type WhatsAppTemplate =
  | 'General Message'
  | 'Attendance Alert'
  | 'Low Attendance'
  | 'Fee Reminder'
  | 'Custom Message'

export type WhatsAppMessagingUser = {
  role: Role
  organizationId?: string | null
  schoolId?: string | null
  teacherAssignments?: Array<{
    school_id?: string
    campus_id: string
    class_name: string
    section: string
    active: boolean
  }>
}

export type WhatsAppMessageContext = {
  attendance?: {
    status?: AttendanceStatus | 'UNMARKED' | null
    date?: string
    rate: number | null
    recordedDays: number
  }
  fee?: {
    outstandingAmount: number
    dueDate: string
  }
}

export const whatsAppTemplates: WhatsAppTemplate[] = [
  'General Message',
  'Attendance Alert',
  'Low Attendance',
  'Fee Reminder',
  'Custom Message',
]

export function normalizeWhatsAppPhone(phone: string): string | null {
  const value = phone.trim()
  if (!value || !/^\+?[\d\s().-]+$/.test(value)) return null

  let digits = value.replace(/\D/g, '')
  if (value.startsWith('00')) digits = digits.slice(2)
  else if (value.startsWith('+')) {
    // International numbers already include their country code.
  } else if (digits.startsWith('0')) {
    digits = `92${digits.slice(1)}`
  } else if (digits.length === 10 && digits.startsWith('3')) {
    digits = `92${digits}`
  }

  if (digits.length < 8 || digits.length > 15) return null
  return digits
}

export function canPrepareWhatsAppForStudent(
  user: WhatsAppMessagingUser,
  student: Student,
): boolean {
  if (user.organizationId && student.organizationId !== user.organizationId) return false

  if (user.role === 'admin') {
    return !user.schoolId || student.schoolId === user.schoolId
  }
  if (user.role === 'principal' || user.role === 'finance') {
    return Boolean(user.schoolId && student.schoolId === user.schoolId)
  }
  if (user.role !== 'teacher' || !student.schoolId || !student.campusId) return false

  return Boolean(user.teacherAssignments?.some((assignment) =>
    assignment.active &&
    (!assignment.school_id || assignment.school_id === student.schoolId) &&
    assignment.campus_id === student.campusId &&
    assignment.class_name.trim().replace(/\s+/g, ' ').toLowerCase() === student.className.trim().replace(/\s+/g, ' ').toLowerCase() &&
    assignment.section.trim().replace(/\s+/g, ' ').toLowerCase() === student.section.trim().replace(/\s+/g, ' ').toLowerCase(),
  ))
}

export function canUseWhatsAppTemplate(
  user: WhatsAppMessagingUser,
  template: WhatsAppTemplate,
  context: WhatsAppMessageContext,
): boolean {
  if (user.role === 'finance') return template === 'Fee Reminder' && Boolean(context.fee && context.fee.outstandingAmount > 0)
  if (user.role === 'teacher') return ['Attendance Alert', 'Low Attendance', 'Custom Message'].includes(template)
  if (['admin', 'principal'].includes(user.role)) return true
  return false
}

export function isWhatsAppTemplateReady(
  template: WhatsAppTemplate,
  context: WhatsAppMessageContext,
): boolean {
  if (template === 'Attendance Alert') {
    return Boolean(context.attendance?.date && context.attendance.status && context.attendance.status !== 'UNMARKED')
  }
  if (template === 'Low Attendance') {
    return Boolean(context.attendance?.recordedDays && context.attendance.rate !== null && context.attendance.rate < 75)
  }
  if (template === 'Fee Reminder') {
    return Boolean(context.fee && context.fee.outstandingAmount > 0 && context.fee.dueDate)
  }
  return true
}

export function createWhatsAppTemplateMessage(
  template: WhatsAppTemplate,
  student: Student,
  context: WhatsAppMessageContext,
): string {
  const studentName = `${student.firstName} ${student.lastName}`
  if (template === 'General Message') {
    return `Dear Parent/Guardian,\n\nI am contacting you regarding ${studentName} (${student.studentId}), ${student.className}-${student.section}.\n\n`
  }
  if (template === 'Attendance Alert') {
    const status = context.attendance?.status?.toLowerCase() ?? 'updated'
    return `Dear Parent/Guardian,\n\n${studentName} (${student.studentId}) was marked ${status} on ${formatDate(context.attendance?.date ?? '')}.\n\nPlease contact the school if you need any clarification.`
  }
  if (template === 'Low Attendance') {
    const rate = context.attendance?.rate
    return `Dear Parent/Guardian,\n\n${studentName} (${student.studentId}) has an attendance rate of ${rate ?? 0}% across ${context.attendance?.recordedDays ?? 0} recorded attendance days.\n\nPlease contact the school to discuss any support needed.`
  }
  if (template === 'Fee Reminder') {
    const amount = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 })
      .format(context.fee?.outstandingAmount ?? 0)
    return `Dear Parent/Guardian,\n\nPKR ${amount} is outstanding for ${studentName} (${student.studentId}). Due date: ${formatDate(context.fee?.dueDate ?? '')}.\n\nPlease contact the school finance office if payment has already been made.`
  }
  return ''
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-PK', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}
