export type DashboardStudentCount = {
  className: string
  studentCount: number
}

export type DashboardSectionStudentCount = DashboardStudentCount & {
  section: string
  campusId: string
}

export type DashboardCampusStudentCount = {
  campusId: string
  studentCount: number
}

export type DashboardGenderStudentCount = {
  gender: string
  studentCount: number
}

export type DashboardAttendanceDayCount = {
  className: string
  date: string
  present: number
  late: number
  absent: number
}

export type DashboardAttendanceSummary = {
  classNames: string[]
  dailyCounts: DashboardAttendanceDayCount[]
}

export type DashboardStudentSummary = {
  activeStudentCount: number
  classCounts: DashboardStudentCount[]
  sectionCounts: DashboardSectionStudentCount[]
  campusCounts: DashboardCampusStudentCount[]
  genderCounts: DashboardGenderStudentCount[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Dashboard summary contains an invalid ${field}.`)
  }
  return value
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Dashboard summary contains an invalid ${field}.`)
  }
  return value
}

function readUuid(value: unknown, field: string): string {
  const id = readString(value, field)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`Dashboard summary contains an invalid ${field}.`)
  }
  return id
}

function readArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Dashboard summary contains an invalid ${field}.`)
  }
  return value
}

function readDate(value: unknown): string {
  const date = readString(value, 'attendance date')
  const parsedDate = new Date(`${date}T00:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  ) {
    throw new Error('Dashboard summary contains an invalid attendance date.')
  }
  return date
}

function readClassCounts(value: unknown): DashboardStudentCount[] {
  return readArray(value, 'class counts').map((item) => {
    if (!isRecord(item)) throw new Error('Dashboard summary contains an invalid class count.')
    return {
      className: readString(item.className, 'class name'),
      studentCount: readCount(item.studentCount, 'class count'),
    }
  })
}

function readSectionCounts(value: unknown): DashboardSectionStudentCount[] {
  return readArray(value, 'section counts').map((item) => {
    if (!isRecord(item)) throw new Error('Dashboard summary contains an invalid section count.')
    return {
      className: readString(item.className, 'class name'),
      section: readString(item.section, 'section'),
      campusId: readUuid(item.campusId, 'section campus ID'),
      studentCount: readCount(item.studentCount, 'section count'),
    }
  })
}

function readCampusCounts(value: unknown): DashboardCampusStudentCount[] {
  return readArray(value, 'campus counts').map((item) => {
    if (!isRecord(item)) throw new Error('Dashboard summary contains an invalid campus count.')
    return {
      campusId: readUuid(item.campusId, 'campus ID'),
      studentCount: readCount(item.studentCount, 'campus count'),
    }
  })
}

function readGenderCounts(value: unknown): DashboardGenderStudentCount[] {
  return readArray(value, 'gender counts').map((item) => {
    if (!isRecord(item)) throw new Error('Dashboard summary contains an invalid gender count.')
    return {
      gender: readString(item.gender, 'gender'),
      studentCount: readCount(item.studentCount, 'gender count'),
    }
  })
}

function assertCountTotal(values: Array<{ studentCount: number }>, expected: number, field: string): void {
  const actual = values.reduce((total, item) => total + item.studentCount, 0)
  if (actual !== expected) {
    throw new Error(`Dashboard summary ${field} do not match the active student total.`)
  }
}

export function parseDashboardStudentSummary(value: unknown): DashboardStudentSummary {
  if (!isRecord(value)) throw new Error('Dashboard summary response is invalid.')
  const summary: DashboardStudentSummary = {
    activeStudentCount: readCount(value.activeStudentCount, 'active student total'),
    classCounts: readClassCounts(value.classCounts),
    sectionCounts: readSectionCounts(value.sectionCounts),
    campusCounts: readCampusCounts(value.campusCounts),
    genderCounts: readGenderCounts(value.genderCounts),
  }
  assertCountTotal(summary.classCounts, summary.activeStudentCount, 'class counts')
  assertCountTotal(summary.sectionCounts, summary.activeStudentCount, 'section counts')
  assertCountTotal(summary.campusCounts, summary.activeStudentCount, 'campus counts')
  assertCountTotal(summary.genderCounts, summary.activeStudentCount, 'gender counts')
  return summary
}

export function parseDashboardAttendanceSummary(value: unknown): DashboardAttendanceSummary {
  if (!isRecord(value)) throw new Error('Dashboard attendance summary response is invalid.')
  const classNames = readArray(value.classNames, 'attendance class names').map((item) =>
    readString(item, 'attendance class name'))
  if (new Set(classNames).size !== classNames.length) {
    throw new Error('Dashboard attendance summary contains duplicate classes.')
  }

  const rowKeys = new Set<string>()
  const dailyCounts = readArray(value.dailyCounts, 'daily attendance counts').map((item) => {
    if (!isRecord(item)) throw new Error('Dashboard summary contains an invalid daily attendance count.')
    const className = readString(item.className, 'attendance class name')
    const date = readDate(item.date)
    const key = `${date}\u0000${className}`
    if (rowKeys.has(key)) throw new Error('Dashboard attendance summary contains duplicate daily counts.')
    rowKeys.add(key)
    if (!classNames.includes(className)) {
      throw new Error('Dashboard attendance summary contains a class outside the authorized student scope.')
    }
    return {
      className,
      date,
      present: readCount(item.present, 'present count'),
      late: readCount(item.late, 'late count'),
      absent: readCount(item.absent, 'absent count'),
    }
  })

  return { classNames, dailyCounts }
}
