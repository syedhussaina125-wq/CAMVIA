import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { mapConcurrent } from './mapConcurrent'
import { mutationConfirmationError, runMutation, verifyMutationSession } from './mutations'
import type { NewStudent, Student } from '../studentData'
import {
  evaluateCsvDuplicates,
  type CsvSkippedRow,
  type StudentCandidate,
} from '../utils/studentDuplicates'

const client = supabase as any
const pageSize = 1000
const relationBatchSize = 100

type StudentRow = {
  id: string
  student_code: string
  first_name: string
  last_name: string
  class_name: string
  section: string
  roll_number: string | null
  date_of_birth: string | null
  gender: string | null
  status: string
  organization_id: string
  school_id: string
  campus_id: string
}

type SchoolRow = {
  id: string
  name: string
}

type CampusRow = {
  id: string
  name: string
}

type GuardianRow = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  email: string | null
}

type StudentGuardianRow = {
  student_id: string
  guardian_id: string
  relationship: string | null
  is_primary: boolean
}

export type TeacherAssignment = {
  id: string
  user_id: string
  school_id: string
  campus_id: string
  class_name: string
  section: string
  active: boolean
}

export type StudentCampusOption = Pick<CampusRow, 'id' | 'name'>

export type StudentCreationOptions = {
  campuses: StudentCampusOption[]
  teacherScopes: TeacherAssignment[]
}

