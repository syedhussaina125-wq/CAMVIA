import type { AlertItem } from '../alertsData'
import type { AttendanceState } from '../attendanceData'
import type { CommunicationState } from '../communicationData'
import type { FeeState } from '../feeData'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { Role, SessionUser } from '../mockData'
import type { Student } from '../studentData'
import { schoolDateKey } from '../utils/schoolTimezone'

export type ChatMessage = {
  role: 'assistant' | 'user'
  text: string
}

export type AskCamviaResponse = {
  text: string
}

export type AskCamviaAuthorizedInput = {
  user: SessionUser
  students: Student[]
  attendance: AttendanceState
  fees: FeeState
  communication: CommunicationState
  alerts: AlertItem[]
  history?: ChatMessage[]
}

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent'

const ROLE_CAPABILITIES: Record<Role, { allowed: string[]; restricted: string[] }> = {
  admin: {
    allowed: [
      'All active students, classes, sections, and guardian details in this school',
      'School-wide attendance sessions, daily attendance rates, present/absent/late counts, and student attendance',
      'School-wide fees, invoices, collected amounts, outstanding balances, and overdue records',
      'All parent communications across all statuses (draft, awaiting approval, approved, rejected, sent)',
      'All active school alerts (attendance, fee, communication)',
    ],
    restricted: [
      'Read-only: cannot create, edit, delete, approve, reject, or send records',
      'Only data belonging to your active school',
    ],
  },
  principal: {
    allowed: [
      'All active students, classes, sections, and guardian details in this school',
      'School-wide attendance sessions, daily attendance rates, present/absent/late counts, and student attendance',
      'School-wide fees, invoices, collected amounts, outstanding balances, and overdue records',
      'All parent communications across all statuses (draft, awaiting approval, approved, rejected, sent)',
      'All active school alerts (attendance, fee, communication)',
    ],
    restricted: [
      'Read-only: cannot create, edit, delete, approve, reject, or send records',
      'Only data belonging to your active school',
    ],
  },
  teacher: {
    allowed: [
      'Active students in your assigned classes/sections only',
      'Attendance sessions, rates, and student attendance for your assigned classes/sections only',
      'Your own communication drafts (DRAFT status) only',
      'Attendance alerts for your assigned classes/sections only',
    ],
    restricted: [
      'No access to fee, invoice, payment, or financial balance data',
      'No access to students or attendance outside your assigned classes/sections',
      'No access to submitted, approved, rejected, or sent communications of other staff',
      'Read-only: cannot create, edit, delete, or mark attendance from CAMVIA Buddy',
    ],
  },
  finance: {
    allowed: [
      'Active student directory and class counts in this school (for billing context)',
      'Fee invoices, collected totals, outstanding dues, overdue invoices, and per-student fee balances',
      'Fee reminder communications (sourceType = FEE) across statuses',
      'Fee-related alerts only',
    ],
    restricted: [
      'No access to attendance sessions, daily attendance rates, or absent/present student lists',
      'No access to non-fee parent communications or attendance alerts',
      'Read-only: cannot create invoices, record payments, void records, or send reminders from CAMVIA Buddy',
    ],
  },
}

const ROMAN_URDU_WORDS = new Set([
  'aaj', 'kal', 'parso', 'hai', 'hain', 'hun', 'hoon', 'tha', 'thi',
  'kya', 'kia', 'kis', 'kisi', 'kaun', 'kon', 'konsa', 'konsi', 'konse', 'kahan', 'kab',
  'kitne', 'kitni', 'kitna', 'kitny', 'batao', 'btao', 'bata', 'btaye', 'bataye',
  'dikhao', 'dikha', 'dikhaye', 'hamari', 'hmari', 'humari', 'meri', 'mere',
  'apne', 'apni', 'apna', 'mein',
  'nahi', 'nhi', 'chahiye', 'pooch', 'pochoo', 'hum', 'mahine', 'mahin',
  'mahina', 'hafta', 'hafte', 'hajri', 'hazir', 'gair', 'chutti', 'chuti', 'sabse',
  'zyada', 'baqi', 'baki', 'jama', 'naam', 'walid', 'sarparast',
])

const MUTATION_VERBS = new Set([
  'create', 'add', 'register', 'edit', 'update', 'modify', 'change',
  'delete', 'remove', 'archive', 'trash', 'approve', 'reject', 'send',
  'correct', 'void',
])

