import type { Role, UserStatus } from '../mockData'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

export type TeacherAssignmentScope = {
  campus_id: string
  class_name: string
  section: string
}

export type SchoolUserInput = {
  fullName: string
  email?: string
  role: Role
  status: UserStatus
  campusId: string | null
  assignments: TeacherAssignmentScope[]
}

type UserManagementResponse = {
  error?: string
  user?: {
    id: string
    email?: string
    full_name: string
    role: string
    status: string
    campus_id: string | null
  }
  invitationSent?: boolean
}

function requireClient(): SupabaseClient {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured for secure user management.')
  }
  return supabase as SupabaseClient
}

async function invokeUserManagement(
  body: Record<string, unknown>,
): Promise<UserManagementResponse> {
  const { data, error } = await requireClient()
    .functions.invoke<UserManagementResponse>('manage-school-user', { body })

  if (error) {
    if (error.context instanceof Response) {
      const errorBody = await error.context.json().catch(() => null) as UserManagementResponse | null
      if (errorBody?.error) throw new Error(errorBody.error)
    }
    throw new Error('Secure user management is unavailable. Confirm the Edge Function is deployed.')
  }
  if (data?.error) throw new Error(data.error)
  return data ?? {}
}

function requestValues(input: SchoolUserInput) {
  return {
    fullName: input.fullName.trim(),
    role: input.role.toUpperCase(),
    status: input.status.toUpperCase(),
    campusId: input.campusId,
    assignments: input.assignments,
  }
}

export async function inviteSchoolUser(input: SchoolUserInput): Promise<void> {
  if (!input.email) throw new Error('An email address is required to invite a user.')
  const result = await invokeUserManagement({
    action: 'invite',
    email: input.email.trim().toLowerCase(),
    ...requestValues(input),
  })
  if (!result.invitationSent) {
    throw new Error('The user was provisioned, but Supabase did not confirm delivery of the invitation.')
  }
}

export async function updateSchoolUser(
  targetUserId: string,
  input: SchoolUserInput,
): Promise<void> {
  await invokeUserManagement({
    action: 'update',
    targetUserId,
    ...requestValues(input),
  })
}

export async function deactivateSchoolUser(targetUserId: string): Promise<void> {
  await invokeUserManagement({ action: 'deactivate', targetUserId })
}
