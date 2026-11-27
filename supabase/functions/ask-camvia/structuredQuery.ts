export const queryToolRegistry = {
  students: {
    count: {
      filterFields: ['name', 'className', 'section', 'gender', 'status', 'campusName', 'studentCode', 'rollNumber', 'incompleteProfile'],
    },
    search: {
      filterFields: ['name', 'className', 'section', 'gender', 'status', 'campusName', 'studentCode'],
      sortFields: ['name', 'className', 'section', 'gender', 'status', 'studentCode'],
    },
  },
  attendance: {
    summary: {
      filterFields: ['date', 'className', 'section'],
    },
    search: {
      filterFields: ['date', 'className', 'section', 'status'],
    },
  },
  fees: {
    summary: {
      filterFields: ['metric', 'className', 'section'],
    },
  },
  dashboard: {
    summary: {
      filterFields: ['focus'],
    },
  },
} as const

type StudentFilterField = 'name' | 'className' | 'section' | 'gender' | 'status' | 'campusName' | 'studentCode' | 'rollNumber' | 'guardianName' | 'incompleteProfile'
type StudentSortField = 'name' | 'className' | 'section' | 'gender' | 'status' | 'studentCode'
export type StudentQueryPlan = {
  module: 'students'
  operation: 'count' | 'search'
  filters: Partial<Record<StudentFilterField, string>>
  page: number
  sort: { field: StudentSortField; direction: 'asc' | 'desc' } | null
}

type AttendanceFilterField = 'date' | 'className' | 'section'
export type AttendanceSummaryQueryPlan = {
  module: 'attendance'
  operation: 'summary'
  filters: Partial<Record<AttendanceFilterField, string>> & { date: string }
}
export type AttendanceSearchQueryPlan = {
  module: 'attendance'
  operation: 'search'
  filters: Partial<Record<'date' | 'className' | 'section' | 'status', string>> & {
    date: string
    status: 'PRESENT' | 'ABSENT' | 'LATE'
  }
  page: number
}
export type AttendanceQueryPlan = AttendanceSummaryQueryPlan | AttendanceSearchQueryPlan
export type AttendanceSummaryResult = {
  sessionCount: number
  eligibleCount: number
  recordedCount: number
  unmarkedCount: number
  presentCount: number
  absentCount: number
  lateCount: number
}
export type AttendanceSearchResult = {
  total: number
  page: number
  pageSize: 50
  rows: Array<{
    studentName: string
    className: string
    section: string
    status: 'PRESENT' | 'ABSENT' | 'LATE'
  }>
}

type FeeSummaryMetric =
  | 'outstanding_amount'
  | 'collected_amount'
  | 'overdue_amount'
  | 'outstanding_invoice_count'
  | 'overdue_invoice_count'
  | 'outstanding_student_count'

export type FeeSummaryQueryPlan = {
  module: 'fees'
  operation: 'summary'
  filters: {
    metric: FeeSummaryMetric
    className?: string
    section?: string
  }
}

export type FeeSummaryResult = {
  outstandingAmount: string
  collectedAmount: string
  overdueAmount: string
  outstandingInvoiceCount: number
  overdueInvoiceCount: number
  outstandingStudentCount: number
  invoiceCount: number
}

export type DashboardSummaryQueryPlan = {
  module: 'dashboard'
  operation: 'summary'
  filters: { focus: 'students' | 'attendance' | 'overview' }
}


