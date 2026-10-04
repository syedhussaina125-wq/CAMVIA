import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('https://'),
)

const supabaseGlobal = globalThis as typeof globalThis & {
  __edupulseSupabaseClient?: SupabaseClient<Database>
}

const createSupabaseClient = () => createClient<Database>(supabaseUrl as string, supabaseAnonKey as string, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

// Reuse the window's auth client when Vite reevaluates this module during HMR.
export const supabase = isSupabaseConfigured
  ? import.meta.env.DEV
    ? (supabaseGlobal.__edupulseSupabaseClient ??= createSupabaseClient())
    : createSupabaseClient()
  : null
