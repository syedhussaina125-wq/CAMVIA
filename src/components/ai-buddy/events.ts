export type BuddyEventType =
  | 'attendance-saved'
  | 'student-created'
  | 'fee-recorded'
  | 'communication-sent'
  | 'approval-received'
  | 'operation-error'

export type BuddyEventDetail = {
  type: BuddyEventType
}

const BUDDY_EVENT_NAME = 'camvia:buddy-event'

export function dispatchBuddyEvent(type: BuddyEventType): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<BuddyEventDetail>(BUDDY_EVENT_NAME, {
    detail: { type },
  }))
}

export function listenForBuddyEvents(listener: (event: BuddyEventDetail) => void): () => void {
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent) || !isBuddyEventDetail(event.detail)) return
    listener(event.detail)
  }
  window.addEventListener(BUDDY_EVENT_NAME, handler)
  return () => window.removeEventListener(BUDDY_EVENT_NAME, handler)
}

function isBuddyEventDetail(value: unknown): value is BuddyEventDetail {
  if (typeof value !== 'object' || value === null || !('type' in value) || typeof value.type !== 'string') return false
  return [
    'attendance-saved',
    'student-created',
    'fee-recorded',
    'communication-sent',
    'approval-received',
    'operation-error',
  ].includes(value.type)
}
