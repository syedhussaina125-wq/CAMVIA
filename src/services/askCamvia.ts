import { isSupabaseConfigured, supabase } from '../lib/supabase'

export type ChatMessage = {
  role: 'assistant' | 'user'
  text: string
}

export type AskCamviaResponse = {
  text: string
}

export async function askCamvia(
  prompt: string,
): Promise<AskCamviaResponse> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('The secure CAMVIA assistant service is not configured.')
  }

  const { data, error } = await supabase.functions.invoke<{ text?: unknown }>('ask-camvia', {
    body: { prompt: prompt.trim() },
  })

  if (error) {
    throw new Error(`The secure CAMVIA assistant request failed: ${error.message}`)
  }

  if (typeof data?.text !== 'string' || !data.text.trim()) {
    throw new Error('The secure CAMVIA assistant returned an invalid response.')
  }

  return { text: data.text.trim() }
}