function requireSupabase() {
  if (!isSupabaseConfigured || !client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  return client
}

function mapStudent(
  row: StudentRow,
  guardian: GuardianRow | undefined,
  relationship: string | null,
  schoolName: string,
  campusName: string,
): Student {
  return {
    id: row.id,
    studentId: row.student_code,
    firstName: row.first_name,
    lastName: row.last_name,
    className: row.class_name,
    section: row.section,
    rollNumber: row.roll_number ?? '',
    dateOfBirth: row.date_of_birth ?? '',
    gender: row.gender ?? '',
    school: schoolName,
    organizationId: row.organization_id,
    schoolId: row.school_id,
    campusId: row.campus_id,
    status: row.status.toUpperCase() === 'ACTIVE'
      ? 'Active'
      : row.status.toUpperCase() === 'ARCHIVED'
        ? 'Archived'
        : 'Inactive',
    campus: campusName,
    guardian: {
      id: guardian?.id,
      name: guardian ? `${guardian.first_name} ${guardian.last_name}`.trim() : '',
      phone: guardian?.phone ?? '',
      email: guardian?.email ?? '',
      relationship: relationship ?? undefined,
    },
    activity: [],
  }
}

const schoolNameCache = new Map<string, string>()
const campusNameCache = new Map<string, string>()

async function mapRows(rows: StudentRow[]): Promise<Student[]> {
  if (rows.length === 0) return []
  const db = requireSupabase()
  const studentIds = rows.map((row) => row.id)
  const uncachedSchoolIds = [...new Set(rows.map((row) => row.school_id))].filter((id) => !schoolNameCache.has(id))
  const uncachedCampusIds = [...new Set(rows.map((row) => row.campus_id))].filter((id) => !campusNameCache.has(id))

  const [linksResult, schoolsResult, campusesResult] = await Promise.all([
    db.from('student_guardians')
      .select('student_id, guardian_id, relationship, is_primary')
      .in('student_id', studentIds),
    uncachedSchoolIds.length
      ? db.from('schools').select('id, name').in('id', uncachedSchoolIds)
      : Promise.resolve({ data: [], error: null }),
    uncachedCampusIds.length
      ? db.from('campuses').select('id, name').in('id', uncachedCampusIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (linksResult.error) throw linksResult.error
  if (schoolsResult.error) throw schoolsResult.error
  if (campusesResult.error) throw campusesResult.error

  for (const school of (schoolsResult.data ?? []) as SchoolRow[]) {
    schoolNameCache.set(school.id, school.name)
  }
  for (const campus of (campusesResult.data ?? []) as CampusRow[]) {
    campusNameCache.set(campus.id, campus.name)
  }

  const links = (linksResult.data ?? []) as StudentGuardianRow[]
  const linkedGuardianIds = [...new Set(links.map((link) => link.guardian_id))]

  let guardians: GuardianRow[] = []
  if (linkedGuardianIds.length > 0) {
    const guardianIdBatches = Array.from({ length: Math.ceil(linkedGuardianIds.length / relationBatchSize) }, (_, index) =>
      linkedGuardianIds.slice(index * relationBatchSize, (index + 1) * relationBatchSize),
    )
    const guardianResults = await mapConcurrent(guardianIdBatches, async (ids) => {
      const { data, error } = await db
        .from('guardians')
        .select('id, first_name, last_name, phone, email')
        .in('id', ids)
        .is('deleted_at', null)
        .is('archived_at', null)
      if (error) throw error
      return (data ?? []) as GuardianRow[]
    })
    guardians = guardianResults.flat()
  }

  const guardianById = new Map<string, GuardianRow>(
    guardians.map((guardian) => [guardian.id, guardian]),
  )
  const primaryGuardianByStudent = new Map<string, { guardian: GuardianRow; relationship: string | null }>()
  for (const link of links) {
    const guardian = guardianById.get(link.guardian_id)
    if (guardian && (link.is_primary || !primaryGuardianByStudent.has(link.student_id))) {
      primaryGuardianByStudent.set(link.student_id, { guardian, relationship: link.relationship })
    }
  }

  return rows.map((row) => {
    const primary = primaryGuardianByStudent.get(row.id)
    return mapStudent(
      row,
      primary?.guardian,
      primary?.relationship ?? null,
      schoolNameCache.get(row.school_id) ?? '',
      campusNameCache.get(row.campus_id) ?? '',
    )
  })
}

export async function fetchStudents(): Promise<Student[]> {
  const db = requireSupabase()
  const rows: StudentRow[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from('students')
      .select('id, student_code, first_name, last_name, class_name, section, roll_number, date_of_birth, gender, status, organization_id, school_id, campus_id')
      .is('deleted_at', null)
      .is('archived_at', null)
      .neq('status', 'ARCHIVED')
      .order('last_name')
      .order('first_name')
      .order('id')
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    const page = (data ?? []) as StudentRow[]
    rows.push(...page)
    if (page.length < pageSize) break
  }

  const rowBatches: StudentRow[][] = []
  for (let start = 0; start < rows.length; start += relationBatchSize) {
    rowBatches.push(rows.slice(start, start + relationBatchSize))
  }
  const mappedBatches = await mapConcurrent(rowBatches, mapRows)
  return mappedBatches.flat()
}

export async function fetchStudentById(studentUuid: string): Promise<Student | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentUuid)) {
    return null
  }

  const db = requireSupabase()
  const { data, error } = await db
    .from('students')
    .select('id, student_code, first_name, last_name, class_name, section, roll_number, date_of_birth, gender, status, organization_id, school_id, campus_id')
    .eq('id', studentUuid)
    .is('deleted_at', null)
    .is('archived_at', null)
    .neq('status', 'ARCHIVED')
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  const [student] = await mapRows([data as StudentRow])
  return student ?? null
}

export async function fetchTeacherAssignments(): Promise<TeacherAssignment[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('teacher_class_assignments')
    .select('id, user_id, school_id, campus_id, class_name, section, active')
    .order('class_name')
    .order('section')

  if (error) throw error
  return (data ?? []) as TeacherAssignment[]
}

export async function fetchStudentCreationOptions(
  role: 'admin' | 'teacher',
  schoolId: string | null,
  organizationId: string | null,
  assignments: TeacherAssignment[],
): Promise<StudentCreationOptions> {
  if (!schoolId || !organizationId) {
    throw new Error('Your account is not assigned to a school.')
  }

  const db = requireSupabase()
  const { data, error } = await db
    .from('campuses')
    .select('id, name, status')
    .eq('school_id', schoolId)
    .eq('organization_id', organizationId)
    .eq('status', 'ACTIVE')
    .order('name')

  if (error) throw error

  const schoolCampuses = (data ?? []) as Array<CampusRow & { status: string }>
  if (role === 'admin') {
    return { campuses: schoolCampuses, teacherScopes: [] }
  }

  const teacherScopes = assignments.filter((assignment) => assignment.active && assignment.school_id === schoolId)
  const allowedCampusIds = new Set(teacherScopes.map((assignment) => assignment.campus_id))
  return {
    campuses: schoolCampuses.filter((campus) => allowedCampusIds.has(campus.id)),
    teacherScopes,
  }
}

export async function createStudentRecord(
  student: NewStudent,
  campusId: string,
): Promise<Student> {
  const db = requireSupabase()
  const guardianName = student.guardian.name.trim().split(/\s+/)
  const hasGuardian = Boolean(student.guardian.name.trim() || student.guardian.phone.trim() || student.guardian.email.trim())
  if (hasGuardian && !student.guardian.name.trim()) {
    throw new Error('Enter the guardian name when adding guardian contact details.')
  }
  const data = await runMutation('create_student', student.studentId, () => db.rpc('create_student', {
    target_campus_id: campusId,
    target_student_code: student.studentId.trim(),
    target_first_name: student.firstName.trim(),
    target_last_name: student.lastName.trim(),
    target_class_name: student.className.trim(),
    target_section: student.section.trim(),
    target_roll_number: student.rollNumber.trim() || null,
    target_date_of_birth: student.dateOfBirth || null,
    target_gender: student.gender || null,
    target_guardian_first_name: hasGuardian ? guardianName[0] : null,
    target_guardian_last_name: hasGuardian ? guardianName.slice(1).join(' ') || guardianName[0] : null,
    target_guardian_phone: student.guardian.phone.trim() || null,
    target_guardian_email: student.guardian.email.trim() || null,
    target_guardian_relationship: student.guardian.relationship?.trim() || null,
  }))

  if (typeof data !== 'string') throw new Error('Student creation did not return a valid student ID.')

  const created = await fetchStudentById(data)
  if (!created) throw new Error('Student was created, but could not be loaded in your authorized scope.')
  return created
}

export async function fetchSchoolStudentsForDuplicateCheck(): Promise<StudentCandidate[]> {
  if (!isSupabaseConfigured || !client) return []
  try {
    const { data, error } = await client
      .from('students')
      .select('id, student_code, first_name, last_name, class_name, section, roll_number, date_of_birth')
    if (error) {
      console.warn('[Supabase] Failed to fetch school students for duplicate check:', error.message)
      return []
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: typeof row.id === 'string' ? row.id : undefined,
      studentId: typeof row.student_code === 'string' ? row.student_code : '',
      firstName: typeof row.first_name === 'string' ? row.first_name : '',
      lastName: typeof row.last_name === 'string' ? row.last_name : '',
      className: typeof row.class_name === 'string' ? row.class_name : '',
      section: typeof row.section === 'string' ? row.section : '',
      rollNumber: typeof row.roll_number === 'string' ? row.roll_number : '',
      dateOfBirth: typeof row.date_of_birth === 'string' ? row.date_of_birth : '',
    }))
  } catch (error) {
    console.warn('[Supabase] Error fetching school students for duplicate check:', error)
    return []
  }
}