export type CommunicationSummaryQueryPlan = {
  module: 'communication'
  operation: 'summary'
  filters: { status?: 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SENT' | 'ALL' }
}

export type AlertsSummaryQueryPlan = {
  module: 'alerts'
  operation: 'summary'
  filters: { sourceType?: string; className?: string; section?: string }
}

export type AdmissionsSummaryQueryPlan = {
  module: 'admissions'
  operation: 'summary'
  filters: { status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL' }
}

export type TrashSummaryQueryPlan = {
  module: 'trash'
  operation: 'summary'
  filters: { recordType?: 'STUDENT' | 'GUARDIAN' | 'COMMUNICATION' | 'ATTENDANCE' | 'ALL' }
}

export type SchoolSummaryQueryPlan = {
  module: 'school'
  operation: 'summary'
  filters: { focus?: 'overview' | 'campuses' | 'contact' | 'academic_year' | 'timezone' }
}

export type DashboardStudentSummaryResult = {
  activeStudentCount: number
  classCounts: Array<{ className: string | null; studentCount: number }>
  sectionCounts: Array<{
    className: string | null
    section: string | null
    campusId: string
    studentCount: number
  }>
  campusCounts: Array<{ campusId: string; studentCount: number }>
  genderCounts: Array<{ gender: string; studentCount: number }>
}

const allowedFilterFields = new Set<string>(queryToolRegistry.students.count.filterFields)
const allowedSortFields = new Set<string>(queryToolRegistry.students.search.sortFields)
const allowedAttendanceFilterFields = new Set<string>(queryToolRegistry.attendance.summary.filterFields)
const allowedAttendanceSearchFilterFields = new Set<string>(queryToolRegistry.attendance.search.filterFields)
const allowedFeeFilterFields = new Set<string>(queryToolRegistry.fees.summary.filterFields)
const allowedDashboardFilterFields = new Set<string>(queryToolRegistry.dashboard.summary.filterFields)

export function getStudentQueryIntent(prompt: string): 'count' | 'search' | null {
  if (/\b(how\s+many|count|number\s+of|kitne|kitni|ginti|tadaad|how\s+are|distributed|distribution|breakdown|ratio|split|boys?\s+and\s+girls?|girls?\s+and\s+boys?)\b/i.test(prompt)) return 'count'
  if (/\b(show|list|find|search|display|which|who|is\s+there|any|check|lookup|detail|profile)\b/i.test(prompt)) return 'search'
  if (/\b(name\s+is|named|called|student\s+name)\b/i.test(prompt)) return 'search'
  if (/\b(most|least|highest|lowest|group|rank|sort)\b/i.test(prompt)) return 'search'
  return null
}

export function isStudentCohortQuery(prompt: string): boolean {
  return /\b(students?|pupils?)\b/i.test(prompt) &&
    /\b(show|list|find|search|display|how\s+many|count|number\s+of|kitne|kitni|ginti|tadaad)\b/i.test(prompt)
}

export function getStudentNameFilter(name: string): string {
  const parts = name.trim().replace(/\s+/g, ' ').split(' ')
  if (parts.length === 1) {
    return `first_name.ilike.%${parts[0]}%,last_name.ilike.%${parts[0]}%`
  }
  const firstName = parts[0]
  const remainingName = parts.slice(1).join(' ')
  return `and(first_name.ilike.%${firstName}%,last_name.ilike.%${remainingName}%),and(first_name.ilike.%${remainingName}%,last_name.ilike.%${firstName}%)`
}

export function getUnsupportedStudentQueryReason(prompt: string): string | null {
  if (/\badmission\s+(?:number|no\.?|id)\b/i.test(prompt)) return 'admission-number filters'
  if (/\b(?:father|mother)(?:['’]s)?\s+name\b/i.test(prompt)) return 'father or mother name filters'
  if (/\b(?:without|missing|no)\b.*\b(?:guardian|parent|contact|phone|email)\b/i.test(prompt) ||
    /\b(?:guardian|parent)\b.*\b(?:contact|phone|email)\b/i.test(prompt)) {
    return 'guardian contact filters'
  }
  if (/\b(?:admission|admitted|enrolled)\s+(?:date|on|during|last|this)\b/i.test(prompt)) {
    return 'admission-date filters'
  }
  if (/\b(?:incomplete|missing|incomplete profile|profile completeness)\b/i.test(prompt)) {
    return 'profile-completeness filters'
  }
  return null
}

export function shouldPlanStudentQuery(
  prompt: string,
  domain: string | null,
  isNamedGuardianLookup: boolean,
): boolean {
  if (isNamedGuardianLookup || (domain !== null && domain !== 'students')) return false
  const intent = getStudentQueryIntent(prompt)
  if (!intent) return false
  if (intent === 'search') return true

  const asksSpecificName = /\b(named|called|name|whose|father|guardian)\b/i.test(prompt)
  const asksAdditionalFilter = /\b(girls?|boys?|female|male|gender|active|inactive|alumni|status|campus|student\s+(?:id|code)|guardian|father|mother|admission|without|missing|contact|phone|birthday|birth\s+date|age)\b/i.test(prompt)
  const asksGenericStudentCount = /^\s*(?:how\s+many|count|number\s+of|kitne|kitni|ginti|tadaad)\s+(?:active\s+)?(?:students?|pupils?)\b/i.test(prompt) &&
    !asksSpecificName &&
    !asksAdditionalFilter
  return asksSpecificName || asksAdditionalFilter || !asksGenericStudentCount
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isSafeFilter(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength &&
    /^[\p{L}\p{M}\d][\p{L}\p{M}\d '\u2019-]*$/u.test(value.trim())
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function parseAttendanceSummaryQueryPlan(value: unknown): AttendanceSummaryQueryPlan | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['module', 'operation', 'filters'])) return null
  if (value.module !== 'attendance' || value.operation !== 'summary') return null
  if (!isRecord(value.filters) || !hasOnlyKeys(value.filters, [...allowedAttendanceFilterFields])) return null
  if (!isValidDate(value.filters.date)) return null

  const filters: AttendanceSummaryQueryPlan['filters'] = { date: value.filters.date }
  for (const field of ['className', 'section'] as const) {
    const filterValue = value.filters[field]
    if (filterValue === undefined) continue
    if (!isSafeFilter(filterValue, 80)) return null
    filters[field] = filterValue.trim().replace(/\s+/g, ' ')
  }

  return { module: 'attendance', operation: 'summary', filters }
}

export function parseAttendanceSearchQueryPlan(value: unknown): AttendanceSearchQueryPlan | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['module', 'operation', 'filters', 'page'])) return null
  if (value.module !== 'attendance' || value.operation !== 'search') return null
  if (!isRecord(value.filters) || !hasOnlyKeys(value.filters, [...allowedAttendanceSearchFilterFields])) return null
  if (!isValidDate(value.filters.date)) return null

  const status = value.filters.status
  if (typeof status !== 'string' || !['PRESENT', 'ABSENT', 'LATE'].includes(status.toUpperCase())) return null
  const filters: AttendanceSearchQueryPlan['filters'] = {
    date: value.filters.date,
    status: status.toUpperCase() as AttendanceSearchQueryPlan['filters']['status'],
  }
  for (const field of ['className', 'section'] as const) {
    const filterValue = value.filters[field]
    if (filterValue === undefined) continue
    if (!isSafeFilter(filterValue, 80)) return null
    filters[field] = filterValue.trim().replace(/\s+/g, ' ')
  }

  const page = value.page === undefined ? 1 : value.page
  if (!Number.isSafeInteger(page) || (page as number) < 1 || (page as number) > 10_000) return null
  return { module: 'attendance', operation: 'search', filters, page: page as number }
}

export function parseAttendanceQueryPlan(value: unknown): AttendanceQueryPlan | null {
  if (!isRecord(value)) return null
  if (value.operation === 'summary') return parseAttendanceSummaryQueryPlan(value)
  if (value.operation === 'search') return parseAttendanceSearchQueryPlan(value)
  return null
}

export function parseFeeSummaryQueryPlan(value: unknown): FeeSummaryQueryPlan | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['module', 'operation', 'filters'])) return null
  if (value.module !== 'fees' || value.operation !== 'summary') return null
  if (!isRecord(value.filters) || !hasOnlyKeys(value.filters, [...allowedFeeFilterFields])) return null

  const metric = value.filters.metric
  const allowedMetrics: readonly FeeSummaryMetric[] = [
    'outstanding_amount',
    'collected_amount',
    'overdue_amount',
    'outstanding_invoice_count',
    'overdue_invoice_count',
    'outstanding_student_count',
  ]
  if (typeof metric !== 'string' || !allowedMetrics.includes(metric as FeeSummaryMetric)) return null

  const filters: FeeSummaryQueryPlan['filters'] = { metric: metric as FeeSummaryMetric }
  for (const field of ['className', 'section'] as const) {
    const filterValue = value.filters[field]
    if (filterValue === undefined) continue
    if (!isSafeFilter(filterValue, 80)) return null
    filters[field] = filterValue.trim().replace(/\s+/g, ' ')
  }
  return { module: 'fees', operation: 'summary', filters }
}

