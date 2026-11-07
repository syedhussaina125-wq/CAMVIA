import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { getCommunicationSummary } from '../../communicationData'
import { getAttendanceClasses, getAttendanceForScope, localDateKey, type AttendanceState } from '../../attendanceData'
import type { FeeState } from '../../feeData'
import { getFeeInvoices, getFeeMetrics } from '../../feeData'
import type { SessionUser } from '../../mockData'
import { getAccessibleStudents, type Student } from '../../studentData'
import { askGemini, type ChatMessage } from '../../services/gemini'
import { dispatchBuddyEvent } from './events'
import type { AlertItem } from '../../alertsData'
import type { CommunicationState } from '../../communicationData'
import { AskCamviaContext, type AskCamviaChatValue } from './context'

function initialMessages(): ChatMessage[] {
  return [{
    role: 'assistant',
    text: 'I can summarize attendance risk, fee pressure, communication workflow, and student focus areas for your authorized school scope.',
  }]
}

type AskCamviaProviderProps = {
  user: SessionUser | null
  students: Student[]
  attendance: AttendanceState
  attendanceLoading: boolean
  attendanceError: string
  fees: FeeState
  communication: CommunicationState
  alerts: AlertItem[]
  alertsLoading: boolean
  alertsError: string
  children: ReactNode
}

