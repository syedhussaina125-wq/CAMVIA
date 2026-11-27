import type { Role } from './mockData'
import type { Student } from './studentData'
import { normalizeSchoolTimezone, schoolDateKey } from './utils/schoolTimezone'
import { compareClassNames, compareNaturalText } from './utils/sortOrder'

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE'
export type AttendanceSessionStatus = 'IN_PROGRESS' | 'COMPLETED'

export type AttendanceChange = {
  changedByUserId: number
  changedAt: string
  previousStatus: AttendanceStatus
  newStatus: AttendanceStatus
}

export type AttendanceSession = {
  id: string
  date: string
  classId: string
  className: string
  section: string
  schoolId: string
  campusId: string
  status: AttendanceSessionStatus
  markedByUserId: string
  completedAt: string | null
  studentCount: number
  hasTrashedRecords?: boolean
}

export type AttendanceRecord = {
  id: string
  sessionId: string
  studentId: string
  status: AttendanceStatus
  note: string
  markedByUserId: string
  createdAt: string
  updatedAt: string
  history: AttendanceChange[]
  trashedAt?: string | null
}

export type AttendanceState = {
  sessions: AttendanceSession[]
  records: AttendanceRecord[]
}

export function mergeAttendanceState(current: AttendanceState, update: AttendanceState): AttendanceState {
  const updatedSessionIds = new Set(update.sessions.map((session) => session.id))
  const sessions = [...current.sessions.filter((session) => !updatedSessionIds.has(session.id)), ...update.sessions]
    .sort((left, right) => right.date.localeCompare(left.date))

  return {
    sessions,
    records: [
      ...current.records.filter((record) => !updatedSessionIds.has(record.sessionId)),
      ...update.records,
    ],
  }
}

export type AttendanceUser = {
  id: number
  role: Role
  email: string
  schoolName: string
  campusName: string
  organizationId?: string | null
  schoolId?: string | null
  schoolTimezone?: string | null
  teacherAssignments?: Array<{
    school_id: string
    campus_id: string
    class_name: string
    section: string
    active: boolean
  }>
}

export type AttendanceClass = {
  id: string
  className: string
  section: string
  schoolId: string
  campusId: string
  students: Student[]
}

export type AttendanceCounts = {
  present: number
  absent: number
  late: number
  total: number
  rate: number | null
}

export type AttendanceAttention = {
  level: 'HIGH' | 'MEDIUM' | 'NOTICE'
  kind: 'student' | 'class'
  studentId?: string
  classId?: string
  title: string
  detail: string
}

export const attendanceRules = {
  consecutiveAbsences: 3,
  lowAttendanceRate: 75,
  significantClassDrop: 8,
  maxAttentionItems: 5,
}

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function attendanceDateKey(timeZone: string | null | undefined, date = new Date()): string {
  const schoolTimeZone = normalizeSchoolTimezone(timeZone)
  if (timeZone?.trim() && !schoolTimeZone && import.meta.env.DEV) {
    console.error('[CAMVIA Attendance] Invalid school timezone; using UTC.', {
      operation: 'attendance.date',
      timeZone,
    })
  }
  return schoolDateKey(schoolTimeZone, date)
}

