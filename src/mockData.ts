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

export const schoolName = 'Beaconhouse School'
export const campusName = 'Main Campus'

export const initialUsers: SchoolUser[] = [
  {
    id: 1,
    name: 'Sarah Ali',
    email: 'admin@beaconhouse.edu',
    role: 'admin',
    campus: campusName,
    status: 'Active',
    lastLogin: 'Today, 08:45 AM',
  },
  {
    id: 2,
    name: 'Hussain Ali',
    email: 'principal@beaconhouse.edu',
    role: 'principal',
    campus: campusName,
    status: 'Active',
    lastLogin: 'Today, 08:10 AM',
  },
  {
    id: 3,
    name: 'Ayesha Khan',
    email: 'finance@beaconhouse.edu',
    role: 'finance',
    campus: campusName,
    status: 'Active',
    lastLogin: 'Yesterday, 04:20 PM',
  },
  {
    id: 4,
    name: 'Usman Tariq',
    email: 'teacher@beaconhouse.edu',
    role: 'teacher',
    campus: campusName,
    status: 'Active',
    lastLogin: 'Today, 07:50 AM',
  },
]
