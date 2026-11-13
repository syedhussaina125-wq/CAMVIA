import { isSupabaseConfigured, supabase, supabaseConfigurationError } from '../lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

type MutationError = {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
  status?: unknown
}

type MutationResponse<T> = {
  data: T | null
  error: MutationError | null
}

function logMutationFailure(operation: string, recordId: string, error: unknown): void {
  const fields = typeof error === 'object' && error !== null
    ? error as MutationError
    : {}
  console.error('[Supabase] Mutation failed:', {
    operation,
    recordId,
    code: fields.code,
    message: fields.message ?? (error instanceof Error ? error.message : String(error)),
    details: fields.details,
    hint: fields.hint,
    status: fields.status,
  })
}

function preserveMutationFailure(operation: string, recordId: string, error: unknown): Error {
  if (
    error instanceof Error &&
    'mutationOperation' in error &&
    error.mutationOperation === operation
  ) {
    return error
  }
  const fields = typeof error === 'object' && error !== null
    ? error as MutationError
    : {}
  const message = typeof fields.message === 'string'
    ? fields.message
    : error instanceof Error
      ? error.message
      : String(error)
  const failure = new Error(message)
  Object.assign(failure, {
    code: fields.code,
    details: fields.details,
    hint: fields.hint,
    status: fields.status,
    mutationOperation: operation,
    affectedRecordId: recordId,
  })
  return failure
}

function failMutation(operation: string, recordId: string, error: unknown): Error {
  if (
    error instanceof Error &&
    'mutationOperation' in error &&
    error.mutationOperation === operation
  ) {
    return error
  }
  logMutationFailure(operation, recordId, error)
  return preserveMutationFailure(operation, recordId, error)
}

export function mutationConfirmationError(
  operation: string,
  recordId: string,
  message: string,
): Error {
  return failMutation(operation, recordId, new Error(message))
}

export async function verifyMutationSession(operation: string, recordId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw failMutation(operation, recordId, new Error(supabaseConfigurationError))
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) {
    throw failMutation(operation, recordId, sessionError)
  }
  if (!sessionData.session) {
    throw failMutation(operation, recordId, new Error('Your session could not be verified. Please sign in again.'))
  }

  let session = sessionData.session
  let { data: userData, error: userError } = await supabase.auth.getUser(session.access_token)
  if (userError && userError.status === 401) {
    const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession(session)
    if (refreshError) {
      throw failMutation(operation, recordId, refreshError)
    }
    if (!refreshedData.session) {
      throw failMutation(operation, recordId, new Error('Your session could not be refreshed. Please sign in again.'))
    }
    session = refreshedData.session
    const verification = await supabase.auth.getUser(session.access_token)
    userData = verification.data
    userError = verification.error
  }

  if (userError) {
    throw failMutation(operation, recordId, userError)
  }
  if (!userData.user || userData.user.id !== session.user.id) {
    throw failMutation(operation, recordId, new Error('Your session could not be verified against your signed-in account. Please sign in again.'))
  }

  const { data: profile, error: profileError } = await (supabase as SupabaseClient)
    .from('profiles')
    .select('id, status')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileError) {
    throw failMutation(operation, recordId, profileError)
  }
  if (!profile || profile.id !== userData.user.id || profile.status !== 'ACTIVE') {
    throw failMutation(operation, recordId, new Error('Your active CAMVIA profile could not be verified. Please sign in again or contact an administrator.'))
  }
}

export async function runMutation<T>(
  operation: string,
  recordId: string,
  request: () => PromiseLike<MutationResponse<T>>,
  requireSuccessPayload = false,
): Promise<T | null> {
  try {
    await verifyMutationSession(operation, recordId)
  } catch (error) {
    throw failMutation(operation, recordId, error)
  }

  let result: MutationResponse<T>
  try {
    result = await request()
  } catch (error) {
    throw failMutation(operation, recordId, error)
  }

  if (result.error) {
    throw failMutation(operation, recordId, result.error)
  }

  if (result.data && typeof result.data === 'object' && 'success' in result.data) {
    const response = result.data as { success?: unknown; message?: unknown }
    if (response.success !== true) {
      const error = new Error(
        typeof response.message === 'string'
          ? response.message
          : `${operation} did not confirm a successful database mutation.`,
      )
      throw failMutation(operation, recordId, error)
    }
  } else if (requireSuccessPayload) {
    throw failMutation(operation, recordId, new Error(`${operation} returned no confirmed success result.`))
  }

  return result.data
}
