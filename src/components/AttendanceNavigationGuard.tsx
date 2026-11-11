import { createContext } from 'react'

export type AttendanceNavigationGuard = (destination: string, onDiscard?: () => void) => boolean

type AttendanceNavigationGuardContextValue = {
  registerGuard: (guard: AttendanceNavigationGuard | null) => () => void
  shouldBlock: (destination: string, onDiscard?: () => void) => boolean
}

export const AttendanceNavigationGuardContext = createContext<AttendanceNavigationGuardContextValue>({
  registerGuard: () => () => undefined,
  shouldBlock: () => false,
})