export function parseFeeSummaryResult(value: unknown): FeeSummaryResult | null {
  const amountFields = ['outstandingAmount', 'collectedAmount', 'overdueAmount'] as const
  const countFields = [
    'outstandingInvoiceCount',
    'overdueInvoiceCount',
    'outstandingStudentCount',
    'invoiceCount',
  ] as const
  if (!isRecord(value) || !hasOnlyKeys(value, [...amountFields, ...countFields])) return null
  for (const field of amountFields) {
    if (typeof value[field] !== 'string' || !/^\d{1,28}\.\d{2}$/.test(value[field])) return null
  }
  for (const field of countFields) {
    if (typeof value[field] !== 'number' || !Number.isSafeInteger(value[field]) || value[field] < 0) {
      return null
    }
  }
  const result = value as FeeSummaryResult
  if (
    result.overdueInvoiceCount > result.outstandingInvoiceCount ||
    result.outstandingInvoiceCount > result.invoiceCount ||
    result.outstandingStudentCount > result.outstandingInvoiceCount
  ) return null
  return result
}

export function parseDashboardSummaryQueryPlan(value: unknown): DashboardSummaryQueryPlan | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['module', 'operation', 'filters'])) return null
  if (value.module !== 'dashboard' || value.operation !== 'summary') return null
  if (!isRecord(value.filters) || !hasOnlyKeys(value.filters, [...allowedDashboardFilterFields])) return null
  const focus = value.filters.focus
  if (focus !== 'students' && focus !== 'attendance' && focus !== 'overview') return null
  return { module: 'dashboard', operation: 'summary', filters: { focus } }
}

