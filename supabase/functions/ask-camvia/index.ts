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
  first_name: string
  last_name: string
  campus_id: string
  class_name: string
  section: string
}
type AttendanceSessionRow = {
  id: string
  campus_id: string
  class_name: string
  section: string
  attendance_date: string
}
type AttendanceRecordRow = { student_id: string; status: string }
type InvoiceRow = { id: string; student_id: string; due_date: string }
type InvoiceItemRow = { invoice_id: string; amount: number | string }
type PaymentRow = { invoice_id: string; amount: number | string }
type CommunicationRow = { status: string }
type AlertRow = { campus_id: string; class_name: string; section: string }
type ClassScope = { className: string; section: string | null }
type GuardianLinkRow = { guardian_id: string; relationship: string | null; is_primary: boolean }
type GuardianRow = { id: string; first_name: string; last_name: string }
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
    return 'CAMVIA Buddy is read-only and cannot make changes.'
  }
  return null
}

function getUnsupportedDetailRefusal(prompt: string): string | null {
  if (/\b(yesterday|last\s+(week|month|year)|this\s+(week|month|year|term)|current\s+(month|year|term)|between|since|history|historical|trends?)\b/i.test(prompt)) {
    return 'That time period is not available in CAMVIA Buddy.'
  }
  return null
}

function classifyDomain(prompt: string): Domain | null {
  const text = prompt.toLowerCase()
  if (/\b(communication|communications|approval|approvals|message|messages|drafts?|reminders?)\b/.test(text)) return 'communication'
  if (/\b(fee|fees|payment|payments|invoice|invoices|collection|collected|outstanding|overdue)\b/.test(text)) return 'fees'
  if (/\b(alert|alerts|risk|risks|attention)\b/.test(text)) return 'alerts'
  if (/\b(attend(?:ance|ence)|absent|absence|present|late|marking|hajri|hazir)\b/.test(text)) return 'attendance'
  if (/\b(student|students|enrolled|enrollment|class|classes|section|sections|guardian|guardians|parent|parents|sarparast)\b/.test(text)) return 'students'
  if (/\b(report|reports|summary|dashboard|overview)\b/.test(text)) return 'reports'
  return null
}

function isRomanUrdu(prompt: string): boolean {
  return /\b(aaj|hai|hain|ha|hamari|hmari|humari|huma|zaree|meri|kitne|kitni|kon|kaun|ka|ki|ke|mein|batao|btao)\b/i.test(prompt) ||
    /^(attendance|fees?\s+due)\s*[?!.]*$/i.test(prompt.trim())
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function extractStudentName(prompt: string): string | null {
  const romanUrdu = prompt.match(/^\s*([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2})\s+(?:ki|ka|ke)\s+(?:attendance|guardian|parent)\b/iu)
  const possessive = prompt.match(/^\s*(?:what(?:\s+is|['’]s)\s+)?([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2})['’]s\s+(?:attendance|guardian|parent)\b/iu)
  const forOrOf = prompt.match(/\b(?:attendance|guardian|parent)\s+(?:for|of)\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2})/iu)
  const value = romanUrdu?.[1] ?? possessive?.[1] ?? forOrOf?.[1]
  if (!value) return null
  const name = value.trim().replace(/\s+/g, ' ')
  const nonNames = new Set(['aaj', 'today', 'hamari', 'hmari', 'humari', 'huma', 'meri', 'my', 'our'])
  return nonNames.has(name.split(' ')[0].toLocaleLowerCase()) ? null : name
}

function extractClassScope(prompt: string): ClassScope | null {
  const match = prompt.match(/\bclass\s+([\p{L}\d-]+)(?:\s+(?:section\s+)?([\p{L}\d-]+))?/iu)
  if (!match) return null
  const reserved = new Set([
    'absent', 'attendance', 'hai', 'hain', 'ha', 'in', 'kitne', 'kitni', 'me', 'mein',
    'present', 'section', 'student', 'students',
  ])
  const section = match[2] && !reserved.has(match[2].toLocaleLowerCase()) ? match[2] : null
  return { className: match[1], section }
}

function matchesClassScope(
  row: { class_name: string; section: string },
  scope: ClassScope | null,
): boolean {
  if (!scope) return true
  const normalizeClass = (value: string) => value.trim().replace(/^(class|grade)\s+/i, '').toLocaleLowerCase()
  return normalizeClass(row.class_name) === normalizeClass(scope.className) &&
    (!scope.section || row.section.trim().toLocaleLowerCase() === scope.section.toLocaleLowerCase())
}

function getNameOnlyQuestion(prompt: string): string | null {
  if (!/^\s*\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*){0,2}\s*[?.!]*\s*$/u.test(prompt)) return null
  if (/\b(?:hello|hi|help|camvia|buddy)\b/i.test(prompt)) return null
  return prompt.replace(/[?.!]+$/g, '').trim()
}

