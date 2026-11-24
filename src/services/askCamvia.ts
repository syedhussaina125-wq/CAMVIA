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
  'aaj', 'hai', 'hain', 'ha', 'ho', 'kya', 'kia', 'kis', 'kisi', 'kaun', 'kon',
  'kitne', 'kitni', 'kitna', 'batao', 'btao', 'dikhao', 'dikha', 'hamari', 'hmari',
  'humari', 'meri', 'mere', 'mera', 'apne', 'apni', 'apna', 'ka', 'ki', 'ke', 'ko',
  'mein', 'me', 'se', 'par', 'nahi', 'nhi', 'chahiye', 'pooch', 'pochoo', 'ma',
  'mai', 'hum', 'mahine', 'mahin', 'hajri',
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

  const perStudentAttendance: PerStudentAttendanceItem[] = activeStudents.slice(0, 120).map((s) => {
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

function answerStudentAttendanceQuery(
  lower: string,
  student: Student,
  attendance: AttendanceSnapshot,
  romanUrdu: boolean,
): string {
  const name = `${student.firstName} ${student.lastName}`
  const stAtt = attendance.perStudentAttendance.find((item) => item.name.toLowerCase() === name.toLowerCase())
  if (!stAtt) {
    return romanUrdu ? `${name} aapke authorized scope mein nahi mila.` : `${name} was not found in your authorized scope.`
  }

  if (/\b(today|aaj)\b/.test(lower)) {
    return romanUrdu
      ? `${name} (${stAtt.class}) ki aaj ki attendance: ${stAtt.todayStatus}.`
      : `${name} (${stAtt.class}) attendance today: ${stAtt.todayStatus}.`
  }

  if (/\b(month|mahin|mahine)\b/.test(lower)) {
    return formatStudentAttendanceStats(name, stAtt.class, stAtt.thisMonth, `this month (${attendance.currentMonth})`, `Is mahine (${attendance.currentMonth})`, romanUrdu)
  }

  return formatStudentAttendanceStats(name, stAtt.class, stAtt.overall, 'overall', 'Overall', romanUrdu)
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

  if (/\b(fee|fees|due|balance|invoice)\b/.test(lower) && input.user.role !== 'teacher') {
    const studentInvoices = input.fees.invoices.filter((inv) => inv.studentId === student.id && !inv.voidedAt && inv.status !== 'Cancelled' && inv.status !== 'Voided')
    const due = studentInvoices.reduce((sum, inv) => sum + Math.max(0, inv.totalAmount - inv.paidAmount), 0)
    return romanUrdu
      ? `${name} (${classLabel}) ki pending fees ${formatMoney(due)} hain.`
      : `${name} (${classLabel}) has ${formatMoney(due)} in outstanding fees.`
  }

  if (/\b(attend(?:ance|ence)|absent|present|late|hajri|month|today|aaj)\b/.test(lower) && typeof ctx.attendance !== 'string') {
    return answerStudentAttendanceQuery(lower, student, ctx.attendance, romanUrdu)
  }

  if (/\b(guardian|parent|sarparast)\b/.test(lower)) {
    return romanUrdu
      ? `${name} ke guardian ${student.guardian?.name || 'N/A'} hain.`
      : `${name}'s guardian is ${student.guardian?.name || 'N/A'}.`
  }

  return null
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

function answerAttendanceSummary(attendance: AttendanceSnapshot, romanUrdu: boolean): string {
  if (attendance.todayAttendanceRatePercent === null) {
    return romanUrdu ? 'Aaj attendance record nahi hui hai.' : 'No attendance has been recorded today.'
  }
  const absNames = attendance.todayAbsentStudents.length ? ` Absent: ${attendance.todayAbsentStudents.join(', ')}.` : ''
  return romanUrdu
    ? `Aaj ki attendance ${attendance.todayAttendanceRatePercent}% hai (Present: ${attendance.todayPresentCount}, Late: ${attendance.todayLateCount}, Absent: ${attendance.todayAbsentCount}).${absNames}`
    : `Today's attendance is ${attendance.todayAttendanceRatePercent}% (Present: ${attendance.todayPresentCount}, Late: ${attendance.todayLateCount}, Absent: ${attendance.todayAbsentCount}).${absNames}`
}

function answerCommunicationSummary(comm: CommunicationSnapshot, romanUrdu: boolean): string {
  if ('draftCount' in comm) {
    return romanUrdu ? `Aapke ${comm.draftCount} communication drafts hain.` : `You have ${comm.draftCount} communication drafts.`
  }
  return romanUrdu
    ? `Communications — Drafts: ${comm.draft}, Approval pending: ${comm.awaitingApproval}, Approved: ${comm.approved}, Sent: ${comm.sent}.`
    : `Communications — Drafts: ${comm.draft}, Awaiting approval: ${comm.awaitingApproval}, Approved: ${comm.approved}, Sent: ${comm.sent}.`
}

function findMatchedStudent(students: Student[], lower: string): Student | undefined {
  return students.find((s) => {
    const full = `${s.firstName} ${s.lastName}`.toLowerCase()
    return lower.includes(full) || (s.firstName.length >= 3 && lower.includes(s.firstName.toLowerCase()))
  })
}

function answerLocallyWithRoleScope(prompt: string, input: AskCamviaAuthorizedInput, romanUrdu: boolean): string | null {
  const ctx = buildAuthorizedContextSnapshot(input)
  const lower = prompt.toLowerCase()

  if (/\b(role|permission|permissions|limit|limitation|limitations|access|can i do|kya kar sakta|kya dekh sakta)\b/.test(lower)) {
    return answerRoleCapabilityQuery(ctx, romanUrdu)
  }

  const matchedStudent = findMatchedStudent(input.students, lower)
  const studentAnswer = matchedStudent ? answerStudentQuery(lower, matchedStudent, ctx, input, romanUrdu) : null
  if (studentAnswer) return studentAnswer

  if (/\b(alert|alerts|attention)\b/.test(lower)) return answerAlertsSummary(ctx, romanUrdu)

  if (/\b(fee|fees|collected|outstanding|overdue|due|invoice)\b/.test(lower) && typeof ctx.fees !== 'string') {
    return romanUrdu
      ? `Total collected: ${ctx.fees.totalCollected}, Total due: ${ctx.fees.totalOutstanding} (${ctx.fees.studentsWithDueCount} students), Overdue: ${ctx.fees.overdueAmount} (${ctx.fees.overdueInvoicesCount} invoices).`
      : `Fee summary — Collected: ${ctx.fees.totalCollected}, Outstanding: ${ctx.fees.totalOutstanding} (${ctx.fees.studentsWithDueCount} students), Overdue: ${ctx.fees.overdueAmount} (${ctx.fees.overdueInvoicesCount} invoices).`
  }

  if (/\b(attend(?:ance|ence)|absent|present|late|hajri)\b/.test(lower) && typeof ctx.attendance !== 'string') {
    return answerAttendanceSummary(ctx.attendance, romanUrdu)
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