export function parseDashboardStudentSummaryResult(value: unknown): DashboardStudentSummaryResult | null {
  const resultFields = ['activeStudentCount', 'classCounts', 'sectionCounts', 'campusCounts', 'genderCounts']
  if (!isRecord(value) || !hasOnlyKeys(value, resultFields)) return null
  if (!Number.isSafeInteger(value.activeStudentCount) || (value.activeStudentCount as number) < 0) return null

  const parseCounts = (
    rows: unknown,
    fields: readonly string[],
    maxRows: number,
  ): Array<Record<string, unknown>> | null => {
    if (!Array.isArray(rows) || rows.length > maxRows) return null
    const parsed: Array<Record<string, unknown>> = []
    for (const row of rows) {
      if (!isRecord(row) || !hasOnlyKeys(row, fields)) return null
      if (!Number.isSafeInteger(row.studentCount) || (row.studentCount as number) < 0) return null
      parsed.push(row)
    }
    return parsed
  }

  const classCounts = parseCounts(value.classCounts, ['className', 'studentCount'], 1_000)
  const sectionCounts = parseCounts(value.sectionCounts, ['className', 'section', 'campusId', 'studentCount'], 10_000)
  const campusCounts = parseCounts(value.campusCounts, ['campusId', 'studentCount'], 500)
  const genderCounts = parseCounts(value.genderCounts, ['gender', 'studentCount'], 20)
  if (!classCounts || !sectionCounts || !campusCounts || !genderCounts) return null

  const isNullableLabel = (label: unknown): label is string | null =>
    label === null || (typeof label === 'string' && label.length <= 120)
  if (classCounts.some((row) => !isNullableLabel(row.className)) ||
    sectionCounts.some((row) =>
      !isNullableLabel(row.className) ||
      !isNullableLabel(row.section) ||
      typeof row.campusId !== 'string' ||
      row.campusId.length > 64
    ) ||
    campusCounts.some((row) => typeof row.campusId !== 'string' || row.campusId.length > 64) ||
    genderCounts.some((row) => typeof row.gender !== 'string' || row.gender.length > 40)) {
    return null
  }

  const activeStudentCount = value.activeStudentCount as number
  if (
    classCounts.reduce((sum, row) => sum + (row.studentCount as number), 0) !== activeStudentCount ||
    sectionCounts.reduce((sum, row) => sum + (row.studentCount as number), 0) !== activeStudentCount ||
    campusCounts.reduce((sum, row) => sum + (row.studentCount as number), 0) !== activeStudentCount ||
    genderCounts.reduce((sum, row) => sum + (row.studentCount as number), 0) !== activeStudentCount
  ) return null

  return {
    activeStudentCount,
    classCounts: classCounts as DashboardStudentSummaryResult['classCounts'],
    sectionCounts: sectionCounts as DashboardStudentSummaryResult['sectionCounts'],
    campusCounts: campusCounts as DashboardStudentSummaryResult['campusCounts'],
    genderCounts: genderCounts as DashboardStudentSummaryResult['genderCounts'],
  }
}

