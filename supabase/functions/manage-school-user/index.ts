import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const allowedRoles = new Set(['ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER'])
const allowedStatuses = new Set(['ACTIVE', 'INACTIVE'])

type AssignmentScope = {
  campus_id: string
  class_name: string
  section: string
}

type ActionBody = {
  action?: unknown
  email?: unknown
  fullName?: unknown
  role?: unknown
  status?: unknown
  campusId?: unknown
  targetUserId?: unknown
  assignments?: unknown
}

function normalizeEmail(value: unknown): string | null {
  const trimmed = cleanText(value, 254)
  if (!trimmed) return null
  const normalized = trimmed.toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null
}

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : null
}

function parseAssignments(value: unknown): AssignmentScope[] | null {
  if (!Array.isArray(value)) return null
  const assignments: AssignmentScope[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const scope = item as Record<string, unknown>
    const campusId = cleanText(scope.campus_id, 64)
    const className = cleanText(scope.class_name, 100)
    const section = cleanText(scope.section, 40)
    if (!campusId || !className || !section) return null
    assignments.push({ campus_id: campusId, class_name: className, section })
  }
  return assignments
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' })

  const authorization = request.headers.get('Authorization')
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) return response(401, { error: 'Sign in with an active administrator account.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('User provisioning function is missing required Supabase server configuration.')
    return response(500, { error: 'Secure user provisioning is not configured.' })
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: authData, error: authError } = await caller.auth.getUser(accessToken)
  if (authError || !authData.user) return response(401, { error: 'Your session could not be verified.' })

  const { data: scopeRows, error: scopeError } = await caller.rpc('get_current_admin_scope')
  const scope = Array.isArray(scopeRows) ? scopeRows[0] : null
  if (scopeError || !scope?.actor_id || !scope.organization_id || !scope.school_id) {
    return response(403, { error: 'Only an active school administrator can manage users.' })
  }

  let body: ActionBody
  try {
    body = await request.json() as ActionBody
  } catch {
    return response(400, { error: 'Request body must be valid JSON.' })
  }

  const action = body.action
  if (action !== 'invite' && action !== 'update' && action !== 'deactivate') {
    return response(400, { error: 'Unsupported user management action.' })
  }

  const targetUserId = action === 'invite' ? null : cleanText(body.targetUserId, 64)
  if (action !== 'invite' && !targetUserId) {
    return response(400, { error: 'A valid target user is required.' })
  }

  let fullName = cleanText(body.fullName, 160)
  let email = normalizeEmail(body.email)
  let role = typeof body.role === 'string' ? body.role.trim().toUpperCase() : ''
  let status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : ''
  let campusId = body.campusId === null || body.campusId === '' ? null : cleanText(body.campusId, 64)
  let assignments = parseAssignments(body.assignments ?? [])
  if (body.campusId !== undefined && body.campusId !== null && body.campusId !== '' && !campusId) {
    return response(400, { error: 'The selected campus ID is invalid.' })
  }
  if (targetUserId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
    return response(400, { error: 'A valid target user is required.' })
  }

  if (action === 'deactivate') {
    const { data: target, error: targetError } = await service
      .from('profiles')
      .select('id, full_name, role, campus_id')
      .eq('id', targetUserId)
      .eq('organization_id', scope.organization_id)
      .eq('school_id', scope.school_id)
      .maybeSingle()
    if (targetError || !target) return response(404, { error: 'The selected user was not found in your school.' })
    fullName = target.full_name
    role = target.role
    status = 'INACTIVE'
    campusId = target.campus_id
    assignments = []
  }

  if (!fullName || !allowedRoles.has(role) || !allowedStatuses.has(status) || assignments === null) {
    return response(400, { error: 'Provide a valid name, role, status, campus, and teacher scope.' })
  }

  if (role !== 'TEACHER' && assignments.length > 0) {
    return response(400, { error: 'Class assignments can only be set for teacher accounts.' })
  }

  if (role === 'TEACHER' && status === 'ACTIVE' && assignments.length === 0) {
    return response(400, { error: 'Assign at least one class and section before activating a teacher.' })
  }

  const requestedCampusIds = [...new Set([
    ...(campusId ? [campusId] : []),
    ...assignments.map((assignment) => assignment.campus_id),
  ])]
  if (requestedCampusIds.length) {
    const { data: permittedCampuses, error: campusError } = await service
      .from('campuses')
      .select('id')
      .eq('organization_id', scope.organization_id)
      .eq('school_id', scope.school_id)
      .eq('status', 'ACTIVE')
      .in('id', requestedCampusIds)
    if (campusError) {
      console.error('Unable to validate requested campus scope:', campusError.message)
      return response(500, { error: 'Campus scope could not be verified.' })
    }
    if ((permittedCampuses ?? []).length !== requestedCampusIds.length) {
      return response(403, { error: 'A selected campus is outside your active school scope.' })
    }
  }

  if (action === 'invite') {
    if (!email) {
      return response(400, { error: 'Enter a valid email address.' })
    }

    const { data: existingProfile, error: duplicateLookupError } = await service
      .from('profiles')
      .select('id')
      .eq('email', email)
      .limit(1)
      .maybeSingle()

    if (duplicateLookupError) {
      console.error('Duplicate email lookup failed during invite:', duplicateLookupError.message)
      return response(500, { error: 'The email could not be verified before sending an invitation.' })
    }
    if (existingProfile) {
      return response(409, { error: 'This email is already in use.' })
    }

    const { data: invitation, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
    })
    if (inviteError || !invitation.user) {
      if (invitation?.user?.id) {
        const { error: cleanupError } = await service.auth.admin.deleteUser(invitation.user.id)
        if (cleanupError) {
          console.error('Unable to clean up a user whose invitation failed:', cleanupError.message)
        }
      }
      console.error('Unable to issue school user invitation:', inviteError?.message ?? 'No user returned.')
      return response(400, { error: 'The invitation could not be sent. Verify the email and Supabase Auth email configuration.' })
    }

    const { error: scopeSetupError } = await service.from('profiles')
      .update({
        full_name: fullName,
        organization_id: scope.organization_id,
        school_id: scope.school_id,
        campus_id: campusId,
        role: 'TEACHER',
        status: 'INACTIVE',
      })
      .eq('id', invitation.user.id)
    if (scopeSetupError) {
      const { error: cleanupError } = await service.auth.admin.deleteUser(invitation.user.id)
      if (cleanupError) console.error('Failed to clean up an invited user after school-scope setup failed:', cleanupError.message)
      console.error('Unable to assign the invited user to the caller school:', scopeSetupError.message)
      return response(500, { error: 'The invitation could not be assigned to this school. The new account was removed where possible.' })
    }

    const { error: provisioningError } = await caller.rpc('update_school_user', {
      target_user_id: invitation.user.id,
      target_email: email,
      target_full_name: fullName,
      target_role: role,
      target_status: status,
      target_campus_id: campusId,
      target_assignment_scopes: assignments,
    })

    if (provisioningError) {
      const { error: cleanupError } = await service.auth.admin.deleteUser(invitation.user.id)
      if (cleanupError) console.error('Failed to clean up a newly invited user after provisioning failed:', cleanupError.message)
      console.error('Unable to finish invited user provisioning:', provisioningError.message)
      return response(400, { error: 'The invited user could not be provisioned for this school. The operation was rolled back where possible.' })
    }

    const { error: auditError } = await service.from('user_management_audit').insert({
      actor_id: scope.actor_id,
      target_id: invitation.user.id,
      event_type: 'USER_CREATED',
      details: { role, status, campus_id: campusId },
    })
    if (auditError) {
      await caller.rpc('update_school_user', {
        target_user_id: invitation.user.id,
        target_full_name: fullName,
        target_role: role,
        target_status: 'INACTIVE',
        target_campus_id: campusId,
        target_assignment_scopes: [],
      })
      console.error('Unable to write user creation audit record:', auditError.message)
      return response(500, { error: 'The invitation may have been sent, but this account was deactivated because its audit record could not be stored.' })
    }

    return response(201, {
      user: { id: invitation.user.id, email, full_name: fullName, role, status, campus_id: campusId },
      invitationSent: true,
    })
  }

  if (!email) {
    return response(400, { error: 'Enter a valid email address.' })
  }

  const { data: existingTarget, error: targetLoadError } = await service
    .from('profiles')
    .select('id, email')
    .eq('id', targetUserId)
    .eq('organization_id', scope.organization_id)
    .eq('school_id', scope.school_id)
    .maybeSingle()

  if (targetLoadError || !existingTarget) {
    return response(404, { error: 'The selected user was not found in your school.' })
  }

  if (existingTarget.email.toLowerCase() !== email) {
    const { data: duplicateProfile, error: duplicateProfileError } = await service
      .from('profiles')
      .select('id')
      .eq('email', email)
      .neq('id', targetUserId)
      .limit(1)
      .maybeSingle()

    if (duplicateProfileError) {
      console.error('Duplicate email lookup failed during profile update:', duplicateProfileError.message)
      return response(500, { error: 'The new email could not be verified.' })
    }
    if (duplicateProfile) {
      return response(409, { error: 'This email is already in use.' })
    }

    const { error: authEmailError } = await service.auth.admin.updateUserById(targetUserId, {
      email,
      email_confirm: true,
    })

    if (authEmailError) {
      const message = authEmailError.message.toLowerCase()
      if (message.includes('already') || message.includes('duplicate') || message.includes('in use')) {
        return response(409, { error: 'This email is already in use.' })
      }
      console.error('Supabase Auth rejected the email update:', authEmailError.message)
      return response(400, { error: 'The email could not be updated in Supabase Auth.' })
    }
  }

  const { data: updatedUser, error: updateError } = await caller.rpc('update_school_user', {
    target_user_id: targetUserId,
    target_email: email,
    target_full_name: fullName,
    target_role: role,
    target_status: status,
    target_campus_id: campusId,
    target_assignment_scopes: assignments,
  })

  if (updateError || !updatedUser) {
    console.error('School user update was denied or failed:', updateError?.message ?? 'No user returned.')
    return response(400, { error: 'The user could not be updated. Check school scope, teacher assignments, and active administrator protections.' })
  }

  return response(200, {
    user: {
      id: updatedUser.id,
      full_name: updatedUser.full_name,
      email: updatedUser.email ?? email,
      role: updatedUser.role,
      status: updatedUser.status,
      campus_id: updatedUser.campus_id,
    },
    invitationSent: false,
  })
})
