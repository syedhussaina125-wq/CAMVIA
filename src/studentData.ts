import type { Role } from './mockData'

export type StudentStatus = 'Active' | 'Inactive' | 'Graduated' | 'Archived'

export type StudentActivity = {
  date: string
  title: string
  detail: string
}

export type Student = {
  id: string
  firstName: string
  lastName: string
  studentId: string
  className: string
  section: string
  rollNumber: string
  dateOfBirth: string
  gender: string
  school?: string
  organizationId?: string
  schoolId?: string
  campusId?: string
  guardian: {
    id?: string
    name: string
    phone: string
    email: string
    relationship?: string
  }
  status: StudentStatus
  campus: string
  activity: StudentActivity[]
}

export type NewStudent = Pick<
  Student,
  | 'firstName'
  | 'lastName'
  | 'studentId'
  | 'className'
  | 'section'
  | 'rollNumber'
  | 'dateOfBirth'
  | 'gender'
  | 'guardian'
>

export type StudentAccess = {
  role: Role
  email: string
  teacherAssignments?: Array<{
    campus_id: string
    class_name: string
    section: string
    active: boolean
  }>
}

export function isStudentAssignedToTeacher(student: Student, access: StudentAccess): boolean {
  if (access.teacherAssignments && access.teacherAssignments.length > 0) {
    return access.teacherAssignments.some(
      (assignment) =>
        assignment.active &&
        (!student.campusId || assignment.campus_id === student.campusId) &&
        assignment.class_name.toLowerCase() === student.className.toLowerCase() &&
        assignment.section.toLowerCase() === student.section.toLowerCase(),
    )
  }
  // When loaded from Supabase, students are already strictly scoped via Postgres RLS
  return true
}

export function getAccessibleStudents(students: Student[], access: StudentAccess): Student[] {
  if (access.role !== 'teacher') {
    return students
  }

  if (access.teacherAssignments && access.teacherAssignments.length > 0) {
    return students.filter((student) => isStudentAssignedToTeacher(student, access))
  }

  return students
}

export function canAccessStudent(student: Student, access: StudentAccess): boolean {
  if (access.role !== 'teacher') {
    return true
  }

  return isStudentAssignedToTeacher(student, access)
}

export function canViewStudentTab(role: Role, tab: 'Overview' | 'Attendance' | 'Fees' | 'Communication'): boolean {
  if (role === 'finance') {
    return tab === 'Overview' || tab === 'Fees'
  }

  if (role === 'teacher') {
    return tab !== 'Fees'
  }

  return true
}

export function createStudentRecord(student: NewStudent, id = `student-${student.studentId}`): Student {
  return {
    ...student,
    id,
    status: 'Active',
    campus: 'Main Campus',
    activity: [{ date: new Date().toISOString().slice(0, 10), title: 'Student added', detail: 'Student record created.' }],
  }
}
