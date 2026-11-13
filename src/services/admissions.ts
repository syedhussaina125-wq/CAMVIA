import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { runMutation } from './mutations'

const client = supabase as any

export type SchoolRegistrationLink = {
  registrationToken: string
  enabled: boolean
  schoolName: string
}

export class RegistrationLinkServiceError extends Error {
  readonly kind: 'configuration' | 'incomplete' | 'server'

  constructor(kind: 'configuration' | 'incomplete' | 'server') {
    super(kind === 'configuration'
      ? 'Registration link configuration is incomplete.'
      : 'Unable to load the registration link. Please try again.')
    this.name = 'RegistrationLinkServiceError'
    this.kind = kind
  }
}

export type PublicRegistrationLookup =
  | { status: 'ACTIVE'; schoolName: string }
  | { status: 'DISABLED' | 'INVALID' }

export type AdmissionApplication = {
  id: string
  application_reference: string
  student_name: string
  date_of_birth: string
  gender: string | null
  applying_class: string
  preferred_section: string | null
  guardian_name: string
  guardian_relationship: string
  guardian_phone: string
  whatsapp_phone: string | null
  guardian_email: string | null
  guardian_address: string | null
  secondary_guardian_name: string | null
  secondary_guardian_relationship: string | null
  secondary_guardian_phone: string | null
  secondary_guardian_email: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  submitted_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  rejected_by?: string | null
  rejected_at?: string | null
  approved_by: string | null
  approved_at: string | null
  rejection_reason: string | null
  created_student_id: string | null
}

export type AdmissionApplicationDetails = Pick<
  AdmissionApplication,
  | 'student_name'
  | 'date_of_birth'
  | 'gender'
  | 'applying_class'
  | 'preferred_section'
  | 'guardian_name'
  | 'guardian_relationship'
  | 'guardian_phone'
  | 'whatsapp_phone'
  | 'guardian_email'
  | 'guardian_address'
  | 'secondary_guardian_name'
  | 'secondary_guardian_relationship'
  | 'secondary_guardian_phone'
  | 'secondary_guardian_email'
>

export type PublicRegistrationDetails = {
  studentName: string
  dateOfBirth: string
  gender: string
  applyingClass: string
  preferredSection: string
  guardianName: string
  guardianRelationship: string
  guardianPhone: string
  whatsappPhone: string
  guardianEmail: string
  guardianAddress: string
  secondaryGuardianName: string
  secondaryGuardianRelationship: string
  secondaryGuardianPhone: string
  secondaryGuardianEmail: string
}