export type ImportBatchSummary = {
  totalParsedRows: number
  validRows: number
  rejectedRows: number
  selectedCampus: string
  createdCount: number
  firstSupabaseError: {
    code?: string
    message: string
    details?: unknown
    hint?: unknown
  } | null
  skippedDetails: CsvSkippedRow[]
}

export async function importStudentsBatch(
  students: NewStudent[],
  campusId: string,
): Promise<ImportBatchSummary> {
  if (!campusId || typeof campusId !== 'string') {
    throw new Error('A valid campus must be selected before importing students.')
  }
  if (!Array.isArray(students) || students.length === 0) {
    throw new Error('No students provided for import.')
  }
  const MAX_IMPORT_ROWS = 500
  if (students.length > MAX_IMPORT_ROWS) {
    throw new Error(`The import contains ${students.length} students, which exceeds the maximum limit of ${MAX_IMPORT_ROWS} students per import.`)
  }

  // Verify active session & role permission before mutating database
  await verifyMutationSession('import_students', campusId)
  const db = requireSupabase()
  const totalParsedRows = students.length

  // Pre-validate for duplicates against existing school records (active + trashed) and intra-CSV
  const existingRecords = await fetchSchoolStudentsForDuplicateCheck()
  const { validRows: nonDuplicateStudents, skippedRows } = evaluateCsvDuplicates(students, existingRecords)

  let firstSupabaseError: {
    code?: string
    message: string
    details?: unknown
    hint?: unknown
  } | null = null

  if (skippedRows.length > 0) {
    firstSupabaseError = {
      code: '23505',
      message: skippedRows[0].reason,
    }
  }

  // Process valid non-duplicate rows with controlled concurrency (4 parallel RPC requests)
  const results = await mapConcurrent(nonDuplicateStudents, async (student) => {
    const guardianName = student.guardian.name.trim().split(/\s+/)
    const hasGuardian = Boolean(student.guardian.name.trim() || student.guardian.phone.trim() || student.guardian.email.trim())

    const { error } = await db.rpc('create_student', {
      target_campus_id: campusId,
      target_student_code: student.studentId.trim(),
      target_first_name: student.firstName.trim(),
      target_last_name: student.lastName.trim(),
      target_class_name: student.className.trim(),
      target_section: student.section.trim(),
      target_roll_number: student.rollNumber.trim() || null,
      target_date_of_birth: student.dateOfBirth || null,
      target_gender: student.gender || null,
      target_guardian_first_name: hasGuardian ? guardianName[0] : null,
      target_guardian_last_name: hasGuardian ? (guardianName.slice(1).join(' ') || guardianName[0]) : null,
      target_guardian_phone: student.guardian.phone.trim() || null,
      target_guardian_email: student.guardian.email.trim() || null,
      target_guardian_relationship: student.guardian.relationship?.trim() || null,
    })

    if (error) {
      return {
        success: false as const,
        student,
        error: {
          code: typeof error.code === 'string' ? error.code : undefined,
          message: error.message || 'Unknown database error',
          details: error.details,
          hint: error.hint,
        },
      }
    }
    return { success: true as const, student }
  }, 4)

  const createdCount = results.filter((r) => r.success).length
  const failedRpcResults = results.filter((r) => !r.success)

  if (failedRpcResults.length > 0 && failedRpcResults[0].error) {
    firstSupabaseError = failedRpcResults[0].error
  }

  const allSkipped: CsvSkippedRow[] = [
    ...skippedRows,
    ...failedRpcResults.map((r, i) => ({
      rowNumber: totalParsedRows - failedRpcResults.length + i + 1,
      student: r.student,
      reason: r.error.message,
      rule: 'identity' as const,
    })),
  ]

  const rejectedRows = totalParsedRows - createdCount
  const validRows = createdCount

  console.log('[Student Import] Summary:', {
    totalParsedRows,
    validRows,
    rejectedRows,
    selectedCampus: campusId,
    firstSupabaseError,
  })

  if (firstSupabaseError) {
    console.error('[Supabase] First import error details:', {
      code: firstSupabaseError.code,
      message: firstSupabaseError.message,
      details: firstSupabaseError.details,
      hint: firstSupabaseError.hint,
    })
  }

  if (createdCount === 0 && rejectedRows > 0) {
    const detail = firstSupabaseError?.message ? `: ${firstSupabaseError.message}` : ''
    throw new Error(`Import failed${detail}`)
  }

  return {
    totalParsedRows,
    validRows,
    rejectedRows,
    selectedCampus: campusId,
    createdCount,
    firstSupabaseError,
    skippedDetails: allSkipped,
  }
}