export function AskCamviaProvider({
  user,
  students,
  attendance,
  attendanceLoading,
  attendanceError,
  fees,
  communication,
  alerts,
  alertsLoading,
  alertsError,
  children,
}: AskCamviaProviderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [query, setQuery] = useState('')
  const [generating, setGenerating] = useState(false)

  const accessibleStudents = useMemo(
    () => user ? getAccessibleStudents(students, user) : [],
    [students, user],
  )
  const communicationSummary = useMemo(
    () => user ? getCommunicationSummary(communication, students, user) : {
      awaitingApproval: 0,
      drafts: 0,
      feeAwaitingApproval: 0,
      deliveryIssues: 0,
      sentToday: 0,
    },
    [communication, students, user],
  )
  const feeInvoices = useMemo(
    () => user ? getFeeInvoices(fees, students, user) : [],
    [fees, students, user],
  )
  const feeMetrics = useMemo(() => getFeeMetrics(feeInvoices), [feeInvoices])
  const attendanceToday = useMemo(() => getAttendanceForScope(
    attendance,
    getAttendanceClasses(accessibleStudents),
    localDateKey(),
  ), [attendance, accessibleStudents])
  const requestIdRef = useRef(0)

  const generateFallbackResponse = useCallback((prompt: string): string => {
    const lowered = prompt.toLowerCase()

    if (lowered.includes('attendance') || lowered.includes('risk') || lowered.includes('class')) {
      if (attendanceLoading) return 'Today’s attendance data is loading. Please try again shortly.'
      if (attendanceError) return 'Today’s attendance data is unavailable. Open Attendance and retry the request.'
      if (lowered.includes('today') && attendanceToday.sessions.length === 0) {
        return 'No attendance has been recorded today in your authorized scope.'
      }
      if (lowered.includes('today') && attendanceToday.counts.total === 0) {
        return `There are ${attendanceToday.sessions.length} attendance session(s) today, but no student marks have been recorded yet.`
      }
      if (lowered.includes('today') && attendanceToday.counts.total > 0) {
        const { present, late, absent, total, rate } = attendanceToday.counts
        return `Today’s recorded attendance is ${rate}% across ${total} student mark(s) in ${attendanceToday.sessions.length} session(s): ${present} present, ${late} late, and ${absent} absent.`
      }
      if (alertsLoading) return 'Live attendance alert data is loading. Please try again shortly.'
      if (alertsError) return 'Live attendance alert data is unavailable. Open Alerts and retry the request.'
      const attention = alerts.filter((alert) => alert.sourceType === 'ATTENDANCE' && alert.status !== 'RESOLVED')
      if (!attention.length) {
        return 'There are no active attendance alerts in the currently recorded sessions. This does not indicate attendance for sessions that have not been marked.'
      }
      const top = attention.slice(0, 2).map((item) => item.title).join(', ')
      return `I found ${attention.length} attendance watch items in the current scope, including ${top}. These are most likely to need follow-up attention.`
    }

    if (lowered.includes('fee') || lowered.includes('overdue') || lowered.includes('payment')) {
      if (!feeInvoices.length) return 'There are no fee records in your authorized scope right now.'
      const overdueCount = feeInvoices.filter((invoice) => invoice.overdueDays > 0).length
      return `Fee overview: PKR ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(feeMetrics.outstanding)} is outstanding across ${feeInvoices.length} invoices (${overdueCount} overdue). ${communicationSummary.feeAwaitingApproval} fee reminders are awaiting approval.`
    }

    if (lowered.includes('approval') || lowered.includes('communication')) {
      return `Current communication workload: ${communicationSummary.awaitingApproval} message(s) awaiting approval, ${communicationSummary.drafts} drafts in progress, and ${communicationSummary.deliveryIssues} delivery issues reported.`
    }

    if (lowered.includes('student') || lowered.includes('focus') || lowered.includes('attention')) {
      if (alertsLoading || alertsError) return 'Live alert data is currently unavailable. Please open Alerts to check its status and retry.'
      const activeAlerts = alerts.filter((alert) => alert.status !== 'RESOLVED')
      return `Your authorized scope includes ${accessibleStudents.length} students. There are ${activeAlerts.length} active alerts and ${communicationSummary.awaitingApproval} approval items requiring review.`
    }

    if (alertsLoading || alertsError) return 'Live alert data is currently unavailable. Please open Alerts to check its status and retry.'
    const activeAlerts = alerts.filter((alert) => alert.status !== 'RESOLVED')
    return `Current summary: ${accessibleStudents.length} students are in scope, ${activeAlerts.length} alerts are active, and ${communicationSummary.awaitingApproval} parent communications are awaiting review. The most important next action is to check the highest-priority alert and any fee or attendance risk items first.`
  }, [accessibleStudents, alerts, alertsError, alertsLoading, attendanceError, attendanceLoading, attendanceToday, communicationSummary, feeInvoices, feeMetrics.outstanding])

  const submitPrompt = useCallback(async (prompt: string) => {
    const normalized = prompt.trim()
    if (!normalized || generating || !user) return

    const history = messages
    const requestId = ++requestIdRef.current
    const userMessage: ChatMessage = { role: 'user', text: normalized }
    setMessages((current) => [...current, userMessage])
    setQuery('')
    setGenerating(true)

    const activeAlerts = alerts.filter((alert) => alert.status !== 'RESOLVED')
    const alertsSummary = activeAlerts.length > 0
      ? activeAlerts.slice(0, 3).map((alert) => alert.title).join('; ')
      : 'None'
    const overdueCount = feeInvoices.filter((invoice) => invoice.overdueDays > 0).length
    const feeSummary = feeInvoices.length > 0
      ? `PKR ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(feeMetrics.outstanding)} outstanding across ${feeInvoices.length} invoices (${overdueCount} overdue)`
      : 'No fee invoices in current scope'
    const commsSummary = `${communicationSummary.awaitingApproval} awaiting approval, ${communicationSummary.drafts} drafts, ${communicationSummary.deliveryIssues} delivery issues`
    const attendanceSummary = attendanceError
      ? 'Attendance data is unavailable.'
      : attendanceLoading
        ? 'Attendance data is loading.'
        : attendanceToday.sessions.length === 0
          ? 'No attendance has been recorded today in the authorized scope.'
          : attendanceToday.counts.total === 0
            ? `${attendanceToday.sessions.length} attendance session(s) exist today, but no student marks have been recorded.`
            : `${attendanceToday.counts.rate}% attendance across ${attendanceToday.counts.total} marks in ${attendanceToday.sessions.length} session(s): ${attendanceToday.counts.present} present, ${attendanceToday.counts.late} late, ${attendanceToday.counts.absent} absent.`

    try {
      const response = await askGemini(
        normalized,
        history,
        {
          userName: user.name,
          userRole: user.role,
          schoolId: user.schoolId,
          campusId: user.campusId,
          studentCount: accessibleStudents.length,
          attendanceSummary,
          activeAlertsCount: activeAlerts.length,
          alertsSummary,
          feeSummary,
          communicationSummary: commsSummary,
        },
        generateFallbackResponse,
      )
      if (requestId === requestIdRef.current) {
        setMessages((current) => [...current, {
          role: 'assistant',
          text: response.text,
          source: response.source,
        }])
      }
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      dispatchBuddyEvent('operation-error')
      console.error('[CAMVIA AI] Assistant request failed:', error instanceof Error ? error.message : 'Unknown error')
      setMessages((current) => [...current, {
        role: 'assistant',
        text: 'I could not complete that request. Please try again.',
      }])
    } finally {
      if (requestId === requestIdRef.current) setGenerating(false)
    }
  }, [
    accessibleStudents,
    alerts,
    attendanceError,
    attendanceLoading,
    attendanceToday,
    communicationSummary,
    feeInvoices,
    feeMetrics.outstanding,
    generateFallbackResponse,
    generating,
    messages,
    requestIdRef,
    user,
  ])

  const clearMessages = useCallback(() => setMessages(initialMessages()), [])

  const value = useMemo<AskCamviaChatValue>(() => ({
    user,
    students,
    attendance,
    attendanceLoading,
    attendanceError,
    fees,
    communication,
    alerts,
    alertsLoading,
    alertsError,
    messages,
    query,
    generating,
    setQuery,
    submitPrompt,
    clearMessages,
  }), [
    alerts,
    alertsError,
    alertsLoading,
    clearMessages,
    communication,
    attendance,
    attendanceError,
    attendanceLoading,
    fees,
    generating,
    messages,
    query,
    students,
    submitPrompt,
    user,
  ])

  return <AskCamviaContext.Provider value={value}>{children}</AskCamviaContext.Provider>
}