function tokenizeWords(prompt: string): string[] {
  return prompt.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function hasAnyToken(tokens: string[], dictionary: Set<string>): boolean {
  return tokens.some((token) => dictionary.has(token))
}

function isRomanUrduPrompt(prompt: string): boolean {
  return hasAnyToken(tokenizeWords(prompt), ROMAN_URDU_WORDS)
}

function getMutationRefusal(prompt: string, romanUrdu: boolean): string | null {
  const tokens = tokenizeWords(prompt)
  const hasActionVerb = hasAnyToken(tokens, MUTATION_VERBS)
  const hasRecordMutation = /\b(record|mark|cancel)\b/.test(prompt.toLowerCase()) &&
    /\b(payment|invoice|fee|attendance|message|student)\b/.test(prompt.toLowerCase())
  if (!hasActionVerb && !hasRecordMutation) return null

  return romanUrdu
    ? 'CAMVIA Buddy sirf read-only hai aur koi bhi record create, edit, approve, send ya delete nahi kar sakta.'
    : 'CAMVIA Buddy is read-only and cannot create, edit, approve, send, or delete records.'
}

function getRoleDomainRefusal(prompt: string, role: Role, romanUrdu: boolean): string | null {
  const lower = prompt.toLowerCase()
  const asksFees = /\b(fee|fees|invoice|invoices|payment|payments|collected|collection|outstanding|overdue|dues|challan|balance|pkr|rupees?)\b/.test(lower)
  const asksAttendance = /\b(attend(?:ance|ence)|absent|absence|present|late|hajri|hazir)\b/.test(lower)
  const asksNonDraftComms = /\b(awaiting|pending\s+approval|approved|rejected|sent)\b/.test(lower) &&
    /\b(communication|message|messages|notice|notices|approval|approvals)\b/.test(lower)

  if (role === 'teacher' && asksFees) {
    return romanUrdu
      ? 'Aapke Teacher role ki limitation ke mutabiq aapko fee, invoice ya payment data dekhne ki permission nahi hai.'
      : 'According to your Teacher role limitations, you do not have access to fee, invoice, or payment data.'
  }

  if (role === 'teacher' && asksNonDraftComms) {
    return romanUrdu
      ? 'Teacher role mein aap sirf apne communication drafts dekh sakte hain; approved, pending approval, rejected ya sent messages ki access nahi hai.'
      : 'As a Teacher, you can only view your own communication drafts. You do not have access to awaiting-approval, approved, rejected, or sent messages.'
  }

  if (role === 'finance' && asksAttendance) {
    return romanUrdu
      ? 'Aapke Finance role ki limitation ke mutabiq aapko attendance ya absent/present students ka data dekhne ki permission nahi hai.'
      : 'According to your Finance role limitations, you do not have access to attendance records or present/absent student lists.'
  }

  return null
}

function formatMoney(amount: number): string {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100
  return `PKR ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(rounded)}`
}

function formatClassLabel(className: string, section?: string): string {
  return section ? `${className}-${section}` : className
}

function computeRatePercent(present: number, late: number, total: number): number | null {
  return total > 0 ? Math.round(((present + late) / total) * 100) : null
}

type PerStudentAttendanceItem = {
  name: string
  class: string
  todayStatus: string
  thisMonth: { present: number; late: number; absent: number; totalSessions: number; ratePercent: number | null }
  overall: { present: number; late: number; absent: number; totalSessions: number; ratePercent: number | null }
}

type AttendanceSnapshot = {
  todayDate: string
  currentMonth: string
  todaySessionsCount: number
  todayPresentCount: number
  todayLateCount: number
  todayAbsentCount: number
  todayAttendanceRatePercent: number | null
  todayAbsentStudents: string[]
  totalRecordedSessions: number
  perStudentAttendance: PerStudentAttendanceItem[]
}

type FeesSnapshot = {
  activeInvoicesCount: number
  totalBilled: string
  totalCollected: string
  totalOutstanding: string
  studentsWithDueCount: number
  overdueInvoicesCount: number
  overdueAmount: string
  studentsWithOutstandingBalances: Array<{ name: string; class: string; dueAmount: string }>
}

type CommunicationSnapshot =
  | { scopeNote: string; draftCount: number }
  | { scopeNote: string; totalCount: number; draft: number; awaitingApproval: number; approved: number; rejected: number; sent: number }

type StudentAttendanceStats = {
  monthPresent: number
  monthLate: number
  monthAbsent: number
  overallPresent: number
  overallLate: number
  overallAbsent: number
  todayStatus: string | null
}

function emptyStudentAttendanceStats(): StudentAttendanceStats {
  return {
    monthPresent: 0,
    monthLate: 0,
    monthAbsent: 0,
    overallPresent: 0,
    overallLate: 0,
    overallAbsent: 0,
    todayStatus: null,
  }
}

function applyStatusIncrement(cur: StudentAttendanceStats, status: string, isMonth: boolean) {
  if (status === 'PRESENT') {
    cur.overallPresent += 1
    if (isMonth) cur.monthPresent += 1
  } else if (status === 'LATE') {
    cur.overallLate += 1
    if (isMonth) cur.monthLate += 1
  } else if (status === 'ABSENT') {
    cur.overallAbsent += 1
    if (isMonth) cur.monthAbsent += 1
  }
}

function accumulateStudentAttendance(
  attendance: AttendanceState,
  currentMonth: string,
  today: string,
): Map<string, StudentAttendanceStats> {
  const sessionById = new Map(attendance.sessions.map((s) => [s.id, s]))
  const studentAttMap = new Map<string, StudentAttendanceStats>()

  for (const r of attendance.records) {
    if (r.trashedAt) continue
    const session = sessionById.get(r.sessionId)
    const cur = studentAttMap.get(r.studentId) ?? emptyStudentAttendanceStats()
    applyStatusIncrement(cur, r.status, Boolean(session?.date.startsWith(currentMonth)))
    if (session?.date === today) cur.todayStatus = r.status
    studentAttMap.set(r.studentId, cur)
  }

  return studentAttMap
}

function buildAttendanceSnapshot(
  role: Role,
  today: string,
  activeStudents: Student[],
  studentById: Map<string, Student>,
  attendance: AttendanceState,
): AttendanceSnapshot | string {
  if (role === 'finance') {
    return 'ACCESS_DENIED_BY_ROLE (Finance role cannot access attendance)'
  }

  const todaySessions = attendance.sessions.filter((s) => s.date === today)
  const todaySessionIds = new Set(todaySessions.map((s) => s.id))
  const todayRecords = attendance.records.filter((r) => !r.trashedAt && todaySessionIds.has(r.sessionId))
  const present = todayRecords.filter((r) => r.status === 'PRESENT').length
  const late = todayRecords.filter((r) => r.status === 'LATE').length
  const absent = todayRecords.filter((r) => r.status === 'ABSENT').length

  const absentStudents = todayRecords
    .filter((r) => r.status === 'ABSENT')
    .map((r) => studentById.get(r.studentId))
    .filter((st): st is Student => Boolean(st))
    .map((st) => `${st.firstName} ${st.lastName} (${formatClassLabel(st.className, st.section)})`)

  const currentMonth = today.slice(0, 7)
  const studentAttMap = accumulateStudentAttendance(attendance, currentMonth, today)

  const perStudentAttendance: PerStudentAttendanceItem[] = activeStudents.map((s) => {
    const stats = studentAttMap.get(s.id) ?? emptyStudentAttendanceStats()
    const mTotal = stats.monthPresent + stats.monthLate + stats.monthAbsent
    const oTotal = stats.overallPresent + stats.overallLate + stats.overallAbsent
    return {
      name: `${s.firstName} ${s.lastName}`,
      class: formatClassLabel(s.className, s.section),
      todayStatus: stats.todayStatus ?? 'Not recorded',
      thisMonth: {
        present: stats.monthPresent,
        late: stats.monthLate,
        absent: stats.monthAbsent,
        totalSessions: mTotal,
        ratePercent: computeRatePercent(stats.monthPresent, stats.monthLate, mTotal),
      },
      overall: {
        present: stats.overallPresent,
        late: stats.overallLate,
        absent: stats.overallAbsent,
        totalSessions: oTotal,
        ratePercent: computeRatePercent(stats.overallPresent, stats.overallLate, oTotal),
      },
    }
  })

  return {
    todayDate: today,
    currentMonth,
    todaySessionsCount: todaySessions.length,
    todayPresentCount: present,
    todayLateCount: late,
    todayAbsentCount: absent,
    todayAttendanceRatePercent: computeRatePercent(present, late, present + late + absent),
    todayAbsentStudents: absentStudents.slice(0, 40),
    totalRecordedSessions: attendance.sessions.length,
    perStudentAttendance,
  }
}

function buildFeesSnapshot(
  role: Role,
  today: string,
  studentById: Map<string, Student>,
  fees: FeeState,
): FeesSnapshot | string {
  if (role === 'teacher') {
    return 'ACCESS_DENIED_BY_ROLE (Teacher role cannot access fees)'
  }

  const activeInvoices = fees.invoices.filter((inv) => !inv.voidedAt && inv.status !== 'Cancelled' && inv.status !== 'Voided')
  const totalBilled = activeInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0)
  const totalCollected = activeInvoices.reduce((sum, inv) => sum + inv.paidAmount, 0)
  const totalOutstanding = activeInvoices.reduce((sum, inv) => sum + Math.max(0, inv.totalAmount - inv.paidAmount), 0)
  const overdueInvoices = activeInvoices.filter((inv) => (inv.status === 'Overdue' || inv.dueDate < today) && inv.totalAmount - inv.paidAmount > 0)
  const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + Math.max(0, inv.totalAmount - inv.paidAmount), 0)
  const dueStudentIds = new Set(activeInvoices.filter((inv) => inv.totalAmount - inv.paidAmount > 0).map((inv) => inv.studentId))

  const studentDueMap = new Map<string, number>()
  for (const inv of activeInvoices) {
    const rem = Math.max(0, inv.totalAmount - inv.paidAmount)
    if (rem > 0) studentDueMap.set(inv.studentId, (studentDueMap.get(inv.studentId) ?? 0) + rem)
  }

  const topDueStudents = [...studentDueMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([sid, due]) => {
      const st = studentById.get(sid)
      return st ? { name: `${st.firstName} ${st.lastName}`, class: formatClassLabel(st.className, st.section), dueAmount: formatMoney(due) } : null
    })
    .filter((v): v is { name: string; class: string; dueAmount: string } => Boolean(v))

  return {
    activeInvoicesCount: activeInvoices.length,
    totalBilled: formatMoney(totalBilled),
    totalCollected: formatMoney(totalCollected),
    totalOutstanding: formatMoney(totalOutstanding),
    studentsWithDueCount: dueStudentIds.size,
    overdueInvoicesCount: overdueInvoices.length,
    overdueAmount: formatMoney(overdueAmount),
    studentsWithOutstandingBalances: topDueStudents,
  }
}

