import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AttendanceState } from '../../attendanceData'
import type { FeeState } from '../../feeData'
import type { SessionUser } from '../../mockData'
import type { Student } from '../../studentData'
import { askCamvia, type AskCamviaContextPayload, type ChatMessage } from '../../services/askCamvia'
import { dispatchBuddyEvent } from './events'
import type { AlertItem } from '../../alertsData'
import type { CommunicationState } from '../../communicationData'
import { AskCamviaContext, type AskCamviaChatValue } from './context'

const CONTEXT_STORAGE_KEY = 'camvia_buddy_active_context_v1'

function initialMessages(user?: SessionUser | null): ChatMessage[] {
  const roleName = user?.role ? (user.role.charAt(0).toUpperCase() + user.role.slice(1).toLowerCase()) : 'Admin'
  const timeHour = new Date().getHours()
  const timeGreeting = timeHour < 12 ? 'Good morning' : timeHour < 17 ? 'Good afternoon' : 'Good evening'
  
  const greetingName = user?.name || roleName
  return [{
    role: 'assistant',
    text: `${timeGreeting}, ${greetingName}! I am CAMVIA Buddy, your AI school operations partner. Ask me anything about students, attendance trends, pending approvals, or fee collections.`,
    timestamp: Date.now(),
    component: {
      type: 'actions',
      actions: [
        { label: "Today's Briefing", actionType: 'prompt', target: "Give me an overview of today's attendance and fee collections", variant: 'primary' },
        { label: 'Check Approvals', actionType: 'prompt', target: 'Show pending approvals', variant: 'secondary' },
        { label: 'Attendance Alerts', actionType: 'prompt', target: 'Show attendance alerts', variant: 'secondary' }
      ]
    }
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
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages(user))
  const [query, setQuery] = useState('')
  const [generating, setGenerating] = useState(false)
  const [pageContext, setInternalPageContext] = useState<AskCamviaContextPayload>(() => {
    try {
      const saved = sessionStorage.getItem(CONTEXT_STORAGE_KEY)
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })

  const requestIdRef = useRef(0)
  const lastPromptRef = useRef<string>('')
  const abortControllerRef = useRef<AbortController | null>(null)

  const setPageContext = useCallback((context: Partial<AskCamviaContextPayload>) => {
    setInternalPageContext((current) => {
      const updated = { ...current, ...context }
      try {
        sessionStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(updated))
      } catch {
        // Ignored
      }
      return updated
    })
  }, [])

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setGenerating(false)
  }, [])

  const submitPrompt = useCallback(async (prompt: string, overrideContext?: AskCamviaContextPayload) => {
    const normalized = prompt.trim()
    if (!normalized || generating || !user) return

    lastPromptRef.current = normalized
    const requestId = ++requestIdRef.current
    const userMessage: ChatMessage = {
      role: 'user',
      text: normalized,
      timestamp: Date.now(),
    }
    setMessages((current) => [...current, userMessage])
    setQuery('')
    setGenerating(true)

    const effectiveContext: AskCamviaContextPayload = {
      ...pageContext,
      ...overrideContext,
      campusId: pageContext.campusId ?? user.campusId ?? undefined,
    }

    try {
      const response = await askCamvia(normalized, effectiveContext)
      if (requestId === requestIdRef.current) {
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            text: response.text,
            timestamp: Date.now(),
            component: response.component,
            exportData: response.exportData,
          },
        ])

        if (response.context) {
          setPageContext(response.context)
        }
      }
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      dispatchBuddyEvent('operation-error')
      console.error('[CAMVIA AI] Assistant request failed:', error instanceof Error ? error.message : 'Unknown error')
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: 'I could not complete that request. Please try again or check your question.',
          timestamp: Date.now(),
        },
      ])
    } finally {
      if (requestId === requestIdRef.current) setGenerating(false)
    }
  }, [generating, pageContext, setPageContext, user])

  const retryLastPrompt = useCallback(async () => {
    if (lastPromptRef.current) {
      await submitPrompt(lastPromptRef.current)
    }
  }, [submitPrompt])

  const clearMessages = useCallback(() => {
    setMessages(initialMessages(user))
    try {
      sessionStorage.removeItem(CONTEXT_STORAGE_KEY)
    } catch {
      // Ignored
    }
    setInternalPageContext({})
  }, [])

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
    pageContext,
    setQuery,
    submitPrompt,
    clearMessages,
    setPageContext,
    retryLastPrompt,
    stopGeneration,
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
    pageContext,
    query,
    retryLastPrompt,
    setPageContext,
    stopGeneration,
    students,
    submitPrompt,
    user,
  ])

  return <AskCamviaContext.Provider value={value}>{children}</AskCamviaContext.Provider>
}
