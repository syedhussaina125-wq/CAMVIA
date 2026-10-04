import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { mapLiveAlert, type AlertItem, type LiveAlertRow } from '../alertsData'

const client = supabase as any
const pageSize = 1000

function requireSupabase() {
  if (!isSupabaseConfigured || !client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return client
}

export async function fetchLiveAlerts(): Promise<AlertItem[]> {
  const db = requireSupabase()
  const rows: LiveAlertRow[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from('live_alerts')
      .select('id, campus_id, student_id, class_name, section, priority, status, source_type, source_id, title, detail, created_at, priority_rank, status_rank')
      .order('priority_rank', { ascending: true })
      .order('status_rank', { ascending: true })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const batch = (data ?? []) as LiveAlertRow[]
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return rows.map(mapLiveAlert)
}