function requireSupabase() {
  if (!isSupabaseConfigured || !client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return client
}

function mapRegistrationLink(row: {
  registration_token?: unknown
  enabled?: unknown
  school_name?: unknown
} | null): SchoolRegistrationLink {
  if (!row
    || typeof row.registration_token !== 'string'
    || !/^[a-f0-9]{64}$/i.test(row.registration_token)
    || typeof row.enabled !== 'boolean'
    || typeof row.school_name !== 'string'
    || !row.school_name.trim()) {
    throw new RegistrationLinkServiceError('incomplete')
  }

  return {
    registrationToken: row.registration_token,
    enabled: row.enabled,
    schoolName: row.school_name,
  }
}

export async function getSchoolRegistrationLink(): Promise<SchoolRegistrationLink | null> {
  if (!isSupabaseConfigured || !client) throw new RegistrationLinkServiceError('configuration')
  const { data, error } = await client.rpc('get_school_registration_link')
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  return mapRegistrationLink(row)
}

export async function createSchoolRegistrationLink(): Promise<SchoolRegistrationLink> {
  if (!isSupabaseConfigured || !client) throw new RegistrationLinkServiceError('configuration')
  const data = await runMutation('create_school_registration_link', 'school-registration-link', () =>
    client.rpc('create_school_registration_link'))
  const row = Array.isArray(data) ? data[0] : data
  return mapRegistrationLink(row)
}

export async function setSchoolRegistrationEnabled(enabled: boolean): Promise<SchoolRegistrationLink> {
  const data = await runMutation('set_school_registration_enabled', 'school-registration-link', () =>
    requireSupabase().rpc('set_school_registration_enabled', { p_enabled: enabled }))
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('The school registration link status could not be updated.')
  const updated = mapRegistrationLink(row)
  if (updated.enabled !== enabled) {
    throw new Error('set_school_registration_enabled did not confirm the requested status.')
  }
  return updated
}

export async function lookupPublicRegistration(token: string): Promise<PublicRegistrationLookup> {
  const { data, error } = await requireSupabase().rpc('lookup_public_registration', {
    p_registration_token: token,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { status: 'INVALID' }
  if (row.registration_enabled !== true) return { status: 'DISABLED' }
  if (typeof row.school_name !== 'string' || !row.school_name) {
    throw new Error('The registration resolver returned an invalid response.')
  }
  return { status: 'ACTIVE', schoolName: row.school_name }
}

export async function submitPublicRegistration(
  token: string,
  submissionKey: string,
  details: PublicRegistrationDetails,
  honeypot: string,
): Promise<string> {
  const { data, error } = await requireSupabase().rpc('submit_public_registration', {
    p_registration_token: token,
    p_submission_key: submissionKey,
    p_student_name: details.studentName,
    p_date_of_birth: details.dateOfBirth,
    p_gender: details.gender || null,
    p_applying_class: details.applyingClass,
    p_preferred_section: details.preferredSection || null,
    p_guardian_name: details.guardianName,
    p_guardian_relationship: details.guardianRelationship,
    p_guardian_phone: details.guardianPhone,
    p_whatsapp_phone: details.whatsappPhone || null,
    p_guardian_email: details.guardianEmail || null,
    p_guardian_address: details.guardianAddress || null,
    p_secondary_guardian_name: details.secondaryGuardianName || null,
    p_secondary_guardian_relationship: details.secondaryGuardianRelationship || null,
    p_secondary_guardian_phone: details.secondaryGuardianPhone || null,
    p_secondary_guardian_email: details.secondaryGuardianEmail || null,
    p_honeypot: honeypot,
  })
  if (error) throw error
  if (typeof data !== 'string' || !data) throw new Error('The registration did not return an application reference.')
  return data
}

export async function fetchAdmissionApplications(): Promise<AdmissionApplication[]> {
  const { data, error } = await requireSupabase().rpc('list_admission_applications')
  if (error) throw error
  return ((data ?? []) as AdmissionApplication[]).filter((application) => application.status === 'PENDING')
}

export type RejectedAdmission = {
  id: string
  application_reference: string
  student_name: string
  applying_class: string
  guardian_name: string
  guardian_phone: string
  submitted_at: string
  rejected_at: string | null
  rejected_by_name: string
  rejection_reason: string
}

export async function fetchRejectedAdmissions(): Promise<RejectedAdmission[]> {
  const { data, error } = await requireSupabase().rpc('get_rejected_admission_trash')
  if (error) throw error
  return (data ?? []) as RejectedAdmission[]
}

export async function restoreRejectedAdmissionToPending(applicationId: string): Promise<void> {
  await runMutation('restore_rejected_admission_to_pending', applicationId, () =>
    requireSupabase().rpc('restore_rejected_admission_to_pending', {
    p_application_id: applicationId,
  })
  )
}

export async function editAdmissionApplication(
  applicationId: string,
  details: AdmissionApplicationDetails,
): Promise<void> {
  await runMutation('edit_admission_application', applicationId, () => requireSupabase().rpc('edit_admission_application', {
    p_application_id: applicationId,
    p_student_name: details.student_name,
    p_date_of_birth: details.date_of_birth,
    p_gender: details.gender,
    p_applying_class: details.applying_class,
    p_preferred_section: details.preferred_section,
    p_guardian_name: details.guardian_name,
    p_guardian_relationship: details.guardian_relationship,
    p_guardian_phone: details.guardian_phone,
    p_whatsapp_phone: details.whatsapp_phone,
    p_guardian_email: details.guardian_email,
    p_guardian_address: details.guardian_address,
    p_secondary_guardian_name: details.secondary_guardian_name,
    p_secondary_guardian_relationship: details.secondary_guardian_relationship,
    p_secondary_guardian_phone: details.secondary_guardian_phone,
    p_secondary_guardian_email: details.secondary_guardian_email,
  }))
}

export async function approveAdmissionApplication(
  applicationId: string,
  campusId: string,
  rollNumber: string,
  section: string,
): Promise<void> {
  const payload = {
    p_application_id: applicationId,
    p_campus_id: campusId,
    p_roll_number: rollNumber || null,
    p_section: section,
  }
  if (import.meta.env.DEV) {
    console.debug('[CAMVIA Admissions] Approval RPC payload:', payload)
  }

  await runMutation('approve_admission_application', applicationId, () =>
    requireSupabase().rpc('approve_admission_application', payload))
}

export async function rejectAdmissionApplication(applicationId: string, reason: string): Promise<void> {
  await runMutation('reject_admission_application', applicationId, () => requireSupabase().rpc('reject_admission_application', {
    p_application_id: applicationId,
    p_rejection_reason: reason || null,
  }))
}
