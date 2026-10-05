import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { NewStudent, Student } from '../studentData'

const client = supabase as any

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
    status: row.status.toUpperCase() === 'ACTIVE' ? 'Active' : 'Inactive',
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

async function mapRows(rows: StudentRow[]): Promise<Student[]> {
  if (rows.length === 0) return []
  const db = requireSupabase()
  const studentIds = rows.map((row) => row.id)
  const schoolIds = [...new Set(rows.map((row) => row.school_id))]
  const campusIds = [...new Set(rows.map((row) => row.campus_id))]

  const [linksResult, guardiansResult, schoolsResult, campusesResult] = await Promise.all([
    db.from('student_guardians')
      .select('student_id, guardian_id, relationship, is_primary')
      .in('student_id', studentIds),
    db.from('guardians')
      .select('id, first_name, last_name, phone, email'),
    db.from('schools')
      .select('id, name')
      .in('id', schoolIds),
    db.from('campuses')
      .select('id, name')
      .in('id', campusIds),
  ])

  for (const result of [linksResult, guardiansResult, schoolsResult, campusesResult]) {
    if (result.error) throw result.error
  }

  const guardianById = new Map<string, GuardianRow>(
    (guardiansResult.data ?? []).map((guardian: GuardianRow) => [guardian.id, guardian]),
  )
  const primaryGuardianByStudent = new Map<string, { guardian: GuardianRow; relationship: string | null }>()
  for (const link of (linksResult.data ?? []) as StudentGuardianRow[]) {
    const guardian = guardianById.get(link.guardian_id)
    if (guardian && (link.is_primary || !primaryGuardianByStudent.has(link.student_id))) {
      primaryGuardianByStudent.set(link.student_id, { guardian, relationship: link.relationship })
    }
  }
  const schoolNameById = new Map<string, string>(
    (schoolsResult.data ?? []).map((school: SchoolRow) => [school.id, school.name]),
  )
  const campusNameById = new Map<string, string>(
    (campusesResult.data ?? []).map((campus: CampusRow) => [campus.id, campus.name]),
  )

  return rows.map((row) => {
    const primary = primaryGuardianByStudent.get(row.id)
    return mapStudent(
      row,
      primary?.guardian,
      primary?.relationship ?? null,
      schoolNameById.get(row.school_id) ?? '',
      campusNameById.get(row.campus_id) ?? '',
    )
  })
}

export async function fetchStudents(): Promise<Student[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('students')
    .select('id, student_code, first_name, last_name, class_name, section, roll_number, date_of_birth, gender, status, organization_id, school_id, campus_id')
    .order('last_name')
    .order('first_name')

  if (error) throw error
  return mapRows((data ?? []) as StudentRow[])
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
  const { data, error } = await db.rpc('create_student', {
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
  })

  if (error) throw error
  if (typeof data !== 'string') throw new Error('Student creation did not return a valid student ID.')

  const created = await fetchStudentById(data)
  if (!created) throw new Error('Student was created, but could not be loaded in your authorized scope.')
  return created
}