export function parseAttendanceSummaryResult(value: unknown): AttendanceSummaryResult | null {
  const fields: readonly (keyof AttendanceSummaryResult)[] = [
    'sessionCount',
    'eligibleCount',
    'recordedCount',
    'unmarkedCount',
    'presentCount',
    'absentCount',
    'lateCount',
  ]
  if (!isRecord(value) || !hasOnlyKeys(value, fields)) return null
  for (const field of fields) {
    if (typeof value[field] !== 'number' || !Number.isSafeInteger(value[field]) || value[field] < 0) {
      return null
    }
  }

  const result = value as AttendanceSummaryResult
  if (
    result.recordedCount > result.eligibleCount ||
    result.unmarkedCount !== result.eligibleCount - result.recordedCount ||
    result.presentCount + result.absentCount + result.lateCount !== result.recordedCount
  ) return null

  return result
}

export function parseAttendanceSearchResult(value: unknown): AttendanceSearchResult | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['total', 'page', 'pageSize', 'rows'])) return null
  if (!Number.isSafeInteger(value.total) || (value.total as number) < 0) return null
  if (!Number.isSafeInteger(value.page) || (value.page as number) < 1) return null
  if (value.pageSize !== 50 || !Array.isArray(value.rows) || value.rows.length > 50) return null

  const rows: AttendanceSearchResult['rows'] = []
  for (const row of value.rows) {
    if (!isRecord(row) ||
      !hasOnlyKeys(row, ['studentName', 'className', 'section', 'status']) ||
      typeof row.studentName !== 'string' ||
      !row.studentName.trim() ||
      row.studentName.length > 160 ||
      typeof row.className !== 'string' ||
      row.className.length > 80 ||
      typeof row.section !== 'string' ||
      row.section.length > 80 ||
      typeof row.status !== 'string' ||
      !['PRESENT', 'ABSENT', 'LATE'].includes(row.status)) {
      return null
    }
    rows.push({
      studentName: row.studentName,
      className: row.className,
      section: row.section,
      status: row.status as AttendanceSearchResult['rows'][number]['status'],
    })
  }
  if (rows.length > (value.total as number)) return null

  return {
    total: value.total as number,
    page: value.page as number,
    pageSize: 50,
    rows,
  }
}

export function parseStructuredQueryPlan(value: unknown): StudentQueryPlan | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['module', 'operation', 'filters', 'page', 'sort'])) return null
  if (value.module !== 'students' || (value.operation !== 'count' && value.operation !== 'search')) return null
  if (!isRecord(value.filters) || !hasOnlyKeys(value.filters, [...allowedFilterFields])) return null

  const filters: StudentQueryPlan['filters'] = {}
  for (const [field, filterValue] of Object.entries(value.filters)) {
    const maxLength = field === 'studentCode' ? 100 : 80
    if (!allowedFilterFields.has(field) || !isSafeFilter(filterValue, maxLength)) return null
    if (field === 'status' && !['ACTIVE', 'INACTIVE', 'ALUMNI'].includes(filterValue.trim().toUpperCase())) {
      return null
    }
    filters[field as StudentFilterField] = field === 'status'
      ? filterValue.trim().toUpperCase()
      : filterValue.trim().replace(/\s+/g, ' ')
  }

  const page = value.page === undefined ? 1 : value.page
  if (!Number.isSafeInteger(page) || (page as number) < 1 || (page as number) > 1000) return null

  let sort: StudentQueryPlan['sort'] = null
  if (value.sort !== undefined && value.sort !== null) {
    if (!isRecord(value.sort) || !hasOnlyKeys(value.sort, ['field', 'direction'])) return null
    if (
      typeof value.sort.field !== 'string' ||
      !allowedSortFields.has(value.sort.field as StudentSortField) ||
      (value.sort.direction !== 'asc' && value.sort.direction !== 'desc')
    ) return null
    sort = {
      field: value.sort.field as StudentSortField,
      direction: value.sort.direction,
    }
  }

  if (value.operation === 'count' && (page !== 1 || sort !== null)) return null
  return {
    module: 'students',
    operation: value.operation,
    filters,
    page: page as number,
    sort: value.operation === 'search'
      ? sort ?? { field: 'name', direction: 'asc' }
      : null,
  }
}


