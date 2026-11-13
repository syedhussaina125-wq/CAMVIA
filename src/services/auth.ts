import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { ProfileStatus, RoleName } from '../types/database'
import { normalizeSchoolTimezone } from '../utils/schoolTimezone'

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
  school_timezone: string | null
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

  const [roleResult, schoolResult, campusResult] = await Promise.all([
    normalizedStatus === 'ACTIVE'
      ? supabaseClient.from('user_roles').select('role').eq('user_id', userId).then((r: any) => r).catch((err: unknown) => ({ data: null, error: err }))
      : Promise.resolve({ data: null, error: null }),
    data.school_id
      ? supabaseClient.from('schools').select('name, timezone').eq('id', data.school_id).maybeSingle().then((r: any) => r).catch((err: unknown) => ({ data: null, error: err }))
      : Promise.resolve({ data: null, error: null }),
    data.campus_id
      ? supabaseClient.from('campuses').select('name').eq('id', data.campus_id).maybeSingle().then((r: any) => r).catch((err: unknown) => ({ data: null, error: err }))
      : Promise.resolve({ data: null, error: null }),
  ])

  if (roleResult.data && roleResult.data.length > 0) {
    const linkedRole = roleResult.data.find(
      (row: { role: string }) => String(row.role).toUpperCase() === normalizedRole
    )
    if (!linkedRole) {
      console.warn(`[CAMVIA Auth] Note: profiles.role (${normalizedRole}) not matched in user_roles:`, roleResult.data)
    }
  }

  const schoolName: string | null = schoolResult.data?.name ?? null
  const schoolTimezone = normalizeSchoolTimezone(schoolResult.data?.timezone)
  const campusName: string | null = campusResult.data?.name ?? null

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
    school_timezone: schoolTimezone,
    campus_name: campusName,
  }
}

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

type AttemptRecord = {
  count: number
  lockedUntil: number
}

const loginAttempts = new Map<string, AttemptRecord>()
const STORAGE_LOCK_PREFIX = 'camvia_lock_'

export function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(Math.max(0, totalSeconds) / 60)
  const s = Math.floor(Math.max(0, totalSeconds) % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function parseLockoutRemainingSeconds(message: string): number | null {
  if (!message) return null
  // Match patterns like "14:32" or "15:00" in "Please try again in 14:32"
  const timeMatch = message.match(/\b(\d{1,2}):(\d{2})\b/)
  if (timeMatch) {
    const mins = parseInt(timeMatch[1], 10)
    const secs = parseInt(timeMatch[2], 10)
    return mins * 60 + secs
  }
  // Match patterns like "Please wait 890 seconds"
  const secMatch = message.match(/(\d+)\s*sec/i)
  if (secMatch) {
    return parseInt(secMatch[1], 10)
  }
  return null
}

export function getActiveLockout(email?: string): { isLocked: boolean; waitSeconds: number } {
  const now = Date.now()
  let maxWait = 0

  if (email) {
    const normalizedKey = email.trim().toLowerCase()
    const memoryRecord = loginAttempts.get(normalizedKey)
    if (memoryRecord && memoryRecord.lockedUntil > now) {
      maxWait = Math.max(maxWait, Math.ceil((memoryRecord.lockedUntil - now) / 1000))
    }

    try {
      const stored = window.sessionStorage.getItem(STORAGE_LOCK_PREFIX + normalizedKey)
      if (stored) {
        const storedUntil = parseInt(stored, 10)
        if (storedUntil > now) {
          maxWait = Math.max(maxWait, Math.ceil((storedUntil - now) / 1000))
        } else {
          window.sessionStorage.removeItem(STORAGE_LOCK_PREFIX + normalizedKey)
        }
      }
    } catch {
      // Storage access gracefully ignored
    }
  }

  // Also check general active session lock
  try {
    const generalStored = window.sessionStorage.getItem('camvia_active_lock_until')
    if (generalStored) {
      const generalUntil = parseInt(generalStored, 10)
      if (generalUntil > now) {
        maxWait = Math.max(maxWait, Math.ceil((generalUntil - now) / 1000))
      } else {
        window.sessionStorage.removeItem('camvia_active_lock_until')
      }
    }
  } catch {
    // Storage access gracefully ignored
  }

  return {
    isLocked: maxWait > 0,
    waitSeconds: maxWait,
  }
}

function setLockoutForEmail(key: string, durationMs: number = LOCKOUT_DURATION_MS): number {
  const normalizedKey = key.trim().toLowerCase()
  const lockedUntil = Date.now() + durationMs
  loginAttempts.set(normalizedKey, { count: MAX_FAILED_ATTEMPTS, lockedUntil })

  try {
    window.sessionStorage.setItem(STORAGE_LOCK_PREFIX + normalizedKey, String(lockedUntil))
    window.sessionStorage.setItem('camvia_active_lock_until', String(lockedUntil))
  } catch {
    // Storage access gracefully ignored
  }

  return Math.ceil(durationMs / 1000)
}

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

function recordFailedAttempt(key: string): { locked: boolean; waitSeconds: number } {
  const normalizedKey = key.trim().toLowerCase()
  const record = loginAttempts.get(normalizedKey) ?? { count: 0, lockedUntil: 0 }
  record.count += 1
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS
    record.count = 0
    loginAttempts.set(normalizedKey, record)
    try {
      window.sessionStorage.setItem(STORAGE_LOCK_PREFIX + normalizedKey, String(record.lockedUntil))
      window.sessionStorage.setItem('camvia_active_lock_until', String(record.lockedUntil))
    } catch {
      // Storage access gracefully ignored
    }
    return { locked: true, waitSeconds: Math.ceil(LOCKOUT_DURATION_MS / 1000) }
  }
  loginAttempts.set(normalizedKey, record)
  return { locked: false, waitSeconds: 0 }
}

