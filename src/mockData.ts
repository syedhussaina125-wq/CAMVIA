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

export const initialUsers: SchoolUser[] = []