function buildCommunicationSnapshot(role: Role, communication: CommunicationState): CommunicationSnapshot {
  if (role === 'teacher') {
    const drafts = communication.messages.filter((m) => m.status === 'DRAFT')
    return { scopeNote: 'Teacher can only view own DRAFT messages', draftCount: drafts.length }
  }

  const scopedMessages = role === 'finance'
    ? communication.messages.filter((m) => m.sourceType === 'FEE' || m.type === 'Fee Reminder')
    : communication.messages

  const scopeNote = role === 'finance' ? 'Finance can only view Fee Reminder messages' : 'All school messages'
  return {
    scopeNote,
    totalCount: scopedMessages.length,
    draft: scopedMessages.filter((m) => m.status === 'DRAFT').length,
    awaitingApproval: scopedMessages.filter((m) => m.status === 'AWAITING_APPROVAL').length,
    approved: scopedMessages.filter((m) => m.status === 'APPROVED').length,
    rejected: scopedMessages.filter((m) => m.status === 'REJECTED').length,
    sent: scopedMessages.filter((m) => m.status === 'SENT').length,
  }
}

function buildAlertsSnapshot(role: Role, alerts: AlertItem[]) {
  const activeAlerts = alerts.filter((a) => a.status !== 'RESOLVED')
  let scopedAlerts = activeAlerts
  if (role === 'teacher') scopedAlerts = activeAlerts.filter((a) => a.sourceType === 'ATTENDANCE')
  else if (role === 'finance') scopedAlerts = activeAlerts.filter((a) => a.sourceType === 'FEE')

  return {
    activeCount: scopedAlerts.length,
    highPriorityCount: scopedAlerts.filter((a) => a.priority === 'HIGH').length,
    mediumPriorityCount: scopedAlerts.filter((a) => a.priority === 'MEDIUM').length,
    items: scopedAlerts.slice(0, 20).map((a) => ({
      title: a.title,
      detail: a.detail,
      priority: a.priority,
      sourceType: a.sourceType,
    })),
  }
}

function buildAuthorizedContextSnapshot(input: AskCamviaAuthorizedInput) {
  const { user, students, attendance, fees, communication, alerts } = input
  const role = user.role
  const today = schoolDateKey(user.schoolTimezone)

  const activeStudents = students.filter((s) => s.status === 'Active')
  const classCounts = new Map<string, number>()
  for (const s of activeStudents) {
    const key = formatClassLabel(s.className, s.section)
    classCounts.set(key, (classCounts.get(key) ?? 0) + 1)
  }

  const studentById = new Map(activeStudents.map((s) => [s.id, s]))

  return {
    user: {
      name: user.name,
      role: role.toUpperCase(),
      schoolName: user.schoolName,
      campus: user.campusName,
      assignedClasses: role === 'teacher'
        ? user.teacherAssignments.filter((a) => a.active).map((a) => formatClassLabel(a.class_name, a.section))
        : 'All school classes',
    },
    rolePermissions: ROLE_CAPABILITIES[role],
    students: {
      activeCount: activeStudents.length,
      classCounts: Object.fromEntries(classCounts),
      directory: activeStudents.slice(0, 120).map((s) => ({
        name: `${s.firstName} ${s.lastName}`,
        class: formatClassLabel(s.className, s.section),
        studentId: s.studentId,
        guardian: s.guardian?.name || 'N/A',
      })),
    },
    attendance: buildAttendanceSnapshot(role, today, activeStudents, studentById, attendance),
    fees: buildFeesSnapshot(role, today, studentById, fees),
    communication: buildCommunicationSnapshot(role, communication),
    alerts: buildAlertsSnapshot(role, alerts),
  }
}