export function parseCommunicationSummaryQueryPlan(value: unknown): CommunicationSummaryQueryPlan | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['module', 'operation', 'filters'])) return null
  if (value.module !== 'communication' || value.operation !== 'summary') return null
  if (!isRecord(value.filters)) return null
  const status = value.filters.status
  const allowed = ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'ALL']
  if (status !== undefined && (typeof status !== 'string' || !allowed.includes(status.toUpperCase()))) return null
  return {
    module: 'communication',
    operation: 'summary',
    filters: { status: status ? (status.toUpperCase() as CommunicationSummaryQueryPlan['filters']['status']) : 'ALL' },
  }
}

export function parseAlertsSummaryQueryPlan(value: unknown): AlertsSummaryQueryPlan | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['module', 'operation', 'filters'])) return null
  if (value.module !== 'alerts' || value.operation !== 'summary') return null
  if (!isRecord(value.filters)) return null
  const filters: AlertsSummaryQueryPlan['filters'] = {}
  if (value.filters.sourceType !== undefined) {
    if (!isSafeFilter(value.filters.sourceType, 80)) return null
    filters.sourceType = value.filters.sourceType.trim()
  }
  if (value.filters.className !== undefined) {
    if (!isSafeFilter(value.filters.className, 80)) return null
    filters.className = value.filters.className.trim()
  }
  if (value.filters.section !== undefined) {
    if (!isSafeFilter(value.filters.section, 80)) return null
    filters.section = value.filters.section.trim()
  }
  return { module: 'alerts', operation: 'summary', filters }
}

export function parseAdmissionsSummaryQueryPlan(value: unknown): AdmissionsSummaryQueryPlan | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['module', 'operation', 'filters'])) return null
  if (value.module !== 'admissions' || value.operation !== 'summary') return null
  if (!isRecord(value.filters)) return null
  const status = value.filters.status
  const allowed = ['PENDING', 'APPROVED', 'REJECTED', 'ALL']
  if (status !== undefined && (typeof status !== 'string' || !allowed.includes(status.toUpperCase()))) return null
  return {
    module: 'admissions',
    operation: 'summary',
    filters: { status: status ? (status.toUpperCase() as AdmissionsSummaryQueryPlan['filters']['status']) : 'ALL' },
  }
}

export function parseTrashSummaryQueryPlan(value: unknown): TrashSummaryQueryPlan | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['module', 'operation', 'filters'])) return null
  if (value.module !== 'trash' || value.operation !== 'summary') return null
  if (!isRecord(value.filters)) return null
  const recordType = value.filters.recordType
  const allowed = ['STUDENT', 'GUARDIAN', 'COMMUNICATION', 'ATTENDANCE', 'ALL']
  if (recordType !== undefined && (typeof recordType !== 'string' || !allowed.includes(recordType.toUpperCase()))) return null
  return {
    module: 'trash',
    operation: 'summary',
    filters: { recordType: recordType ? (recordType.toUpperCase() as TrashSummaryQueryPlan['filters']['recordType']) : 'ALL' },
  }
}

export function parseSchoolSummaryQueryPlan(value: unknown): SchoolSummaryQueryPlan | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['module', 'operation', 'filters'])) return null
  if (value.module !== 'school' || value.operation !== 'summary') return null
  if (!isRecord(value.filters)) return null
  const focus = value.filters.focus
  const allowed = ['overview', 'campuses', 'contact', 'academic_year', 'timezone']
  if (focus !== undefined && (typeof focus !== 'string' || !allowed.includes(focus.toLowerCase()))) return null
  return {
    module: 'school',
    operation: 'summary',
    filters: { focus: focus ? (focus.toLowerCase() as SchoolSummaryQueryPlan['filters']['focus']) : 'overview' },
  }
}
