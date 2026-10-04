import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  AlertTriangle,
  Banknote,
  Bell,
  BellRing,
  BookCheck,
  BookOpenText,
  Building2,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  CreditCard,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import {
  type Role,
  type SchoolUser,
} from './mockData'
const StudentDetailPage = lazy(() => import('./StudentPages').then((module) => ({ default: module.StudentDetailPage })))
const StudentsPage = lazy(() => import('./StudentPages').then((module) => ({ default: module.StudentsPage })))
const AttendancePage = lazy(() => import('./AttendancePages').then((module) => ({ default: module.AttendancePage })))
const TakeAttendancePage = lazy(() => import('./AttendancePages').then((module) => ({ default: module.TakeAttendancePage })))
const FeeStudentDetailPage = lazy(() => import('./FeesPages').then((module) => ({ default: module.FeeStudentDetailPage })))
const FeesPage = lazy(() => import('./FeesPages').then((module) => ({ default: module.FeesPage })))
const CommunicationPage = lazy(() => import('./CommunicationPages').then((module) => ({ default: module.CommunicationPage })))
import { type AlertItem } from './alertsData'
import {
  getAccessibleStudents,
  type NewStudent,
  type Student,
} from './studentData'
import {
  getAttendanceClasses,
  getAttendanceClassId,
  getAttendanceAttention,
  getAttendanceForScope,
  getAttendanceTrend,
  getSessionForClass,
  localDateKey,
  type AttendanceState,
  type AttendanceSubmission,
} from './attendanceData'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { getActiveProfile, normalizeRole, signInWithEmail, signOut as signOutSupabase, type AppProfile } from './services/auth'
import { fetchStudents, fetchTeacherAssignments, type TeacherAssignment } from './services/students'
import { fetchProfiles } from './services/users'
import { fetchAttendanceState, saveAttendance as saveLiveAttendance } from './services/attendance'
import { fetchFeeState, recordFeePayment as recordLiveFeePayment } from './services/fees'
import { fetchCommunicationState, saveCommunicationDraft as saveLiveCommunicationDraft, transitionCommunication } from './services/communication'
import { fetchLiveAlerts } from './services/alerts'
import {
  fetchAdministrationSnapshot,
  saveCampusSettings,
  saveSchoolSettings,
  type AdministrationSnapshot,
  type CampusSettingsRecord,
  type SchoolSettingsRecord,
} from './services/administration'
import {
  getFeeCollectionTrend,
  getFeeInvoices,
  getFeeMetrics,
  getFeePaymentsCollected,
  localMonthKey,
  type FeePaymentSubmission,
  type FeeState,
} from './feeData'
import {
  getAccessibleCommunication,
  getCommunicationSummary,
  type CommunicationDraftSubmission,
  type CommunicationOperation,
  type CommunicationState,
} from './communicationData'
import './App.css'

type SessionUser = {
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
  teacherAssignments: TeacherAssignment[]
}

const emptyAttendanceState: AttendanceState = { sessions: [], records: [] }
const emptyCommunicationState: CommunicationState = { messages: [] }

type ToastState = {
  type: 'success' | 'error' | 'info'
  text: string
}

type NavItem = {
  label: string
  path: string
  icon: LucideIcon
}

type StatItem = {
  label: string
  value: string
  subLabel: string
  trendLabel?: string
  tone: 'blue' | 'cyan' | 'purple' | 'amber' | 'green' | 'red'
  icon: LucideIcon
}

type AttentionItem = {
  level: 'HIGH' | 'MEDIUM' | 'NOTICE'
  title: string
  detail: string
  cta: string
  path?: string
}

type QuickAction = {
  label: string
  icon: LucideIcon
  path: string
}

type TrendPoint = {
  day: string
  value: number
}

type DashboardConfig = {
  stats: StatItem[]
  morningBrief?: {
    summary: string
    cta: string
  }
  attention: AttentionItem[]
  quickActions: QuickAction[]
  trend: TrendPoint[]
}

const walkthroughStorageKey = 'walkthroughCompletedByRole'
const legacyFeesStorageKey = 'edupulse_fees'

const defaultWalkthroughState: Record<Role, boolean> = {
  admin: false,
  principal: false,
  finance: false,
  teacher: false,
}

const walkthroughStepsByRole: Record<Role, Array<{ title: string; text: string }>> = {
  admin: [
    { title: 'Your dashboard', text: 'This is your dashboard. See what needs attention today.' },
    { title: 'Students', text: 'Students gives you quick access to every Student 360 record in your school.' },
    { title: 'Attendance', text: 'Attendance lets you review daily class status and follow up on risks.' },
    { title: 'Alerts', text: 'Alerts highlights the items that need follow-up today.' },
    { title: 'Ask EduPulse', text: 'Ask EduPulse lets you ask questions about your authorized school data.' },
  ],
  principal: [
    { title: 'School overview', text: 'This is your dashboard. See trends and attention areas at a glance.' },
    { title: 'Students', text: 'Use Student 360 to review student-level detail and context quickly.' },
    { title: 'Attendance', text: 'Attendance helps you monitor class health and follow-up priorities.' },
    { title: 'Alerts', text: 'Alerts surfaces the issues that need your review and action.' },
    { title: 'Ask EduPulse', text: 'Ask EduPulse gives you fast, role-aware answers from the school data you can access.' },
  ],
  finance: [
    { title: 'Finance dashboard', text: 'This dashboard brings fee collections, balances, and overdue attention into one place.' },
    { title: 'Fees & Collections', text: 'Fees & Collections shows outstanding and overdue balances across the school.' },
    { title: 'Parent Communication', text: 'Use Parent Communication to prepare reminders and follow-ups.' },
    { title: 'Ask EduPulse', text: 'Ask EduPulse helps you answer fee and collection questions using your authorized data.' },
  ],
  teacher: [
    { title: 'Your dashboard', text: 'This is your teacher dashboard. Focus on your classes and student needs.' },
    { title: 'My Classes', text: 'My Classes shows the students and sections assigned to you.' },
    { title: 'Attendance', text: 'Attendance lets you mark attendance and review class participation.' },
    { title: 'Alerts', text: 'Alerts surfaces the attendance and student follow-ups that need your attention.' },
    { title: 'Parent Communication', text: 'Use Parent Communication to prepare a quick update or reminder.' },
  ],
}

const roleLabels: Record<Role, string> = {
  admin: 'Admin / School Owner',
  principal: 'Principal',
  finance: 'Finance Manager',
  teacher: 'Teacher',
}

const routeTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/finance/dashboard': 'Finance Dashboard',
  '/teacher/dashboard': 'Teacher Dashboard',
  '/students': 'Students',
  '/attendance': 'Attendance',
  '/fees': 'Fees & Collections',
  '/alerts': 'Alerts',
  '/approvals': 'Approval Center',
  '/communication': 'Parent Communication',
  '/ask-edu': 'Ask EduPulse',
  '/administration': 'Administration',
  '/reports': 'Reports',
  '/users': 'Users',
  '/my-classes': 'My Classes',
}

const navByRole: Record<Role, NavItem[]> = {
  admin: [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { label: 'Students', path: '/students', icon: GraduationCap },
    { label: 'Attendance', path: '/attendance', icon: ClipboardCheck },
    { label: 'Fees & Collections', path: '/fees', icon: Wallet },
    { label: 'Alerts', path: '/alerts', icon: BellRing },
    { label: 'Approval Center', path: '/approvals', icon: ShieldCheck },
    { label: 'Parent Communication', path: '/communication', icon: MessageSquareText },
    { label: 'Ask EduPulse', path: '/ask-edu', icon: Sparkles },
    { label: 'Administration', path: '/administration', icon: UserCog },
  ],
  principal: [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { label: 'Students', path: '/students', icon: GraduationCap },
    { label: 'Attendance', path: '/attendance', icon: ClipboardCheck },
    { label: 'Fees & Collections', path: '/fees', icon: Wallet },
    { label: 'Alerts', path: '/alerts', icon: BellRing },
    { label: 'Approval Center', path: '/approvals', icon: ShieldCheck },
    { label: 'Parent Communication', path: '/communication', icon: MessageSquareText },
    { label: 'Ask EduPulse', path: '/ask-edu', icon: Sparkles },
    { label: 'Reports', path: '/reports', icon: Gauge },
    { label: 'Administration', path: '/administration', icon: UserCog },
  ],
  finance: [
    { label: 'Dashboard', path: '/finance/dashboard', icon: LayoutDashboard },
    { label: 'Students', path: '/students', icon: GraduationCap },
    { label: 'Fees & Collections', path: '/fees', icon: Wallet },
    { label: 'Alerts', path: '/alerts', icon: BellRing },
    { label: 'Parent Communication', path: '/communication', icon: MessageSquareText },
    { label: 'Ask EduPulse', path: '/ask-edu', icon: Sparkles },
  ],
  teacher: [
    { label: 'Dashboard', path: '/teacher/dashboard', icon: LayoutDashboard },
    { label: 'My Classes', path: '/my-classes', icon: BookOpenText },
    { label: 'Students', path: '/students', icon: GraduationCap },
    { label: 'Attendance', path: '/attendance', icon: ClipboardCheck },
    { label: 'Parent Communication', path: '/communication', icon: MessageSquareText },
    { label: 'Alerts', path: '/alerts', icon: BellRing },
  ],
}

const allowedRoutes: Record<Role, string[]> = {
  admin: ['/dashboard', '/students', '/attendance', '/fees', '/alerts', '/approvals', '/communication', '/ask-edu', '/administration', '/reports', '/users'],
  principal: ['/dashboard', '/students', '/attendance', '/fees', '/alerts', '/approvals', '/communication', '/ask-edu', '/administration', '/reports'],
  finance: ['/finance/dashboard', '/students', '/fees', '/alerts', '/communication', '/ask-edu'],
  teacher: ['/teacher/dashboard', '/my-classes', '/students', '/attendance', '/communication', '/alerts'],
}