async function queryGeminiWithContext(
  prompt: string,
  input: AskCamviaAuthorizedInput,
): Promise<string | null> {
  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim()
  if (!apiKey) return null

  const authorizedContext = buildAuthorizedContextSnapshot(input)
  const recentHistory = (input.history ?? [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'CAMVIA Buddy'}: ${m.text}`)
    .join('\n')

  const systemInstruction = [
    'You are CAMVIA Buddy, a concise, accurate, read-only school assistant.',
    `Active User: ${authorizedContext.user.name} | Role: ${authorizedContext.user.role} | School: ${authorizedContext.user.schoolName}.`,
    'CRITICAL RULES:',
    '1. Answer ONLY the exact question asked by the user. Be direct, clear, and concise.',
    '2. Reply in the same language/script the user used (English or Roman Urdu).',
    '3. Use ONLY facts present in AUTHORIZED_SCHOOL_DATA. Never guess, fabricate, or extrapolate numbers or student names.',
    '4. Enforce strict role limitations:',
    `   - Allowed for ${authorizedContext.user.role}: ${authorizedContext.rolePermissions.allowed.join('; ')}.`,
    `   - Restricted for ${authorizedContext.user.role}: ${authorizedContext.rolePermissions.restricted.join('; ')}.`,
    '   - If the user asks for anything marked ACCESS_DENIED_BY_ROLE or outside their role, clearly refuse and state the exact role limitation.',
    '5. If the user asks about their role or permissions, list their exact allowed scope and limitations.',
    '6. If specific data is missing from AUTHORIZED_SCHOOL_DATA, state clearly that it is not available in your current authorized scope.',
  ].join('\n')

  const userPayload = [
    recentHistory ? `Recent Conversation:\n${recentHistory}\n` : '',
    `AUTHORIZED_SCHOOL_DATA:\n${JSON.stringify(authorizedContext)}`,
    `\nUser Question: ${prompt}`,
  ].join('\n')

  const response = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: userPayload }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 512 },
    }),
  })

  if (!response.ok) {
    throw new Error(`Gemini request failed with status ${response.status}`)
  }

  const json = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
  return text || null
}

function formatStudentAttendanceStats(
  name: string,
  classLabel: string,
  stats: { present: number; late: number; absent: number; totalSessions: number; ratePercent: number | null },
  periodLabelEn: string,
  periodLabelUr: string,
  romanUrdu: boolean,
): string {
  if (stats.totalSessions === 0) {
    return romanUrdu
      ? `${periodLabelUr} ${name} (${classLabel}) ki koi attendance record nahi hui.`
      : `No attendance has been recorded for ${name} (${classLabel}) ${periodLabelEn}.`
  }
  return romanUrdu
    ? `${periodLabelUr} ${name} (${classLabel}) ki attendance ${stats.ratePercent}% hai — Present: ${stats.present}, Late: ${stats.late}, Absent: ${stats.absent} (Total ${stats.totalSessions} din).`
    : `${name} (${classLabel}) attendance ${periodLabelEn}: ${stats.ratePercent}% — Present: ${stats.present}, Late: ${stats.late}, Absent: ${stats.absent} (${stats.totalSessions} recorded days).`
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return dt.toISOString().slice(0, 10)
}

function normalizeClassToken(value: string): string {
  return value.trim().replace(/^(?:class|grade)\s+/i, '').toLowerCase()
}

type ClassScopeFilter = {
  className: string
  section: string | null
}

function extractClassScopeFilter(prompt: string): ClassScopeFilter | null {
  const withKeyword = prompt.match(/\b(?:class|grade)\s+([a-z0-9]+)(?:\s*[-/\s]+(?:section\s+)?([a-z]))?\b/i)
  if (withKeyword) {
    const reserved = new Set(['a', 'in', 'is', 'ki', 'ka', 'ke', 'me', 'mein', 'ko', 'se', 'par'])
    const rawSection = withKeyword[2]
    const section = rawSection && !reserved.has(rawSection.toLowerCase()) ? rawSection.toUpperCase() : null
    return { className: withKeyword[1], section }
  }
  const hyphenated = prompt.match(/\b(\d{1,2})\s*[-/]\s*([a-z])\b/i)
  if (hyphenated) {
    return { className: hyphenated[1], section: hyphenated[2].toUpperCase() }
  }
  return null
}

function matchesClassScopeFilter(student: Pick<Student, 'className' | 'section'>, scope: ClassScopeFilter): boolean {
  if (normalizeClassToken(student.className) !== normalizeClassToken(scope.className)) return false
  if (scope.section && student.section.trim().toUpperCase() !== scope.section.toUpperCase()) return false
  return true
}

type AttendancePeriod = {
  start: string
  end: string
  isToday: boolean
  labelEn: string
  labelUr: string
}

function getIsoDayOfWeek(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function resolveAttendancePeriod(lower: string, today: string): AttendancePeriod {
  if (/\b(yesterday|kal)\b/.test(lower)) {
    const yesterday = shiftIsoDate(today, -1)
    return { start: yesterday, end: yesterday, isToday: false, labelEn: `yesterday (${yesterday})`, labelUr: `kal (${yesterday})` }
  }

  const dayOfWeek = getIsoDayOfWeek(today)
  const daysSinceSunday = dayOfWeek === 0 ? 7 : dayOfWeek

  if (/\b(last\s+weekend|weekend)\b/.test(lower)) {
    const sunday = shiftIsoDate(today, -daysSinceSunday)
    const saturday = shiftIsoDate(sunday, -1)
    return { start: saturday, end: sunday, isToday: false, labelEn: `last weekend (${saturday} to ${sunday})`, labelUr: `pichle weekend (${saturday} se ${sunday})` }
  }

  if (/\b(last\s+week|pichle\s+hafte|pichla\s+hafta)\b/.test(lower)) {
    const lastSunday = shiftIsoDate(today, -daysSinceSunday)
    const lastMonday = shiftIsoDate(lastSunday, -6)
    return { start: lastMonday, end: lastSunday, isToday: false, labelEn: `last week (${lastMonday} to ${lastSunday})`, labelUr: `pichle hafte (${lastMonday} se ${lastSunday})` }
  }

  if (/\b(this\s+week|is\s+hafte|hafta|hafte)\b/.test(lower)) {
    const daysSinceMonday = (dayOfWeek + 6) % 7
    const monday = shiftIsoDate(today, -daysSinceMonday)
    return { start: monday, end: today, isToday: false, labelEn: `this week (${monday} to ${today})`, labelUr: `is hafte (${monday} se ${today})` }
  }

  if (/\b(last\s+month|pichle\s+mahin[ae]|pichla\s+mahina)\b/.test(lower)) {
    const [y, m] = today.split('-').map(Number)
    const prevFirst = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10)
    const prevLast = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)
    const ym = prevFirst.slice(0, 7)
    return { start: prevFirst, end: prevLast, isToday: false, labelEn: `last month (${ym})`, labelUr: `pichle mahine (${ym})` }
  }

  if (/\b(this\s+month|month|mahin|mahine|mahina)\b/.test(lower)) {
    const ym = today.slice(0, 7)
    return { start: `${ym}-01`, end: today, isToday: false, labelEn: `this month (${ym})`, labelUr: `is mahine (${ym})` }
  }

  const isoMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (isoMatch) {
    const d = isoMatch[1]
    return { start: d, end: d, isToday: d === today, labelEn: d, labelUr: d }
  }

  return { start: today, end: today, isToday: true, labelEn: `today (${today})`, labelUr: `aaj (${today})` }
}

function getStudentFeeDue(studentId: string, fees: FeeState): number {
  return fees.invoices
    .filter((inv) => inv.studentId === studentId && !inv.voidedAt && inv.status !== 'Cancelled' && inv.status !== 'Voided')
    .reduce((sum, inv) => sum + Math.max(0, inv.totalAmount - inv.paidAmount), 0)
}

function getStudentDateStatus(studentId: string, targetDate: string, attendance: AttendanceState): string {
  const sessionIds = new Set(attendance.sessions.filter((s) => s.date === targetDate).map((s) => s.id))
  const rec = attendance.records.find((r) => !r.trashedAt && r.studentId === studentId && sessionIds.has(r.sessionId))
  return rec ? rec.status : 'Not recorded'
}

function answerStudentAttendanceQuery(
  lower: string,
  student: Student,
  attendanceStats: AttendanceSnapshot,
  rawAttendance: AttendanceState,
  romanUrdu: boolean,
): string {
  const name = `${student.firstName} ${student.lastName}`
  const classLabel = formatClassLabel(student.className, student.section)

  if (/\b(yesterday|kal)\b/.test(lower)) {
    const yesterday = shiftIsoDate(attendanceStats.todayDate, -1)
    const status = getStudentDateStatus(student.id, yesterday, rawAttendance)
    return romanUrdu
      ? `${name} (${classLabel}) ki kal (${yesterday}) ki attendance: ${status}.`
      : `${name} (${classLabel}) attendance on ${yesterday}: ${status}.`
  }

  const stAtt = attendanceStats.perStudentAttendance.find(
    (item) => item.name.toLowerCase() === name.toLowerCase() && item.class.toLowerCase() === classLabel.toLowerCase(),
  )
  if (!stAtt) {
    return romanUrdu ? `${name} aapke authorized scope mein nahi mila.` : `${name} was not found in your authorized scope.`
  }

  if (/\b(today|aaj)\b/.test(lower)) {
    return romanUrdu
      ? `${name} (${stAtt.class}) ki aaj ki attendance: ${stAtt.todayStatus}.`
      : `${name} (${stAtt.class}) attendance today: ${stAtt.todayStatus}.`
  }

  if (/\b(month|mahin|mahine|mahina)\b/.test(lower)) {
    return formatStudentAttendanceStats(name, stAtt.class, stAtt.thisMonth, `this month (${attendanceStats.currentMonth})`, `Is mahine (${attendanceStats.currentMonth})`, romanUrdu)
  }

  return formatStudentAttendanceStats(name, stAtt.class, stAtt.overall, 'overall', 'Overall', romanUrdu)
}

function formatStudentProfileSummary(
  student: Student,
  ctx: ReturnType<typeof buildAuthorizedContextSnapshot>,
  input: AskCamviaAuthorizedInput,
  romanUrdu: boolean,
): string {
  const name = `${student.firstName} ${student.lastName}`
  const classLabel = formatClassLabel(student.className, student.section)
  const parts = [
    romanUrdu
      ? `${name} (${student.studentId}) — Class ${classLabel}, Roll ${student.rollNumber || 'N/A'}, Status: ${student.status}, Guardian: ${student.guardian?.name || 'N/A'}`
      : `${name} (${student.studentId}) — Class ${classLabel}, Roll ${student.rollNumber || 'N/A'}, Status: ${student.status}, Guardian: ${student.guardian?.name || 'N/A'}`,
  ]
  if (typeof ctx.attendance !== 'string') {
    const stAtt = ctx.attendance.perStudentAttendance.find(
      (item) => item.name.toLowerCase() === name.toLowerCase() && item.class.toLowerCase() === classLabel.toLowerCase(),
    )
    if (stAtt) {
      parts.push(
        romanUrdu
          ? `Aaj: ${stAtt.todayStatus}, Overall attendance: ${stAtt.overall.ratePercent ?? 'N/A'}%`
          : `Today: ${stAtt.todayStatus}, Overall attendance: ${stAtt.overall.ratePercent ?? 'N/A'}%`,
      )
    }
  }
  if (input.user.role !== 'teacher') {
    const due = getStudentFeeDue(student.id, input.fees)
    parts.push(romanUrdu ? `Pending fees: ${formatMoney(due)}` : `Outstanding fees: ${formatMoney(due)}`)
  }
  return `${parts.join(' | ')}.`
}

function answerStudentQuery(
  lower: string,
  student: Student,
  ctx: ReturnType<typeof buildAuthorizedContextSnapshot>,
  input: AskCamviaAuthorizedInput,
  romanUrdu: boolean,
): string | null {
  const name = `${student.firstName} ${student.lastName}`
  const classLabel = formatClassLabel(student.className, student.section)

  if (/\b(fee|fees|due|dues|balance|invoice|baqi|baki|jama)\b/.test(lower) && input.user.role !== 'teacher') {
    const due = getStudentFeeDue(student.id, input.fees)
    return romanUrdu
      ? `${name} (${classLabel}) ki pending fees ${formatMoney(due)} hain.`
      : `${name} (${classLabel}) has ${formatMoney(due)} in outstanding fees.`
  }

  if (/\b(attend(?:ance|ence)|absent|present|late|hajri|hazir|gair|month|mahin|mahine|mahina|today|aaj|yesterday|kal)\b/.test(lower) && typeof ctx.attendance !== 'string') {
    return answerStudentAttendanceQuery(lower, student, ctx.attendance, input.attendance, romanUrdu)
  }

  if (/\b(guardian|parent|sarparast|walid|father|mother|phone|email|contact|number)\b/.test(lower)) {
    const phone = student.guardian?.phone ? `, Phone: ${student.guardian.phone}` : ''
    const email = student.guardian?.email ? `, Email: ${student.guardian.email}` : ''
    return romanUrdu
      ? `${name} (${classLabel}) ke guardian ${student.guardian?.name || 'N/A'} hain${phone}${email}.`
      : `${name}'s (${classLabel}) guardian is ${student.guardian?.name || 'N/A'}${phone}${email}.`
  }

  if (/\b(who|kaun|kon|detail|details|profile|info|roll|class|section|id|status|batao|btao|about)\b/.test(lower) || lower.split(/\s+/).length <= 3) {
    return formatStudentProfileSummary(student, ctx, input, romanUrdu)
  }

  return null
}