export function formatAttendanceDate(dateKey: string): string {
  if (!dateKey) return 'Select a date'
  const date = new Date(`${dateKey}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) return 'Invalid date'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(date)
}

export function getAttendanceClassId(className: string, section: string, campusId: string): string {
  return `${campusId}::${encodeURIComponent(className.trim())}::${encodeURIComponent(section.trim())}`
}

export function getAttendanceClasses(students: Student[]): AttendanceClass[] {
  const groups = new Map<string, AttendanceClass>()

  for (const student of students) {
    if (!student.schoolId || !student.campusId || !student.organizationId) continue
    if (student.status !== 'Active' || (student as any).deleted_at || (student as any).deletedAt) continue
    const id = getAttendanceClassId(student.className, student.section, student.campusId)
    const current = groups.get(id)
    if (current) {
      current.students.push(student)
    } else {
      groups.set(id, {
        id,
        className: student.className,
        section: student.section,
        schoolId: student.schoolId,
        campusId: student.campusId,
        students: [student],
      })
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      students: [...group.students].sort((left, right) =>
        compareNaturalText(left.studentId, right.studentId) ||
        compareNaturalText(left.firstName, right.firstName),
      ),
    }))
    .sort(
      (left, right) =>
        compareClassNames(left.className, right.className) ||
        compareNaturalText(left.section, right.section),
    )
}

export function canAccessAttendanceClass(
  students: Student[],
  classId: string,
  campusId?: string,
  schoolId?: string,
): AttendanceClass | null {
  const attendanceClass = getAttendanceClasses(students).find((item) => item.id === classId)
  if (!attendanceClass) return null
  if (campusId && campusId !== attendanceClass.campusId) return null
  if (schoolId && schoolId !== attendanceClass.schoolId) return null
  return attendanceClass
}

export function getAttendanceCounts(records: AttendanceRecord[]): AttendanceCounts {
  return getAttendanceCountsFromStatuses(records.map((record) => record.status))
}

export function getAttendanceCountsFromStatuses(statuses: AttendanceStatus[]): AttendanceCounts {
  const present = statuses.filter((status) => status === 'PRESENT').length
  const absent = statuses.filter((status) => status === 'ABSENT').length
  const late = statuses.filter((status) => status === 'LATE').length
  const total = present + absent + late
  return {
    present,
    absent,
    late,
    total,
    rate: total ? Math.round(((present + late) / total) * 100) : null,
  }
}

export function getSessionRecords(state: AttendanceState, sessionId: string): AttendanceRecord[] {
  return state.records.filter((record) => record.sessionId === sessionId && !record.trashedAt)
}

export function getSessionForClass(
  state: AttendanceState,
  date: string,
  attendanceClass: AttendanceClass,
): AttendanceSession | undefined {
  return state.sessions.find((session) =>
    session.date === date &&
    session.classId === attendanceClass.id &&
    session.schoolId === attendanceClass.schoolId &&
    session.campusId === attendanceClass.campusId,
  )
}

export function getStudentAttendance(
  student: Student,
  state: AttendanceState,
): {
  counts: AttendanceCounts
  recent: { date: string; status: AttendanceStatus }[]
  trend: { date: string; value: number }[]
} {
  const sessionsById = new Map(state.sessions.map((session) => [session.id, session]))
  if (!student.campusId || !student.schoolId) {
    return { counts: getAttendanceCounts([]), recent: [], trend: [] }
  }
  const studentClassId = getAttendanceClassId(student.className, student.section, student.campusId)
  const studentRecords = state.records
    .filter((record) => {
      if (record.trashedAt) return false
      const session = sessionsById.get(record.sessionId)
      if (!session) return false
      return record.studentId === student.id &&
        session.campusId === student.campusId &&
        session.schoolId === student.schoolId &&
        session.classId === studentClassId
    })
    .sort((left, right) => {
      const leftDate = sessionsById.get(left.sessionId)?.date ?? ''
      const rightDate = sessionsById.get(right.sessionId)?.date ?? ''
      return rightDate.localeCompare(leftDate)
    })
  const counts = getAttendanceCounts(studentRecords)
  const recent = studentRecords.slice(0, 10).map((record) => ({
    date: sessionsById.get(record.sessionId)?.date ?? '',
    status: record.status,
  }))
  const dates = [...new Set(studentRecords.map((record) => sessionsById.get(record.sessionId)?.date ?? ''))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
  const trend = dates.map((date) => {
    const recordsForDate = studentRecords.filter((record) => sessionsById.get(record.sessionId)?.date === date)
    return { date, value: getAttendanceCounts(recordsForDate).rate ?? 0 }
  })

  return { counts, recent, trend }
}

export function getAttendanceForScope(
  state: AttendanceState,
  classes: AttendanceClass[],
  date: string,
): { counts: AttendanceCounts; records: AttendanceRecord[]; sessions: AttendanceSession[] } {
  const classIds = new Set(classes.map((attendanceClass) => attendanceClass.id))
  const sessions = state.sessions.filter((session) =>
    session.date === date &&
    classIds.has(session.classId),
  )
  const sessionIds = new Set(sessions.map((session) => session.id))
  const studentIdsBySession = new Map(sessions.map((session) => [
    session.id,
    new Set(classes.find((attendanceClass) => attendanceClass.id === session.classId)?.students.map((student) => student.id) ?? []),
  ]))
  const records = state.records.filter((record) =>
    !record.trashedAt &&
    sessionIds.has(record.sessionId) &&
    studentIdsBySession.get(record.sessionId)?.has(record.studentId),
  )
  return { counts: getAttendanceCounts(records), records, sessions }
}

function collectStudentAttentionAlerts(
  recordsByStudent: Map<string, AttendanceRecord[]>,
  studentsById: Map<string, Student>,
  sessionsById: Map<string, AttendanceSession>,
): AttendanceAttention[] {
  const alerts: AttendanceAttention[] = []
  for (const [studentId, records] of recordsByStudent) {
    const student = studentsById.get(studentId)
    if (!student) continue
    const orderedRecords = [...records].sort((left, right) => {
      const leftDate = sessionsById.get(left.sessionId)?.date ?? ''
      const rightDate = sessionsById.get(right.sessionId)?.date ?? ''
      return rightDate.localeCompare(leftDate)
    })
    let consecutiveAbsences = 0
    for (const record of orderedRecords) {
      if (record.status !== 'ABSENT') break
      consecutiveAbsences += 1
    }
    const counts = getAttendanceCounts(orderedRecords)
    if (consecutiveAbsences >= attendanceRules.consecutiveAbsences) {
      alerts.push({
        level: 'HIGH',
        kind: 'student',
        studentId,
        title: `${student.firstName} ${student.lastName}`,
        detail: `Absent for ${consecutiveAbsences} consecutive recorded school days.`,
      })
    }
    if (counts.rate !== null && counts.rate < attendanceRules.lowAttendanceRate) {
      alerts.push({
        level: 'MEDIUM',
        kind: 'student',
        studentId,
        title: `${student.firstName} ${student.lastName}`,
        detail: `Attendance is ${counts.rate}%.`,
      })
    }
  }
  return alerts
}

function collectClassDropAttentionAlerts(
  classes: AttendanceClass[],
  sessions: AttendanceSession[],
  recordsBySession: Map<string, AttendanceRecord[]>,
): AttendanceAttention[] {
  const alerts: AttendanceAttention[] = []
  for (const attendanceClass of classes) {
    const classSessions = sessions.filter((session) => session.classId === attendanceClass.id)
    if (classSessions.length < 2) continue
    const latest = getAttendanceCounts(recordsBySession.get(classSessions[0].id) ?? []).rate
    const comparisonRates = classSessions
      .slice(1, 4)
      .map((session) => getAttendanceCounts(recordsBySession.get(session.id) ?? []).rate)
      .filter((rate): rate is number => rate !== null)
    if (latest === null || comparisonRates.length === 0) continue
    const recentAverage = comparisonRates.reduce((sum, rate) => sum + rate, 0) / comparisonRates.length
    const drop = Math.round(recentAverage - latest)
    if (drop >= attendanceRules.significantClassDrop) {
      alerts.push({
        level: 'NOTICE',
        kind: 'class',
        classId: attendanceClass.id,
        title: `${attendanceClass.className}-${attendanceClass.section}`,
        detail: `Attendance is ${drop}% below its recent average.`,
      })
    }
  }
  return alerts
}

export function getAttendanceAttention(
  state: AttendanceState,
  students: Student[],
): AttendanceAttention[] {
  const classes = getAttendanceClasses(students)
  const studentsById = new Map(students.map((student) => [student.id, student]))
  const sessionsById = new Map(state.sessions.map((session) => [session.id, session]))
  const scopedClassIds = new Map<string, AttendanceClass>()
  for (const attendanceClass of classes) {
    scopedClassIds.set(`${attendanceClass.schoolId}:${attendanceClass.campusId}:${attendanceClass.id}`, attendanceClass)
  }

  const recordsBySession = new Map<string, AttendanceRecord[]>()
  for (const record of state.records) {
    if (record.trashedAt) continue
    const list = recordsBySession.get(record.sessionId)
    if (list) list.push(record)
    else recordsBySession.set(record.sessionId, [record])
  }

  const sessions = state.sessions
    .filter((session) =>
      scopedClassIds.has(`${session.schoolId}:${session.campusId}:${session.classId}`) &&
      recordsBySession.has(session.id),
    )
    .sort((left, right) => right.date.localeCompare(left.date))
  const scopedSessionIds = new Set(sessions.map((session) => session.id))

  const recordsByStudent = new Map<string, AttendanceRecord[]>()
  for (const record of state.records) {
    if (record.trashedAt || !scopedSessionIds.has(record.sessionId)) continue
    const student = studentsById.get(record.studentId)
    const session = sessionsById.get(record.sessionId)
    if (!student?.campusId || session?.classId !== getAttendanceClassId(student.className, student.section, student.campusId)) continue
    const list = recordsByStudent.get(record.studentId)
    if (list) list.push(record)
    else recordsByStudent.set(record.studentId, [record])
  }

  const attention = [
    ...collectStudentAttentionAlerts(recordsByStudent, studentsById, sessionsById),
    ...collectClassDropAttentionAlerts(classes, sessions, recordsBySession),
  ]

  const rank = { HIGH: 0, MEDIUM: 1, NOTICE: 2 }
  attention.sort((left, right) => rank[left.level] - rank[right.level] || left.title.localeCompare(right.title))
  return attention.slice(0, attendanceRules.maxAttentionItems)
}

export type AttendanceOverviewTimeframe = 'today' | 'weekly' | 'monthly' | 'yearly'

export type GroupedAttendanceSeries = {
  key: string
  label: string
  averageRate: number | null
}

export type GroupedAttendanceCell = {
  rate: number | null
  present: number
  late: number
  total: number
}

export type GroupedAttendanceBucket = {
  key: string
  label: string
  fullLabel: string
  values: Record<string, GroupedAttendanceCell>
}

export type GroupedAttendanceChartData = {
  timeframe: AttendanceOverviewTimeframe
  periodLabel: string
  avgLabel: string
  series: GroupedAttendanceSeries[]
  buckets: GroupedAttendanceBucket[]
  averageRate: number
  highestRate: number
  lowestRate: number
  lowSeriesLabels: string[]
}

function formatGroupedClassLabel(className: string): string {
  const trimmed = className.trim()
  if (!trimmed) return 'Unassigned'
  return /^\d+$/.test(trimmed) ? `Class ${trimmed}` : trimmed
}

function formatShortDateLabel(dateKey: string): string {
  return new Intl.DateTimeFormat('en-PK', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${dateKey}T00:00:00Z`))
}

