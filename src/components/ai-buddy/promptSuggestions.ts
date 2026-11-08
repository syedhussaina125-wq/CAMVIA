import type { Role } from '../../mockData'

export function getAskCamviaSuggestions(role: Role): string[] {
  if (role === 'teacher') {
    return [
      "Show today's attendance summary.",
      'How many students are in my assigned classes?',
      'Show attendance alerts.',
      'Show my communication drafts.',
    ]
  }
  if (role === 'finance') {
    return [
      'Show fee collection summary.',
      'Show pending fee reminders.',
      'How many students are enrolled?',
    ]
  }
  return [
    "Show today's attendance summary.",
    'How many students are enrolled?',
    'Show pending approvals.',
    'Show fee collection summary.',
    'Show attendance alerts.',
  ]
}