function findMatchedStudents(students: Student[], lower: string): Student[] {
  const active = students.filter((s) => s.status === 'Active')
  const idMatch = active.filter((s) => s.studentId && lower.includes(s.studentId.toLowerCase()))
  if (idMatch.length > 0) return idMatch

  const fullMatches = active.filter((s) => {
    const full = `${s.firstName} ${s.lastName}`.trim().toLowerCase()
    return full.length >= 3 && lower.includes(full)
  })
  if (fullMatches.length > 0) return fullMatches

  const tokens = new Set(tokenizeWords(lower).filter((t) => t.length >= 3))
  return active.filter((s) =>
    tokens.has(s.firstName.trim().toLowerCase()) || tokens.has(s.lastName.trim().toLowerCase()),
  )
}

function answerClassScopedQuery(
  lower: string,
  scope: ClassScopeFilter,
  ctx: ReturnType<typeof buildAuthorizedContextSnapshot>,
  input: AskCamviaAuthorizedInput,
  romanUrdu: boolean,
): string | null {
  const activeInClass = input.students.filter((s) => s.status === 'Active' && matchesClassScopeFilter(s, scope))
  const label = scope.section ? `Class ${scope.className}-${scope.section}` : `Class ${scope.className}`

  if (activeInClass.length === 0) {
    return romanUrdu
      ? `${label} mein aapke authorized scope mein koi active student nahi mila.`
      : `No active students were found for ${label} in your authorized scope.`
  }

  if (/\b(fee|fees|collected|outstanding|overdue|due|dues|invoice|baqi|baki)\b/.test(lower) && input.user.role !== 'teacher') {
    const studentIds = new Set(activeInClass.map((s) => s.id))
    const invoices = input.fees.invoices.filter((inv) => studentIds.has(inv.studentId) && !inv.voidedAt && inv.status !== 'Cancelled' && inv.status !== 'Voided')
    const billed = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0)
    const collected = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0)
    const outstanding = invoices.reduce((sum, inv) => sum + Math.max(0, inv.totalAmount - inv.paidAmount), 0)
    return romanUrdu
      ? `${label} (${activeInClass.length} students) — Billed: ${formatMoney(billed)}, Collected: ${formatMoney(collected)}, Pending: ${formatMoney(outstanding)}.`
      : `${label} (${activeInClass.length} students) — Billed: ${formatMoney(billed)}, Collected: ${formatMoney(collected)}, Outstanding: ${formatMoney(outstanding)}.`
  }

  if (/\b(attend(?:ance|ence)|absent|present|late|hajri|hazir|gair|rate|who|kaun|kon)\b/.test(lower) && typeof ctx.attendance !== 'string') {
    const period = resolveAttendancePeriod(lower, ctx.attendance.todayDate)
    const sessionIds = new Set(
      input.attendance.sessions
        .filter((s) => s.date >= period.start && s.date <= period.end)
        .map((s) => s.id),
    )
    const studentIds = new Set(activeInClass.map((s) => s.id))
    const records = input.attendance.records.filter((r) => !r.trashedAt && sessionIds.has(r.sessionId) && studentIds.has(r.studentId))
    if (records.length === 0) {
      return romanUrdu
        ? `${label} ki ${period.labelUr} ki attendance record nahi hui hai.`
        : `No attendance was recorded for ${label} during ${period.labelEn}.`
    }
    const present = records.filter((r) => r.status === 'PRESENT').length
    const late = records.filter((r) => r.status === 'LATE').length
    const absentRecs = records.filter((r) => r.status === 'ABSENT')
    const rate = computeRatePercent(present, late, records.length)
    const studentById = new Map(activeInClass.map((s) => [s.id, s]))
    const absentNames = absentRecs
      .map((r) => studentById.get(r.studentId))
      .filter((s): s is Student => Boolean(s))
      .map((s) => `${s.firstName} ${s.lastName}`)
    const absentSuffix = absentNames.length > 0 ? ` Absent: ${absentNames.slice(0, 20).join(', ')}.` : ''
    return romanUrdu
      ? `${label} (${period.labelUr}) ki attendance ${rate}% hai (Present: ${present}, Late: ${late}, Absent: ${absentRecs.length}).${absentSuffix}`
      : `${label} (${period.labelEn}) attendance is ${rate}% (Present: ${present}, Late: ${late}, Absent: ${absentRecs.length}).${absentSuffix}`
  }

  if (/\b(student|students|kitne|kitni|how many|count|list|names|enrolled|total)\b/.test(lower)) {
    const wantsNames = /\b(list|names|who|kaun|kon|dikhao|batao)\b/.test(lower) && !/\b(how many|kitne|kitni|count|total)\b/.test(lower)
    if (wantsNames) {
      const preview = activeInClass.slice(0, 20).map((s) => `${s.firstName} ${s.lastName} (${s.studentId})`).join(', ')
      const more = activeInClass.length > 20 ? ` (+${activeInClass.length - 20} more)` : ''
      return `${label} (${activeInClass.length} students): ${preview}${more}.`
    }
    return romanUrdu
      ? `${label} mein ${activeInClass.length} active students hain.`
      : `There are ${activeInClass.length} active students in ${label}.`
  }

  return null
}