type BucketDescriptorResult = {
  periodLabel: string
  avgLabel: string
  buckets: Array<{ key: string; label: string; fullLabel: string; dates: Set<string> }>
}

function getMonthlyBucketDescriptors(recordedDates: string[]): BucketDescriptorResult {
  const latestDate = recordedDates.at(-1) ?? ''
  const latestMs = Date.parse(`${latestDate}T00:00:00Z`)
  const cutoffMs = latestMs - 29 * 86_400_000
  const monthlyDates = recordedDates.filter((date) => Date.parse(`${date}T00:00:00Z`) >= cutoffMs)
  if (monthlyDates.length <= 7) {
    return {
      periodLabel: 'Last 30 days',
      avgLabel: '30-day avg',
      buckets: monthlyDates.map((date) => ({
        key: date,
        label: formatShortDateLabel(date),
        fullLabel: new Intl.DateTimeFormat('en-PK', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)),
        dates: new Set([date]),
      })),
    }
  }
  const weekMap = new Map<string, string[]>()
  for (const date of monthlyDates) {
    const parsed = new Date(`${date}T00:00:00Z`)
    const dayOfWeek = (parsed.getUTCDay() + 6) % 7
    const weekStart = new Date(parsed.getTime() - dayOfWeek * 86_400_000).toISOString().slice(0, 10)
    const list = weekMap.get(weekStart)
    if (list) list.push(date)
    else weekMap.set(weekStart, [date])
  }
  const weekEntries = [...weekMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6)
  return {
    periodLabel: 'Last 30 days',
    avgLabel: '30-day avg',
    buckets: weekEntries.map(([weekStart, dates]) => ({
      key: weekStart,
      label: formatShortDateLabel(weekStart),
      fullLabel: `Week of ${formatShortDateLabel(weekStart)}`,
      dates: new Set(dates),
    })),
  }
}

