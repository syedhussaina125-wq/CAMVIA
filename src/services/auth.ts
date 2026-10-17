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

  const profile = await getActiveProfile(userId)
  if (profile && profile.status === 'INACTIVE') {
    await supabaseClient.auth.signOut()
    return null
  }

  return profile
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
    console.error('[CAMVIA Auth] Failed to query user profile:', error.message)
    throw error
  }
  if (!data) {
    return null
  }

  const normalizedRole = String(data.role || 'TEACHER').toUpperCase() as RoleName
  const normalizedStatus = String(data.status || 'ACTIVE').toUpperCase() as ProfileStatus

  if (normalizedStatus === 'ACTIVE') {
    try {
      const { data: roleRows, error: rolesError } = await supabaseClient
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)

      if (rolesError) {
        console.warn('[CAMVIA Auth] Note: user_roles query was restricted:', rolesError.message)
      } else if (roleRows && roleRows.length > 0) {
        const linkedRole = roleRows.find(
          (row: { role: string }) => String(row.role).toUpperCase() === normalizedRole
        )
        if (!linkedRole) {
          console.warn(`[CAMVIA Auth] Note: profiles.role (${normalizedRole}) not matched in user_roles:`, roleRows)
        }
      }
    } catch (roleErr) {
      console.warn('[CAMVIA Auth] Exception reading user_roles:', roleErr)
    }
  }

  let schoolName: string | null = null
  let campusName: string | null = null

  if (data.school_id) {
    try {
      const { data: schoolResult, error: schoolError } = await supabaseClient
        .from('schools')
        .select('name')
        .eq('id', data.school_id)
        .maybeSingle()

      if (schoolError) {
        console.warn('[CAMVIA Auth] Note: schools name query was restricted:', schoolError.message)
      } else if (schoolResult?.name) {
        schoolName = schoolResult.name
      }
    } catch (sErr) {
      console.warn('[CAMVIA Auth] Exception resolving school name:', sErr)
    }
  }

  if (data.campus_id) {
    try {
      const { data: campusResult, error: campusError } = await supabaseClient
        .from('campuses')
        .select('name')
        .eq('id', data.campus_id)
        .maybeSingle()

      if (campusError) {
        console.warn('[CAMVIA Auth] Note: campuses name query was restricted:', campusError.message)
      } else if (campusResult?.name) {
        campusName = campusResult.name
      }
    } catch (cErr) {
      console.warn('[CAMVIA Auth] Exception resolving campus name:', cErr)
    }
  }

  return {
    id: data.id,
    email: data.email,
    full_name: data.full_name,
    status: normalizedStatus,
    role: normalizedRole,
    organization_id: data.organization_id,
    school_id: data.school_id,
    campus_id: data.campus_id,
    school_name: schoolName,
    campus_name: campusName,
  }
}

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 60 * 1000

type AttemptRecord = {
  count: number
  lockedUntil: number
}

const loginAttempts = new Map<string, AttemptRecord>()

function checkRateLimit(key: string): { allowed: boolean; waitSeconds?: number } {
  const normalizedKey = key.trim().toLowerCase()
  const record = loginAttempts.get(normalizedKey)
  const now = Date.now()

  if (record && record.lockedUntil > now) {
    const waitSeconds = Math.ceil((record.lockedUntil - now) / 1000)
    return { allowed: false, waitSeconds }
  }

  return { allowed: true }
}

function recordFailedAttempt(key: string): void {
  const normalizedKey = key.trim().toLowerCase()
  const record = loginAttempts.get(normalizedKey) ?? { count: 0, lockedUntil: 0 }
  record.count += 1
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS
    record.count = 0
  }
  loginAttempts.set(normalizedKey, record)
}

function clearFailedAttempts(key: string): void {
  loginAttempts.delete(key.trim().toLowerCase())
}

export async function signInWithEmail(email: string, password: string): Promise<{ success: boolean; profile?: AppProfile; error?: string }> {
  if (!isSupabaseConfigured || !supabaseClient) {
    return { success: false, error: 'Supabase is not configured in this environment. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before enabling login.' }
  }

  const rateCheck = checkRateLimit(email)
  if (!rateCheck.allowed) {
    return {
      success: false,
      error: `Too many failed login attempts. Please wait ${rateCheck.waitSeconds} seconds before trying again.`,
    }
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    recordFailedAttempt(email)
    return { success: false, error: 'Invalid email or password.' }
  }

  let profile: AppProfile | null
  try {
    profile = await getActiveProfile(data.user.id)
  } catch (profileError) {
    console.error('[CAMVIA Auth] Failed to load profile for user:', data.user.id, profileError)
    await supabaseClient.auth.signOut()
    return {
      success: false,
      error: profileError instanceof Error && profileError.message
        ? profileError.message
        : 'Unable to load account profile. Please contact your school administrator.',
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

  clearFailedAttempts(email)
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

export function getAppBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return import.meta.env.VITE_APP_URL || import.meta.env.VITE_SITE_URL || 'https://camvia.elvaveo.com'
}

export async function resetPasswordForEmail(email: string): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabaseClient) {
    return {
      success: false,
      error: 'Supabase is not configured in this environment. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    }
  }

  const normalizedEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { success: false, error: 'Please enter a valid email address.' }
  }

  const rateCheck = checkRateLimit(`reset:${normalizedEmail}`)
  if (!rateCheck.allowed) {
    return {
      success: false,
      error: `Too many password reset attempts. Please wait ${rateCheck.waitSeconds} seconds before trying again.`,
    }
  }

  const baseUrl = getAppBaseUrl()
  const redirectTo = `${baseUrl}/reset-password`

  const { error } = await supabaseClient.auth.resetPasswordForEmail(normalizedEmail, {
    redirectTo,
  })

  if (error) {
    recordFailedAttempt(`reset:${normalizedEmail}`)
    return {
      success: false,
      error: error.message || 'Unable to send password reset email. Please try again later.',
    }
  }

  return { success: true }
}

export async function updateUserPassword(password: string): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabaseClient) {
    return {
      success: false,
      error: 'Supabase is not configured in this environment.',
    }
  }

  if (password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters long.' }
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return {
      success: false,
      error: 'Password must contain uppercase letters, lowercase letters, and at least one number.',
    }
  }

  const { error } = await supabaseClient.auth.updateUser({ password })
  if (error) {
    return {
      success: false,
      error: error.message || 'Unable to update password. Please verify that your link has not expired.',
    }
  }

  return { success: true }
}

export function normalizeRole(role: RoleName | string): 'admin' | 'principal' | 'finance' | 'teacher' {
  const normalized = String(role).toUpperCase()

  if (normalized === 'ADMIN') return 'admin'
  if (normalized === 'PRINCIPAL') return 'principal'
  if (normalized === 'FINANCE') return 'finance'
  return 'teacher'
}

