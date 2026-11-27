import {
  buildStudentRosterSearchFilter,
  defaultStudentRosterQuery,
  parseStudentRosterQuery,
} from '../../../src/services/studentRoster.ts'

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`)
  }
}

Deno.test('parses default and bounded roster queries', () => {
  assertEquals(parseStudentRosterQuery({}), defaultStudentRosterQuery)
  assertEquals(
    parseStudentRosterQuery({ page: 2, pageSize: 25, className: 'Grade 5', status: 'ACTIVE' }),
    {
      ...defaultStudentRosterQuery,
      page: 2,
      pageSize: 25,
      className: 'Grade 5',
      campusId: '',
      gender: '',
      status: 'ACTIVE',
    },
  )
})

Deno.test('accepts combined campus, gender, status, and roster filters', () => {
  const query = parseStudentRosterQuery({
    campusId: '01234567-89ab-cdef-0123-456789abcdef',
    gender: 'Female',
    status: 'ALUMNI',
    className: 'Grade 5',
    section: 'A',
    search: 'Ahmed Ali',
    page: 3,
    pageSize: 25,
    sort: 'name',
    direction: 'desc',
  })
  assertEquals(query, {
    page: 3,
    pageSize: 25,
    search: 'Ahmed Ali',
    className: 'Grade 5',
    section: 'A',
    campusId: '01234567-89ab-cdef-0123-456789abcdef',
    gender: 'Female',
    status: 'ALUMNI',
    sort: 'name',
    direction: 'desc',
  })
})

Deno.test('rejects invalid limits, unsupported statuses, and unknown fields', () => {
  assertEquals(parseStudentRosterQuery({ pageSize: 101 }), null)
  assertEquals(parseStudentRosterQuery({ page: 0 }), null)
  assertEquals(parseStudentRosterQuery({ status: 'ARCHIVED' }), null)
  assertEquals(parseStudentRosterQuery({ gender: 'Other' }), null)
  assertEquals(parseStudentRosterQuery({ campusId: 'not-a-uuid' }), null)
  assertEquals(parseStudentRosterQuery({ campusId: 'untrusted-scope' }), null)
})

Deno.test('quotes search alternatives and escapes user-controlled LIKE syntax', () => {
  assertEquals(
    buildStudentRosterSearchFilter('A%,(B)\\_'),
    'first_name.ilike."%A\\%,(B)\\\\\\_%",last_name.ilike."%A\\%,(B)\\\\\\_%",student_code.ilike."%A\\%,(B)\\\\\\_%",class_name.ilike."%A\\%,(B)\\\\\\_%",section.ilike."%A\\%,(B)\\\\\\_%",roll_number.ilike."%A\\%,(B)\\\\\\_%"',
  )
})

Deno.test('matches full names across first and last name columns', () => {
  const filter = buildStudentRosterSearchFilter('Ahmed Ali')
  if (!filter.includes('and(first_name.ilike."%Ahmed%",last_name.ilike."%Ali%")')) {
    throw new Error('Full name search must match a name split across first and last name fields.')
  }
  if (!filter.includes('and(first_name.ilike."%Ali%",last_name.ilike."%Ahmed%")')) {
    throw new Error('Full name search must support reversed first and last name terms.')
  }
})
