import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { Student } from '../studentData'

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
