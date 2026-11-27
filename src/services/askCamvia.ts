import { isSupabaseConfigured, supabase } from '../lib/supabase'

export type ChatMessage = {
  role: 'assistant' | 'user'
  text: string
  timestamp?: number
  component?: AskCamviaComponent
  exportData?: AskCamviaExportData
}

export type AskCamviaKpi = {
  label: string
  value: string | number
  subtext?: string
  color?: 'primary' | 'success' | 'warning' | 'danger'
}

export type AskCamviaTableColumn = {
  key: string
  header: string
  align?: 'left' | 'center' | 'right'
}

export type AskCamviaTable = {
  columns: AskCamviaTableColumn[]
  rows: Array<Record<string, string | number | null | undefined>>
  caption?: string
  total?: number
  page?: number
}

export type AskCamviaAction = {
  label: string
  actionType: 'navigate' | 'filter' | 'prompt'
  target: string
  variant?: 'primary' | 'secondary' | 'outline'
}

export type AskCamviaExportData = {
  title: string
  filename: string
  columns: string[]
  rows: Array<Array<string | number | null | undefined>>
}

export type AskCamviaComponent = {
  type: 'kpi' | 'table' | 'actions' | 'alert'
  kpis?: AskCamviaKpi[]
  table?: AskCamviaTable
  actions?: AskCamviaAction[]
  alert?: {
    type: 'info' | 'warning' | 'error' | 'success'
    message: string
  }
}

export type AskCamviaContextPayload = {
  route?: string
  className?: string
  section?: string
  studentId?: string
  campusId?: string
  conversationId?: string
  previousEntityRef?: {
    type: 'students' | 'attendance' | 'fees'
    filters?: Record<string, string>
    total?: number
  }
}

export type AskCamviaResponse = {
  text: string
  component?: AskCamviaComponent
  exportData?: AskCamviaExportData
  context?: AskCamviaContextPayload
}

export async function askCamvia(
  prompt: string,
  context?: AskCamviaContextPayload,
): Promise<AskCamviaResponse> {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) throw new Error('Enter a question for CAMVIA Buddy.')
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('The secure CAMVIA assistant service is not configured.')
  }

  // When testing on localhost, prioritize the local Deno ask-camvia server on port 8000
  let data: AskCamviaResponse | null = null
  let error: { message: string } | null = null

  const isLocalDev = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  if (isLocalDev) {
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (token) {
        const localRes = await fetch('http://localhost:8000', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ prompt: normalizedPrompt, context }),
        })
        if (localRes.ok) {
          data = await localRes.json()
        }
      }
    } catch {
      // Local Deno runner not reachable, fall through to remote Supabase Edge Function
    }
  }

  if (!data) {
    const remote = await supabase.functions.invoke<AskCamviaResponse>('ask-camvia', {
      body: {
        prompt: normalizedPrompt,
        context,
      },
    })
    data = remote.data
    error = remote.error
  }

  if (error) {
    throw new Error(`CAMVIA Buddy request failed: ${error.message}`)
  }
  if (typeof data?.text !== 'string' || !data.text.trim()) {
    throw new Error('The secure CAMVIA assistant returned an invalid response.')
  }

  return {
    text: data.text.trim(),
    component: data.component,
    exportData: data.exportData,
    context: data.context,
  }
}