function getAttendanceMetric(prompt: string): 'rate' | 'present-count' | 'absent-count' | 'absent-names' {
  const text = prompt.toLocaleLowerCase()
  if (/\b(absent|absence|gair\s+hazir)\b/.test(text) && /\b(who|which|names?|list|kon|kaun)\b/.test(text)) {
    return 'absent-names'
  }
  const asksCount = /\b(how\s+many|count|number\s+of|kitne|kitni)\b/.test(text)
  if (/\b(present|hazir)\b/.test(text) && asksCount) return 'present-count'
  if (/\b(absent|absence|gair\s+hazir)\b/.test(text) && asksCount) return 'absent-count'
  return 'rate'
}

function asksForAmount(prompt: string): boolean {
  return /\b(how\s+much|amount|total|pkr|rupees?|fees?\s+kitni|kitni\s+(?:fee|fees|amount))\b/i.test(prompt)
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
  const romanUrdu = isRomanUrdu(prompt)

  const mutationRefusal = getMutationRefusal(prompt)
  if (mutationRefusal) {
    return response(200, {
      text: romanUrdu ? 'CAMVIA Buddy sirf read-only hai.' : mutationRefusal,
    }, cors)
  }

  const detailRefusal = getUnsupportedDetailRefusal(prompt)
  if (detailRefusal) {
    return response(200, {
      text: romanUrdu ? 'Yeh time period CAMVIA Buddy mein available nahi hai.' : detailRefusal,
    }, cors)
  }

  const domain = classifyDomain(prompt)
  const nameOnlyQuestion = getNameOnlyQuestion(prompt)
  const classScope = extractClassScope(prompt)
  const studentName = extractStudentName(prompt)
  const guardianQuestion = /\b(guardian|guardians|parent|parents|sarparast)\b/i.test(prompt)
  const requestedDomain = domain === 'reports'
    ? role === 'FINANCE' ? 'fees' : 'attendance'
    : domain

  if (!domain) {
    if (nameOnlyQuestion) {
      return response(200, {
        text: `${nameOnlyQuestion} ke bare mein kya dekhna hai — attendance, fees, ya profile?`,
      }, cors)
    }
    return response(200, { text: 'Ask about a CAMVIA school record.' }, cors)
  }

  if (!roleDomains[role].includes(domain)) {
    return response(200, {
      text: romanUrdu
        ? `Aapke role mein ${domain} data dekhne ki permission nahi hai.`
        : `Your role does not have access to ${domain} data.`,
    }, cors)
  }

  if (guardianQuestion && !studentName) {
    return response(200, {
      text: romanUrdu ? 'Kis student ka guardian dekhna hai?' : 'Which student’s guardian should I check?',
    }, cors)
  }

  if (domain === 'communication' &&
    !/\b(draft|awaiting|pending|approval|approved|rejected|sent|summary|overview|all\s+statuses)\b/i.test(prompt)) {
    return response(200, {
      text: romanUrdu
        ? 'Communication mein kya dekhna hai — drafts, approvals, ya sent messages?'
        : 'Which communication status should I check — drafts, approvals, or sent messages?',
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
    const attendanceMetric = getAttendanceMetric(prompt)
    const needsStudentRows = domain === 'students' ||
      Boolean(studentName) ||
      (requestedDomain === 'attendance' && attendanceMetric === 'absent-names') ||
      (requestedDomain === 'fees' && Boolean(classScope))
    if (needsStudentRows) {
      const students = await fetchAll<StudentRow>((start, end) => supabase
        .from('students')
        .select('id, first_name, last_name, campus_id, class_name, section')
        .eq('school_id', profile.school_id)
        .eq('status', 'ACTIVE')
        .is('deleted_at', null)
        .range(start, end))
      scopedStudents = role === 'TEACHER'
        ? students.filter((student) => matchesAssignment(student, assignments))
        : students
    }
    if (domain === 'students') {
      if (guardianQuestion && studentName) {
        const matchingStudents = scopedStudents.filter((student) =>
          normalizeName(`${student.first_name} ${student.last_name}`) === normalizeName(studentName) ||
          normalizeName(student.first_name) === normalizeName(studentName),
        )
        if (matchingStudents.length > 1) {
          return response(200, {
            text: romanUrdu
              ? `${studentName} naam ke multiple students hain. Class ya section batayein.`
              : `More than one student is named ${studentName}. Which class or section?`,
          }, cors)
        }
        const student = matchingStudents[0]
        if (!student) {
          return response(200, {
            text: romanUrdu
              ? `${studentName} aapke authorized scope mein nahi mila.`
              : `${studentName} was not found in your authorized scope.`,
          }, cors)
        }

        const links = await fetchAll<GuardianLinkRow>((start, end) => supabase
          .from('student_guardians')
          .select('guardian_id, relationship, is_primary')
          .eq('student_id', student.id)
          .range(start, end))
        const guardianIds = links.map((link) => link.guardian_id)
        const guardians = guardianIds.length
          ? await fetchAll<GuardianRow>((start, end) => supabase
            .from('guardians')
            .select('id, first_name, last_name')
            .eq('school_id', profile.school_id)
            .in('id', guardianIds)
            .is('deleted_at', null)
            .is('archived_at', null)
            .range(start, end))
          : []
        const guardianById = new Map(guardians.map((guardian) => [guardian.id, guardian]))
        const link = links.find((item) => item.is_primary && guardianById.has(item.guardian_id)) ||
          links.find((item) => guardianById.has(item.guardian_id))
        const guardian = link ? guardianById.get(link.guardian_id) : undefined
        const studentFullName = `${student.first_name} ${student.last_name}`.trim()
        if (!guardian) {
          return response(200, {
            text: romanUrdu
              ? `${studentFullName} ka guardian record nahi mila.`
              : `No guardian record was found for ${studentFullName}.`,
          }, cors)
        }
        const guardianFullName = `${guardian.first_name} ${guardian.last_name}`.trim()
        return response(200, {
          text: romanUrdu
            ? `${studentFullName} ke guardian ${guardianFullName} hain.`
            : `${studentFullName}’s guardian is ${guardianFullName}.`,
        }, cors)
      }

      const students = scopedStudents.filter((student) => matchesClassScope(student, classScope))
      const classLabel = classScope
        ? `Class ${classScope.className}${classScope.section ? `-${classScope.section}` : ''}`
        : null
      return response(200, {
        text: classLabel
          ? romanUrdu
            ? `${classLabel} mein ${students.length} students hain.`
            : `${classLabel} has ${students.length} active students.`
          : romanUrdu
            ? `${students.length} students hain.`
            : `${students.length} active students.`,
      }, cors)
    }

    if (requestedDomain === 'attendance') {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: (profile as Record<string, unknown>).school_timezone as string || 'Asia/Karachi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())
      let sessions = await fetchAll<AttendanceSessionRow>((start, end) => {
        let query = supabase
        .from('attendance_sessions')
        .select('id, campus_id, class_name, section, attendance_date')
        .eq('school_id', profile.school_id)
        if (!studentName || /\b(today|aaj)\b/i.test(prompt)) query = query.eq('attendance_date', today)
        return query.range(start, end)
      })
      sessions = role === 'TEACHER'
        ? sessions.filter((session) => matchesAssignment(session, assignments))
        : sessions
      sessions = sessions.filter((session) => matchesClassScope(session, classScope))

      let selectedStudent: StudentRow | undefined
      if (studentName) {
        const matchingStudents = scopedStudents.filter((student) =>
          (normalizeName(`${student.first_name} ${student.last_name}`) === normalizeName(studentName) ||
            normalizeName(student.first_name) === normalizeName(studentName)) &&
          matchesClassScope(student, classScope),
        )
        if (matchingStudents.length > 1) {
          return response(200, {
            text: romanUrdu
              ? `${studentName} naam ke multiple students hain. Class ya section batayein.`
              : `More than one student is named ${studentName}. Which class or section?`,
          }, cors)
        }
        selectedStudent = matchingStudents[0]
        if (!selectedStudent) {
          return response(200, {
            text: romanUrdu
              ? `${studentName} aapke authorized scope mein nahi mila.`
              : `${studentName} was not found in your authorized scope.`,
          }, cors)
        }
      }

      const scopedSessions = selectedStudent && role === 'TEACHER'
        ? sessions.filter((session) => matchesAssignment(session, assignments))
        : sessions
      const sessionIds = scopedSessions.map((session) => session.id)
      const records = sessionIds.length
        ? await fetchForIds<AttendanceRecordRow>(sessionIds, (ids, start, end) => {
          let query = supabase
            .from('attendance_records')
            .select('student_id, status')
            .in('attendance_session_id', ids)
          if (selectedStudent) query = query.eq('student_id', selectedStudent.id)
          return query.range(start, end)
        })
        : []
      const present = records.filter((record) => record.status === 'PRESENT').length
      const late = records.filter((record) => record.status === 'LATE').length
      const absent = records.filter((record) => record.status === 'ABSENT').length
      const total = present + late + absent
      const studentFullName = selectedStudent
        ? `${selectedStudent.first_name} ${selectedStudent.last_name}`.trim()
        : ''
      if (selectedStudent && /\b(today|aaj)\b/i.test(prompt)) {
        const status = records[0]?.status
        return response(200, {
          text: status
            ? romanUrdu
              ? `${studentFullName} aaj ${status === 'PRESENT' ? 'present' : status === 'ABSENT' ? 'absent' : 'late'} hain.`
              : `${studentFullName} is ${status.toLocaleLowerCase()} today.`
            : romanUrdu
              ? `Aaj ${studentFullName} ki attendance record nahi hui.`
              : `No attendance was recorded for ${studentFullName} today.`,
        }, cors)
      }
      if (selectedStudent) {
        const rate = total ? Math.round(((present + late) / total) * 100) : null
        return response(200, {
          text: rate !== null
            ? romanUrdu
              ? `${studentFullName} ki attendance ${rate}% hai.`
              : `${studentFullName}’s attendance is ${rate}%.`
            : romanUrdu
              ? `${studentFullName} ki attendance record nahi mili.`
              : `No attendance record was found for ${studentFullName}.`,
        }, cors)
      }

      if (attendanceMetric === 'absent-names') {
        const absentIds = new Set(records.filter((record) => record.status === 'ABSENT').map((record) => record.student_id))
        const names = [...new Set(scopedStudents
          .filter((student) => absentIds.has(student.id) && matchesClassScope(student, classScope))
          .map((student) => `${student.first_name} ${student.last_name}`.trim()))]
        return response(200, {
          text: names.length
            ? names.join(', ')
            : romanUrdu ? 'Aaj koi student absent nahi hai.' : 'No students are absent today.',
        }, cors)
      }

      if (attendanceMetric === 'present-count') {
        const classLabel = classScope
          ? `Class ${classScope.className}${classScope.section ? `-${classScope.section}` : ''}`
          : null
        return response(200, {
          text: classLabel
            ? romanUrdu
              ? `${classLabel} mein ${present} students present hain.`
              : `${present} students are present in ${classLabel}.`
            : romanUrdu
              ? `${present} students present hain.`
              : `${present} students are present.`,
        }, cors)
      }
      if (attendanceMetric === 'absent-count') {
        const classLabel = classScope
          ? `Class ${classScope.className}${classScope.section ? `-${classScope.section}` : ''}`
          : null
        return response(200, {
          text: classLabel
            ? romanUrdu
              ? `${classLabel} mein ${absent} students absent hain.`
              : `${absent} students are absent in ${classLabel}.`
            : romanUrdu
              ? `${absent} students absent hain.`
              : `${absent} students are absent.`,
        }, cors)
      }
      const rate = total ? Math.round(((present + late) / total) * 100) : null
      const classLabel = classScope
        ? `Class ${classScope.className}${classScope.section ? `-${classScope.section}` : ''}`
        : null
      return response(200, {
        text: total
          ? classLabel
            ? romanUrdu
              ? `${classLabel} ki attendance ${rate}% hai.`
              : `${classLabel}’s attendance is ${rate}% today.`
            : romanUrdu
              ? `Aaj ${rate}% attendance hai.`
              : `Today's attendance is ${rate}%.`
          : romanUrdu
            ? 'Aaj attendance record nahi hui.'
            : 'No attendance has been recorded today.',
      }, cors)
    }

    if (requestedDomain === 'fees') {
      const invoices = await fetchAll<InvoiceRow>((start, end) => supabase
          .from('fee_invoices')
          .select('id, student_id, due_date')
          .eq('school_id', profile.school_id)
          .is('voided_at', null)
          .range(start, end))
      const scopedStudentIds = classScope
        ? new Set(scopedStudents.filter((student) => matchesClassScope(student, classScope)).map((student) => student.id))
        : null
      const scopedInvoices = scopedStudentIds
        ? invoices.filter((invoice) => scopedStudentIds.has(invoice.student_id))
        : invoices
      const invoiceIds = scopedInvoices.map((invoice) => invoice.id)
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
      const outstandingByInvoice = new Map(scopedInvoices.map((invoice) => {
        const total = invoiceTotals.get(invoice.id) ?? 0
        const paid = paidTotals.get(invoice.id) ?? 0
        return [invoice.id, roundMoney(Math.max(0, total - paid))] as const
      }))
      const dueInvoices = scopedInvoices.filter((invoice) => (outstandingByInvoice.get(invoice.id) ?? 0) > 0)
      const overdueInvoices = dueInvoices.filter((invoice) =>
        invoice.due_date < today &&
        (outstandingByInvoice.get(invoice.id) ?? 0) > 0)
      const asksOverdue = /\b(overdue|past\s+due)\b/i.test(prompt)
      if (asksOverdue && asksForAmount(prompt)) {
        const overdueAmount = roundMoney(overdueInvoices.reduce((sum, invoice) =>
          sum + (outstandingByInvoice.get(invoice.id) ?? 0), 0))
        return response(200, {
          text: romanUrdu
            ? `PKR ${formatAmount(overdueAmount)} overdue hai.`
            : `PKR ${formatAmount(overdueAmount)} is overdue.`,
        }, cors)
      }
      if (asksOverdue) {
        return response(200, {
          text: romanUrdu
            ? `${overdueInvoices.length} invoices overdue hain.`
            : `${overdueInvoices.length} invoices are overdue.`,
        }, cors)
      }
      if (/\b(collected|paid|payments?)\b/i.test(prompt) && !/\b(due|outstanding)\b/i.test(prompt)) {
        const collected = roundMoney(scopedInvoices.reduce((sum, invoice) =>
          sum + (paidTotals.get(invoice.id) ?? 0), 0))
        return response(200, {
          text: romanUrdu
            ? `PKR ${formatAmount(collected)} fees collect hui hain.`
            : `PKR ${formatAmount(collected)} has been collected.`,
        }, cors)
      }
      if (asksForAmount(prompt)) {
        const outstanding = roundMoney([...outstandingByInvoice.values()].reduce((sum, amount) => sum + amount, 0))
        return response(200, {
          text: romanUrdu
            ? `PKR ${formatAmount(outstanding)} fees due hain.`
            : `PKR ${formatAmount(outstanding)} is due.`,
        }, cors)
      }
      const dueStudentCount = new Set(dueInvoices.map((invoice) => invoice.student_id)).size
      return response(200, {
        text: romanUrdu
          ? `${dueStudentCount} students ki fees due hain.`
          : `${dueStudentCount} students have fees due.`,
      }, cors)
    }

    if (domain === 'communication') {
      const requestedStatus = /\b(draft|drafts)\b/i.test(prompt)
        ? 'DRAFT'
        : /\b(awaiting|pending|approval|approvals)\b/i.test(prompt)
          ? 'AWAITING_APPROVAL'
          : /\b(approved)\b/i.test(prompt)
            ? 'APPROVED'
            : /\b(rejected)\b/i.test(prompt)
              ? 'REJECTED'
              : /\b(sent)\b/i.test(prompt)
                ? 'SENT'
                : null
      if (role === 'TEACHER' && requestedStatus && requestedStatus !== 'DRAFT') {
        return response(200, {
          text: romanUrdu
            ? 'Teacher role sirf apne drafts dekh sakta hai.'
            : 'Teachers can only view their own drafts.',
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
      if (/\b(summary|overview|all\s+statuses)\b/i.test(prompt)) {
        if (role === 'TEACHER') {
          return response(200, {
            text: romanUrdu
              ? `Aapke ${drafts} communication drafts hain.`
              : `You have ${drafts} communication drafts.`,
          }, cors)
        }
        return response(200, {
          text: romanUrdu
            ? `Drafts: ${drafts}; approval ke liye pending: ${awaiting}; approved: ${approved}; rejected: ${rejected}; sent: ${sent}.`
            : `Drafts: ${drafts}; awaiting approval: ${awaiting}; approved: ${approved}; rejected: ${rejected}; sent: ${sent}.`,
        }, cors)
      }
      const count = requestedStatus === 'DRAFT' ? drafts
        : requestedStatus === 'AWAITING_APPROVAL' ? awaiting
            : requestedStatus === 'APPROVED' ? approved
              : requestedStatus === 'REJECTED' ? rejected
                : sent
      const label = requestedStatus === 'DRAFT' ? 'drafts'
        : requestedStatus === 'AWAITING_APPROVAL' ? (romanUrdu ? 'approval ke liye pending messages' : 'messages awaiting approval')
          : requestedStatus === 'APPROVED' ? 'approved messages'
            : requestedStatus === 'REJECTED' ? 'rejected messages'
              : 'sent messages'
      return response(200, {
        text: romanUrdu ? `${count} ${label} hain.` : `${count} ${label}.`,
      }, cors)
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
      const filteredAlerts = scopedAlerts.filter((alert) => matchesClassScope(alert, classScope))
      return response(200, {
        text: romanUrdu
          ? `${filteredAlerts.length} active alerts hain.`
          : `${filteredAlerts.length} active alerts.`,
      }, cors)
    }

    return response(200, {
      text: romanUrdu ? 'Is CAMVIA sawal ka jawab available nahi.' : 'I could not answer that CAMVIA question.',
    }, cors)
  } catch (error) {
    console.error('[CAMVIA Buddy] Live authorized data retrieval failed:', error instanceof Error ? error.message : 'Unknown error')
    return response(503, { error: 'Current authorized data is unavailable. Please try again.' }, cors)
  }
})
