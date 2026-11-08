import { createClient } from 'npm:@supabase/supabase-js@2'

type Role = 'ADMIN' | 'PRINCIPAL' | 'TEACHER' | 'FINANCE'
type Domain = 'students' | 'attendance' | 'fees' | 'communication' | 'alerts' | 'reports'
type Assignment = {
  campus_id: string
  class_name: string
  section: string
}
type StudentRow = {
  id: string
  campus_id: string
  class_name: string
  section: string
}
type AttendanceSessionRow = {
  id: string
  campus_id: string
  class_name: string
  section: string
}
type AttendanceRecordRow = { status: string }
type InvoiceRow = { id: string; due_date: string }
type InvoiceItemRow = { invoice_id: string; amount: number | string }
type PaymentRow = { invoice_id: string; amount: number | string }
type CommunicationRow = { status: string }
type AlertRow = { campus_id: string; class_name: string; section: string }
type RequestBody = { prompt?: unknown }
type PageResult<T> = { data: T[] | null; error: { message: string } | null }

function isRequestBody(value: unknown): value is RequestBody {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const userRateLimits = new Map<string, { count: number; resetAt: number }>()
const pageSize = 500
const idBatchSize = 100
const roleDomains: Record<Role, Domain[]> = {
  ADMIN: ['students', 'attendance', 'fees', 'communication', 'alerts', 'reports'],
  PRINCIPAL: ['students', 'attendance', 'fees', 'communication', 'alerts', 'reports'],
  TEACHER: ['students', 'attendance', 'communication', 'alerts', 'reports'],
  FINANCE: ['students', 'fees', 'communication', 'reports'],
}

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? ''
  const allowedOriginEnv = Deno.env.get('ALLOWED_ORIGIN') ?? ''
  const isAllowed =
    (allowedOriginEnv && origin === allowedOriginEnv) ||
    !origin ||
    origin === 'https://camvia.elvaveo.com' ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/i.test(origin)

  return {
    'Access-Control-Allow-Origin': isAllowed ? (origin || '*') : (allowedOriginEnv || 'null'),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function response(status: number, body: Record<string, unknown>, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : null
}

function parseRole(value: unknown): Role | null {
  if (typeof value !== 'string') return null
  const role = value.toUpperCase()
  return role === 'ADMIN' || role === 'PRINCIPAL' || role === 'TEACHER' || role === 'FINANCE'
    ? role
    : null
}

function getMutationRefusal(prompt: string): string | null {
  if (/\b(create|add|register|edit|update|delete|remove|archive|trash|approve|reject|send|correct)\b/i.test(prompt) ||
    /\b(record|cancel)\s+(a\s+)?(payment|invoice|fee|attendance|message)\b/i.test(prompt)) {
    return 'CAMVIA Buddy is read-only and cannot make changes. Use the relevant CAMVIA page to perform that action.'
  }
  return null
}

function getUnsupportedDetailRefusal(prompt: string): string | null {
  const asksForDetails =
    /\b(which|who|names?|list|details?|individual|each|history|trends?|specific)\b/i.test(prompt) ||
    /\bshow\s+all\b/i.test(prompt) ||
    /\b(?:grade|class|section|campus)\s+[a-z0-9-]+\b/i.test(prompt) ||
    /\b(?!today['’]s\b)[a-z][a-z'-]*['’]s\s+(?:attendance|fee|balance|record|payment|status)\b/i.test(prompt) ||
    /\b(yesterday|last\s+(week|month|year)|this\s+(week|month|year|term)|current\s+(month|year|term)|between|since)\b/i.test(prompt) ||
    /\b(joined|newly|new students|admissions)\b/i.test(prompt)
  const referencedRecord = prompt.match(/\b(?:for|about)\s+([a-z][a-z'-]*)\b/i)?.[1]?.toLowerCase()
  const generalReferences = new Set([
    'all', 'assigned', 'current', 'my', 'our', 'school', 'students', 'student', 'the', 'this', 'today',
  ])
  if (asksForDetails || (referencedRecord && !generalReferences.has(referencedRecord))) {
    return 'CAMVIA Buddy provides aggregate summaries only. Use the relevant page for individual records or detailed reports available to your role.'
  }
  return null
}

function classifyDomain(prompt: string): Domain | null {
  const text = prompt.toLowerCase()
  if (/\b(communication|communications|approval|approvals|message|messages|parent|parents|drafts?|reminders?)\b/.test(text)) return 'communication'
  if (/\b(fee|fees|payment|payments|invoice|invoices|collection|collected|outstanding|overdue)\b/.test(text)) return 'fees'
  if (/\b(alert|alerts|risk|risks|attention)\b/.test(text)) return 'alerts'
  if (/\b(attendance|absent|absence|present|late|marking)\b/.test(text)) return 'attendance'
  if (/\b(student|students|enrolled|enrollment|class|classes|section|sections)\b/.test(text)) return 'students'
  if (/\b(report|reports|summary|dashboard|overview)\b/.test(text)) return 'reports'
  return null
}

function matchesAssignment(row: { campus_id: string; class_name: string; section: string }, assignments: Assignment[]) {
  return assignments.some((assignment) =>
    assignment.campus_id === row.campus_id &&
    assignment.class_name === row.class_name &&
    assignment.section === row.section,
  )
}

async function fetchAll<T>(loadPage: (start: number, end: number) => Promise<PageResult<T>>): Promise<T[]> {
  const result: T[] = []
  for (let start = 0; ; start += pageSize) {
    const page = await loadPage(start, start + pageSize - 1)
    if (page.error) throw new Error(page.error.message)
    const rows = page.data ?? []
    result.push(...rows)
    if (rows.length < pageSize) return result
  }
}

async function fetchForIds<T>(
  ids: string[],
  loadPage: (ids: string[], start: number, end: number) => Promise<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; offset < ids.length; offset += idBatchSize) {
    const batch = ids.slice(offset, offset + idBatchSize)
    rows.push(...await fetchAll<T>((start, end) => loadPage(batch, start, end)))
  }
  return rows
}

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const record = userRateLimits.get(userId) ?? { count: 0, resetAt: now + 60_000 }
  if (now >= record.resetAt) {
    record.count = 0
    record.resetAt = now + 60_000
  }
  record.count += 1
  userRateLimits.set(userId, record)
  return record.count <= 30
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(amount)
}

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

Deno.serve(async (request: Request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' }, cors)

  const origin = request.headers.get('Origin') ?? ''
  const allowedOrigin = cors['Access-Control-Allow-Origin']
  if (origin && allowedOrigin !== origin) {
    return response(403, { error: 'This origin is not allowed.' }, cors)
  }

  const authorization = request.headers.get('Authorization')
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) return response(401, { error: 'Sign in to use CAMVIA Buddy.' }, cors)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    console.error('[CAMVIA Buddy] Secure assistant configuration is incomplete.')
    return response(503, { error: 'The secure assistant service is not configured.' }, cors)
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)
  if (authError || !authData.user) {
    return response(401, { error: 'Your session could not be verified.' }, cors)
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, status, school_id')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError) {
    console.error('[CAMVIA Buddy] Could not verify the active user profile.')
    return response(403, { error: 'Your account scope could not be verified.' }, cors)
  }
  const role = parseRole(profile?.role)
  if (!profile || profile.status !== 'ACTIVE' || !profile.school_id || !role) {
    return response(403, { error: 'An active school account is required.' }, cors)
  }

  if (!checkRateLimit(authData.user.id)) {
    return response(429, { error: 'Assistant request limit reached. Try again shortly.' }, cors)
  }

  let body: RequestBody
  try {
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > 8_192) {
      return response(413, { error: 'Request is too large.' }, cors)
    }
    const parsed: unknown = JSON.parse(rawBody)
    if (!isRequestBody(parsed)) {
      return response(400, { error: 'Invalid request body.' }, cors)
    }
    body = parsed
  } catch {
    return response(400, { error: 'Invalid request body.' }, cors)
  }

  const prompt = cleanText(body.prompt, 2000)
  if (!prompt) return response(400, { error: 'Enter a question for CAMVIA Buddy.' }, cors)

  const mutationRefusal = getMutationRefusal(prompt)
  if (mutationRefusal) return response(200, { text: mutationRefusal }, cors)

  const detailRefusal = getUnsupportedDetailRefusal(prompt)
  if (detailRefusal) return response(200, { text: detailRefusal }, cors)

  const domain = classifyDomain(prompt)
  if (!domain) {
    return response(200, {
      text: 'I can answer current summaries about students, attendance, fees, communication, alerts, and reports that are available to your role.',
    }, cors)
  }

  if (!roleDomains[role].includes(domain)) {
    return response(200, {
      text: `I can’t provide ${domain} information for your role. I can answer questions about ${roleDomains[role].join(', ')}.`,
    }, cors)
  }

  try {
    let assignments: Assignment[] = []
    if (role === 'TEACHER') {
      assignments = await fetchAll<Assignment>((start, end) => supabase
        .from('teacher_class_assignments')
        .select('campus_id, class_name, section')
        .eq('user_id', authData.user.id)
        .eq('school_id', profile.school_id)
        .eq('active', true)
        .range(start, end))
    }

    let scopedStudents: StudentRow[] = []
    if (domain === 'students' || domain === 'reports') {
      const students = await fetchAll<StudentRow>((start, end) => supabase
        .from('students')
        .select('id, campus_id, class_name, section')
        .eq('school_id', profile.school_id)
        .eq('status', 'ACTIVE')
        .is('deleted_at', null)
        .range(start, end))
      scopedStudents = role === 'TEACHER'
        ? students.filter((student) => matchesAssignment(student, assignments))
        : students
    }
    if (domain === 'students') {
      const classes = new Set(scopedStudents.map((student) =>
        `${student.campus_id}:${student.class_name}:${student.section}`,
      ))
      return response(200, {
        text: `There are ${scopedStudents.length} active student(s) across ${classes.size} class/section group(s) in your authorized scope.`,
      }, cors)
    }

    if (domain === 'attendance') {
      const today = new Date().toISOString().slice(0, 10)
      const sessions = await fetchAll<AttendanceSessionRow>((start, end) => supabase
        .from('attendance_sessions')
        .select('id, campus_id, class_name, section')
        .eq('school_id', profile.school_id)
        .eq('attendance_date', today)
        .range(start, end))
      const scopedSessions = role === 'TEACHER'
        ? sessions.filter((session) => matchesAssignment(session, assignments))
        : sessions
      const sessionIds = scopedSessions.map((session) => session.id)
      const records = sessionIds.length
        ? await fetchForIds<AttendanceRecordRow>(sessionIds, (ids, start, end) => supabase
          .from('attendance_records')
          .select('status')
          .in('attendance_session_id', ids)
          .range(start, end))
        : []
      const present = records.filter((record) => record.status === 'PRESENT').length
      const late = records.filter((record) => record.status === 'LATE').length
      const absent = records.filter((record) => record.status === 'ABSENT').length
      const total = present + late + absent
      const rate = total ? Math.round(((present + late) / total) * 100) : null
      return response(200, {
        text: total
          ? `Today’s recorded attendance is ${rate}% across ${total} student mark(s) in ${scopedSessions.length} session(s): ${present} present, ${late} late, and ${absent} absent.`
          : scopedSessions.length
            ? `There are ${scopedSessions.length} attendance session(s) today, but no student marks have been recorded.`
            : 'No attendance has been recorded today in your authorized scope.',
      }, cors)
    }

    if (domain === 'reports' && role === 'TEACHER') {
      const attendanceToday = await getAttendanceSummary(supabase, profile.school_id, role, assignments)
      return response(200, {
        text: `Report summary: ${scopedStudents.length} active student(s) in your assigned scope. Today’s attendance: ${attendanceToday}`,
      }, cors)
    }

    if (domain === 'fees' || domain === 'reports') {
      const invoices = await fetchAll<InvoiceRow>((start, end) => supabase
          .from('fee_invoices')
          .select('id, due_date')
          .eq('school_id', profile.school_id)
          .is('voided_at', null)
          .range(start, end))
      const invoiceIds = invoices.map((invoice) => invoice.id)
      const [items, payments] = invoiceIds.length
        ? await Promise.all([
          fetchForIds<InvoiceItemRow>(invoiceIds, (ids, start, end) => supabase
              .from('fee_invoice_items')
              .select('invoice_id, amount')
              .in('invoice_id', ids)
              .range(start, end)),
          fetchForIds<PaymentRow>(invoiceIds, (ids, start, end) => supabase
              .from('fee_payments')
              .select('invoice_id, amount')
              .in('invoice_id', ids)
              .is('voided_at', null)
              .range(start, end)),
        ])
        : [[], []]

      const invoiceTotals = new Map<string, number>()
      const paidTotals = new Map<string, number>()
      for (const item of items) {
        invoiceTotals.set(item.invoice_id, roundMoney((invoiceTotals.get(item.invoice_id) ?? 0) + Number(item.amount)))
      }
      for (const payment of payments) {
        paidTotals.set(payment.invoice_id, roundMoney((paidTotals.get(payment.invoice_id) ?? 0) + Number(payment.amount)))
      }

      const today = new Date().toISOString().slice(0, 10)
      const outstanding = roundMoney(invoices.reduce((sum, invoice) => {
        const total = invoiceTotals.get(invoice.id) ?? 0
        const paid = paidTotals.get(invoice.id) ?? 0
        return sum + Math.max(0, total - paid)
      }, 0))
      const collected = roundMoney(invoices.reduce((sum, invoice) => sum + (paidTotals.get(invoice.id) ?? 0), 0))
      const overdue = invoices.filter((invoice) =>
        invoice.due_date < today &&
        roundMoney(Math.max(0, (invoiceTotals.get(invoice.id) ?? 0) - (paidTotals.get(invoice.id) ?? 0))) > 0,
      ).length
      const financialSummary = `There are ${invoices.length} active invoice(s): PKR ${formatAmount(outstanding)} outstanding and PKR ${formatAmount(collected)} collected`
      const withOverdue = `${financialSummary}; ${overdue} invoice(s) are overdue.`
      if (domain === 'fees') return response(200, { text: withOverdue }, cors)
      if (role === 'FINANCE') return response(200, { text: withOverdue }, cors)
      const attendanceToday = await getAttendanceSummary(supabase, profile.school_id, role, assignments)
      return response(200, {
        text: `School report: ${scopedStudents.length} active student(s); ${withOverdue} Today’s attendance: ${attendanceToday}`,
      }, cors)
    }

    if (domain === 'communication') {
      if (role === 'TEACHER' && /\b(approval|approvals|awaiting|pending)\b/i.test(prompt)) {
        return response(200, {
          text: 'Teachers can use CAMVIA Buddy to check their own communication drafts. Approval workflows are not available to the Teacher role.',
        }, cors)
      }
      const messages = role === 'TEACHER'
        ? await fetchAll<CommunicationRow>((start, end) => supabase
          .from('communication_messages')
          .select('status')
          .eq('school_id', profile.school_id)
          .eq('created_by', authData.user.id)
          .eq('status', 'DRAFT')
          .is('deleted_at', null)
          .range(start, end))
        : role === 'FINANCE'
          ? await fetchAll<CommunicationRow>((start, end) => supabase
            .from('communication_messages')
            .select('status')
            .eq('school_id', profile.school_id)
            .eq('message_type', 'Fee Reminder')
            .eq('source_type', 'FEE')
            .is('deleted_at', null)
            .range(start, end))
          : await fetchAll<CommunicationRow>((start, end) => supabase
            .from('communication_messages')
            .select('status')
            .eq('school_id', profile.school_id)
            .is('deleted_at', null)
            .range(start, end))
      const drafts = messages.filter((message) => message.status === 'DRAFT').length
      const awaiting = messages.filter((message) => message.status === 'AWAITING_APPROVAL').length
      const approved = messages.filter((message) => message.status === 'APPROVED').length
      const rejected = messages.filter((message) => message.status === 'REJECTED').length
      const sent = messages.filter((message) => message.status === 'SENT').length
      if (role === 'TEACHER') {
        return response(200, { text: `You have ${drafts} own communication draft(s) in your assigned scope.` }, cors)
      }
      if (role === 'FINANCE') {
        return response(200, {
          text: `Fee reminder communications in your authorized scope: ${drafts} draft(s), ${awaiting} awaiting approval, ${approved} approved, ${rejected} rejected, and ${sent} sent.`,
        }, cors)
      }
      const summary = `Communication records in your authorized scope: ${drafts} draft(s), ${awaiting} awaiting approval, ${approved} approved, ${rejected} rejected, and ${sent} sent.`
      return response(200, { text: summary }, cors)
    }

    if (domain === 'alerts') {
      const alertRows = await fetchAll<AlertRow>((start, end) => supabase
        .from('live_alerts')
        .select('campus_id, class_name, section')
        .eq('school_id', profile.school_id)
        .eq('source_type', 'ATTENDANCE')
        .neq('status', 'RESOLVED')
        .range(start, end))
      const scopedAlerts = role === 'TEACHER'
        ? alertRows.filter((alert) => matchesAssignment(alert, assignments))
        : alertRows
      return response(200, {
        text: `There are ${scopedAlerts.length} active attendance alert(s) in your authorized scope.`,
      }, cors)
    }

    return response(200, {
      text: `There are ${scopedStudents.length} active student(s) in your authorized scope.`,
    }, cors)
  } catch (error) {
    console.error('[CAMVIA Buddy] Live authorized data retrieval failed:', error instanceof Error ? error.message : 'Unknown error')
    return response(503, { error: 'Current authorized data is unavailable. Please try again.' }, cors)
  }
})

async function getAttendanceSummary(
  supabase: ReturnType<typeof createClient>,
  schoolId: string,
  role: Role,
  assignments: Assignment[],
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10)
  const sessions = await fetchAll<AttendanceSessionRow>((start, end) => supabase
    .from('attendance_sessions')
    .select('id, campus_id, class_name, section')
    .eq('school_id', schoolId)
    .eq('attendance_date', today)
    .range(start, end))
  const scopedSessions = role === 'TEACHER'
    ? sessions.filter((session) => matchesAssignment(session, assignments))
    : sessions
  const ids = scopedSessions.map((session) => session.id)
  if (!ids.length) return 'no attendance has been recorded today in the authorized scope.'
  const records = await fetchForIds<AttendanceRecordRow>(ids, (sessionIds, start, end) => supabase
    .from('attendance_records')
    .select('status')
    .in('attendance_session_id', sessionIds)
    .range(start, end))
  const present = records.filter((record) => record.status === 'PRESENT').length
  const late = records.filter((record) => record.status === 'LATE').length
  const absent = records.filter((record) => record.status === 'ABSENT').length
  const total = present + late + absent
  if (!total) return `${ids.length} session(s) exist, but no student marks have been recorded.`
  const rate = Math.round(((present + late) / total) * 100)
  return `${rate}% across ${total} marks in ${ids.length} session(s): ${present} present, ${late} late, and ${absent} absent.`
}
