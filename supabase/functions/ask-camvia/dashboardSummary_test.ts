import {
  parseDashboardAttendanceSummary,
  parseDashboardStudentSummary,
  type DashboardAttendanceSummary,
  type DashboardStudentSummary,
} from '../../../src/services/dashboardSummaryContract.ts'
import { getGroupedAttendanceChartDataFromDailyCounts } from '../../../src/attendanceData.ts'

const campusId = '123e4567-e89b-12d3-a456-426614174000'

function summaryFixture(): DashboardStudentSummary {
  return {
    activeStudentCount: 3,
    classCounts: [
      { className: '1', studentCount: 2 },
      { className: '2', studentCount: 1 },
    ],
    sectionCounts: [
      { className: '1', section: 'A', campusId, studentCount: 2 },
      { className: '2', section: 'B', campusId, studentCount: 1 },
    ],
    campusCounts: [{ campusId, studentCount: 3 }],
    genderCounts: [
      { gender: 'Female', studentCount: 1 },
      { gender: 'Male', studentCount: 2 },
    ],
  }
}

Deno.test('accepts a complete aggregate dashboard summary', () => {
  const summary = summaryFixture()
  if (JSON.stringify(parseDashboardStudentSummary(summary)) !== JSON.stringify(summary)) {
    throw new Error('Valid dashboard summary was not preserved.')
  }
})

Deno.test('accepts an empty authorized student scope', () => {
  const summary = parseDashboardStudentSummary({
    activeStudentCount: 0,
    classCounts: [],
    sectionCounts: [],
    campusCounts: [],
    genderCounts: [],
  })
  if (summary.activeStudentCount !== 0 || summary.classCounts.length !== 0) {
    throw new Error('Empty dashboard summary was not preserved.')
  }
})

Deno.test('rejects invalid counts, campus IDs, and inconsistent totals', () => {
  const invalidSummaries = [
    { ...summaryFixture(), activeStudentCount: -1 },
    { ...summaryFixture(), sectionCounts: [{ className: '1', section: 'A', campusId: 'not-a-uuid', studentCount: 3 }] },
    { ...summaryFixture(), genderCounts: [{ gender: 'Female', studentCount: 2 }] },
  ]

  for (const summary of invalidSummaries) {
    let rejected = false
    try {
      parseDashboardStudentSummary(summary)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Invalid dashboard summary was accepted.')
  }
})

function attendanceSummaryFixture(): DashboardAttendanceSummary {
  return {
    classNames: ['Class 1'],
    dailyCounts: [
      { className: 'Class 1', date: '2024-01-08', present: 8, late: 0, absent: 2 },
      { className: 'Class 1', date: '2024-01-09', present: 1, late: 1, absent: 2 },
    ],
  }
}

Deno.test('accepts valid daily attendance aggregates and rejects invalid dates or duplicate rows', () => {
  const summary = attendanceSummaryFixture()
  if (JSON.stringify(parseDashboardAttendanceSummary(summary)) !== JSON.stringify(summary)) {
    throw new Error('Valid dashboard attendance summary was not preserved.')
  }

  const invalidSummaries = [
    { ...summary, dailyCounts: [{ ...summary.dailyCounts[0], date: '2024-02-31' }] },
    { ...summary, dailyCounts: [summary.dailyCounts[0], summary.dailyCounts[0]] },
    { ...summary, dailyCounts: [{ ...summary.dailyCounts[0], className: 'Class 9' }] },
  ]
  for (const invalid of invalidSummaries) {
    let rejected = false
    try {
      parseDashboardAttendanceSummary(invalid)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Invalid dashboard attendance summary was accepted.')
  }
})

Deno.test('builds weekly chart cells from database aggregates with existing rate semantics', () => {
  const summary = attendanceSummaryFixture()
  const chart = getGroupedAttendanceChartDataFromDailyCounts(
    summary.classNames,
    summary.dailyCounts,
    'weekly',
  )

  if (chart.buckets.length !== 2) throw new Error('Expected one chart bucket per recorded day.')
  if (chart.buckets[0].values['class 1']?.rate !== 80) {
    throw new Error('The first daily attendance rate was not preserved.')
  }
  if (chart.buckets[1].values['class 1']?.rate !== 50) {
    throw new Error('The second daily attendance rate was not preserved.')
  }
  if (chart.series[0]?.averageRate !== 71 || chart.averageRate !== 65) {
    throw new Error('Attendance average calculations do not match the existing chart semantics.')
  }
})