function getYearlyBucketDescriptors(recordedDates: string[]): BucketDescriptorResult {
  const monthMap = new Map<string, string[]>()
  for (const date of recordedDates) {
    const monthKey = date.slice(0, 7)
    const list = monthMap.get(monthKey)
    if (list) list.push(date)
    else monthMap.set(monthKey, [date])
  }
  const monthEntries = [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12)
  return {
    periodLabel: 'Last 12 months',
    avgLabel: 'Yearly avg',
    buckets: monthEntries.map(([monthKey, dates]) => {
      const parsed = new Date(`${monthKey}-01T00:00:00Z`)
      return {
        key: monthKey,
        label: new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(parsed),
        fullLabel: new Intl.DateTimeFormat('en-PK', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parsed),
        dates: new Set(dates),
      }
    }),
  }
}

function getBucketDescriptors(
  recordedDates: string[],
  timeframe: AttendanceOverviewTimeframe,
  schoolTimezone?: string | null,
): BucketDescriptorResult {
  if (!recordedDates.length) {
    return { periodLabel: 'No recorded days', avgLabel: 'Avg', buckets: [] }
  }

  if (timeframe === 'today') {
    const todayKey = attendanceDateKey(schoolTimezone)
    const targetDate = recordedDates.includes(todayKey) ? todayKey : (recordedDates.at(-1) ?? '')
    const label = targetDate === todayKey ? 'Today' : formatShortDateLabel(targetDate)
    return {
      periodLabel: targetDate === todayKey ? 'Today' : 'Latest recorded day',
      avgLabel: 'Today avg',
      buckets: [{
        key: targetDate,
        label,
        fullLabel: new Intl.DateTimeFormat('en-PK', { dateStyle: 'medium', timeZone: 'UTC' })
          .format(new Date(`${targetDate}T00:00:00Z`)),
        dates: new Set([targetDate]),
      }],
    }
  }

  if (timeframe === 'weekly') {
    const weeklyDates = recordedDates.slice(-7)
    return {
      periodLabel: 'Last 7 recorded days',
      avgLabel: '7-day avg',
      buckets: weeklyDates.map((date) => ({
        key: date,
        label: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)),
        fullLabel: new Intl.DateTimeFormat('en-PK', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)),
        dates: new Set([date]),
      })),
    }
  }

  if (timeframe === 'monthly') {
    return getMonthlyBucketDescriptors(recordedDates)
  }

  return getYearlyBucketDescriptors(recordedDates)
}

