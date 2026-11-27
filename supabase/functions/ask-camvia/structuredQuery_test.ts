import {
  getStudentNameFilter,
  getStudentQueryIntent,
  getUnsupportedStudentQueryReason,
  isStudentCohortQuery,
  parseAttendanceQueryPlan,
  parseAttendanceSearchQueryPlan,
  parseAttendanceSearchResult,
  parseAttendanceSummaryQueryPlan,
  parseAttendanceSummaryResult,
  parseDashboardStudentSummaryResult,
  parseDashboardSummaryQueryPlan,
  parseFeeSummaryQueryPlan,
  parseFeeSummaryResult,
  parseStructuredQueryPlan,
  shouldPlanStudentQuery,
} from './structuredQuery.ts'

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`)
  }
}

Deno.test('accepts a bounded student count plan with name and class filters', () => {
  assertEquals(
    parseStructuredQueryPlan({
      module: 'students',
      operation: 'count',
      filters: { name: 'Huzaifa', className: '1' },
    }),
    {
      module: 'students',
      operation: 'count',
      filters: { name: 'Huzaifa', className: '1' },
      page: 1,
      sort: null,
    },
  )
})

Deno.test('builds safe single- and multi-part name filters', () => {
  assertEquals(
    getStudentNameFilter('Ahmed'),
    'first_name.ilike.%Ahmed%,last_name.ilike.%Ahmed%',
  )
  assertEquals(
    getStudentNameFilter('Ahmed Khan'),
    'and(first_name.ilike.%Ahmed%,last_name.ilike.%Khan%),and(first_name.ilike.%Khan%,last_name.ilike.%Ahmed%)',
  )
})

Deno.test('identifies unsupported relationship and admission-number filters explicitly', () => {
  assertEquals(
    getUnsupportedStudentQueryReason('Find Ali whose father’s name is Ahmed'),
    'father or mother name filters',
  )
  assertEquals(
    getUnsupportedStudentQueryReason('Find students by admission number A-100'),
    'admission-number filters',
  )
  assertEquals(
    getUnsupportedStudentQueryReason('Show students admitted last month'),
    'admission-date filters',
  )
  assertEquals(
    getUnsupportedStudentQueryReason('Show students without guardian contact numbers'),
    'guardian contact filters',
  )
  assertEquals(
    getUnsupportedStudentQueryReason('Which students have incomplete profiles?'),
    'profile-completeness filters',
  )
})

Deno.test('accepts schema-backed gender, status, campus and student-code filters', () => {
  const plan = parseStructuredQueryPlan({
    module: 'students',
    operation: 'search',
    filters: {
      gender: 'female',
      status: 'inactive',
      campusName: 'North Campus',
      studentCode: 'STU-100',
    },
  })
  assertEquals(plan?.filters, {
    gender: 'female',
    status: 'INACTIVE',
    campusName: 'North Campus',
    studentCode: 'STU-100',
  })
})

Deno.test('accepts bounded student search pagination and sorting', () => {
  assertEquals(
    parseStructuredQueryPlan({
      module: 'students',
      operation: 'search',
      filters: { className: '5', section: 'A' },
      page: 2,
      sort: { field: 'className', direction: 'desc' },
    }),
    {
      module: 'students',
      operation: 'search',
      filters: { className: '5', section: 'A' },
      page: 2,
      sort: { field: 'className', direction: 'desc' },
    },
  )
})

Deno.test('rejects unknown filters instead of silently ignoring them', () => {
  assertEquals(
    parseStructuredQueryPlan({
      module: 'students',
      operation: 'count',
      filters: { className: '1', guardianName: 'Ahmed' },
    }),
    null,
  )
  assertEquals(
    parseStructuredQueryPlan({
      module: 'students',
      operation: 'count',
      filters: { admissionNumber: 'A-100' },
    }),
    null,
  )
})

Deno.test('rejects unsafe filter syntax and out-of-range pages', () => {
  assertEquals(
    parseStructuredQueryPlan({
      module: 'students',
      operation: 'count',
      filters: { name: 'x),status.eq.ACTIVE' },
    }),
    null,
  )
  assertEquals(
    parseStructuredQueryPlan({
      module: 'students',
      operation: 'search',
      filters: {},
      page: 1001,
    }),
    null,
  )
})

Deno.test('rejects count plans that request paging or sorting', () => {
  assertEquals(
    parseStructuredQueryPlan({
      module: 'students',
      operation: 'count',
      filters: {},
      page: 2,
    }),
    null,
  )
})

Deno.test('routes named counts and student searches through the planner', () => {
  const originalQuestion = 'how many huzaifas is in claess one'
  assertEquals(getStudentQueryIntent(originalQuestion), 'count')
  assertEquals(shouldPlanStudentQuery(originalQuestion, null, false), true)
  assertEquals(shouldPlanStudentQuery('Show students named Ahmed', 'students', false), true)
  assertEquals(shouldPlanStudentQuery('How many students are in Class 1?', 'students', false), false)
})

Deno.test('keeps cohort guardian queries from becoming single-student lookups', () => {
  assertEquals(isStudentCohortQuery('Show students without guardian phone numbers'), true)
  assertEquals(
    shouldPlanStudentQuery('How many girls are in Class 1?', 'students', false),
    true,
  )
  assertEquals(
    shouldPlanStudentQuery('How many students in Class 1 with gender female?', 'students', false),
    true,
  )
})

Deno.test('accepts attendance summary plans with validated date and optional class filters', () => {
  assertEquals(
    parseAttendanceSummaryQueryPlan({
      module: 'attendance',
      operation: 'summary',
      filters: { date: '2026-11-26', className: 'Class 5', section: 'A' },
    }),
    {
      module: 'attendance',
      operation: 'summary',
      filters: { date: '2026-11-26', className: 'Class 5', section: 'A' },
    },
  )
})

Deno.test('rejects invalid dates, unknown attendance filters, and non-summary operations', () => {
  const invalidPlans = [
    { module: 'attendance', operation: 'summary', filters: { date: '2026-02-30' } },
    { module: 'attendance', operation: 'summary', filters: { date: '2026-11-26', campusId: 'untrusted' } },
    { module: 'attendance', operation: 'search', filters: { date: '2026-11-26' } },
    { module: 'attendance', operation: 'summary', filters: { date: '2026-11-26', section: 'A),status.eq.ABSENT' } },
  ]

  for (const plan of invalidPlans) {
    assertEquals(parseAttendanceSummaryQueryPlan(plan), null)
  }
})

Deno.test('validates attendance aggregate counts and rejects inconsistent totals', () => {
  const valid = {
    sessionCount: 2,
    eligibleCount: 100,
    recordedCount: 80,
    unmarkedCount: 20,
    presentCount: 70,
    absentCount: 5,
    lateCount: 5,
  }
  assertEquals(parseAttendanceSummaryResult(valid), valid)
  assertEquals(parseAttendanceSummaryResult({ ...valid, unmarkedCount: 19 }), null)
  assertEquals(parseAttendanceSummaryResult({ ...valid, absentCount: 25 }), null)
  assertEquals(parseAttendanceSummaryResult({ ...valid, extra: true }), null)
})

Deno.test('accepts bounded attendance search plans and rejects unsupported filters or pages', () => {
  assertEquals(
    parseAttendanceSearchQueryPlan({
      module: 'attendance',
      operation: 'search',
      filters: { date: '2026-11-25', status: 'absent', className: '5' },
      page: 2,
    }),
    {
      module: 'attendance',
      operation: 'search',
      filters: { date: '2026-11-25', status: 'ABSENT', className: '5' },
      page: 2,
    },
  )
  assertEquals(
    parseAttendanceQueryPlan({
      module: 'attendance',
      operation: 'search',
      filters: { date: '2026-11-25', status: 'ABSENT', studentId: 'untrusted' },
    }),
    null,
  )
  assertEquals(
    parseAttendanceQueryPlan({
      module: 'attendance',
      operation: 'search',
      filters: { date: '2026-11-25', status: 'ABSENT' },
      page: 10001,
    }),
    null,
  )
})

Deno.test('validates paginated attendance search results', () => {
  const valid = {
    total: 1,
    page: 1,
    pageSize: 50,
    rows: [{ studentName: 'Ahmed Ali', className: '5', section: 'A', status: 'ABSENT' }],
  }
  assertEquals(parseAttendanceSearchResult(valid), valid)
  assertEquals(parseAttendanceSearchResult({ ...valid, pageSize: 100 }), null)
  assertEquals(parseAttendanceSearchResult({
    ...valid,
    rows: [{ ...valid.rows[0], status: 'UNMARKED' }],
  }), null)
  assertEquals(parseAttendanceSearchResult({
    ...valid,
    rows: [{ ...valid.rows[0], guardianPhone: 'must not be returned' }],
  }), null)
})

Deno.test('accepts fee summary plans with allowlisted metrics and optional class filters', () => {
  assertEquals(
    parseFeeSummaryQueryPlan({
      module: 'fees',
      operation: 'summary',
      filters: { metric: 'overdue_amount', className: 'Class 5', section: 'A' },
    }),
    {
      module: 'fees',
      operation: 'summary',
      filters: { metric: 'overdue_amount', className: 'Class 5', section: 'A' },
    },
  )
})

Deno.test('rejects unsupported fee filters, operations, and unsafe filter syntax', () => {
  const invalidPlans = [
    { module: 'fees', operation: 'summary', filters: { metric: 'outstanding_amount', campusId: 'untrusted' } },
    { module: 'fees', operation: 'search', filters: { metric: 'outstanding_amount' } },
    { module: 'fees', operation: 'summary', filters: { metric: 'forecast' } },
    { module: 'fees', operation: 'summary', filters: { metric: 'outstanding_amount', section: 'A),true' } },
  ]

  for (const plan of invalidPlans) {
    assertEquals(parseFeeSummaryQueryPlan(plan), null)
  }
})

Deno.test('validates exact fee amount strings and consistent aggregate counts', () => {
  const valid = {
    outstandingAmount: '1250.50',
    collectedAmount: '2700.00',
    overdueAmount: '500.25',
    outstandingInvoiceCount: 3,
    overdueInvoiceCount: 1,
    outstandingStudentCount: 2,
    invoiceCount: 8,
  }
  assertEquals(parseFeeSummaryResult(valid), valid)
  assertEquals(parseFeeSummaryResult({ ...valid, outstandingAmount: 1250.5 }), null)
  assertEquals(parseFeeSummaryResult({ ...valid, overdueInvoiceCount: 4 }), null)
  assertEquals(parseFeeSummaryResult({ ...valid, extra: true }), null)
})

Deno.test('accepts dashboard summary plans for supported focus areas only', () => {
  assertEquals(
    parseDashboardSummaryQueryPlan({
      module: 'dashboard',
      operation: 'summary',
      filters: { focus: 'attendance' },
    }),
    {
      module: 'dashboard',
      operation: 'summary',
      filters: { focus: 'attendance' },
    },
  )
  assertEquals(parseDashboardSummaryQueryPlan({
    module: 'dashboard',
    operation: 'summary',
    filters: { focus: 'fees' },
  }), null)
  assertEquals(parseDashboardSummaryQueryPlan({
    module: 'dashboard',
    operation: 'summary',
    filters: { focus: 'students', schoolId: 'untrusted' },
  }), null)
})

Deno.test('validates dashboard aggregate shapes and group-count parity', () => {
  const valid = {
    activeStudentCount: 2,
    classCounts: [{ className: '1', studentCount: 2 }],
    sectionCounts: [{ className: '1', section: 'A', campusId: 'campus-1', studentCount: 2 }],
    campusCounts: [{ campusId: 'campus-1', studentCount: 2 }],
    genderCounts: [{ gender: 'Female', studentCount: 1 }, { gender: 'Male', studentCount: 1 }],
  }
  assertEquals(parseDashboardStudentSummaryResult(valid), valid)
  assertEquals(parseDashboardStudentSummaryResult({
    ...valid,
    campusCounts: [{ campusId: 'campus-1', studentCount: 1 }],
  }), null)
  assertEquals(parseDashboardStudentSummaryResult({
    ...valid,
    classCounts: [{ className: '1', studentCount: 2, extra: true }],
  }), null)
})
