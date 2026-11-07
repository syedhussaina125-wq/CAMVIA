import { createContext } from 'react'
import type { AlertItem } from '../../alertsData'
import type { AttendanceState } from '../../attendanceData'
import type { CommunicationState } from '../../communicationData'
import type { FeeState } from '../../feeData'
import type { SessionUser } from '../../mockData'
import type { Student } from '../../studentData'
import type { ChatMessage } from '../../services/gemini'

export type AskCamviaChatValue = {
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
  messages: ChatMessage[]
  query: string
  generating: boolean
  setQuery: (query: string) => void
  submitPrompt: (prompt: string) => Promise<void>
  clearMessages: () => void
}

export const AskCamviaContext = createContext<AskCamviaChatValue | null>(null)