export function getGroupedAttendanceChartData(
  state: AttendanceState,
  students: Student[],
  timeframe: AttendanceOverviewTimeframe,
  schoolTimezone?: string | null,
): GroupedAttendanceChartData {
  const classes = getAttendanceClasses(students)
  const classIds = new Set(classes.map((item) => item.id))
  const sessionsWithRecords = new Set(state.records.filter((record) => !record.trashedAt).map((record) => record.sessionId))
  const recordedDates = [...new Set(
    state.sessions
      .filter((session) => classIds.has(session.classId) && sessionsWithRecords.has(session.id))
      .map((session) => session.date),
  )].sort((left, right) => left.localeCompare(right))

  const { periodLabel, avgLabel, buckets: descriptors } = getBucketDescriptors(recordedDates, timeframe, schoolTimezone)
  if (!classes.length || !descriptors.length) {
    return {
      timeframe,
      periodLabel,
      avgLabel,
      series: [],
      buckets: [],
      averageRate: 0,
      highestRate: 0,
      lowestRate: 0,
      lowSeriesLabels: [],
    }
  }

  const classGroupsMap = new Map<string, { key: string; label: string; classIds: Set<string>; studentIds: Set<string> }>()
  for (const item of classes) {
    const label = formatGroupedClassLabel(item.className)
    const key = label.toLowerCase()
    const existing = classGroupsMap.get(key)
    if (existing) {
      existing.classIds.add(item.id)
      for (const student of item.students) existing.studentIds.add(student.id)
    } else {
      classGroupsMap.set(key, {
        key,
        label,
        classIds: new Set([item.id]),
        studentIds: new Set(item.students.map((student) => student.id)),
      })
    }
  }

  const allSeriesGroups = [...classGroupsMap.values()].sort((a, b) =>
    compareClassNames(a.label, b.label),
  )

  const computeCell = (dates: Set<string>, classIdsSet: Set<string>, studentIdsSet: Set<string>): GroupedAttendanceCell => {
    const sessionIds = new Set(
      state.sessions
        .filter((session) => classIdsSet.has(session.classId) && dates.has(session.date))
        .map((session) => session.id),
    )
    if (!sessionIds.size) {
      return { rate: null, present: 0, late: 0, total: 0 }
    }
    const matchingRecords = state.records.filter((record) =>
      !record.trashedAt && sessionIds.has(record.sessionId) && studentIdsSet.has(record.studentId),
    )
    const counts = getAttendanceCounts(matchingRecords)
    return {
      rate: counts.rate,
      present: counts.present,
      late: counts.late,
      total: counts.total,
    }
  }

  const allPeriodDates = new Set(descriptors.flatMap((descriptor) => [...descriptor.dates]))
  const seriesWithAvg = allSeriesGroups.map((group) => {
    const summary = computeCell(allPeriodDates, group.classIds, group.studentIds)
    return { ...group, averageRate: summary.rate }
  })

  const selectedGroups = seriesWithAvg

  const series: GroupedAttendanceSeries[] = selectedGroups.map(({ key, label, averageRate }) => ({
    key,
    label,
    averageRate,
  }))

  const rates: number[] = []
  const buckets: GroupedAttendanceBucket[] = descriptors.map((descriptor) => {
    const values: Record<string, GroupedAttendanceCell> = {}
    for (const group of selectedGroups) {
      const cell = computeCell(descriptor.dates, group.classIds, group.studentIds)
      values[group.key] = cell
      if (cell.rate !== null) rates.push(cell.rate)
    }
    return {
      key: descriptor.key,
      label: descriptor.label,
      fullLabel: descriptor.fullLabel,
      values,
    }
  })

  const averageRate = rates.length ? Math.round(rates.reduce((sum, r) => sum + r, 0) / rates.length) : 0
  const highestRate = rates.length ? Math.max(...rates) : 0
  const lowestRate = rates.length ? Math.min(...rates) : 0
  const lowSeriesLabels = series
    .filter((item) => item.averageRate !== null && item.averageRate < attendanceRules.lowAttendanceRate)
    .map((item) => item.label)

  return {
    timeframe,
    periodLabel,
    avgLabel,
    series,
    buckets,
    averageRate,
    highestRate,
    lowestRate,
    lowSeriesLabels,
  }
}

