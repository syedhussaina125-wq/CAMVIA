import { isSupabaseConfigured, supabase } from '../lib/supabase'

export type ChatMessage = {
  role: 'assistant' | 'user'
  text: string
  source?: 'gemini' | 'context'
}

export type AskCamviaResponse = {
  text: string
  source: 'gemini' | 'context'
}

export type AskCamviaContext = {
  userName: string
  userRole: string
  schoolId: string | null
  campusId: string | null
  studentCount: number
  attendanceSummary: string
  activeAlertsCount: number
  alertsSummary: string
  feeSummary: string
  communicationSummary: string
}

export async function askGemini(
  prompt: string,
  history: ChatMessage[],
  context: AskCamviaContext,
  fallbackGenerator: (prompt: string) => string
): Promise<AskCamviaResponse> {
  if (!isSupabaseConfigured || !supabase) {
    return { text: fallbackGenerator(prompt), source: 'context' }
  }

  try {
    const { data, error } = await supabase.functions.invoke<{ text?: unknown }>('ask-camvia', {
      body: {
        prompt: prompt.trim(),
        history: history.slice(-8).map(({ role, text }) => ({ role, text })),
        context,
      },
    })

    if (error) {
      console.warn('[CAMVIA AI] Secure assistant service is unavailable:', error.message)
      return { text: fallbackGenerator(prompt), source: 'context' }
    }

    if (typeof data?.text !== 'string' || !data.text.trim()) {
      console.warn('[CAMVIA AI] Secure assistant returned an invalid response.')
      return { text: fallbackGenerator(prompt), source: 'context' }
    }

    return { text: data.text.trim(), source: 'gemini' }
  } catch (error) {
    console.warn('[CAMVIA AI] Secure assistant request failed:', error instanceof Error ? error.message : 'Unknown error')
    return { text: fallbackGenerator(prompt), source: 'context' }
  }
}