function clearFailedAttempts(key: string): void {
  const normalizedKey = key.trim().toLowerCase()
  loginAttempts.delete(normalizedKey)
  try {
    window.sessionStorage.removeItem(STORAGE_LOCK_PREFIX + normalizedKey)
    window.sessionStorage.removeItem('camvia_active_lock_until')
  } catch {
    // Storage access gracefully ignored
  }
}

export type SignInResult = {
  success: boolean
  profile?: AppProfile
  error?: string
  lockWaitSeconds?: number
}

export async function signInWithEmail(email: string, password: string): Promise<SignInResult> {
  if (!isSupabaseConfigured || !supabaseClient) {
    return { success: false, error: 'Supabase is not configured in this environment. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before enabling login.' }
  }

  // Pre-check client-side active lockout
  const activeLock = getActiveLockout(email)
  if (activeLock.isLocked) {
    const formatted = formatMMSS(activeLock.waitSeconds)
    return {
      success: false,
      error: `Too many unsuccessful login attempts. Please try again in ${formatted}.`,
      lockWaitSeconds: activeLock.waitSeconds,
    }
  }

  let authResponse: any
  try {
    authResponse = await supabaseClient.auth.signInWithPassword({ email, password })
  } catch (networkError: any) {
    // Handle Supabase 429 rate limit or network error
    const msg = String(networkError?.message ?? '').toLowerCase()
    const status = networkError?.status
    if (status === 429 || msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
      return {
        success: false,
        error: 'Too many login requests. Please try again shortly.',
      }
    }
    return {
      success: false,
      error: 'Unable to connect to authentication server. Please try again.',
    }
  }

  const { data, error } = authResponse

  if (error || !data?.user) {
    const rawMsg = error?.message ?? ''
    const lowerMsg = rawMsg.toLowerCase()
    const status = error?.status

    // Check for HTTP 429 / Supabase rate limit errors
    if (status === 429 || lowerMsg.includes('429') || lowerMsg.includes('rate limit') || lowerMsg.includes('too many requests')) {
      return {
        success: false,
        error: 'Too many login requests. Please try again shortly.',
      }
    }

    // Check if error message is from the Password Verification Hook temporary lockout
    if (lowerMsg.includes('too many unsuccessful login attempts') || lowerMsg.includes('locked')) {
      const waitSeconds = parseLockoutRemainingSeconds(rawMsg) ?? (15 * 60)
      setLockoutForEmail(email, waitSeconds * 1000)
      const formatted = formatMMSS(waitSeconds)
      return {
        success: false,
        error: `Too many unsuccessful login attempts. Please try again in ${formatted}.`,
        lockWaitSeconds: waitSeconds,
      }
    }

    // Standard wrong password failure
    const failureStatus = recordFailedAttempt(email)
    if (failureStatus.locked) {
      const formatted = formatMMSS(failureStatus.waitSeconds)
      return {
        success: false,
        error: `Too many unsuccessful login attempts. Please try again in ${formatted}.`,
        lockWaitSeconds: failureStatus.waitSeconds,
      }
    }

    // Generic response for normal invalid attempts 1-4 (preserves account non-enumeration)
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

  // Successful login clears failed-attempt tracking
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
