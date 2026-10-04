import type { Role } from './mockData'
import type { Student } from './studentData'

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
}

export type AttendanceState = {
  sessions: AttendanceSession[]
  records: AttendanceRecord[]
}

export type AttendanceUser = {
  id: number
  role: Role
  email: string
  schoolName: string
  campusName: string
  organizationId?: string | null
  schoolId?: string | null
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

export function formatAttendanceDate(dateKey: string): string {
  if (!dateKey) return 'Select a date'
  const date = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(date.getTime()) || localDateKey(date) !== dateKey) return 'Invalid date'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(date)
}

export function getAttendanceClassId(className: string, section: string, campusId: string): string {
  return `${campusId}::${encodeURIComponent(className.trim())}::${encodeURIComponent(section.trim())}`
}

export function getAttendanceClasses(students: Student[]): AttendanceClass[] {
  const groups = new Map<string, AttendanceClass>()

  for (const student of students) {
    if (!student.schoolId || !student.campusId || !student.organizationId) continue
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

  return [...groups.values()].sort((left, right) =>
    left.className.localeCompare(right.className) || left.section.localeCompare(right.section),
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
  const present = records.filter((record) => record.status === 'PRESENT').length
  const absent = records.filter((record) => record.status === 'ABSENT').length
  const late = records.filter((record) => record.status === 'LATE').length
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
  return state.records.filter((record) => record.sessionId === sessionId)
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
): { counts: AttendanceCounts; recent: { date: string; status: AttendanceStatus }[]; trend: number[] } {
  const sessionsById = new Map(state.sessions.map((session) => [session.id, session]))
  if (!student.campusId || !student.schoolId) {
    return { counts: getAttendanceCounts([]), recent: [], trend: [] }
  }
  const studentClassId = getAttendanceClassId(student.className, student.section, student.campusId)
  const studentRecords = state.records
    .filter((record) => {
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
    .sort()
    .slice(-7)
  const trend = dates.map((date) => {
    const recordsForDate = studentRecords.filter((record) => sessionsById.get(record.sessionId)?.date === date)
    return getAttendanceCounts(recordsForDate).rate ?? 0
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
    sessionIds.has(record.sessionId) && studentIdsBySession.get(record.sessionId)?.has(record.studentId),
  )
  return { counts: getAttendanceCounts(records), records, sessions }
}

export function getAttendanceAttention(
  state: AttendanceState,
  students: Student[],
): AttendanceAttention[] {
  const classes = getAttendanceClasses(students)
  const scopedStudentIds = new Set(classes.flatMap((attendanceClass) => attendanceClass.students.map((student) => student.id)))
  const sessions = state.sessions
    .filter((session) =>
      classes.some((attendanceClass) =>
        session.classId === attendanceClass.id &&
        session.schoolId === attendanceClass.schoolId &&
        session.campusId === attendanceClass.campusId,
      ),
    )
    .sort((left, right) => right.date.localeCompare(left.date))
  const recordsByStudent = new Map<string, AttendanceRecord[]>()
  for (const record of state.records) {
    if (!scopedStudentIds.has(record.studentId)) continue
    const session = state.sessions.find((item) => item.id === record.sessionId)
    if (!session || !sessions.some((item) => item.id === session.id)) continue
    const student = students.find((item) => item.id === record.studentId)
    if (!student?.campusId || session.classId !== getAttendanceClassId(student.className, student.section, student.campusId)) continue
    recordsByStudent.set(record.studentId, [...(recordsByStudent.get(record.studentId) ?? []), record])
  }

  const attention: AttendanceAttention[] = []
  for (const [studentId, records] of recordsByStudent) {
    const student = students.find((item) => item.id === studentId)
    if (!student) continue
    const orderedRecords = records.sort((left, right) => {
      const leftDate = state.sessions.find((session) => session.id === left.sessionId)?.date ?? ''
      const rightDate = state.sessions.find((session) => session.id === right.sessionId)?.date ?? ''
      return rightDate.localeCompare(leftDate)
    })
    let consecutiveAbsences = 0
    for (const record of orderedRecords) {
      if (record.status !== 'ABSENT') break
      consecutiveAbsences += 1
    }
    const { counts } = getStudentAttendance(student, state)
    if (consecutiveAbsences >= attendanceRules.consecutiveAbsences) {
      attention.push({
        level: 'HIGH',
        kind: 'student',
        studentId,
        title: `${student.firstName} ${student.lastName}`,
        detail: `Absent for ${consecutiveAbsences} consecutive recorded school days.`,
      })
    }
    if (counts.rate !== null && counts.rate < attendanceRules.lowAttendanceRate) {
      attention.push({
        level: 'MEDIUM',
        kind: 'student',
        studentId,
        title: `${student.firstName} ${student.lastName}`,
        detail: `Attendance is ${counts.rate}%.`,
      })
    }
  }

  for (const attendanceClass of classes) {
    const classSessions = sessions
      .filter((session) => session.classId === attendanceClass.id)
      .sort((left, right) => right.date.localeCompare(left.date))
    if (classSessions.length < 2) continue
    const latest = getAttendanceCounts(getSessionRecords(state, classSessions[0].id)).rate
    const comparisonSessions = classSessions.slice(1, 4)
    const comparisonRates = comparisonSessions
      .map((session) => getAttendanceCounts(getSessionRecords(state, session.id)).rate)
      .filter((rate): rate is number => rate !== null)
    if (latest === null || comparisonRates.length === 0) continue
    const recentAverage = comparisonRates.reduce((sum, rate) => sum + rate, 0) / comparisonRates.length
    const drop = Math.round(recentAverage - latest)
    if (drop >= attendanceRules.significantClassDrop) {
      attention.push({
        level: 'NOTICE',
        kind: 'class',
        classId: attendanceClass.id,
        title: `${attendanceClass.className}-${attendanceClass.section}`,
        detail: `Attendance is ${drop}% below its recent average.`,
      })
    }
  }

  const rank = { HIGH: 0, MEDIUM: 1, NOTICE: 2 }
  return attention
    .sort((left, right) => rank[left.level] - rank[right.level] || left.title.localeCompare(right.title))
    .slice(0, attendanceRules.maxAttentionItems)
}

export function getAttendanceTrend(
  state: AttendanceState,
  students: Student[],
): { day: string; value: number }[] {
  const classes = getAttendanceClasses(students)
  const classIds = new Set(classes.map((attendanceClass) => attendanceClass.id))
  const dates = [...new Set(state.sessions
    .filter((session) =>
      classIds.has(session.classId),
    )
    .map((session) => session.date),
  )].sort().slice(-7)
  return dates.map((date) => {
    const daily = getAttendanceForScope(state, classes, date).counts
    return { day: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(`${date}T00:00:00`)), value: daily.rate ?? 0 }
  })
}

export type AttendanceSubmission = {
  date: string
  classId: string
  statuses: Record<string, AttendanceStatus>
  notes: Record<string, string>
}

export function getLastRecordedAttendanceDate(state: AttendanceState, students: Student[]): string | null {
  const classes = getAttendanceClasses(students)
  return state.sessions
    .filter((session) => classes.some((attendanceClass) =>
      session.classId === attendanceClass.id &&
      session.schoolId === attendanceClass.schoolId &&
      session.campusId === attendanceClass.campusId,
    ))
    .map((session) => session.date)
    .sort()
    .at(-1) ?? null
}
