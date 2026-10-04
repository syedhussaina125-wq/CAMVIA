import type { Role } from './mockData'

export type StudentStatus = 'Active' | 'Inactive' | 'Graduated'

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
}

function createFixture(
  id: string,
  firstName: string,
  lastName: string,
  studentId: string,
  className: string,
  section: string,
  rollNumber: string,
  guardianName: string,
): Student {
  return {
    id,
    firstName,
    lastName,
    studentId,
    className,
    section,
    rollNumber,
    dateOfBirth: '2013-04-18',
    gender: 'Female',
    guardian: {
      name: guardianName,
      phone: '+92 300 555 0101',
      email: `${guardianName.toLowerCase().replaceAll(' ', '.')}@example.com`,
    },
    status: 'Active',
    campus: 'Main Campus',
    activity: [
      { date: '2026-10-02', title: 'Guardian communication', detail: 'Attendance follow-up email was read.' },
    ],
  }
}

export const initialStudents: Student[] = [
  createFixture('student-1001', 'Ahmed', 'Khan', 'ST-2026-1001', 'Grade 8', 'A', '08', 'Imran Khan'),
  createFixture('student-1002', 'Sara', 'Ali', 'ST-2026-1002', 'Grade 9', 'B', '12', 'Nadia Ali'),
  createFixture('student-1003', 'Mariam', 'Ahmed', 'ST-2026-1003', 'Grade 8', 'A', '04', 'Faisal Ahmed'),
  createFixture('student-1004', 'Zain', 'Raza', 'ST-2026-1004', 'Grade 9', 'B', '16', 'Sana Raza'),
  createFixture('student-1005', 'Hiba', 'Malik', 'ST-2026-1005', 'Grade 7', 'A', '21', 'Omar Malik'),
  createFixture('student-1006', 'Rayyan', 'Shah', 'ST-2026-1006', 'Grade 6', 'C', '09', 'Amina Shah'),
]

const teacherClassAssignments: Record<string, string[]> = {
  'teacher@beaconhouse.edu': ['Grade 8|A', 'Grade 9|B'],
}

export function getAccessibleStudents(students: Student[], access: StudentAccess): Student[] {
  if (access.role !== 'teacher') {
    return students
  }

  return students.filter((student) => isStudentAssignedToTeacher(student, access.email))
}

export function canAccessStudent(student: Student, access: StudentAccess): boolean {
  if (access.role !== 'teacher') {
    return true
  }

  return isStudentAssignedToTeacher(student, access.email)
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

export function isStudentAssignedToTeacher(student: Student, email: string): boolean {
  const assignments = teacherClassAssignments[email.toLowerCase()] ?? []
  return assignments.includes(`${student.className}|${student.section}`)
}