function answerClassRankingsQuery(
  lower: string,
  ctx: ReturnType<typeof buildAuthorizedContextSnapshot>,
  input: AskCamviaAuthorizedInput,
  romanUrdu: boolean,
): string | null {
  if (typeof ctx.attendance === 'string') return null
  const wantsLowest = /\b(lowest|worst|kam|sabse kam|below 75|low)\b/.test(lower)
  const wantsHighest = /\b(highest|best|top|zyada|sabse zyada)\b/.test(lower)
  const wantsUnmarked = /\b(unmarked|not marked|pending|missing|nahi hui)\b/.test(lower)
  if (!wantsLowest && !wantsHighest && !wantsUnmarked) return null

  const today = ctx.attendance.todayDate
  const activeStudents = input.students.filter((s) => s.status === 'Active')
  const classGroups = new Map<string, { label: string; studentIds: Set<string> }>()
  for (const s of activeStudents) {
    const key = `${s.campusId}|${s.className}|${s.section}`
    const group = classGroups.get(key) ?? { label: formatClassLabel(s.className, s.section), studentIds: new Set<string>() }
    group.studentIds.add(s.id)
    classGroups.set(key, group)
  }

  const todaySessionIds = new Set(input.attendance.sessions.filter((s) => s.date === today).map((s) => s.id))
  const todayRecords = input.attendance.records.filter((r) => !r.trashedAt && todaySessionIds.has(r.sessionId))

  const stats = [...classGroups.values()].map((g) => {
    const recs = todayRecords.filter((r) => g.studentIds.has(r.studentId))
    const present = recs.filter((r) => r.status === 'PRESENT').length
    const late = recs.filter((r) => r.status === 'LATE').length
    const rate = computeRatePercent(present, late, recs.length)
    return { label: g.label, rate, recorded: recs.length }
  })

  if (wantsUnmarked) {
    const unmarked = stats.filter((s) => s.recorded === 0).map((s) => s.label)
    if (unmarked.length === 0) {
      return romanUrdu
        ? `Aaj (${today}) sab ${stats.length} classes ki attendance record ho chuki hai.`
        : `All ${stats.length} classes have recorded attendance today (${today}).`
    }
    return romanUrdu
      ? `Aaj (${today}) in ${unmarked.length} classes ki attendance pending hai: ${unmarked.join(', ')}.`
      : `${unmarked.length} class(es) have not recorded attendance today (${today}): ${unmarked.join(', ')}.`
  }

  const recorded = stats.filter((s): s is { label: string; rate: number; recorded: number } => s.rate !== null)
  if (recorded.length === 0) {
    return romanUrdu ? `Aaj (${today}) abhi kisi class ki attendance record nahi hui.` : `No class attendance has been recorded today (${today}).`
  }

  const sorted = [...recorded].sort((a, b) => (wantsLowest ? a.rate - b.rate : b.rate - a.rate))
  const top = sorted.slice(0, 5).map((s) => `${s.label} (${s.rate}%)`).join(', ')
  if (wantsLowest) {
    return romanUrdu
      ? `Aaj sabse kam attendance wali classes: ${top}.`
      : `Classes with the lowest attendance today: ${top}.`
  }
  return romanUrdu
    ? `Aaj sabse zyada attendance wali classes: ${top}.`
    : `Classes with the highest attendance today: ${top}.`
}

