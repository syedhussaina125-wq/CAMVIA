import type { Role, UserStatus } from '../mockData'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mutationConfirmationError, verifyMutationSession } from './mutations'

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
  const action = typeof body.action === 'string' ? body.action : 'unknown'
  const recordId = typeof body.targetUserId === 'string' ? body.targetUserId : 'new-user'
  const operation = `manage-school-user:${action}`
  await verifyMutationSession(operation, recordId)

  const { data, error } = await requireClient().functions.invoke<UserManagementResponse>(
    'manage-school-user',
    { body },
  )

  if (error) {
    if (error.context instanceof Response) {
      let responseText = ''
      try {
        if (!error.context.bodyUsed && typeof error.context.text === 'function') {
          responseText = await error.context.text()
        }
      } catch {
        // Response body already disturbed or unreadable
      }
      let errorBody: UserManagementResponse | null = null
      if (responseText) {
        try {
          errorBody = JSON.parse(responseText) as UserManagementResponse
        } catch (parseError) {
          if (!(parseError instanceof SyntaxError)) throw parseError
        }
      }
      console.error('[Supabase] Mutation failed:', {
        operation,
        recordId,
        code: error.name,
        message: errorBody?.error ?? responseText ?? error.message,
        details: errorBody ?? responseText,
        hint: errorBody?.error,
        status: error.context.status,
      })
      if (errorBody?.error) throw new Error(errorBody.error)
      if (responseText.trim()) throw new Error(responseText.trim())
    }
    console.error('[Supabase] Mutation failed:', {
      operation,
      recordId,
      code: error.name,
      message: error.message,
      details: error,
      hint: undefined,
      status: undefined,
    })
    throw error
  }
  if (data?.error) {
    console.error('[Supabase] Mutation failed:', {
      operation,
      recordId,
      code: undefined,
      message: data.error,
      details: data,
      hint: undefined,
      status: undefined,
    })
    throw new Error(data.error)
  }
  return data ?? {}
}

function requestValues(input: SchoolUserInput) {
  return {
    fullName: input.fullName.trim(),
    email: input.email?.trim().toLowerCase() ?? '',
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
  const result = await invokeUserManagement({
    action: 'update',
    targetUserId,
    ...requestValues(input),
  })
  if (
    result.user?.id !== targetUserId ||
    result.user.full_name !== input.fullName.trim() ||
    result.user.role !== input.role.toUpperCase() ||
    result.user.status !== input.status.toUpperCase() ||
    result.user.campus_id !== input.campusId
  ) {
    throw mutationConfirmationError('manage-school-user:update', targetUserId, 'The user update was not confirmed by the server.')
  }
}

export async function deactivateSchoolUser(targetUserId: string): Promise<void> {
  const result = await invokeUserManagement({ action: 'deactivate', targetUserId })
  if (result.user?.id !== targetUserId || result.user.status !== 'INACTIVE') {
    throw mutationConfirmationError('manage-school-user:deactivate', targetUserId, 'The user deactivation was not confirmed by the server.')
  }
}