export async function updateStudent(payload: {
  studentId: string
  campusId: string
  firstName: string
  lastName: string
  className: string
  section: string
  rollNumber: string
  dateOfBirth?: string | null
  gender?: string | null
  reason: string
}): Promise<Student> {
  const db = requireSupabase()
  await runMutation('update_student', payload.studentId, () => db.rpc('update_student', {
    p_student_id: payload.studentId,
    p_campus_id: payload.campusId,
    p_first_name: payload.firstName,
    p_last_name: payload.lastName,
    p_class_name: payload.className,
    p_section: payload.section,
    p_roll_number: payload.rollNumber || null,
    p_date_of_birth: payload.dateOfBirth || null,
    p_gender: payload.gender || null,
    p_reason: payload.reason,
  }), true)

  const updated = await fetchStudentById(payload.studentId)
  if (!updated) throw new Error('Student was updated, but could not be re-loaded.')
  return updated
}

export async function archiveStudent(studentId: string, reason: string): Promise<void> {
  const db = requireSupabase()
  const data = await runMutation<{ student_id: string; status: string }>('archive_student', studentId, () => db.rpc('archive_student', {
    p_student_id: studentId,
    p_reason: reason,
  }), true)
  if (!data || data.student_id !== studentId || data.status !== 'ARCHIVED') {
    throw mutationConfirmationError(
      'archive_student',
      studentId,
      'archive_student did not confirm the requested student was archived.',
    )
  }
}

export async function updateGuardian(payload: {
  guardianId: string
  firstName: string
  lastName: string
  phone?: string | null
  email?: string | null
  address?: string | null
  reason: string
}): Promise<void> {
  const db = requireSupabase()
  await runMutation('update_guardian', payload.guardianId, () => db.rpc('update_guardian', {
    p_guardian_id: payload.guardianId,
    p_first_name: payload.firstName,
    p_last_name: payload.lastName,
    p_phone: payload.phone || null,
    p_email: payload.email || null,
    p_address: payload.address || null,
    p_reason: payload.reason,
  }), true)
}

export async function linkStudentGuardian(payload: {
  studentId: string
  guardianId: string
  relationship: string
  isPrimary: boolean
  reason: string
}): Promise<void> {
  const db = requireSupabase()
  await runMutation('link_student_guardian', payload.studentId, () => db.rpc('link_student_guardian', {
    p_student_id: payload.studentId,
    p_guardian_id: payload.guardianId,
    p_relationship: payload.relationship || null,
    p_is_primary: payload.isPrimary,
    p_reason: payload.reason,
  }), true)
}

export async function unlinkStudentGuardian(payload: {
  studentId: string
  guardianId: string
  reason: string
}): Promise<void> {
  const db = requireSupabase()
  await runMutation('unlink_student_guardian', payload.studentId, () => db.rpc('unlink_student_guardian', {
    p_student_id: payload.studentId,
    p_guardian_id: payload.guardianId,
    p_reason: payload.reason,
  }), true)
}