export function getGroupedAttendanceChartDataFromDailyCounts(
  classNames: string[],
  dailyCounts: Array<{
    className: string
    date: string
    present: number
    late: number
    absent: number
  }>,
  timeframe: AttendanceOverviewTimeframe,
  schoolTimezone?: string | null,
): GroupedAttendanceChartData {
  const countsByClassAndDate = new Map<string, Map<string, { present: number; late: number; absent: number }>>()
  for (const item of dailyCounts) {
    let countsByDate = countsByClassAndDate.get(item.className)
    if (!countsByDate) {
      countsByDate = new Map()
      countsByClassAndDate.set(item.className, countsByDate)
    }
    const counts = countsByDate.get(item.date)
    if (counts) {
      counts.present += item.present
      counts.late += item.late
      counts.absent += item.absent
    } else {
      countsByDate.set(item.date, {
        present: item.present,
        late: item.late,
        absent: item.absent,
      })
    }
  }

  const recordedDates = [...new Set(
    [...countsByClassAndDate.values()]
      .flatMap((countsByDate) => [...countsByDate.entries()]
        .filter(([, counts]) => counts.present + counts.late + counts.absent > 0)
        .map(([date]) => date)),
  )].sort((left, right) => left.localeCompare(right))
  const { periodLabel, avgLabel, buckets: descriptors } = getBucketDescriptors(recordedDates, timeframe, schoolTimezone)
  const groups = new Map<string, { key: string; label: string; classNames: Set<string> }>()

  for (const className of classNames) {
    const label = formatGroupedClassLabel(className)
    const key = label.toLowerCase()
    const group = groups.get(key)
    if (group) group.classNames.add(className)
    else groups.set(key, { key, label, classNames: new Set([className]) })
  }

  const allSeriesGroups = [...groups.values()].sort((left, right) =>
    compareClassNames(left.label, right.label),
  )

  if (!allSeriesGroups.length || !descriptors.length) {
    return {
      timeframe,
      periodLabel,
      avgLabel,
      series: [],
      buckets: [],
      averageRate: 0,
      highestRate: 0,
      lowestRate: 0,
      lowSeriesLabels: [],
    }
  }

  const computeCell = (
    dates: Set<string>,
    groupedClassNames: Set<string>,
  ): GroupedAttendanceCell => {
    const counts = { present: 0, late: 0, absent: 0 }
    for (const className of groupedClassNames) {
      const countsByDate = countsByClassAndDate.get(className)
      if (!countsByDate) continue
      for (const date of dates) {
        const daily = countsByDate.get(date)
        if (!daily) continue
        counts.present += daily.present
        counts.late += daily.late
        counts.absent += daily.absent
      }
    }
    const total = counts.present + counts.late + counts.absent
    return {
      rate: total ? Math.round(((counts.present + counts.late) / total) * 100) : null,
      present: counts.present,
      late: counts.late,
      total,
    }
  }

  const allPeriodDates = new Set(descriptors.flatMap((descriptor) => [...descriptor.dates]))
  const selectedGroups = allSeriesGroups.map((group) => ({
    ...group,
    averageRate: computeCell(allPeriodDates, group.classNames).rate,
  }))
  const series: GroupedAttendanceSeries[] = selectedGroups.map(({ key, label, averageRate }) => ({
    key,
    label,
    averageRate,
  }))
  const rates: number[] = []
  const buckets: GroupedAttendanceBucket[] = descriptors.map((descriptor) => {
    const values: Record<string, GroupedAttendanceCell> = {}
    for (const group of selectedGroups) {
      const cell = computeCell(descriptor.dates, group.classNames)
      values[group.key] = cell
      if (cell.rate !== null) rates.push(cell.rate)
    }
    return {
      key: descriptor.key,
      label: descriptor.label,
      fullLabel: descriptor.fullLabel,
      values,
    }
  })

  const averageRate = rates.length ? Math.round(rates.reduce((sum, rate) => sum + rate, 0) / rates.length) : 0
  const highestRate = rates.length ? Math.max(...rates) : 0
  const lowestRate = rates.length ? Math.min(...rates) : 0
  const lowSeriesLabels = series
    .filter((item) => item.averageRate !== null && item.averageRate < attendanceRules.lowAttendanceRate)
    .map((item) => item.label)

  return {
    timeframe,
    periodLabel,
    avgLabel,
    series,
    buckets,
    averageRate,
    highestRate,
    lowestRate,
    lowSeriesLabels,
  }
}