function getScopeHint(role: Role, romanUrdu: boolean): string {
  if (role === 'finance') return 'fees'
  if (role === 'teacher') return romanUrdu ? 'assigned classes ki attendance' : 'attendance for your assigned classes'
  return 'attendance, fees'
}

function answerRoleCapabilityQuery(ctx: ReturnType<typeof buildAuthorizedContextSnapshot>, romanUrdu: boolean): string {
  const allowed = ctx.rolePermissions.allowed.join('; ')
  const restricted = ctx.rolePermissions.restricted.join('; ')
  return romanUrdu
    ? `Aapka role ${ctx.user.role} hai. Aap yeh dekh sakte hain: ${allowed}. Limitations: ${restricted}.`
    : `Your role is ${ctx.user.role}. Allowed: ${allowed}. Limitations: ${restricted}.`
}

function answerAlertsSummary(ctx: ReturnType<typeof buildAuthorizedContextSnapshot>, romanUrdu: boolean): string {
  if (ctx.alerts.activeCount === 0) return romanUrdu ? 'Is waqt koi active alert nahi hai.' : 'There are no active alerts right now.'
  const preview = ctx.alerts.items.slice(0, 5).map((a) => `${a.title}: ${a.detail}`).join(' | ')
  return romanUrdu ? `${ctx.alerts.activeCount} active alerts hain: ${preview}` : `There are ${ctx.alerts.activeCount} active alerts: ${preview}`
}

function answerAttendanceSummary(
  lower: string,
  attendance: AttendanceSnapshot,
  rawAttendance: AttendanceState,
  students: Student[],
  romanUrdu: boolean,
): string {
  const period = resolveAttendancePeriod(lower, attendance.todayDate)
  const activeStudents = students.filter((s) => s.status === 'Active')
  const studentById = new Map(activeStudents.map((s) => [s.id, s]))

  const sessionIds = new Set(
    rawAttendance.sessions
      .filter((s) => s.date >= period.start && s.date <= period.end)
      .map((s) => s.id),
  )
  const recs = rawAttendance.records.filter((r) => !r.trashedAt && sessionIds.has(r.sessionId))

  if (recs.length === 0) {
    return romanUrdu
      ? `${period.labelUr} ke liye koi attendance record nahi mili.`
      : `No attendance was recorded for ${period.labelEn}.`
  }

  const presentRecs = recs.filter((r) => r.status === 'PRESENT')
  const lateRecs = recs.filter((r) => r.status === 'LATE')
  const absentRecs = recs.filter((r) => r.status === 'ABSENT')
  const rate = computeRatePercent(presentRecs.length, lateRecs.length, recs.length)

  const asksLateOnly = /\b(late)\b/.test(lower) && !/\b(present|absent)\b/.test(lower)
  if (asksLateOnly) {
    const lateNames = lateRecs
      .map((r) => studentById.get(r.studentId))
      .filter((s): s is Student => Boolean(s))
      .map((s) => `${s.firstName} ${s.lastName} (${formatClassLabel(s.className, s.section)})`)
    if (lateNames.length === 0) {
      return romanUrdu ? `${period.labelUr} mein koi student late nahi tha.` : `No students were marked late for ${period.labelEn}.`
    }
    return romanUrdu
      ? `${period.labelUr} mein ${lateNames.length} student(s) late thay: ${lateNames.slice(0, 40).join(', ')}.`
      : `${lateNames.length} student(s) were marked late for ${period.labelEn}: ${lateNames.slice(0, 40).join(', ')}.`
  }

  const asksPresentOnly = /\b(present|hazir)\b/.test(lower) && !/\b(absent|late)\b/.test(lower)
  if (asksPresentOnly) {
    const presentNames = presentRecs
      .map((r) => studentById.get(r.studentId))
      .filter((s): s is Student => Boolean(s))
      .map((s) => `${s.firstName} ${s.lastName} (${formatClassLabel(s.className, s.section)})`)
    const sample = presentNames.slice(0, 15).join(', ')
    const more = presentNames.length > 15 ? ` (+${presentNames.length - 15} more)` : ''
    return romanUrdu
      ? `${period.labelUr} mein ${presentRecs.length} students present thay (${rate}% attendance; Late: ${lateRecs.length}, Absent: ${absentRecs.length}). Shuru ke students: ${sample}${more}.`
      : `For ${period.labelEn}, ${presentRecs.length} students were present (${rate}% attendance; Late: ${lateRecs.length}, Absent: ${absentRecs.length}). Sample: ${sample}${more}.`
  }

  const absentNames = absentRecs
    .map((r) => studentById.get(r.studentId))
    .filter((s): s is Student => Boolean(s))
    .map((s) => `${s.firstName} ${s.lastName} (${formatClassLabel(s.className, s.section)})`)
  const absSuffix = absentNames.length > 0 ? ` Absent: ${absentNames.slice(0, 40).join(', ')}.` : ''

  return romanUrdu
    ? `${period.labelUr} ki attendance ${rate}% hai (Present: ${presentRecs.length}, Late: ${lateRecs.length}, Absent: ${absentRecs.length}).${absSuffix}`
    : `Attendance for ${period.labelEn}: ${rate}% (Present: ${presentRecs.length}, Late: ${lateRecs.length}, Absent: ${absentRecs.length}).${absSuffix}`
}

function answerFeesSummary(
  lower: string,
  fees: FeesSnapshot,
  romanUrdu: boolean,
): string {
  if (/\b(who|which|list|names|kon|kaun|kis|top|defaulter|defaulters)\b/.test(lower)) {
    if (fees.studentsWithOutstandingBalances.length === 0) {
      return romanUrdu ? 'Kisi student ki pending fee nahi hai.' : 'No students currently have outstanding fees.'
    }
    const list = fees.studentsWithOutstandingBalances
      .slice(0, 10)
      .map((s) => `${s.name} (${s.class}): ${s.dueAmount}`)
      .join(', ')
    return romanUrdu
      ? `Top pending fee students (${fees.studentsWithDueCount} total): ${list}.`
      : `Top students with outstanding fees (${fees.studentsWithDueCount} total): ${list}.`
  }
  return romanUrdu
    ? `Fee summary — Billed: ${fees.totalBilled}, Collected: ${fees.totalCollected}, Total due: ${fees.totalOutstanding} (${fees.studentsWithDueCount} students), Overdue: ${fees.overdueAmount} (${fees.overdueInvoicesCount} invoices).`
    : `Fee summary — Billed: ${fees.totalBilled}, Collected: ${fees.totalCollected}, Outstanding: ${fees.totalOutstanding} (${fees.studentsWithDueCount} students), Overdue: ${fees.overdueAmount} (${fees.overdueInvoicesCount} invoices).`
}

