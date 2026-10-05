import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { ProfileStatus, RoleName } from '../types/database'

const supabaseClient = supabase as any

export type AppProfile = {
  id: string
  email: string
  full_name: string
  status: ProfileStatus
  role: RoleName
  organization_id: string | null
  school_id: string | null
  campus_id: string | null
  school_name: string | null
  campus_name: string | null
}

export async function getSessionProfile(): Promise<AppProfile | null> {
  if (!isSupabaseConfigured || !supabaseClient) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }

  const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession()
  if (sessionError) {
    throw sessionError
  }
  const userId = sessionData.session?.user?.id

  if (!userId) {
    return null
  }

  return getActiveProfile(userId)
}

export async function getActiveProfile(userId: string): Promise<AppProfile | null> {
  if (!isSupabaseConfigured || !supabaseClient) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }

  const { data, error } = await supabaseClient
    .from('profiles')
    .select('id, email, full_name, status, role, organization_id, school_id, campus_id')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }
  if (!data) {
    return null
  }

  if (data.status === 'ACTIVE') {
    const { data: roleRows, error: rolesError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)

    if (rolesError) {
      throw rolesError
    }

    const linkedRole = (roleRows ?? []).find((row: { role: RoleName }) => row.role === data.role)
    if (!linkedRole) {
      throw new Error('The account profile has no matching role assignment.')
    }
  }

  const [schoolResult, campusResult] = await Promise.all([
    data.school_id
      ? supabaseClient.from('schools').select('name').eq('id', data.school_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    data.campus_id
      ? supabaseClient.from('campuses').select('name').eq('id', data.campus_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (schoolResult.error) throw schoolResult.error
  if (campusResult.error) throw campusResult.error

  return {
    id: data.id,
    email: data.email,
    full_name: data.full_name,
    status: data.status,
    role: data.role,
    organization_id: data.organization_id,
    school_id: data.school_id,
    campus_id: data.campus_id,
    school_name: schoolResult.data?.name ?? null,
    campus_name: campusResult.data?.name ?? null,
  }
}

export async function signInWithEmail(email: string, password: string): Promise<{ success: boolean; profile?: AppProfile; error?: string }> {
  if (!isSupabaseConfigured || !supabaseClient) {
    return { success: false, error: 'Supabase is not configured in this environment. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before enabling login.' }
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return { success: false, error: error?.message ?? 'Unable to sign in.' }
  }

  let profile: AppProfile | null
  try {
    profile = await getActiveProfile(data.user.id)
  } catch (profileError) {
    await supabaseClient.auth.signOut()
    return {
      success: false,
      error: profileError instanceof Error ? profileError.message : 'Unable to load this account profile.',
    }
  }

  if (!profile) {
    await supabaseClient.auth.signOut()
    return { success: false, error: 'This account is not configured for CAMVIA access.' }
  }

  if (profile.status === 'INACTIVE') {
    await supabaseClient.auth.signOut()
    return { success: false, error: 'This account is inactive. Please contact the administrator.' }
  }

  return { success: true, profile }
}

export async function signUpWithEmail(_email: string, _password: string): Promise<{ success: boolean; error?: string }> {
  return {
    success: false,
    error: 'Public signup is disabled. Contact the school administrator to create an approved account.',
  }
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured || !supabaseClient) {
    return
  }

  const { error } = await supabaseClient.auth.signOut()
  if (error) {
    throw error
  }
}

export function normalizeRole(role: RoleName | string): 'admin' | 'principal' | 'finance' | 'teacher' {
  const normalized = String(role).toUpperCase()

  if (normalized === 'ADMIN') return 'admin'
  if (normalized === 'PRINCIPAL') return 'principal'
  if (normalized === 'FINANCE') return 'finance'
  return 'teacher'
}