export function getAttendanceTrend(
  state: AttendanceState,
  students: Student[],
): { day: string; date: string; value: number; total: number }[] {
  const classes = getAttendanceClasses(students)
  const classIds = new Set(classes.map((attendanceClass) => attendanceClass.id))
  const sessionsWithRecords = new Set(state.records.filter((record) => !record.trashedAt).map((record) => record.sessionId))
  const dates = [...new Set(state.sessions
    .filter((session) =>
      classIds.has(session.classId) && sessionsWithRecords.has(session.id),
    )
    .map((session) => session.date),
  )].sort((left, right) => left.localeCompare(right)).slice(-7)
  return dates.map((date) => {
    const daily = getAttendanceForScope(state, classes, date).counts
    return {
      day: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)),
      date,
      value: daily.rate ?? 0,
      total: daily.total,
    }
  })
}

export type AttendanceSubmission = {
  date: string
  classId: string
  changedStudentIds: string[]
  statuses: Record<string, AttendanceStatus>
  notes: Record<string, string>
}

export function getLastRecordedAttendanceDate(state: AttendanceState, students: Student[]): string | null {
  const classes = getAttendanceClasses(students)
  const sessionsWithRecords = new Set(state.records.filter((record) => !record.trashedAt).map((record) => record.sessionId))
  return state.sessions
    .filter((session) => classes.some((attendanceClass) =>
      session.classId === attendanceClass.id &&
      session.schoolId === attendanceClass.schoolId &&
      session.campusId === attendanceClass.campusId &&
      sessionsWithRecords.has(session.id),
    ))
    .map((session) => session.date)
    .sort((left, right) => left.localeCompare(right))
    .at(-1) ?? null
}
