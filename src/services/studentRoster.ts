export type StudentRosterStatus = 'ACTIVE' | 'INACTIVE' | 'ALUMNI'
export type StudentRosterGender = 'Female' | 'Male' | 'Prefer not to say'
export type StudentRosterSortField = 'directory' | 'name' | 'studentId' | 'className' | 'section' | 'status'

export type StudentRosterQuery = {
  page: number
  pageSize: number
  search: string
  className: string
  section: string
  campusId: string
  gender: StudentRosterGender | ''
  status: StudentRosterStatus | ''
  sort: StudentRosterSortField
  direction: 'asc' | 'desc'
}

export type StudentRosterQueryInput = Partial<StudentRosterQuery>

export const defaultStudentRosterQuery: StudentRosterQuery = {
  page: 1,
  pageSize: 50,
  search: '',
  className: '',
  section: '',
  campusId: '',
  gender: '',
  status: '',
  sort: 'directory',
  direction: 'asc',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length <= maxLength
}

export function parseStudentRosterQuery(value: unknown): StudentRosterQuery | null {
  if (!isRecord(value)) return null
  const allowedKeys = ['page', 'pageSize', 'search', 'className', 'section', 'campusId', 'gender', 'status', 'sort', 'direction']
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) return null

  const page = value.page ?? defaultStudentRosterQuery.page
  const pageSize = value.pageSize ?? defaultStudentRosterQuery.pageSize
  const search = value.search ?? defaultStudentRosterQuery.search
  const className = value.className ?? defaultStudentRosterQuery.className
  const section = value.section ?? defaultStudentRosterQuery.section
  const campusId = value.campusId ?? defaultStudentRosterQuery.campusId
  const gender = value.gender ?? defaultStudentRosterQuery.gender
  const status = value.status ?? defaultStudentRosterQuery.status
  const sort = value.sort ?? defaultStudentRosterQuery.sort
  const direction = value.direction ?? defaultStudentRosterQuery.direction

  if (!Number.isSafeInteger(page) || (page as number) < 1 || (page as number) > 10000) return null
  if (!Number.isSafeInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 100) return null
  if (!isText(search, 120) || !isText(className, 100) || !isText(section, 100)) return null
  if (typeof campusId !== 'string' || (campusId !== '' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campusId))) return null
  if (gender !== '' && gender !== 'Female' && gender !== 'Male' && gender !== 'Prefer not to say') return null
  if (status !== '' && status !== 'ACTIVE' && status !== 'INACTIVE' && status !== 'ALUMNI') return null
  if (sort !== 'directory' && sort !== 'name' && sort !== 'studentId' && sort !== 'className' && sort !== 'section' && sort !== 'status') return null
  if (direction !== 'asc' && direction !== 'desc') return null

  return {
    page: page as number,
    pageSize: pageSize as number,
    search: search.trim(),
    className: className.trim(),
    section: section.trim(),
    campusId,
    gender,
    status,
    sort,
    direction,
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_"]/g, '\\$&')
}

export function buildStudentRosterSearchFilter(value: string): string {
  const search = value.trim()
  const pattern = (part: string) => `"%${escapeLikePattern(part)}%"`
  const filters = [
    `first_name.ilike.${pattern(search)}`,
    `last_name.ilike.${pattern(search)}`,
    `student_code.ilike.${pattern(search)}`,
    `class_name.ilike.${pattern(search)}`,
    `section.ilike.${pattern(search)}`,
    `roll_number.ilike.${pattern(search)}`,
  ]
  const words = search.split(/\s+/)
  if (words.length > 1) {
    const firstName = pattern(words[0])
    const lastName = pattern(words.slice(1).join(' '))
    const reverseFirstName = pattern(words.slice(1).join(' '))
    const reverseLastName = pattern(words[0])
    filters.push(
      `and(first_name.ilike.${firstName},last_name.ilike.${lastName})`,
      `and(first_name.ilike.${reverseFirstName},last_name.ilike.${reverseLastName})`,
    )
  }
  return filters.join(',')
}
