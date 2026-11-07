export type Role = 'admin' | 'principal' | 'finance' | 'teacher'
export type UserStatus = 'Active' | 'Inactive'

export type SchoolUser = {
  id: number
  authUserId?: string
  name: string
  email: string
  role: Role
  campus: string
  campusId?: string | null
  status: UserStatus
  lastLogin: string
  assignmentScopes?: Array<{
    campusId: string
    className: string
    section: string
    active: boolean
  }>
}

export type SessionUser = {
  id: number
  authUserId: string
  organizationId: string | null
  schoolId: string | null
  campusId: string | null
  name: string
  email: string
  role: Role
  schoolName: string
  campusName: string
  teacherAssignments: Array<{
    id: string
    user_id: string
    school_id: string
    campus_id: string
    class_name: string
    section: string
    active: boolean
  }>
}

export const initialUsers: SchoolUser[] = []