const dashboardFixtures: Record<Role, DashboardConfig> = {
  admin: {
    stats: [
      { label: 'Students', value: '1,245', subLabel: 'Total students', tone: 'blue', icon: Users },
      { label: 'Attendance', value: '—', subLabel: 'Today', tone: 'cyan', icon: ClipboardCheck },
      { label: 'Collected This Month', value: '—', subLabel: 'Fee collections', tone: 'green', icon: Wallet },
      { label: 'Outstanding', value: '—', subLabel: 'Current fee balance', tone: 'purple', icon: CreditCard },
      { label: 'Overdue', value: '—', subLabel: 'Past-due balance', tone: 'red', icon: AlertTriangle },
      { label: 'Parent Communications Awaiting Approval', value: '—', subLabel: 'Pending review', tone: 'amber', icon: MessageSquareText },
      { label: 'Alerts', value: '8', subLabel: 'Need attention', tone: 'amber', icon: BellRing },
    ],
    morningBrief: {
      summary: 'Attendance summary will appear from recorded attendance sessions.',
      cta: 'View Details',
    },
    attention: [],
    quickActions: [
      { label: 'Add User', icon: UserCog, path: '/users' },
      { label: 'Import Students', icon: GraduationCap, path: '/students' },
      { label: 'View Alerts', icon: BellRing, path: '/alerts' },
    ],
    trend: [
    ],
  },
  principal: {
    stats: [
      { label: 'Attendance', value: '—', subLabel: 'Today', tone: 'blue', icon: ClipboardCheck },
      { label: 'Present', value: '—', subLabel: 'Students present', tone: 'green', icon: Users },
      { label: 'Absent', value: '—', subLabel: 'Students absent', tone: 'amber', icon: AlertTriangle },
      { label: 'Attendance Alerts', value: '—', subLabel: 'Based on recorded sessions', tone: 'red', icon: BellRing },
      { label: 'Collected This Month', value: '—', subLabel: 'Fee collections', tone: 'green', icon: Wallet },
      { label: 'Outstanding', value: '—', subLabel: 'Current fee balance', tone: 'purple', icon: CreditCard },
      { label: 'Overdue', value: '—', subLabel: 'Past-due balance', tone: 'amber', icon: AlertTriangle },
      { label: 'Parent Communications Awaiting Approval', value: '—', subLabel: 'Pending review', tone: 'purple', icon: MessageSquareText },
    ],
    morningBrief: {
      summary: 'Attendance summary will appear from recorded attendance sessions.',
      cta: 'View Details',
    },
    attention: [],
    quickActions: [
      { label: 'View Attendance', icon: ClipboardCheck, path: '/attendance' },
      { label: 'View Students', icon: GraduationCap, path: '/students' },
      { label: 'Review Alerts', icon: BellRing, path: '/alerts' },
    ],
    trend: [
    ],
  },
  finance: {
    stats: [
      { label: 'Expected', value: '—', subLabel: 'Total expected fees', tone: 'blue', icon: Banknote },
      { label: 'Collected', value: '—', subLabel: 'This month', tone: 'green', icon: CircleDollarSign },
      { label: 'Outstanding', value: '—', subLabel: 'Current balance', tone: 'purple', icon: CreditCard },
      { label: 'Overdue', value: '—', subLabel: 'Past due amount', tone: 'red', icon: AlertTriangle },
      { label: 'Fee Reminders Awaiting Review', value: '—', subLabel: 'Pending approval', tone: 'amber', icon: MessageSquareText },
    ],
    morningBrief: {
      summary: 'Fee collection totals will appear from recorded invoice and payment data.',
      cta: 'View Details',
    },
    attention: [],
    quickActions: [
      { label: 'View Outstanding Fees', icon: Wallet, path: '/fees' },
      { label: 'Prepare Fee Reminder', icon: MessageSquareText, path: '/communication' },
      { label: 'View Collections', icon: TrendingUp, path: '/fees' },
    ],
    trend: [],
  },
  teacher: {
    stats: [
      { label: 'My Classes', value: '4', subLabel: 'Assigned classes', tone: 'blue', icon: BookCheck },
      { label: 'Students', value: '96', subLabel: 'Assigned students', tone: 'cyan', icon: Users },
      { label: 'Attendance', value: '—', subLabel: "Today's attendance", tone: 'green', icon: ClipboardCheck },
      { label: 'Attendance Alerts', value: '—', subLabel: 'Based on recorded sessions', tone: 'amber', icon: AlertTriangle },
      { label: 'Draft Attendance Messages', value: '—', subLabel: 'Ready to submit', tone: 'purple', icon: MessageSquareText },
    ],
    morningBrief: {
      summary: 'Attendance summary will appear from recorded attendance sessions.',
      cta: 'View Details',
    },
    attention: [
    ],
    quickActions: [
      { label: 'Take Attendance', icon: ClipboardCheck, path: '/attendance' },
      { label: 'View My Students', icon: GraduationCap, path: '/students' },
      { label: 'Review Alerts', icon: BellRing, path: '/alerts' },
    ],
    trend: [
    ],
  },
}

function readLocalStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const saved = window.localStorage.getItem(key)
    return saved ? (JSON.parse(saved) as T) : fallback
  } catch {
    return fallback
  }
}

function defaultDashboardForRole(role: Role) {
  if (role === 'finance') {
    return '/finance/dashboard'
  }

  if (role === 'teacher') {
    return '/teacher/dashboard'
  }

  return '/dashboard'
}

function AttendanceRoute({ user, students, attendance, loading, error, onRetry }: {
  user: SessionUser
  students: Student[]
  attendance: AttendanceState
  loading: boolean
  error: string
  onRetry: () => void
}) {
  const navigate = useNavigate()
  return (
    <AttendancePage
      user={user}
      students={students}
      attendance={attendance}
      loading={loading}
      error={error}
      onRetry={onRetry}
      onPrepareMessage={(studentId) => navigate(
        `/communication?studentId=${encodeURIComponent(studentId)}&sourceType=ATTENDANCE&sourceId=${encodeURIComponent(studentId)}`,
      )}
    />
  )
}