function answerCommunicationSummary(comm: CommunicationSnapshot, romanUrdu: boolean): string {
  if ('draftCount' in comm) {
    return romanUrdu ? `Aapke ${comm.draftCount} communication drafts hain.` : `You have ${comm.draftCount} communication drafts.`
  }
  return romanUrdu
    ? `Communications — Drafts: ${comm.draft}, Approval pending: ${comm.awaitingApproval}, Approved: ${comm.approved}, Sent: ${comm.sent}.`
    : `Communications — Drafts: ${comm.draft}, Awaiting approval: ${comm.awaitingApproval}, Approved: ${comm.approved}, Sent: ${comm.sent}.`
}

function answerLocallyWithRoleScope(prompt: string, input: AskCamviaAuthorizedInput, romanUrdu: boolean): string | null {
  const ctx = buildAuthorizedContextSnapshot(input)
  const lower = prompt.toLowerCase()

  if (/\b(role|permission|permissions|limit|limitation|limitations|access|can i do|kya kar sakta|kya dekh sakta)\b/.test(lower)) {
    return answerRoleCapabilityQuery(ctx, romanUrdu)
  }

  const classScope = extractClassScopeFilter(prompt)
  if (classScope) {
    const classAnswer = answerClassScopedQuery(lower, classScope, ctx, input, romanUrdu)
    if (classAnswer) return classAnswer
  }

  const matchedStudents = findMatchedStudents(input.students, lower)
  if (matchedStudents.length === 1) {
    const studentAnswer = answerStudentQuery(lower, matchedStudents[0], ctx, input, romanUrdu)
    if (studentAnswer) return studentAnswer
  } else if (matchedStudents.length > 1) {
    const preview = matchedStudents
      .slice(0, 6)
      .map((s) => `${s.firstName} ${s.lastName} (${formatClassLabel(s.className, s.section)}, ${s.studentId})`)
      .join(', ')
    return romanUrdu
      ? `Is naam ke ${matchedStudents.length} students mile hain: ${preview}. Exact full name ya Student ID likh kar poochein.`
      : `Found ${matchedStudents.length} matching students: ${preview}. Please specify the full name or Student ID.`
  }

  const rankingAnswer = answerClassRankingsQuery(lower, ctx, input, romanUrdu)
  if (rankingAnswer) return rankingAnswer

  if (/\b(alert|alerts|attention)\b/.test(lower)) return answerAlertsSummary(ctx, romanUrdu)

  if (/\b(fee|fees|collected|collection|outstanding|overdue|due|dues|invoice|invoices|baqi|baki|jama|billed)\b/.test(lower) && typeof ctx.fees !== 'string') {
    return answerFeesSummary(lower, ctx.fees, romanUrdu)
  }

  if (/\b(attend(?:ance|ence)|absent|present|late|hajri|hazir|gair|chutti|chuti)\b/.test(lower) && typeof ctx.attendance !== 'string') {
    return answerAttendanceSummary(lower, ctx.attendance, input.attendance, input.students, romanUrdu)
  }

  if (/\b(class|classes|section|sections)\b/.test(lower) && !/\b(student|students|enrolled)\b/.test(lower)) {
    const classEntries = Object.entries(ctx.students.classCounts)
    return romanUrdu
      ? `Aapke authorized scope mein ${classEntries.length} classes/sections aur ${ctx.students.activeCount} active students hain.`
      : `There are ${classEntries.length} classes/sections and ${ctx.students.activeCount} active students in your authorized scope.`
  }

  if (/\b(student|students|enrolled|class|classes)\b/.test(lower)) {
    return romanUrdu
      ? `Aapke authorized scope mein ${ctx.students.activeCount} active students hain.`
      : `There are ${ctx.students.activeCount} active students in your authorized scope.`
  }

  if (/\b(communication|message|messages|draft|drafts|approval|approvals|sent)\b/.test(lower)) {
    return answerCommunicationSummary(ctx.communication, romanUrdu)
  }

  return null
}

function getRoleFallbackHint(role: Role, romanUrdu: boolean): string {
  const scopeHint = getScopeHint(role, romanUrdu)
  const roleLabel = role.toUpperCase()
  return romanUrdu
    ? `Aap ${roleLabel} role ke mutabiq students, ${scopeHint}, alerts aur communications ke bare mein sawal pooch sakte hain.`
    : `As ${roleLabel}, you can ask about students, ${scopeHint}, alerts, and communications within your role scope.`
}

async function invokeEdgeAssistant(prompt: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke<{ text?: unknown }>('ask-camvia', {
      body: { prompt },
    })
    if (error || typeof data?.text !== 'string' || !data.text.trim()) return null
    return data.text.trim()
  } catch {
    return null
  }
}

function isGenericEdgeRejection(text: string): boolean {
  return text === 'Ask about a CAMVIA school record.' ||
    text === 'I could not answer that CAMVIA question.' ||
    text.includes('provides aggregate summaries only')
}

async function tryAuthorizedAnswer(
  trimmed: string,
  authorizedInput: AskCamviaAuthorizedInput,
  romanUrdu: boolean,
): Promise<string> {
  const mutationRefusal = getMutationRefusal(trimmed, romanUrdu)
  if (mutationRefusal) return mutationRefusal

  const roleRefusal = getRoleDomainRefusal(trimmed, authorizedInput.user.role, romanUrdu)
  if (roleRefusal) return roleRefusal

  const deterministicAnswer = answerLocallyWithRoleScope(trimmed, authorizedInput, romanUrdu)
  if (deterministicAnswer) return deterministicAnswer

  try {
    const aiText = await queryGeminiWithContext(trimmed, authorizedInput)
    if (aiText) return aiText
  } catch {
    // Silent fallback to role hint when Gemini is temporarily unavailable
  }

  return getRoleFallbackHint(authorizedInput.user.role, romanUrdu)
}

export async function askCamvia(
  prompt: string,
  authorizedInput?: AskCamviaAuthorizedInput,
): Promise<AskCamviaResponse> {
  const trimmed = prompt.trim()
  const romanUrdu = isRomanUrduPrompt(trimmed)

  if (authorizedInput) {
    return { text: await tryAuthorizedAnswer(trimmed, authorizedInput, romanUrdu) }
  }

  const edgeText = await invokeEdgeAssistant(trimmed)
  if (edgeText && !isGenericEdgeRejection(edgeText)) {
    return { text: edgeText }
  }

  throw new Error('The secure CAMVIA assistant service is not configured.')
}
