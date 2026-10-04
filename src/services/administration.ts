import { isSupabaseConfigured, supabase } from '../lib/supabase'

const client = supabase as any

export type SchoolSettingsRecord = {
  id: string
  organization_id: string
  name: string
  short_name: string
  email: string | null
  phone: string | null
  address: string | null
  timezone: string | null
  country: string | null
  academic_year: string | null
  updated_at: string
  updated_by: string | null
}

export type CampusSettingsRecord = {
  id: string
  organization_id: string
  school_id: string
  name: string
  code: string
  address: string | null
  status: 'ACTIVE' | 'INACTIVE'
  updated_at: string
  updated_by: string | null
}

export type IntegrationConfigRecord = {
  id: string
  organization_id: string
  school_id: string
  provider_key: 'EMAIL' | 'SMS' | 'WHATSAPP'
  status: 'NOT_CONFIGURED' | 'CONFIGURED' | 'DISABLED'
  external_identifier: string | null
  updated_at: string
  updated_by: string | null
}

export type AdministrationSnapshot = {
  school: SchoolSettingsRecord
  campuses: CampusSettingsRecord[]
  integrations: IntegrationConfigRecord[]
}

function requireSupabase() {
  if (!isSupabaseConfigured || !client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return client
}

export async function fetchAdministrationSnapshot(
  organizationId: string,
  schoolId: string,
): Promise<AdministrationSnapshot> {
  const db = requireSupabase()
  const [schoolResult, campusResult, integrationResult] = await Promise.all([
    db.from('schools')
      .select('id, organization_id, name, short_name, email, phone, address, timezone, country, academic_year, updated_at, updated_by')
      .eq('id', schoolId)
      .eq('organization_id', organizationId)
      .maybeSingle(),
    db.from('campuses')
      .select('id, organization_id, school_id, name, code, address, status, updated_at, updated_by')
      .eq('school_id', schoolId)
      .eq('organization_id', organizationId)
      .order('name'),
    db.from('integration_configs')
      .select('id, organization_id, school_id, provider_key, status, external_identifier, updated_at, updated_by')
      .eq('school_id', schoolId)
      .eq('organization_id', organizationId)
      .order('provider_key'),
  ])

  if (schoolResult.error) throw schoolResult.error
  if (campusResult.error) throw campusResult.error
  if (integrationResult.error) throw integrationResult.error
  if (!schoolResult.data) throw new Error('The current school settings are unavailable in your authorized scope.')

  return {
    school: schoolResult.data as SchoolSettingsRecord,
    campuses: (campusResult.data ?? []) as CampusSettingsRecord[],
    integrations: (integrationResult.data ?? []) as IntegrationConfigRecord[],
  }
}

export async function saveSchoolSettings(
  organizationId: string,
  schoolId: string,
  values: Pick<SchoolSettingsRecord, 'name' | 'short_name' | 'email' | 'phone' | 'address' | 'timezone'>,
): Promise<SchoolSettingsRecord> {
  const db = requireSupabase()
  const { data, error } = await db.from('schools')
    .update(values)
    .eq('id', schoolId)
    .eq('organization_id', organizationId)
    .select('id, organization_id, name, short_name, email, phone, address, timezone, country, academic_year, updated_at, updated_by')
    .single()

  if (error) throw error
  return data as SchoolSettingsRecord
}

export async function saveCampusSettings(
  organizationId: string,
  schoolId: string,
  campusId: string,
  values: Pick<CampusSettingsRecord, 'name' | 'code' | 'address' | 'status'>,
): Promise<CampusSettingsRecord> {
  const db = requireSupabase()
  const { data, error } = await db.from('campuses')
    .update(values)
    .eq('id', campusId)
    .eq('school_id', schoolId)
    .eq('organization_id', organizationId)
    .select('id, organization_id, school_id, name, code, address, status, updated_at, updated_by')
    .single()

  if (error) throw error
  return data as CampusSettingsRecord
}