function App() {
  const [session, setSession] = useState<SessionUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [studentsLoading, setStudentsLoading] = useState(true)
  const [studentsError, setStudentsError] = useState('')
  const [liveProfiles, setLiveProfiles] = useState<SchoolUser[]>([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profilesError, setProfilesError] = useState('')
  const [attendance, setAttendance] = useState<AttendanceState>(emptyAttendanceState)
  const [attendanceLoading, setAttendanceLoading] = useState(true)
  const [attendanceError, setAttendanceError] = useState('')
  const [fees, setFees] = useState<FeeState>({ invoices: [], payments: [] })
  const [feesLoading, setFeesLoading] = useState(true)
  const [feesError, setFeesError] = useState('')
  const [communication, setCommunication] = useState<CommunicationState>(emptyCommunicationState)
  const [communicationLoading, setCommunicationLoading] = useState(true)
  const [communicationError, setCommunicationError] = useState('')
  const [alertSnapshot, setAlertSnapshot] = useState<{ ownerId: string | null; items: AlertItem[] }>({ ownerId: null, items: [] })
  const [alertsLoading, setAlertsLoading] = useState(true)
  const [alertsError, setAlertsError] = useState('')
  const [administration, setAdministration] = useState<AdministrationSnapshot | null>(null)
  const [administrationLoading, setAdministrationLoading] = useState(true)
  const [administrationError, setAdministrationError] = useState('')
  const [walkthroughState, setWalkthroughState] = useState<Record<Role, boolean>>(() => readLocalStorage<Record<Role, boolean>>(walkthroughStorageKey, defaultWalkthroughState))
  const [tourOpen, setTourOpen] = useState(false)
  const [activeTourRole, setActiveTourRole] = useState<Role | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const authResolutionId = useRef(0)
  const studentsRequestId = useRef(0)
  const resolvingUserId = useRef<string | null>(null)
  const resolvedUserId = useRef<string | null>(null)

  const refreshAlerts = async (ownerId: string) => {
    setAlertsLoading(true)
    setAlertsError('')
    try {
      const nextAlerts = await fetchLiveAlerts()
      if (resolvedUserId.current === ownerId) {
        setAlertSnapshot({ ownerId, items: nextAlerts })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load alerts from Supabase.'
      console.error('[Supabase] Live alerts request failed:', message)
      if (resolvedUserId.current === ownerId) {
        setAlertSnapshot({ ownerId, items: [] })
        setAlertsError('Alerts could not be loaded from Supabase. Please retry.')
      }
    } finally {
      if (resolvedUserId.current === ownerId) setAlertsLoading(false)
    }
  }

  const refreshAdministration = async (owner: SessionUser) => {
    if ((owner.role !== 'admin' && owner.role !== 'principal') || !owner.organizationId || !owner.schoolId) {
      setAdministration(null)
      setAdministrationLoading(false)
      setAdministrationError('')
      return
    }

    setAdministrationLoading(true)
    setAdministrationError('')
    try {
      const nextSnapshot = await fetchAdministrationSnapshot(owner.organizationId, owner.schoolId)
      if (resolvedUserId.current === owner.authUserId) {
        setAdministration(nextSnapshot)
        window.localStorage.removeItem('edupulse_settings_v1')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load school administration settings.'
      console.error('[Supabase] Administration settings request failed:', message)
      if (resolvedUserId.current === owner.authUserId) {
        setAdministration(null)
        setAdministrationError('School settings could not be loaded from Supabase. Please retry.')
      }
    } finally {
      if (resolvedUserId.current === owner.authUserId) setAdministrationLoading(false)
    }
  }

  const refreshStudents = async (owner: SessionUser): Promise<Student[] | null> => {
    const requestId = ++studentsRequestId.current
    setStudentsLoading(true)
    setStudentsError('')
    try {
      const nextStudents = await fetchStudents()
      if (requestId === studentsRequestId.current && resolvedUserId.current === owner.authUserId) {
        setStudents(nextStudents)
        return nextStudents
      }
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load students from Supabase.'
      console.error('[Supabase] Student directory retry failed:', message)
      if (requestId === studentsRequestId.current) {
        setStudents([])
        setStudentsError('Students could not be loaded from Supabase. Please retry.')
      }
      return null
    } finally {
      if (requestId === studentsRequestId.current) setStudentsLoading(false)
    }
  }

  const refreshProfiles = async (owner: SessionUser) => {
    if (owner.role !== 'admin' && owner.role !== 'principal') {
      setLiveProfiles([])
      setProfilesLoading(false)
      setProfilesError('')
      return
    }

    setProfilesLoading(true)
    setProfilesError('')
    try {
      const nextProfiles = await fetchProfiles()
      if (resolvedUserId.current === owner.authUserId) {
        setLiveProfiles(nextProfiles)
        window.localStorage.removeItem('edupulse_users')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load profiles from Supabase.'
      console.error('[Supabase] Profiles request failed:', message)
      if (resolvedUserId.current === owner.authUserId) {
        setProfilesError('Profiles could not be loaded from Supabase. Please retry.')
        setLiveProfiles([])
      }
    } finally {
      if (resolvedUserId.current === owner.authUserId) setProfilesLoading(false)
    }
  }

  useEffect(() => {
    window.localStorage.removeItem('edupulse_attendance')
    window.localStorage.removeItem(legacyFeesStorageKey)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(walkthroughStorageKey, JSON.stringify(walkthroughState))
  }, [walkthroughState])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const buildSessionUser = async (profile: AppProfile): Promise<SessionUser> => {
    const teacherAssignments = await fetchTeacherAssignments()
    return {
      id: profile.id.split('').reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0),
      authUserId: profile.id,
      organizationId: profile.organization_id,
      schoolId: profile.school_id,
      campusId: profile.campus_id,
      name: profile.full_name,
      email: profile.email,
      role: normalizeRole(profile.role),
      schoolName: profile.school_name ?? 'No school assigned',
      campusName: profile.campus_name ?? 'No campus assigned',
      teacherAssignments,
    }
  }

  const activateUser = async (profile: AppProfile, resolutionId: number) => {
    if (profile.status !== 'ACTIVE') {
      if (resolutionId !== authResolutionId.current) return null
      setSession(null)
      setAlertSnapshot({ ownerId: null, items: [] })
      setAlertsLoading(false)
      setAlertsError('')
      setStudents([])
      setAttendance(emptyAttendanceState)
      setFees({ invoices: [], payments: [] })
      setCommunication(emptyCommunicationState)
      setLiveProfiles([])
      setAdministration(null)
      setAdministrationLoading(false)
      setAdministrationError('')
      setAuthError('This account is inactive. Please contact the administrator.')
      setAuthLoading(false)
      setStudentsLoading(false)
      setAttendanceLoading(false)
      setFeesLoading(false)
      setCommunicationLoading(false)
      setProfilesLoading(false)
      await signOutSupabase()
      return null
    }

    const nextSession = await buildSessionUser(profile)
    if (resolutionId !== authResolutionId.current) return null
    setAlertSnapshot({ ownerId: profile.id, items: [] })
    setAlertsLoading(true)
    setAlertsError('')
    setSession(nextSession)
    setAdministration(null)
    setAdministrationLoading(nextSession.role === 'admin' || nextSession.role === 'principal')
    setAdministrationError('')
    resolvedUserId.current = profile.id
    setAuthError('')
    setAuthLoading(false)
    setStudentsLoading(true)
    setStudentsError('')
    setAttendanceLoading(true)
    setAttendanceError('')
    setFeesLoading(true)
    setFeesError('')
    setCommunicationLoading(true)
    setCommunicationError('')
    setProfilesLoading(nextSession.role === 'admin' || nextSession.role === 'principal')
    setProfilesError('')
    const loadedStudentRows = await refreshStudents(nextSession)
    const loadedStudents = loadedStudentRows ?? []
    const studentLoadFailed = loadedStudentRows === null
    try {
      const nextAttendance = await fetchAttendanceState()
      if (resolutionId === authResolutionId.current) setAttendance(nextAttendance)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load attendance from Supabase.'
      console.error('[Supabase] Attendance request failed:', message)
      if (resolutionId === authResolutionId.current) {
        setAttendanceError('Attendance could not be loaded from Supabase. Please retry.')
        setAttendance(emptyAttendanceState)
      }
    } finally {
      if (resolutionId === authResolutionId.current) setAttendanceLoading(false)
    }
    try {
      if (studentLoadFailed) throw new Error('Student scope could not be loaded for fee records.')
      const nextFees = await fetchFeeState(loadedStudents)
      if (resolutionId === authResolutionId.current) setFees(nextFees)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load fees from Supabase.'
      console.error('[Supabase] Fee request failed:', message)
      if (resolutionId === authResolutionId.current) {
        setFeesError('Fee information could not be loaded from Supabase. Please retry.')
        setFees({ invoices: [], payments: [] })
      }
    } finally {
      if (resolutionId === authResolutionId.current) setFeesLoading(false)
    }
    try {
      if (studentLoadFailed) throw new Error('Student scope could not be loaded for communication.')
      const nextCommunication = await fetchCommunicationState(loadedStudents)
      if (resolutionId === authResolutionId.current) {
        window.localStorage.removeItem('edupulse_communication')
        setCommunication(nextCommunication)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load parent communication from Supabase.'
      console.error('[Supabase] Communication request failed:', message)
      if (resolutionId === authResolutionId.current) {
        setCommunicationError('Parent communication could not be loaded from Supabase. Please retry.')
        setCommunication(emptyCommunicationState)
      }
    } finally {
      if (resolutionId === authResolutionId.current) setCommunicationLoading(false)
    }
    await refreshAlerts(profile.id)
    await refreshProfiles(nextSession)
    await refreshAdministration(nextSession)
    return nextSession
  }

  useEffect(() => {
    let alive = true
    const client = supabase
    if (!isSupabaseConfigured || !client) {
      setAuthError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
      setAuthLoading(false)
      setStudentsLoading(false)
      setAttendanceLoading(false)
      setFeesLoading(false)
      setProfilesLoading(false)
      return
    }

    const resolveUser = async (userId: string) => {
      if (resolvedUserId.current === userId || resolvingUserId.current === userId) return
      const resolutionId = ++authResolutionId.current
      studentsRequestId.current += 1
      resolvingUserId.current = userId
      setSession(null)
      setAdministration(null)
      setAdministrationLoading(true)
      setAdministrationError('')
      setAdministrationLoading(false)
      setAdministrationError('')
      setStudents([])
      setAttendance(emptyAttendanceState)
      setFees({ invoices: [], payments: [] })
      setCommunication(emptyCommunicationState)
      setLiveProfiles([])
      setAuthLoading(true)
      setStudentsLoading(true)
      setAttendanceLoading(true)
      setFeesLoading(true)
      setCommunicationLoading(true)
      setCommunicationError('')
      setFeesError('')
      setProfilesLoading(true)
      try {
        const profile = await getActiveProfile(userId)
        if (!alive || resolutionId !== authResolutionId.current) return
        if (!profile) {
          setAuthError('This account is not configured for EduPulse access.')
          setAuthLoading(false)
          setStudentsLoading(false)
          setAttendanceLoading(false)
          setFeesLoading(false)
          setCommunicationLoading(false)
          setProfilesLoading(false)
          await signOutSupabase()
          return
        }
        await activateUser(profile, resolutionId)
      } catch (error) {
        if (!alive || resolutionId !== authResolutionId.current) return
        const message = error instanceof Error ? error.message : 'Unable to restore your Supabase session.'
        console.error('[Supabase] Session/profile restore failed:', message)
        setSession(null)
        setAdministration(null)
        setAdministrationLoading(false)
        setAdministrationError('')
        setAdministration(null)
        setAdministrationLoading(false)
        setAdministrationError('')
        setStudents([])
        setAttendance(emptyAttendanceState)
        setFees({ invoices: [], payments: [] })
        setCommunication(emptyCommunicationState)
        setLiveProfiles([])
        setAuthError('Your account could not be verified. Please sign in again.')
        setAuthLoading(false)
        setStudentsLoading(false)
        setAttendanceLoading(false)
        setFeesLoading(false)
        setCommunicationLoading(false)
        setProfilesLoading(false)
        await signOutSupabase()
      } finally {
        if (resolutionId === authResolutionId.current && resolvingUserId.current === userId) {
          resolvingUserId.current = null
        }
      }
    }

    const { data: authListener } = client.auth.onAuthStateChange((_event, authSession) => {
      window.setTimeout(() => {
        if (!alive) return
        if (authSession?.user) {
          void resolveUser(authSession.user.id)
        } else {
          authResolutionId.current += 1
          studentsRequestId.current += 1
          resolvingUserId.current = null
          resolvedUserId.current = null
          setSession(null)
          setStudents([])
          setAttendance(emptyAttendanceState)
          setFees({ invoices: [], payments: [] })
          setCommunication(emptyCommunicationState)
          setLiveProfiles([])
          setAuthLoading(false)
          setStudentsLoading(false)
          setAttendanceLoading(false)
          setFeesLoading(false)
          setCommunicationLoading(false)
          setProfilesLoading(false)
        }
      }, 0)
    })

    void client.auth.getSession().then(({ data, error }) => {
      if (!alive) return
      if (error) {
        console.error('[Supabase] Session restore failed:', error.message)
        setAuthError('Your session could not be restored. Please sign in again.')
        setAuthLoading(false)
        setStudentsLoading(false)
        setAttendanceLoading(false)
        setFeesLoading(false)
        setCommunicationLoading(false)
        setProfilesLoading(false)
      } else if (data.session?.user) {
        void resolveUser(data.session.user.id)
      } else {
        setAuthLoading(false)
        setStudentsLoading(false)
        setAttendanceLoading(false)
        setFeesLoading(false)
        setCommunicationLoading(false)
        setProfilesLoading(false)
      }
    }).catch((error: unknown) => {
      if (!alive) return
      const message = error instanceof Error ? error.message : 'Unable to restore your Supabase session.'
      console.error('[Supabase] Session restore failed:', message)
      setAuthError('Your session could not be restored. Please sign in again.')
      setAuthLoading(false)
      setStudentsLoading(false)
      setAttendanceLoading(false)
      setFeesLoading(false)
      setCommunicationLoading(false)
      setProfilesLoading(false)
    })

    return () => {
      alive = false
      authResolutionId.current += 1
      studentsRequestId.current += 1
      resolvingUserId.current = null
      resolvedUserId.current = null
      authListener.subscription.unsubscribe()
    }
  }, [])

  const handleLogin = async (email: string, password: string): Promise<{ role?: Role; error?: string }> => {
    if (!isSupabaseConfigured) {
      return { error: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before enabling login.' }
    }

    const result = await signInWithEmail(email, password)

    if (!result.success || !result.profile) {
      return { error: result.error ?? 'Unable to sign in with Supabase Auth.' }
    }

    const role = normalizeRole(result.profile.role)
    setActiveTourRole(role)
    setTourOpen(!walkthroughState[role])
    return { role }
  }

  const handleLogout = async () => {
    try {
      await signOutSupabase()
      resolvedUserId.current = null
      setSession(null)
      setAdministration(null)
      setAdministrationLoading(false)
      setAdministrationError('')
      setAlertSnapshot({ ownerId: null, items: [] })
      setAlertsLoading(false)
      setAlertsError('')
      setLiveProfiles([])
      setStudents([])
      setAttendance(emptyAttendanceState)
      setFees({ invoices: [], payments: [] })
      setCommunication(emptyCommunicationState)
      setToast({ type: 'info', text: 'You have been logged out.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to log out.'
      setToast({ type: 'error', text: message })
    }
  }

  const handleSaveSchoolSettings = async (
    values: Pick<SchoolSettingsRecord, 'name' | 'short_name' | 'email' | 'phone' | 'address' | 'timezone'>,
  ) => {
    if (!session || session.role !== 'admin' || !session.organizationId || !session.schoolId) {
      throw new Error('Only an active school administrator can update school settings.')
    }
    try {
      const school = await saveSchoolSettings(session.organizationId, session.schoolId, values)
      setAdministration((current) => current ? { ...current, school } : current)
      setSession((current) => current ? { ...current, schoolName: school.name } : current)
      setToast({ type: 'success', text: 'School settings saved.' })
    } catch (error) {
      console.error('[Supabase] School settings update failed:', error instanceof Error ? error.message : 'Unknown error')
      throw error
    }
  }

  const handleSaveCampusSettings = async (
    campusId: string,
    values: Pick<CampusSettingsRecord, 'name' | 'code' | 'address' | 'status'>,
  ) => {
    if (!session || session.role !== 'admin' || !session.organizationId || !session.schoolId) {
      throw new Error('Only an active school administrator can update campus settings.')
    }
    try {
      const campus = await saveCampusSettings(session.organizationId, session.schoolId, campusId, values)
      setAdministration((current) => current
        ? { ...current, campuses: current.campuses.map((item) => item.id === campus.id ? campus : item) }
        : current)
      setSession((current) => current && current.campusId === campus.id
        ? { ...current, campusName: campus.name }
        : current)
      setToast({ type: 'success', text: 'Campus settings saved.' })
    } catch (error) {
      console.error('[Supabase] Campus settings update failed:', error instanceof Error ? error.message : 'Unknown error')
      throw error
    }
  }

  const handleCompleteTour = (role: Role) => {
    setWalkthroughState((current) => ({ ...current, [role]: true }))
    setTourOpen(false)
    setActiveTourRole(null)
  }

  const handleRestartTour = (role: Role) => {
    setActiveTourRole(role)
    setTourOpen(true)
  }

  const handleAddStudent = (_payload: NewStudent) => {
    if (session?.role !== 'admin') {
      setToast({ type: 'error', text: 'Only administrators can add students.' })
      return false
    }

    setToast({ type: 'error', text: 'Student creation is not enabled in this read-only Supabase migration. No local record was created.' })
    return false
  }

  const handleImportStudents = (_payload: NewStudent[]) => {
    if (session?.role !== 'admin') {
      setToast({ type: 'error', text: 'Only administrators can import students.' })
      return false
    }
    setToast({ type: 'error', text: 'Student import is not enabled in this read-only Supabase migration. No local records were created.' })
    return false
  }

  const handleSaveAttendance = async (submission: AttendanceSubmission): Promise<AttendanceState> => {
    if (!session) {
      throw new Error('Sign in to manage attendance.')
    }
    const attendanceClass = getAttendanceClasses(students).find((item) => item.id === submission.classId)
    if (!attendanceClass) throw new Error('This class is outside your authorized attendance scope.')
    const nextState = await saveLiveAttendance(session, attendanceClass, submission)
    setAttendance(nextState)
    await refreshAlerts(session.authUserId)
    return nextState
  }

  const handleRefreshAttendance = async () => {
    setAttendanceLoading(true)
    setAttendanceError('')
    try {
      setAttendance(await fetchAttendanceState())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load attendance from Supabase.'
      console.error('[Supabase] Attendance retry failed:', message)
      setAttendanceError('Attendance could not be loaded from Supabase. Please retry.')
      setAttendance(emptyAttendanceState)
    } finally {
      setAttendanceLoading(false)
    }
    if (session) await refreshAlerts(session.authUserId)
  }

  const handleRefreshFees = async () => {
    setFeesLoading(true)
    setFeesError('')
    try {
      setFees(await fetchFeeState(students))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load fees from Supabase.'
      console.error('[Supabase] Fee retry failed:', message)
      setFeesError('Fee information could not be loaded from Supabase. Please retry.')
      setFees({ invoices: [], payments: [] })
    } finally {
      setFeesLoading(false)
    }
    if (session) await refreshAlerts(session.authUserId)
  }

  const handleRecordFeePayment = async (submission: FeePaymentSubmission): Promise<boolean> => {
    if (!session) {
      setToast({ type: 'error', text: 'Sign in to record fee payments.' })
      return false
    }
    try {
      const nextFees = await recordLiveFeePayment(students, submission)
      setFees(nextFees)
      await refreshAlerts(session.authUserId)
      setToast({ type: 'success', text: 'Payment recorded successfully.' })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to record fee payment.'
      console.error('[Supabase] Fee payment failed:', message)
      setToast({ type: 'error', text: message })
      return false
    }
  }

  const handleRefreshCommunication = async () => {
    setCommunicationLoading(true)
    setCommunicationError('')
    try {
      setCommunication(await fetchCommunicationState(students))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load parent communication from Supabase.'
      console.error('[Supabase] Communication retry failed:', message)
      setCommunicationError('Parent communication could not be loaded from Supabase. Please retry.')
      setCommunication(emptyCommunicationState)
    } finally {
      setCommunicationLoading(false)
    }
    if (session) await refreshAlerts(session.authUserId)
  }

  const handleSaveCommunicationDraft = async (submission: CommunicationDraftSubmission, submit: boolean): Promise<{ messageId?: string; error?: string }> => {
    if (!session) {
      return { error: 'Sign in to prepare parent communication.' }
    }
    try {
      const result = await saveLiveCommunicationDraft(submission, submit, students)
      setCommunication(result.state)
      await refreshAlerts(session.authUserId)
      return { messageId: result.messageId }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The communication could not be saved.'
      console.error('[Supabase] Communication save failed:', message)
      return { error: message }
    }
  }

  const handleCommunicationOperation = async (operation: CommunicationOperation): Promise<boolean> => {
    if (!session) {
      setToast({ type: 'error', text: 'Sign in to manage parent communication.' })
      return false
    }
    try {
      setCommunication(await transitionCommunication(operation, students))
      await refreshAlerts(session.authUserId)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The communication workflow action could not be completed.'
      console.error('[Supabase] Communication transition failed:', message)
      setToast({ type: 'error', text: message })
      return false
    }
  }

  const visibleAlerts = session && alertSnapshot.ownerId === session.authUserId ? alertSnapshot.items : []
  const visibleAlertsLoading = !session || alertSnapshot.ownerId !== session.authUserId || alertsLoading
  const visibleAlertsError = alertSnapshot.ownerId === session?.authUserId ? alertsError : ''
  const handleRefreshAlerts = async () => {
    if (session) await refreshAlerts(session.authUserId)
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="app-loading-state" role="status">Loading page…</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={handleLogin} loading={authLoading} authError={authError} />} />

        <Route element={<ProtectedRoute user={session} loading={authLoading} />}>
        <Route
          element={
            <AppShell
              user={session}
              onLogout={handleLogout}
              tourOpen={tourOpen}
              activeTourRole={activeTourRole}
              onCloseTour={() => {
                setTourOpen(false)
                setActiveTourRole(null)
              }}
              onCompleteTour={handleCompleteTour}
              onRestartTour={handleRestartTour}
            />
          }
        >
          <Route path="/" element={<Navigate to={session ? defaultDashboardForRole(session.role) : '/login'} replace />} />
            <Route path="/dashboard" element={<DashboardPage user={session} students={students} attendance={attendance} attendanceLoading={attendanceLoading} attendanceError={attendanceError} onRetry={handleRefreshAttendance} fees={fees} feesLoading={feesLoading} feesError={feesError} onRetryFees={handleRefreshFees} communication={communication} alerts={visibleAlerts} alertsLoading={visibleAlertsLoading} alertsError={visibleAlertsError} onRetryAlerts={handleRefreshAlerts} />} />
            <Route path="/finance/dashboard" element={<DashboardPage user={session} students={students} attendance={attendance} attendanceLoading={attendanceLoading} attendanceError={attendanceError} onRetry={handleRefreshAttendance} fees={fees} feesLoading={feesLoading} feesError={feesError} onRetryFees={handleRefreshFees} communication={communication} alerts={visibleAlerts} alertsLoading={visibleAlertsLoading} alertsError={visibleAlertsError} onRetryAlerts={handleRefreshAlerts} />} />
            <Route path="/teacher/dashboard" element={<DashboardPage user={session} students={students} attendance={attendance} attendanceLoading={attendanceLoading} attendanceError={attendanceError} onRetry={handleRefreshAttendance} fees={fees} feesLoading={feesLoading} feesError={feesError} onRetryFees={handleRefreshFees} communication={communication} alerts={visibleAlerts} alertsLoading={visibleAlertsLoading} alertsError={visibleAlertsError} onRetryAlerts={handleRefreshAlerts} />} />
            <Route
              path="/students"
              element={
                session ? (
                  <StudentsPage
                    user={session}
                    students={students}
                    loading={studentsLoading}
                    error={studentsError}
                    onRetry={() => session ? refreshStudents(session) : undefined}
                    onAddStudent={handleAddStudent}
                    onImportStudents={handleImportStudents}
                  />
                ) : null
              }
            />
            <Route
              path="/students/:studentId"
              element={session ? <StudentDetailPage user={session} students={students} attendance={attendance} attendanceLoading={attendanceLoading} attendanceError={attendanceError} fees={fees} feesLoading={feesLoading} feesError={feesError} onRetryFees={handleRefreshFees} communication={communication} users={liveProfiles} alerts={visibleAlerts} alertsLoading={visibleAlertsLoading} alertsError={visibleAlertsError} /> : null}
            />
            <Route
              path="/attendance"
              element={session ? <AttendanceRoute user={session} students={students} attendance={attendance} loading={attendanceLoading} error={attendanceError} onRetry={handleRefreshAttendance} /> : null}
            />
            <Route
              path="/attendance/take/:classId"
              element={session ? <TakeAttendancePage user={session} students={students} attendance={attendance} loading={attendanceLoading} error={attendanceError} onRetry={handleRefreshAttendance} onSave={handleSaveAttendance} /> : null}
            />
            <Route path="/fees" element={session ? <FeesPage user={session} students={students} feeState={fees} feeLoading={feesLoading} feeError={feesError} onRetry={handleRefreshFees} schoolUsers={liveProfiles} onRecordPayment={handleRecordFeePayment} /> : null} />
            <Route path="/fees/:studentId" element={session ? <FeeStudentDetailPage user={session} students={students} feeState={fees} feeLoading={feesLoading} feeError={feesError} onRetry={handleRefreshFees} schoolUsers={liveProfiles} onRecordPayment={handleRecordFeePayment} /> : null} />
            <Route path="/communication" element={session ? <CommunicationPage user={session} students={students} state={communication} attendance={attendance} fees={fees} users={liveProfiles} loading={communicationLoading} loadError={communicationError} onRetry={handleRefreshCommunication} onSaveDraft={handleSaveCommunicationDraft} onOperation={handleCommunicationOperation} /> : null} />
            <Route path="/alerts" element={session ? <AlertsPage user={session} alerts={visibleAlerts} loading={visibleAlertsLoading} error={visibleAlertsError} onRetry={handleRefreshAlerts} /> : null} />
            <Route path="/approvals" element={session ? <ApprovalsPage user={session} students={students} communication={communication} loading={communicationLoading} error={communicationError} onRetry={handleRefreshCommunication} onOperation={handleCommunicationOperation} /> : null} />
            <Route path="/ask-edu" element={session ? <AskEduPage user={session} students={students} fees={fees} communication={communication} alerts={visibleAlerts} alertsLoading={visibleAlertsLoading} alertsError={visibleAlertsError} /> : null} />
            <Route path="/reports" element={session ? <ReportsPage user={session} students={students} attendance={attendance} fees={fees} communication={communication} /> : null} />
            <Route path="/my-classes" element={session ? <MyClassesPage user={session} students={students} attendance={attendance} attendanceLoading={attendanceLoading} attendanceError={attendanceError} onRetry={handleRefreshAttendance} /> : null} />
            <Route
              path="/administration"
              element={
                session ? <AdministrationPage
                  user={session}
                  snapshot={administration}
                  loading={administrationLoading}
                  error={administrationError}
                  profiles={liveProfiles}
                  profilesLoading={profilesLoading}
                  profilesError={profilesError}
                  onRetryProfiles={() => session ? refreshProfiles(session) : undefined}
                  onRetry={() => session ? refreshAdministration(session) : undefined}
                  onSaveSchool={handleSaveSchoolSettings}
                  onSaveCampus={handleSaveCampusSettings}
              /> : null
              }
            />
            <Route
              path="/users"
              element={session?.role === 'admin' ? <ProfilesDirectoryPage profiles={liveProfiles} loading={profilesLoading} error={profilesError} onRetry={() => session ? refreshProfiles(session) : undefined} /> : null}
            />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to={session ? defaultDashboardForRole(session.role) : '/login'} replace />} />
      </Routes>
      </Suspense>

      {toast ? (
        <div className={`toast toast-${toast.type}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      ) : null}
    </BrowserRouter>
  )
}

function ProtectedRoute({ user, loading }: { user: SessionUser | null; loading: boolean }) {
  const location = useLocation()

  if (loading) {
    return <div className="app-loading-state" role="status">Checking your secure session…</div>
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  const route = location.pathname
  const allowed = allowedRoutes[user.role]
  const isStudentDetailRoute = route.startsWith('/students/') && route !== '/students/'
  const isAttendanceTakeRoute = route.startsWith('/attendance/take/')
  const isFeeDetailRoute = route.startsWith('/fees/') && route !== '/fees/'

  if (!allowed.includes(route) &&
    !(isStudentDetailRoute && allowed.includes('/students')) &&
    !(isAttendanceTakeRoute && allowed.includes('/attendance')) &&
    !(isFeeDetailRoute && allowed.includes('/fees'))) {
    return <Navigate to={defaultDashboardForRole(user.role)} replace />
  }

  return <Outlet />
}

function LoginPage({ onLogin, loading, authError }: {
  onLogin: (email: string, password: string) => Promise<{ role?: Role; error?: string }>
  loading: boolean
  authError: string
}) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [passwordResetNotice, setPasswordResetNotice] = useState('')

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting || loading) return

    setSubmitting(true)
    setError('')
    try {
      const result = await onLogin(email, password)
      setPassword('')
      if (result.role) {
        navigate(defaultDashboardForRole(result.role))
        return
      }
      setError(result.error ?? 'Unable to sign in.')
    } catch {
      setError('Unable to sign in. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-panel">
        <div className="login-brand-panel">
          <div className="brand-mark">E</div>
          <h1>EduPulse AI</h1>
          <p className="subtitle">School Management Intelligence</p>
          <div className="brand-copy">
            <span>See.</span>
            <span>Understand.</span>
            <span>Act.</span>
          </div>
          <p className="tagline">AI-powered school management intelligence.</p>
        </div>

        <div className="login-form-panel">
          <div className="login-header">
            <p className="eyebrow">Secure login</p>
            <h2>Welcome back</h2>
          </div>

          <form onSubmit={handleSubmit} className="login-form" aria-busy={loading || submitting}>
            <label>
              <span>Email</span>
              <input
                type="email"
                required
                disabled={loading || submitting}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@school.edu"
              />
            </label>

            <label>
              <span>Password</span>
              <div className="password-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  disabled={loading || submitting}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter password"
                />
                <button type="button" disabled={loading || submitting} onClick={() => setShowPassword((current) => !current)}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>

            {error || authError ? <p className="error-message" role="alert">{error || authError}</p> : null}

            <button type="submit" className="primary-button" disabled={loading || submitting}>
              {loading ? 'Checking session…' : submitting ? 'Signing in…' : 'Sign In'}
            </button>

            <button type="button" className="secondary-button" disabled={loading || submitting} onClick={() => setPasswordResetNotice('Password reset is not configured; contact an administrator.')}>
              Forgot Password
            </button>
            {passwordResetNotice ? <p className="communication-feedback" role="status">{passwordResetNotice}</p> : null}
          </form>
        </div>
      </div>
    </div>
  )
}

function AppShell({
  user,
  onLogout,
  tourOpen,
  activeTourRole,
  onCloseTour,
  onCompleteTour,
  onRestartTour,
}: {
  user: SessionUser | null
  onLogout: () => void
  tourOpen: boolean
  activeTourRole: Role | null
  onCloseTour: () => void
  onCompleteTour: (role: Role) => void
  onRestartTour: (role: Role) => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)

  if (!user) {
    return null
  }

  const nav = navByRole[user.role]
  const pageTitle = location.pathname.startsWith('/students/')
    ? 'Student 360'
    : location.pathname.startsWith('/attendance/take/')
      ? 'Attendance'
      : location.pathname.startsWith('/fees/')
        ? 'Fees & Collections'
      : routeTitles[location.pathname] ?? 'Dashboard'
  const initials = user.name
    .split(' ')
    .map((namePart) => namePart[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-badge">E</div>
          <div>
            <strong>EduPulse AI</strong>
            <span>School intelligence</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          {nav.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path ||
              (item.path === '/students' && location.pathname.startsWith('/students/')) ||
              (item.path === '/attendance' && location.pathname.startsWith('/attendance/take/'))

            return (
              <button
                key={item.path}
                type="button"
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => navigate(item.path)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="nav-item profile-item" onClick={() => navigate(defaultDashboardForRole(user.role))}>
            <UserCog size={18} />
            <span>Profile</span>
          </button>

          <button type="button" className="nav-item danger-item" onClick={onLogout}>
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <div className="topbar-title">
            <div>
              <p className="page-kicker">{pageTitle}</p>
              <h2>{user.schoolName}</h2>
            </div>
            <div className="school-context">
              <Building2 size={15} />
              <span>{user.campusName}</span>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="search-box">
              <Search size={16} />
              <input type="text" placeholder="Search" readOnly aria-label="Search" />
            </div>

            <button type="button" className="icon-button" aria-label="Notifications">
              <Bell size={18} />
            </button>

            <div className="profile-panel">
              <div className="profile-avatar">{initials}</div>

              <div className="profile-details">
                <strong>{user.name}</strong>
                <span>{roleLabels[user.role]}</span>
              </div>

              <button type="button" className="profile-toggle" aria-label="Open profile menu" onClick={() => setProfileOpen((value) => !value)}>
                <ChevronDown size={16} />
              </button>

              {profileOpen ? (
                <div className="profile-menu">
                  <button type="button" onClick={() => navigate(defaultDashboardForRole(user.role))}>My Profile</button>
                  <button type="button" onClick={() => onRestartTour(user.role)}>Restart Tour</button>
                  <button type="button" onClick={onLogout}>Logout</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {activeTourRole && tourOpen ? (
          <WalkthroughModal
            steps={walkthroughStepsByRole[activeTourRole]}
            onClose={() => {
              onCompleteTour(activeTourRole)
              onCloseTour()
            }}
            onComplete={() => onCompleteTour(activeTourRole)}
          />
        ) : null}

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function WalkthroughModal({ steps, onClose, onComplete }: { steps: Array<{ title: string; text: string }>; onClose: () => void; onComplete: () => void }) {
  const [stepIndex, setStepIndex] = useState(0)
  const currentStep = steps[stepIndex]

  if (!currentStep) {
    return null
  }

  const isLastStep = stepIndex === steps.length - 1

  return (
    <div className="tour-backdrop" role="dialog" aria-modal="true" aria-label="Quick tour">
      <div className="tour-dialog">
        <div className="tour-header">
          <span className="eyebrow">Quick tour</span>
          <button type="button" className="text-button" onClick={onClose}>Skip</button>
        </div>
        <h3>{currentStep.title}</h3>
        <p>{currentStep.text}</p>
        <div className="tour-progress">
          {steps.map((_, index) => (
            <span key={`dot-${index}`} className={index === stepIndex ? 'active' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button type="button" className="secondary-button small-button" onClick={() => setStepIndex((value) => Math.max(0, value - 1))} disabled={stepIndex === 0}>
            Back
          </button>
          {isLastStep ? (
            <button type="button" className="primary-button small-button" onClick={onComplete}>Finish</button>
          ) : (
            <button type="button" className="primary-button small-button" onClick={() => setStepIndex((value) => value + 1)}>Next</button>
          )}
        </div>
      </div>
    </div>
  )
}

function DashboardPage({ user, students, attendance, attendanceLoading, attendanceError, onRetry, fees, feesLoading, feesError, onRetryFees, communication, alerts, alertsLoading, alertsError, onRetryAlerts }: {
  user: SessionUser | null
  students: Student[]
  attendance: AttendanceState
  attendanceLoading: boolean
  attendanceError: string
  onRetry: () => void
  fees: FeeState
  feesLoading: boolean
  feesError: string
  onRetryFees: () => void
  communication: CommunicationState
  alerts: AlertItem[]
  alertsLoading: boolean
  alertsError: string
  onRetryAlerts: () => void
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    setStatus('loading')
    const timeoutId = window.setTimeout(() => setStatus('ready'), 600)
    return () => window.clearTimeout(timeoutId)
  }, [user?.role])

  if (!user) {
    return null
  }

  if (status === 'loading') {
    return <DashboardLoadingState role={user.role} />
  }

  if (status === 'error') {
    return <DashboardErrorState onRetry={() => setStatus('loading')} />
  }

  if (attendanceLoading || feesLoading) {
    return <DashboardLoadingState role={user.role} />
  }

  const config = buildDashboardConfig(user, students, attendance, fees, communication, alerts, Boolean(attendanceError), Boolean(feesError), alertsLoading || Boolean(alertsError))

  if (!config || config.stats.length === 0) {
    return <EmptyDashboardState role={user.role} />
  }

  let dashboard: ReactNode
  if (user.role === 'admin' || user.role === 'principal') {
    dashboard = <SchoolDashboard user={user} config={config} />
  } else if (user.role === 'finance') {
    dashboard = <FinanceDashboard user={user} config={config} />
  } else {
    dashboard = <TeacherDashboard user={user} config={config} students={students} />
  }
  return (
    <>
      {attendanceError ? <div className="attendance-empty-notice" role="alert">{attendanceError} <button type="button" className="student-link" onClick={onRetry}>Try again</button></div> : null}
      {feesError ? <div className="attendance-empty-notice" role="alert">{feesError} <button type="button" className="student-link" onClick={onRetryFees}>Try again</button></div> : null}
      {alertsError ? <div className="attendance-empty-notice" role="alert">{alertsError} <button type="button" className="student-link" onClick={onRetryAlerts}>Try again</button></div> : null}
      {dashboard}
    </>
  )
}

function buildDashboardConfig(user: SessionUser, students: Student[], attendance: AttendanceState, fees: FeeState, communication: CommunicationState, liveAlerts: AlertItem[], attendanceUnavailable = false, feesUnavailable = false, alertsUnavailable = false): DashboardConfig {
  const fixture = dashboardFixtures[user.role]
  const communicationSummary = getCommunicationSummary(communication, students, user)
  const feeInvoices = getFeeInvoices(fees, students, user)
  const feeMetrics = getFeeMetrics(feeInvoices)
  const currentMonthInvoices = feeInvoices.filter((invoice) => invoice.month === localMonthKey())
  const currentMonthMetrics = getFeeMetrics(currentMonthInvoices)
  const currentMonthCollections = getFeePaymentsCollected(fees, students, user)
  const pendingFeeApprovals = liveAlerts.filter((alert) => alert.sourceType === 'COMMUNICATION' && alert.status === 'IN_REVIEW')
  const feeAttention: AttentionItem[] = (alertsUnavailable ? [] : liveAlerts
    .filter((alert) => alert.sourceType === 'FEE' && alert.status !== 'RESOLVED')
    .slice(0, 3)).map((alert) => alertToAttention(alert, user))

  if (user.role === 'finance') {
    const stats = fixture.stats.map((stat) => {
      if (stat.label === 'Expected') return { ...stat, value: feesUnavailable ? '—' : formatFeeCurrency(currentMonthMetrics.expected) }
      if (stat.label === 'Collected') return { ...stat, value: feesUnavailable ? '—' : formatFeeCurrency(currentMonthCollections), subLabel: feesUnavailable ? 'Fee data unavailable' : 'This month' }
      if (stat.label === 'Outstanding') return { ...stat, value: feesUnavailable ? '—' : formatFeeCurrency(feeMetrics.outstanding) }
      if (stat.label === 'Overdue') return { ...stat, value: feesUnavailable ? '—' : formatFeeCurrency(feeMetrics.overdue) }
      if (stat.label === 'Fee Reminders Awaiting Review') {
        return { ...stat, value: String(communicationSummary.feeAwaitingApproval) }
      }
      return stat
    })
    return {
      ...fixture,
      stats,
      morningBrief: {
        summary: feesUnavailable ? 'Live fee metrics are currently unavailable.' : `${formatFeeCurrency(currentMonthCollections)} collected this month. ${formatFeeCurrency(feeMetrics.outstanding)} remains outstanding, including ${formatFeeCurrency(feeMetrics.overdue)} overdue. ${communicationSummary.feeAwaitingApproval} fee reminders await review.`,
        cta: 'View Fees',
      },
      attention: [
        ...feeAttention,
        ...(!alertsUnavailable && pendingFeeApprovals.length ? [{
          level: 'NOTICE' as const,
          title: 'Fee reminders awaiting review',
          detail: `${pendingFeeApprovals.length} fee reminder${pendingFeeApprovals.length === 1 ? '' : 's'} await approval.`,
          cta: 'Review',
          path: '/communication',
        }] : []),
      ].slice(0, 5),
      trend: feesUnavailable ? [] : getFeeCollectionTrend(fees, students, user),
    }
  }

  const today = localDateKey()
  const classes = getAttendanceClasses(students)
  const todayCounts = getAttendanceForScope(attendance, classes, today).counts
  const attendanceAttention = getAttendanceAttention(attendance, students)
  const rate = todayCounts.rate === null ? '—' : `${todayCounts.rate}%`
  const activeAlertCount = alertsUnavailable ? '—' : String(liveAlerts.filter((alert) => alert.status !== 'RESOLVED').length)
  const authorizedStudentCount = classes.reduce((total, item) => total + item.students.length, 0)
  const stats = fixture.stats.map((stat) => {
    if (stat.label === 'Students') {
      return {
        ...stat,
        value: String(students.length),
        subLabel: user.role === 'teacher' ? 'Students authorized by Supabase RLS' : 'Live Supabase student records',
      }
    }
    if (stat.label === 'Collected This Month') {
      return { ...stat, value: feesUnavailable ? '—' : formatFeeCurrency(currentMonthCollections), subLabel: feesUnavailable ? 'Fee data unavailable' : stat.subLabel }
    }
    if (stat.label === 'Outstanding') {
      return { ...stat, value: feesUnavailable ? '—' : formatFeeCurrency(feeMetrics.outstanding) }
    }
    if (stat.label === 'Overdue') {
      return { ...stat, value: feesUnavailable ? '—' : formatFeeCurrency(feeMetrics.overdue) }
    }
    if (stat.label === 'Parent Communications Awaiting Approval') {
      return { ...stat, value: String(communicationSummary.awaitingApproval) }
    }
    if (stat.label === 'Draft Attendance Messages') {
      return { ...stat, value: String(communicationSummary.teacherDrafts) }
    }
    if (stat.label === 'Attendance') {
      return {
        ...stat,
        value: attendanceUnavailable ? '—' : rate,
        subLabel: attendanceUnavailable ? 'Attendance data unavailable' : todayCounts.total
          ? `${todayCounts.total} of ${authorizedStudentCount} authorized students recorded`
          : 'No attendance recorded today',
      }
    }
    if (stat.label === 'Present') return { ...stat, value: attendanceUnavailable ? '—' : todayCounts.total ? String(todayCounts.present) : '—' }
    if (stat.label === 'Absent') return { ...stat, value: attendanceUnavailable ? '—' : todayCounts.total ? String(todayCounts.absent) : '—' }
    if (stat.label === 'Attendance Alerts' || stat.label === 'Alerts' || stat.label === 'Open alerts') {
      return { ...stat, label: 'Alerts', value: activeAlertCount, subLabel: 'Across attendance, fees, and communication' }
    }
    if (user.role === 'teacher' && stat.label === 'My Classes') {
      return { ...stat, value: String(classes.length), subLabel: 'Assigned classes' }
    }
    return stat
  })
  const attendanceItems: AttentionItem[] = alertsUnavailable ? [] : liveAlerts
    .filter((alert) => alert.sourceType === 'ATTENDANCE' && alert.status !== 'RESOLVED')
    .map((alert) => alertToAttention(alert, user))
  const attention = [...attendanceItems, ...feeAttention].slice(0, 5)
  const pendingCommunicationAlerts = liveAlerts.filter((alert) => alert.sourceType === 'COMMUNICATION' && alert.status === 'IN_REVIEW')
  if (!alertsUnavailable && pendingCommunicationAlerts.length && user.role !== 'teacher') {
    attention.unshift({
      level: 'NOTICE',
      title: 'Parent communications',
      detail: `${pendingCommunicationAlerts.length} message${pendingCommunicationAlerts.length === 1 ? '' : 's'} awaiting approval.`,
      cta: 'Review',
      path: '/communication',
    })
    attention.splice(5)
  }
  const scopeText = user.role === 'teacher' ? 'your assigned classes' : 'the authorized campus'
  const summary = todayCounts.total
    ? `Today's recorded attendance is ${rate} across ${todayCounts.total} student records in ${scopeText}. ${attendanceAttention.length} attendance items meet the current attention rules.`
    : `No attendance has been recorded today in ${scopeText}. ${attendanceAttention.length} items meet the current attention rules based on previously recorded sessions.`

  return {
    ...fixture,
    stats,
    morningBrief: { summary, cta: 'View Attendance' },
    attention,
    trend: getAttendanceTrend(attendance, students),
  }
}

function formatFeeCurrency(amount: number): string {
  return `PKR ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(amount)}`
}

function alertToAttention(alert: AlertItem, user: SessionUser): AttentionItem {
  if (alert.sourceType === 'COMMUNICATION') {
    return {
      level: alert.priority,
      title: alert.title,
      detail: alert.detail,
      cta: 'Review',
      path: user.role === 'finance' ? '/communication' : '/approvals',
    }
  }
  if (alert.sourceType === 'FEE') {
    return {
      level: alert.priority,
      title: alert.title,
      detail: alert.detail,
      cta: 'View Student',
      path: alert.studentId ? `/fees/${encodeURIComponent(alert.studentId)}` : '/fees',
    }
  }
  return {
    level: alert.priority,
    title: alert.title,
    detail: alert.detail,
    cta: alert.studentId ? 'View Student' : 'View Class',
    path: alert.studentId
      ? `/students/${encodeURIComponent(alert.studentId)}`
      : alert.classId
        ? `/attendance/take/${encodeURIComponent(alert.classId)}?date=${localDateKey()}`
        : '/attendance',
  }
}

function AlertsPage({
  user,
  alerts,
  loading,
  error,
  onRetry,
}: {
  user: SessionUser
  alerts: AlertItem[]
  loading: boolean
  error: string
  onRetry: () => void
}) {
  const navigate = useNavigate()
  const visibleAttendanceAlertIds = new Set(
    alerts
      .filter((alert) => alert.sourceType === 'ATTENDANCE')
      .sort((left, right) => {
        const priority = { HIGH: 0, MEDIUM: 1, NOTICE: 2 }
        return priority[left.priority] - priority[right.priority] || left.title.localeCompare(right.title)
      })
      .slice(0, 5)
      .map((alert) => alert.id),
  )
  const displayedAlerts = alerts.filter((alert) =>
    alert.sourceType !== 'ATTENDANCE' || visibleAttendanceAlertIds.has(alert.id),
  )

  const handleOpen = (alert: AlertItem) => {
    if (alert.sourceType === 'COMMUNICATION') {
      navigate(user.role === 'admin' || user.role === 'principal' ? '/approvals' : '/communication')
      return
    }
    if (alert.studentId) {
      navigate(`/students/${encodeURIComponent(alert.studentId)}`)
      return
    }
    if (alert.classId) {
      navigate(`/attendance/take/${encodeURIComponent(alert.classId)}`)
      return
    }
    navigate('/alerts')
  }

  return (
    <section className="alert-page">
      <div className="panel-header flex-header">
        <div>
          <p className="eyebrow">School oversight</p>
          <h1>Alerts</h1>
        </div>
        <div className="status-pill">{loading ? 'Loading…' : error ? 'Unavailable' : `${displayedAlerts.length} active`}</div>
      </div>

      {loading ? (
        <div className="empty-state-card" role="status">Loading live alerts…</div>
      ) : error ? (
        <div className="empty-state-card" role="alert">
          <h1>We couldn't load alerts.</h1>
          <p>{error}</p>
          <button type="button" className="primary-button small-button" onClick={onRetry}>Try again</button>
        </div>
      ) : displayedAlerts.length === 0 ? (
        <div className="empty-state-card">
          <div className="empty-icon">
            <BellRing size={22} />
          </div>
          <h1>No active alerts</h1>
          <p>Everything is currently in a healthy state for your authorized scope.</p>
        </div>
      ) : (
        <div className="alert-list">
          {displayedAlerts.map((alert) => (
            <article key={alert.id} className="alert-card">
              <div className="alert-head">
                <span className={`alert-badge ${alert.priority.toLowerCase()}`}>{alert.priority}</span>
                <span className="alert-status">{alert.status}</span>
              </div>
              <h3>{alert.title}</h3>
              <p>{alert.detail}</p>
              <div className="alert-meta">
                <span>{alert.sourceType}</span>
                <span>{new Date(alert.createdAt).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              </div>
              <button type="button" className="primary-button small-button" onClick={() => handleOpen(alert)}>
                {alert.sourceType === 'COMMUNICATION' ? 'Review' : 'Open'}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function ApprovalsPage({
  user,
  students,
  communication,
  loading,
  error,
  onRetry,
  onOperation,
}: {
  user: SessionUser
  students: Student[]
  communication: CommunicationState
  loading: boolean
  error: string
  onRetry: () => void
  onOperation: (operation: CommunicationOperation) => Promise<boolean>
}) {
  const items = useMemo(
    () => getAccessibleCommunication(communication, students, user).filter((message) => message.status === 'AWAITING_APPROVAL'),
    [communication, students, user],
  )
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({})

  if (user.role !== 'admin' && user.role !== 'principal') {
    return (
      <section className="alert-page">
        <div className="empty-state-card">
          <div className="empty-icon">
            <ShieldCheck size={22} />
          </div>
          <h1>Approvals unavailable</h1>
          <p>You do not have permission to review student communication approvals.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="alert-page">
      <div className="panel-header flex-header">
        <div>
          <p className="eyebrow">Approval queue</p>
          <h1>Approval Center</h1>
        </div>
        <div className="status-pill">{items.length} pending</div>
      </div>

      <div className="help-banner">
        <strong>Helpful tip:</strong> Review messages before they are marked as sent.
      </div>

      {loading ? (
        <div className="empty-state-card" role="status">Loading communication approvals…</div>
      ) : error ? (
        <div className="empty-state-card" role="alert">
          <h1>We couldn't load approvals.</h1>
          <p>{error}</p>
          <button type="button" className="primary-button small-button" onClick={onRetry}>Try again</button>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state-card">
          <div className="empty-icon">
            <ShieldCheck size={22} />
          </div>
          <h1>No pending approvals</h1>
          <p>Submitted parent communication will appear here for review.</p>
        </div>
      ) : (
        <div className="alert-list">
          {items.map((message) => (
            <article key={message.id} className="alert-card approval-card">
              <div className="alert-head">
                <span className="alert-badge notice">Review</span>
                <span className="alert-status">{message.status}</span>
              </div>
              <h3>{message.type}</h3>
              <p><strong>{message.student.firstName} {message.student.lastName}</strong> · Guardian: {message.guardianName}</p>
              <p>{message.message}</p>
              <div className="alert-meta">
                <span>{message.channel}</span>
                <span>{message.sourceType}</span>
                <span>{new Date(message.createdAt).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              </div>
              <textarea
                value={rejectReason[message.id] ?? ''}
                onChange={(event) => setRejectReason((current) => ({ ...current, [message.id]: event.target.value }))}
                placeholder="Reject reason (optional)"
              />
              <div className="alert-actions">
                <button type="button" className="primary-button small-button" onClick={() => onOperation({ type: 'approve', messageId: message.id })}>Approve</button>
                <button type="button" className="secondary-button small-button" onClick={() => onOperation({ type: 'reject', messageId: message.id, reason: rejectReason[message.id] || 'Please revise the communication before sending.' })}>Reject</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function DashboardLoadingState({ role }: { role: Role }) {
  const isTeacher = role === 'teacher'

  return (
    <section className="dashboard-page">
      <div className="skeleton hero-skeleton" />
      <div className="stats-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="skeleton stat-skeleton" />
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="skeleton panel-skeleton" />
        <div className="skeleton panel-skeleton small-panel" />
      </div>
      {!isTeacher ? <div className="skeleton chart-skeleton" /> : null}
    </section>
  )
}

function DashboardErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="dashboard-page">
      <div className="empty-state-card error-card">
        <div className="empty-icon error-icon">
          <AlertTriangle size={22} />
        </div>
        <h1>We couldn't load the dashboard.</h1>
        <p>Something went wrong while gathering your school summary.</p>
        <button type="button" className="primary-button small-button" onClick={onRetry}>Try Again</button>
      </div>
    </section>
  )
}

function EmptyDashboardState({ role }: { role: Role }) {
  const heading = role === 'teacher' ? 'No class data yet.' : 'No dashboard data yet.'
  const text =
    role === 'teacher'
      ? 'Attendance and class information will appear here after the class schedule is added.'
      : 'Dashboard information will appear here after attendance and school data is added.'

  return (
    <section className="dashboard-page">
      <div className="empty-state-card">
        <div className="empty-icon">
          <ClipboardCheck size={22} />
        </div>
        <h1>{heading}</h1>
        <p>{text}</p>
        <button type="button" className="primary-button small-button">Go to Attendance</button>
      </div>
    </section>
  )
}

function SchoolDashboard({ user, config }: { user: SessionUser; config: DashboardConfig }) {
  const navigate = useNavigate()

  return (
    <section className="dashboard-page">
      <DashboardHeader user={user} title={user.role === 'admin' ? 'Executive Dashboard' : 'School Operations Dashboard'} />

      <div className="stats-grid">
        {config.stats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </div>

      {config.morningBrief ? <MorningBrief summary={config.morningBrief.summary} cta={config.morningBrief.cta} /> : null}

      <div className="dashboard-grid">
        <DashboardSection title="Needs Attention">
          <AttentionList items={config.attention} onNavigate={navigate} />
        </DashboardSection>

        <DashboardSection title="Quick Actions">
          <QuickActions actions={config.quickActions} navigate={navigate} />
        </DashboardSection>
      </div>

      <DashboardSection title="Attendance — Last 7 Days">
        <SimpleTrendChart data={config.trend} emptyMessage="Collection trend will appear after payments are recorded." />
      </DashboardSection>
    </section>
  )
}

function FinanceDashboard({ user, config }: { user: SessionUser; config: DashboardConfig }) {
  const navigate = useNavigate()

  return (
    <section className="dashboard-page">
      <DashboardHeader user={user} title="Finance Dashboard" />

      <div className="stats-grid">
        {config.stats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </div>

      {config.morningBrief ? <MorningBrief summary={config.morningBrief.summary} cta={config.morningBrief.cta} /> : null}

      <div className="dashboard-grid">
        <DashboardSection title="Needs Attention">
          <AttentionList items={config.attention} />
        </DashboardSection>

        <DashboardSection title="Quick Actions">
          <QuickActions actions={config.quickActions} navigate={navigate} />
        </DashboardSection>
      </div>

      <DashboardSection title="Collections — This Month">
        <SimpleTrendChart data={config.trend} />
      </DashboardSection>
    </section>
  )
}

function TeacherDashboard({ user, config, students }: { user: SessionUser; config: DashboardConfig; students: Student[] }) {
  const navigate = useNavigate()
  const classes = getAttendanceClasses(students)
  const today = localDateKey()

  return (
    <section className="dashboard-page">
      <DashboardHeader user={user} title="Teacher Dashboard" />

      <div className="stats-grid">
        {config.stats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </div>

      {config.morningBrief ? <MorningBrief summary={config.morningBrief.summary} cta={config.morningBrief.cta} /> : null}

      <DashboardSection title="Today's Classes">
        <div className="class-list">
          {classes.map((attendanceClass) => (
            <div className="class-row" key={attendanceClass.id}>
              <div>
                <strong>{attendanceClass.className}-{attendanceClass.section}</strong>
                <span>{attendanceClass.students.length} Students</span>
              </div>
              <button type="button" className="primary-button small-button" onClick={() => navigate(`/attendance/take/${encodeURIComponent(attendanceClass.id)}?date=${today}`)}>
                Take Attendance
              </button>
            </div>
          ))}
          {!classes.length ? <p className="student-muted">No classes are assigned to you.</p> : null}
        </div>
      </DashboardSection>

      <div className="dashboard-grid">
        <DashboardSection title="Attention">
          <AttentionList items={config.attention} onNavigate={navigate} />
        </DashboardSection>

        <DashboardSection title="Quick Actions">
          <QuickActions actions={config.quickActions} navigate={navigate} />
        </DashboardSection>
      </div>
    </section>
  )
}

function DashboardHeader({ user, title }: { user: SessionUser; title: string }) {
  const firstName = user.name.split(' ')[0]

  return (
    <div className="hero-panel">
      <div>
        <p className="eyebrow">{title}</p>
        <h1>Good Morning, {firstName} 👋</h1>
        <p>Here&apos;s what needs your attention today.</p>
      </div>

      <div className="hero-meta">
        <div className="meta-pill">
          <Building2 size={16} />
          <span>{user.schoolName}</span>
        </div>
        <div className="meta-pill muted-pill">
          <CalendarDays size={16} />
          <span>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
      </div>
    </div>
  )
}

function StatCard({ stat }: { stat: StatItem }) {
  const Icon = stat.icon

  return (
    <article className={`stat-card ${stat.tone}`}>
      <div className="stat-topline">
        <span className="stat-label">{stat.label}</span>
        <span className="stat-icon-box">
          <Icon size={16} />
        </span>
      </div>
      <strong>{stat.value}</strong>
      <small>{stat.subLabel}</small>
      {stat.trendLabel ? (
        <span className="stat-trend">
          <TrendingUp size={12} />
          {stat.trendLabel}
        </span>
      ) : null}
    </article>
  )
}

function MorningBrief({ summary, cta }: { summary: string; cta: string }) {
  return (
    <div className="morning-brief">
      <div className="brief-title">
        <Sparkles size={18} />
        <h3>AI Morning Brief ✨</h3>
      </div>
      <p>{summary}</p>
      <button type="button" className="secondary-button compact-button">
        {cta}
      </button>
    </div>
  )
}

function DashboardSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel-card">
      <div className="panel-header">
        <h3>{title}</h3>
        <span className="status-pill success">Updated</span>
      </div>
      {children}
    </section>
  )
}

function AttentionList({ items, onNavigate }: { items: AttentionItem[]; onNavigate?: (path: string) => void }) {
  if (!items.length) return <p className="student-muted">No attendance items need attention.</p>
  return (
    <ul className="list-stack">
      {items.map((item) => (
        <li key={`${item.level}-${item.title}`}>
          <div className="attention-copy">
            <span className={`level-badge ${item.level.toLowerCase()}`}>{item.level}</span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </div>
          </div>
          <button type="button" className="action-tag" onClick={() => item.path && onNavigate?.(item.path)}>{item.cta}</button>
        </li>
      ))}
    </ul>
  )
}

function QuickActions({ actions, navigate }: { actions: QuickAction[]; navigate: (path: string) => void }) {
  return (
    <div className="action-list">
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <button key={action.label} type="button" className="action-chip" onClick={() => navigate(action.path)}>
            <Icon size={16} />
            {action.label}
          </button>
        )
      })}
    </div>
  )
}

function SimpleTrendChart({ data, emptyMessage = 'Trend data will appear after attendance has been recorded.' }: { data: TrendPoint[]; emptyMessage?: string }) {
  if (!data.length) {
    return <p className="student-muted">{emptyMessage}</p>
  }
  const width = 640
  const height = 180
  const padding = 22
  const maxValue = Math.max(...data.map((point) => point.value))
  const minValue = Math.min(...data.map((point) => point.value))

  const points = data
    .map((point, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(data.length - 1, 1)
      const y = height - padding - ((point.value - minValue) / Math.max(maxValue - minValue, 1)) * (height - padding * 2)
      return `${x},${y}`
    })
    .join(' ')

  return (
    <div className="chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trend chart">
        <polyline points={points} fill="none" stroke="#2a6ef5" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((point, index) => {
          const x = padding + (index * (width - padding * 2)) / Math.max(data.length - 1, 1)
          const y = height - padding - ((point.value - minValue) / Math.max(maxValue - minValue, 1)) * (height - padding * 2)

          return (
            <g key={point.day}>
              <circle cx={x} cy={y} r="4" fill="#2a6ef5" />
              <text x={x} y={height - 4} textAnchor="middle" className="chart-label">
                {point.day}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function AskEduPage({
  user,
  students,
  fees,
  communication,
  alerts,
  alertsLoading,
  alertsError,
}: {
  user: SessionUser
  students: Student[]
  fees: FeeState
  communication: CommunicationState
  alerts: AlertItem[]
  alertsLoading: boolean
  alertsError: string
}) {
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<Array<{ role: 'assistant' | 'user'; text: string }>>([
    {
      role: 'assistant',
      text: 'I can summarize attendance risk, fee pressure, communication workflow, and student focus areas for your authorized school scope.',
    },
  ])

  const accessibleStudents = useMemo(() => getAccessibleStudents(students, user), [students, user])
  const communicationSummary = useMemo(
    () => getCommunicationSummary(communication, students, user),
    [communication, students, user],
  )
  const feeInvoices = useMemo(() => getFeeInvoices(fees, students, user), [fees, students, user])
  const feeMetrics = useMemo(() => getFeeMetrics(feeInvoices), [feeInvoices])
  const suggestionCards = [
    'Summarize attendance risk for my classes',
    'Show me fee status and overdue totals',
    'What needs approval right now?',
    'Which students need attention today?',
  ]

  const submitPrompt = (prompt: string) => {
    const normalized = prompt.trim()
    if (!normalized) return

    const response = generateAskEduResponse(normalized)
    setMessages((current) => [...current, { role: 'user', text: normalized }, { role: 'assistant', text: response }])
    setQuery('')
  }

  const generateAskEduResponse = (prompt: string): string => {
    const lowered = prompt.toLowerCase()

    if (lowered.includes('attendance') || lowered.includes('risk') || lowered.includes('class')) {
      if (alertsLoading) return 'Live attendance alert data is loading. Please try again shortly.'
      if (alertsError) return 'Live attendance alert data is unavailable. Open Alerts and retry the request.'
      const attention = alerts.filter((alert) => alert.sourceType === 'ATTENDANCE' && alert.status !== 'RESOLVED')
      if (!attention.length) {
        return `Attendance is currently stable in your scope. There are no active attendance alerts in the current set of recorded sessions.`
      }
      const top = attention.slice(0, 2).map((item) => item.title).join(', ')
      return `I found ${attention.length} attendance watch items in the current scope, including ${top}. These are most likely to need follow-up attention.`
    }

    if (lowered.includes('fee') || lowered.includes('overdue') || lowered.includes('payment')) {
      if (!feeInvoices.length) {
        return 'There are no fee records in your authorized scope right now.'
      }
      const overdueCount = feeInvoices.filter((invoice) => invoice.overdueDays > 0).length
      return `Fee overview: PKR ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(feeMetrics.outstanding)} is outstanding across ${feeInvoices.length} invoices, with ${overdueCount} overdue items and ${communicationSummary.feeAwaitingApproval} fee reminders awaiting approval.`
    }

    if (lowered.includes('approval') || lowered.includes('communication')) {
      return `Current communication workload: ${communicationSummary.awaitingApproval} message(s) awaiting approval, ${communicationSummary.drafts} drafts in progress, and ${communicationSummary.deliveryIssues} delivery issues reported.`
    }

    if (lowered.includes('student') || lowered.includes('focus') || lowered.includes('attention')) {
      if (alertsLoading || alertsError) return 'Live alert data is currently unavailable. Please open Alerts to check its status and retry.'
      const studentCount = accessibleStudents.length
      return `Your authorized scope includes ${studentCount} students. There are ${alerts.filter((alert) => alert.status !== 'RESOLVED').length} active alerts and ${communicationSummary.awaitingApproval} approval items requiring review.`
    }

    if (alertsLoading || alertsError) return 'Live alert data is currently unavailable. Please open Alerts to check its status and retry.'
    return `Current summary: ${accessibleStudents.length} students are in scope, ${alerts.filter((alert) => alert.status !== 'RESOLVED').length} alerts are active, and ${communicationSummary.awaitingApproval} parent communications are awaiting review. The most important next action is to check the highest-priority alert and any fee or attendance risk items first.`
  }

  return (
    <section className="ask-edu-page">
      <div className="panel-header flex-header">
        <div>
          <p className="eyebrow">School intelligence</p>
          <h1>Ask EduPulse</h1>
        </div>
        <div className="status-pill">Live school brief</div>
      </div>

      <div className="help-banner">
        <strong>Helpful tip:</strong> Ask questions using your authorized school data.
      </div>

      <div className="ask-edu-layout">
        <div className="ask-edu-sidebar">
          <h3>Suggested prompts</h3>
          {suggestionCards.map((suggestion) => (
            <button key={suggestion} type="button" className="ask-edu-suggestion" onClick={() => submitPrompt(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>

        <div className="ask-edu-panel">
          <div className="ask-edu-header">
            <div>
              <strong>{user.name}</strong>
              <span>{user.role}</span>
            </div>
          </div>

          <div className="ask-edu-messages">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`ask-edu-message ${message.role}`}>
                <p>{message.text}</p>
              </div>
            ))}
          </div>

          <form
            className="ask-edu-form"
            onSubmit={(event) => {
              event.preventDefault()
              submitPrompt(query)
            }}
          >
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask about attendance, fees, approvals, or student focus areas..."
            />
            <button type="submit" className="primary-button small-button">Ask</button>
          </form>
        </div>
      </div>
    </section>
  )
}

function ReportsPage({ user, students, attendance, fees, communication }: {
  user: SessionUser
  students: Student[]
  attendance: AttendanceState
  fees: FeeState
  communication: CommunicationState
}) {
  const accessibleStudents = useMemo(() => getAccessibleStudents(students, user), [students, user])
  const attendanceAttention = useMemo(() => getAttendanceAttention(attendance, students), [attendance, students])
  const feeInvoices = useMemo(() => getFeeInvoices(fees, students, user), [fees, students, user])
  const feeMetrics = useMemo(() => getFeeMetrics(feeInvoices), [feeInvoices])
  const communicationSummary = useMemo(() => getCommunicationSummary(communication, students, user), [communication, students, user])

  return (
    <section className="dashboard-page">
      <div className="panel-header flex-header">
        <div>
          <p className="eyebrow">Operational overview</p>
          <h1>Reports</h1>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard stat={{ label: 'Students in scope', value: String(accessibleStudents.length), subLabel: 'Accessible records', tone: 'blue', icon: Users }} />
        <StatCard stat={{ label: 'Attendance alerts', value: String(attendanceAttention.length), subLabel: 'Follow-ups needed', tone: 'amber', icon: ClipboardCheck }} />
        <StatCard stat={{ label: 'Outstanding fees', value: formatFeeCurrency(feeMetrics.outstanding), subLabel: 'Current balance', tone: 'purple', icon: Wallet }} />
        <StatCard stat={{ label: 'Pending approvals', value: String(communicationSummary.awaitingApproval), subLabel: 'Waiting review', tone: 'green', icon: ShieldCheck }} />
      </div>

      <div className="dashboard-grid">
        <div className="panel-card">
          <h3>School summary</h3>
          <p className="student-muted">The latest pilot overview highlights student coverage, fee exposure, and communication review load.</p>
        </div>
        <div className="panel-card">
          <h3>Top priorities</h3>
          <ul className="list-stack">
            <li><span>Attendance follow-up</span><strong>{attendanceAttention.length}</strong></li>
            <li><span>Outstanding fees</span><strong>{formatFeeCurrency(feeMetrics.outstanding)}</strong></li>
            <li><span>Communication approvals</span><strong>{communicationSummary.awaitingApproval}</strong></li>
          </ul>
        </div>
      </div>
    </section>
  )
}

function MyClassesPage({ user, students, attendance, attendanceLoading, attendanceError, onRetry }: {
  user: SessionUser
  students: Student[]
  attendance: AttendanceState
  attendanceLoading: boolean
  attendanceError: string
  onRetry: () => void
}) {
  const navigate = useNavigate()
  const classes = user.teacherAssignments
    .filter((assignment) => assignment.active)
    .map((assignment) => ({
      id: getAttendanceClassId(assignment.class_name, assignment.section, assignment.campus_id),
      schoolId: assignment.school_id,
      campusId: assignment.campus_id,
      className: assignment.class_name,
      section: assignment.section,
      students: students.filter((student) =>
        student.schoolId === assignment.school_id &&
        student.campusId === assignment.campus_id &&
        student.className === assignment.class_name &&
        student.section === assignment.section,
      ),
    }))

  return (
    <section className="dashboard-page">
      <div className="panel-header flex-header">
        <div>
          <p className="eyebrow">My schedule</p>
          <h1>My Classes</h1>
        </div>
      </div>

      {attendanceError ? <div className="attendance-empty-notice" role="alert">{attendanceError} <button type="button" className="student-link" onClick={onRetry}>Try again</button></div> : null}
      <div className="dashboard-grid">
        {classes.length ? classes.map((attendanceClass) => (
          <div key={attendanceClass.id} className="panel-card">
            <h3>{attendanceClass.className}</h3>
            <p className="student-muted">Section {attendanceClass.section}</p>
            <ul className="list-stack">
              <li><span>Students</span><strong>{attendanceClass.students.length}</strong></li>
              <li><span>Attendance status</span><strong>{attendanceLoading ? 'Loading…' : attendanceError ? 'Unavailable' : getSessionForClass(attendance, localDateKey(), attendanceClass) ? 'Recorded today' : 'Not marked yet'}</strong></li>
            </ul>
            <button
              type="button"
              className="primary-button small-button"
              disabled={attendanceLoading || Boolean(attendanceError)}
              onClick={() => navigate(`/attendance/take/${encodeURIComponent(attendanceClass.id)}?date=${localDateKey()}`)}
            >
              Open Attendance
            </button>
          </div>
        )) : (
          <div className="empty-state-card">
            <div className="empty-icon"><BookOpenText size={22} /></div>
            <h1>No assigned classes</h1>
            <p>Class assignments will appear here once your schedule is active.</p>
          </div>
        )}
      </div>
    </section>
  )
}

function AdministrationPage({
  user,
  snapshot,
  loading,
  error,
  profiles,
  profilesLoading,
  profilesError,
  onRetryProfiles,
  onRetry,
  onSaveSchool,
  onSaveCampus,
}: {
  user: SessionUser
  snapshot: AdministrationSnapshot | null
  loading: boolean
  error: string
  profiles: SchoolUser[]
  profilesLoading: boolean
  profilesError: string
  onRetryProfiles: () => void
  onRetry: () => void
  onSaveSchool: (values: Pick<SchoolSettingsRecord, 'name' | 'short_name' | 'email' | 'phone' | 'address' | 'timezone'>) => Promise<void>
  onSaveCampus: (campusId: string, values: Pick<CampusSettingsRecord, 'name' | 'code' | 'address' | 'status'>) => Promise<void>
}) {
  const canEdit = user.role === 'admin'
  const [schoolForm, setSchoolForm] = useState<Partial<Pick<SchoolSettingsRecord, 'name' | 'short_name' | 'email' | 'phone' | 'address' | 'timezone'>>>({})
  const [campusId, setCampusId] = useState('')
  const [campusForm, setCampusForm] = useState<Partial<Pick<CampusSettingsRecord, 'name' | 'code' | 'address' | 'status'>>>({})
  const [schoolSaving, setSchoolSaving] = useState(false)
  const [campusSaving, setCampusSaving] = useState(false)
  const [schoolError, setSchoolError] = useState('')
  const [campusError, setCampusError] = useState('')
  const [schoolSaved, setSchoolSaved] = useState(false)
  const [campusSaved, setCampusSaved] = useState(false)
  const selectedCampusId = campusId || snapshot?.campuses[0]?.id || ''
  const selectedCampus = snapshot?.campuses.find((campus) => campus.id === selectedCampusId) ?? null

  const handleSchoolSave = async (event: FormEvent) => {
    event.preventDefault()
    setSchoolError('')
    setSchoolSaved(false)
    setSchoolSaving(true)
    try {
      await onSaveSchool({
        name: (schoolForm.name ?? snapshot?.school.name ?? '').trim(),
        short_name: (schoolForm.short_name ?? snapshot?.school.short_name ?? '').trim(),
        email: (schoolForm.email ?? snapshot?.school.email ?? '').trim() || null,
        phone: (schoolForm.phone ?? snapshot?.school.phone ?? '').trim() || null,
        address: (schoolForm.address ?? snapshot?.school.address ?? '').trim() || null,
        timezone: (schoolForm.timezone ?? snapshot?.school.timezone ?? '').trim() || null,
      })
      setSchoolSaved(true)
    } catch (saveError) {
      setSchoolError(saveError instanceof Error ? saveError.message : 'Unable to save school settings.')
    } finally {
      setSchoolSaving(false)
    }
  }

  const handleCampusSave = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedCampus) return
    setCampusError('')
    setCampusSaved(false)
    setCampusSaving(true)
    try {
      await onSaveCampus(selectedCampus.id, {
        name: (campusForm.name ?? selectedCampus.name).trim(),
        code: (campusForm.code ?? selectedCampus.code).trim(),
        address: (campusForm.address ?? selectedCampus.address ?? '').trim() || null,
        status: campusForm.status ?? selectedCampus.status,
      })
      setCampusSaved(true)
    } catch (saveError) {
      setCampusError(saveError instanceof Error ? saveError.message : 'Unable to save campus settings.')
    } finally {
      setCampusSaving(false)
    }
  }

  return (
    <section className="users-page">
      <div className="panel-header flex-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Administration &amp; Settings</h1>
          <p className="student-muted">{canEdit ? 'Changes are saved to this school in Supabase.' : 'Settings are read-only for your role.'}</p>
        </div>
      </div>

      {loading ? <div className="empty-state-card" role="status">Loading live school settings…</div> : null}
      {!loading && error ? (
        <div className="empty-state-card error-card" role="alert">
          <h2>School settings unavailable</h2>
          <p>{error}</p>
          <button type="button" className="primary-button small-button" onClick={onRetry}>Try again</button>
        </div>
      ) : null}
      {!loading && !error && snapshot ? (
        <>
          <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <div className="panel-card">
              <h3>School profile</h3>
              <form className="user-form" onSubmit={handleSchoolSave}>
                <label><span>School name</span><input required maxLength={160} disabled={!canEdit || schoolSaving} value={schoolForm.name ?? snapshot.school.name} onChange={(event) => setSchoolForm((current) => ({ ...current, name: event.target.value }))} /></label>
                <label><span>Short name</span><input required maxLength={80} disabled={!canEdit || schoolSaving} value={schoolForm.short_name ?? snapshot.school.short_name} onChange={(event) => setSchoolForm((current) => ({ ...current, short_name: event.target.value }))} /></label>
                <label><span>Email</span><input type="email" maxLength={254} disabled={!canEdit || schoolSaving} value={schoolForm.email ?? snapshot.school.email ?? ''} onChange={(event) => setSchoolForm((current) => ({ ...current, email: event.target.value }))} /></label>
                <label><span>Phone</span><input maxLength={40} disabled={!canEdit || schoolSaving} value={schoolForm.phone ?? snapshot.school.phone ?? ''} onChange={(event) => setSchoolForm((current) => ({ ...current, phone: event.target.value }))} /></label>
                <label><span>Address</span><input maxLength={240} disabled={!canEdit || schoolSaving} value={schoolForm.address ?? snapshot.school.address ?? ''} onChange={(event) => setSchoolForm((current) => ({ ...current, address: event.target.value }))} /></label>
                <label><span>Timezone</span><input maxLength={80} disabled={!canEdit || schoolSaving} value={schoolForm.timezone ?? snapshot.school.timezone ?? ''} onChange={(event) => setSchoolForm((current) => ({ ...current, timezone: event.target.value }))} /></label>
                {canEdit ? <button type="submit" className="primary-button small-button" disabled={schoolSaving}>{schoolSaving ? 'Saving…' : 'Save school settings'}</button> : null}
                {schoolError ? <p className="communication-feedback error" role="alert">{schoolError}</p> : null}
                {schoolSaved ? <p className="communication-feedback success" role="status">School settings saved.</p> : null}
                <p className="student-muted">Last updated {new Date(snapshot.school.updated_at).toLocaleString()}.</p>
              </form>
            </div>

            <div className="panel-card">
              <h3>Campus settings</h3>
              {snapshot.campuses.length ? (
                <>
                  <label className="user-form"><span>Campus</span><select disabled={campusSaving} value={selectedCampusId} onChange={(event) => { setCampusId(event.target.value); setCampusForm({}); setCampusSaved(false); setCampusError('') }}>{snapshot.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name} · {campus.code}</option>)}</select></label>
                  {selectedCampus ? (
                    <form className="user-form" onSubmit={handleCampusSave}>
                      <label><span>Campus name</span><input required maxLength={160} disabled={!canEdit || campusSaving} value={campusForm.name ?? selectedCampus.name} onChange={(event) => setCampusForm((current) => ({ ...current, name: event.target.value }))} /></label>
                      <label><span>Campus code</span><input required maxLength={40} disabled={!canEdit || campusSaving} value={campusForm.code ?? selectedCampus.code} onChange={(event) => setCampusForm((current) => ({ ...current, code: event.target.value }))} /></label>
                      <label><span>Address</span><input maxLength={240} disabled={!canEdit || campusSaving} value={campusForm.address ?? selectedCampus.address ?? ''} onChange={(event) => setCampusForm((current) => ({ ...current, address: event.target.value }))} /></label>
                      <label><span>Status</span><select disabled={!canEdit || campusSaving} value={campusForm.status ?? selectedCampus.status} onChange={(event) => setCampusForm((current) => ({ ...current, status: event.target.value as CampusSettingsRecord['status'] }))}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
                      {canEdit ? <button type="submit" className="primary-button small-button" disabled={campusSaving}>{campusSaving ? 'Saving…' : 'Save campus'}</button> : null}
                      {campusError ? <p className="communication-feedback error" role="alert">{campusError}</p> : null}
                      {campusSaved ? <p className="communication-feedback success" role="status">Campus settings saved.</p> : null}
                    </form>
                  ) : null}
                </>
              ) : <p className="student-muted">No campus records are available in this school.</p>}
            </div>
          </div>

          <div className="panel-card" style={{ marginTop: '24px' }}>
            <h3>Integration metadata</h3>
            <p className="student-muted">Status is configuration metadata only. No connection or provider health check is implied; message delivery is not configured here.</p>
            {snapshot.integrations.length ? (
              <div className="table-card">
                <table>
                  <thead><tr><th>Provider</th><th>Status</th><th>Non-secret identifier</th></tr></thead>
                  <tbody>{snapshot.integrations.map((item) => (
                    <tr key={item.id}>
                      <td>{item.provider_key}</td>
                      <td><span className="status-pill">{item.status.replaceAll('_', ' ')}</span></td>
                      <td>{item.external_identifier ?? '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="student-muted">No integration metadata is configured.</p>}
          </div>
        </>
      ) : null}

      <div className="panel-card" style={{ marginTop: '24px' }}>
        <h3>Import history</h3>
        <p className="student-muted">No live import-history records are available. CSV upload currently supports preview only; it does not import records or create an integration connection.</p>
      </div>

      {canEdit || user.role === 'principal' ? <ProfilesDirectoryPage profiles={profiles} loading={profilesLoading} error={profilesError} onRetry={onRetryProfiles} /> : null}
    </section>
  )
}

function ProfilesDirectoryPage({ profiles, loading, error, onRetry }: {
  profiles: SchoolUser[]
  loading: boolean
  error: string
  onRetry: () => void
}) {
  return (
    <section className="users-page">
      <div className="panel-header flex-header">
        <div>
          <p className="eyebrow">Access management</p>
          <h1>Profiles</h1>
          <p className="student-muted">Profile roles, campus, and account status are read from Supabase.</p>
        </div>
      </div>
      {loading ? <div className="empty-state-card" role="status">Loading profiles…</div> : null}
      {!loading && error ? <div className="empty-state-card error-card" role="alert"><p>{error}</p><button type="button" className="primary-button small-button" onClick={onRetry}>Try again</button></div> : null}
      {!loading && !error && profiles.length === 0 ? <div className="empty-state-card">No profiles are visible in your authorized scope.</div> : null}
      {!loading && !error && profiles.length ? (
        <div className="table-card">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Campus</th><th>Status</th></tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.email}>
                  <td>{profile.name}</td>
                  <td>{profile.email}</td>
                  <td>{roleLabels[profile.role]}</td>
                  <td>{profile.campus}</td>
                  <td><span className={`status-pill ${profile.status === 'Active' ? 'success' : 'muted'}`}>{profile.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

export default App
