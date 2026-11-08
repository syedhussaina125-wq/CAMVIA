import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AttendanceState } from '../../attendanceData'
import type { FeeState } from '../../feeData'
import type { SessionUser } from '../../mockData'
import type { Student } from '../../studentData'
import { askCamvia, type ChatMessage } from '../../services/askCamvia'
import { dispatchBuddyEvent } from './events'
import type { AlertItem } from '../../alertsData'
import type { CommunicationState } from '../../communicationData'
import { AskCamviaContext, type AskCamviaChatValue } from './context'

function initialMessages(): ChatMessage[] {
  return [{
    role: 'assistant',
    text: 'Ask about current school information available to your role. CAMVIA Buddy is read-only.',
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
  const requestIdRef = useRef(0)

  const submitPrompt = useCallback(async (prompt: string) => {
    const normalized = prompt.trim()
    if (!normalized || generating || !user) return

    const requestId = ++requestIdRef.current
    const userMessage: ChatMessage = { role: 'user', text: normalized }
    setMessages((current) => [...current, userMessage])
    setQuery('')
    setGenerating(true)

    try {
      const response = await askCamvia(normalized)
      if (requestId === requestIdRef.current) {
        setMessages((current) => [...current, {
          role: 'assistant',
          text: response.text,
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
    generating,
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
