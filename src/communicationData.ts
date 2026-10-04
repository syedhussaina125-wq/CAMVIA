import type { Role } from './mockData'
import type { Student } from './studentData'

export type CommunicationType = 'Attendance Reminder' | 'Fee Reminder' | 'General Notice' | 'Follow-up'
export type CommunicationChannel = 'WhatsApp' | 'SMS' | 'Email'
export type CommunicationStatus = 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SENT'
export type DeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED'
export type CommunicationSourceType = 'ATTENDANCE' | 'FEE' | 'STUDENT' | 'MANUAL'
export type CommunicationAction = 'Created' | 'Edited' | 'Submitted' | 'Approved' | 'Rejected' | 'Sent'

export type CommunicationHistoryEntry = {
  action: CommunicationAction
  userId: number
  userName: string
  timestamp: string
}

export type CommunicationMessage = {
  id: string
  guardianId: string
  schoolName: string
  campusId: string
  studentId: string
  guardianName: string
  type: CommunicationType
  channel: CommunicationChannel
  message: string
  status: CommunicationStatus
  sourceType: CommunicationSourceType
  sourceId: string
  createdByUserId: number
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  approvedByUserId: number | null
  approvedAt: string | null
  rejectedByUserId: number | null
  rejectedAt: string | null
  rejectionReason: string
  sentByUserId: number | null
  sentAt: string | null
  deliveryStatus: DeliveryStatus | null
  history: CommunicationHistoryEntry[]
}

export type CommunicationState = {
  messages: CommunicationMessage[]
}

export type CommunicationUser = {
  id: number
  authUserId?: string
  organizationId?: string | null
  schoolId?: string | null
  campusId?: string | null
  name: string
  role: Role
  email: string
  schoolName: string
  campusName: string
  teacherAssignments?: Array<{ campus_id: string; class_name: string; section: string; active: boolean }>
}

export type CommunicationDraftSubmission = {
  studentId: string
  guardianId: string
  type: CommunicationType
  channel: CommunicationChannel
  message: string
  sourceType?: CommunicationSourceType
  sourceId?: string
  messageId?: string
}

export type CommunicationOperation =
  | { type: 'submit'; messageId: string }
  | { type: 'approve'; messageId: string }
  | { type: 'reject'; messageId: string; reason: string }
  | { type: 'send'; messageId: string }

export type CommunicationMessageView = CommunicationMessage & { student: Student }

export const communicationTypes: CommunicationType[] = [
  'Attendance Reminder',
  'Fee Reminder',
  'General Notice',
  'Follow-up',
]

export const communicationChannels: CommunicationChannel[] = ['WhatsApp', 'SMS', 'Email']

function isAssignedStudent(student: Student, user: CommunicationUser): boolean {
  return Boolean(user.teacherAssignments?.some((assignment) =>
    assignment.active &&
    assignment.campus_id === student.campusId &&
    assignment.class_name === student.className &&
    assignment.section === student.section,
  ))
}

export function canAccessCommunication(user: CommunicationUser): boolean {
  return ['admin', 'principal', 'teacher', 'finance'].includes(user.role)
}

export function canCreateCommunication(user: CommunicationUser, type: CommunicationType): boolean {
  if (user.role === 'admin') return true
  if (user.role === 'finance') return type === 'Fee Reminder'
  if (user.role === 'teacher') return type === 'Attendance Reminder' || type === 'Follow-up'
  return false
}

export function getAccessibleCommunication(
  state: CommunicationState,
  students: Student[],
  user: CommunicationUser,
): CommunicationMessageView[] {
  if (!canAccessCommunication(user) || !Array.isArray(state?.messages)) return []
  const studentById = new Map(students.map((student) => [student.id, student]))

  return state.messages.flatMap((message) => {
    const student = studentById.get(message.studentId)
    if (!student || (user.schoolId && student.schoolId !== user.schoolId) ||
      (user.organizationId && student.organizationId !== user.organizationId) ||
      message.schoolName !== user.schoolName) return []
    if (user.role === 'finance' && (message.type !== 'Fee Reminder' || message.sourceType !== 'FEE')) return []
    if (user.role === 'teacher') {
      if (!isAssignedStudent(student, user)) return []
      if (!['Attendance Reminder', 'Follow-up'].includes(message.type) || message.sourceType === 'FEE') return []
    }
    return [{ ...message, student }]
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function getCommunicationSummary(state: CommunicationState, students: Student[], user: CommunicationUser) {
  const messages = getAccessibleCommunication(state, students, user)
  const today = new Date().toISOString().slice(0, 10)
  const awaitingApproval = messages.filter((message) => message.status === 'AWAITING_APPROVAL')
  return {
    drafts: messages.filter((message) => message.status === 'DRAFT').length,
    awaitingApproval: awaitingApproval.length,
    feeAwaitingApproval: awaitingApproval.filter((message) => message.type === 'Fee Reminder').length,
    teacherDrafts: messages.filter((message) => user.role === 'teacher' && message.status === 'DRAFT').length,
    sentToday: messages.filter((message) => message.status === 'SENT' && message.sentAt?.slice(0, 10) === today).length,
    deliveryIssues: messages.filter((message) => message.status === 'SENT' && message.deliveryStatus === 'FAILED').length,
  }
}

export function createAttendanceMessageTemplate(student: Student, consecutiveAbsences: number): string {
  return `Dear Parent,\n${student.firstName} ${student.lastName} has been absent for ${consecutiveAbsences} consecutive recorded school days.\nPlease contact the school if assistance or clarification is needed.`
}

export function createFeeMessageTemplate(student: Student, amount: number, dueDate: string): string {
  const formattedDate = new Intl.DateTimeFormat('en', { day: '2-digit', month: 'long', year: 'numeric' })
    .format(new Date(`${dueDate}T00:00:00Z`))
  return `Dear Parent,\nPKR ${new Intl.NumberFormat('en-PK').format(amount)} is currently outstanding for ${student.firstName} ${student.lastName}.\nDue date: ${formattedDate}.\nPlease contact the school finance office if payment has already been made.`
}
