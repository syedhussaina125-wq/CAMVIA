import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { Role, SchoolUser } from '../mockData'

const client = supabase as any

type ProfileRow = {
  id: string
  email: string
  full_name: string
  role: string
  status: string
  campus_id: string | null
}

type CampusRow = {
  id: string
  name: string
}

function numericId(uuid: string): number {
  return uuid.split('').reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0)
}

function mapRole(value: string): Role {
  const role = value.toUpperCase()
  if (role === 'ADMIN') return 'admin'
  if (role === 'PRINCIPAL') return 'principal'
  if (role === 'FINANCE') return 'finance'
  if (role === 'TEACHER') return 'teacher'
  throw new Error(`Unsupported Supabase profile role: ${value}`)
}

export async function fetchProfiles(): Promise<SchoolUser[]> {
  if (!isSupabaseConfigured || !client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }

  const { data, error } = await client
    .from('profiles')
    .select('id, email, full_name, role, status, campus_id')
    .order('full_name')

  if (error) throw error
  const profiles = (data ?? []) as ProfileRow[]
  const campusIds = [...new Set(profiles.map((profile) => profile.campus_id).filter((id): id is string => id !== null))]
  const campusResult = campusIds.length
    ? await client.from('campuses').select('id, name').in('id', campusIds)
    : { data: [], error: null }
  if (campusResult.error) throw campusResult.error
  const campusNames = new Map<string, string>(
    ((campusResult.data ?? []) as CampusRow[]).map((campus) => [campus.id, campus.name]),
  )

  return profiles.map((profile) => ({
    id: numericId(profile.id),
    name: profile.full_name,
    email: profile.email,
    role: mapRole(profile.role),
    campus: profile.campus_id ? campusNames.get(profile.campus_id) ?? 'Campus unavailable' : 'No campus assigned',
    status: profile.status.toUpperCase() === 'ACTIVE' ? 'Active' : 'Inactive',
    lastLogin: '—',
  }))
}
