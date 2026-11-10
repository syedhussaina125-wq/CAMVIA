import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lightbulb,
  LockKeyhole,
  Mail,
  Menu,
  Moon,
  Sun,
  Banknote,
  Bell,
  BellRing,
  BookCheck,
  BookOpenText,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
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
  X,
  Zap,
  Trash2,
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
  type SessionUser,
} from './mockData'
const StudentDetailPage = lazy(() => import('./StudentPages').then((module) => ({ default: module.StudentDetailPage })))
const StudentsPage = lazy(() => import('./StudentPages').then((module) => ({ default: module.StudentsPage })))
const AttendancePage = lazy(() => import('./AttendancePages').then((module) => ({ default: module.AttendancePage })))
const TakeAttendancePage = lazy(() => import('./AttendancePages').then((module) => ({ default: module.TakeAttendancePage })))
const FeeStudentDetailPage = lazy(() => import('./FeesPages').then((module) => ({ default: module.FeeStudentDetailPage })))
const FeesPage = lazy(() => import('./FeesPages').then((module) => ({ default: module.FeesPage })))
const CommunicationPage = lazy(() => import('./CommunicationPages').then((module) => ({ default: module.CommunicationPage })))
const TrashPage = lazy(() => import('./TrashPage').then((module) => ({ default: module.TrashPage })))
const AskEduPage = lazy(() => import('./AskEduPage').then((module) => ({ default: module.AskEduPage })))
const ReportsPage = lazy(() => import('./ReportsPage').then((module) => ({ default: module.ReportsPage })))
const AdministrationPage = lazy(() => import('./AdministrationPages').then((module) => ({ default: module.AdministrationPage })))
const ProfilesDirectoryPage = lazy(() => import('./AdministrationPages').then((module) => ({ default: module.ProfilesDirectoryPage })))
import { type AlertItem } from './alertsData'
import {
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
import { formatMMSS, getActiveLockout, getActiveProfile, normalizeRole, resetPasswordForEmail, signInWithEmail, signOut as signOutSupabase, updateUserPassword, type AppProfile } from './services/auth'
import { createStudentRecord as createLiveStudent, fetchStudents, fetchTeacherAssignments } from './services/students'
import { fetchProfiles } from './services/users'
import { deactivateSchoolUser, inviteSchoolUser, updateSchoolUser, type SchoolUserInput } from './services/userManagement'
import { fetchAttendanceState, saveAttendance as saveLiveAttendance, correctAttendanceSession } from './services/attendance'
import { createFeeInvoice as createLiveFeeInvoice, fetchFeeState, recordFeePayment as recordLiveFeePayment } from './services/fees'
import { fetchCommunicationState, saveCommunicationDraft as saveLiveCommunicationDraft, transitionCommunication, deleteCommunicationDraft } from './services/communication'
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
  type FeeInvoiceCreationInput,
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
const AIBuddy = lazy(() => import('./components/ai-buddy/AIBuddy').then((module) => ({ default: module.AIBuddy })))
import { AskCamviaProvider } from './components/ai-buddy/AskCamviaContext'
import { dispatchBuddyEvent } from './components/ai-buddy/events'
import camviaLogo from './assets/camvia-dark-logo.png'
import schoolBuildingIllustration from './assets/school-building-reference.png'
import './App.css'
import './LoginPage.css'

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
  description: string
  icon: LucideIcon
  path: string
}

type TrendPoint = {
  day: string
  value: number
}

type DashboardActivity = {
  id: string
  title: string
  detail: string
  occurredAt: string
  path: string
  icon: LucideIcon
  tone: 'blue' | 'teal' | 'purple'
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
    { title: 'Ask CAMVIA', text: 'Ask CAMVIA lets you ask questions about your authorized school data.' },
  ],
  principal: [
    { title: 'School overview', text: 'This is your dashboard. See trends and attention areas at a glance.' },
    { title: 'Students', text: 'Use Student 360 to review student-level detail and context quickly.' },
    { title: 'Attendance', text: 'Attendance helps you monitor class health and follow-up priorities.' },
    { title: 'Alerts', text: 'Alerts surfaces the issues that need your review and action.' },
    { title: 'Ask CAMVIA', text: 'Ask CAMVIA gives you fast, role-aware answers from the school data you can access.' },
  ],
  finance: [
    { title: 'Finance dashboard', text: 'This dashboard brings fee collections, balances, and overdue attention into one place.' },
    { title: 'Fees & Collections', text: 'Fees & Collections shows outstanding and overdue balances across the school.' },
    { title: 'Parent Communication', text: 'Use Parent Communication to prepare reminders and follow-ups.' },
    { title: 'Ask CAMVIA', text: 'Ask CAMVIA helps you answer fee and collection questions using your authorized data.' },
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
  '/ask-edu': 'Ask CAMVIA',
  '/administration': 'Administration',
  '/reports': 'Reports',
  '/users': 'Users',
  '/my-classes': 'My Classes',
  '/trash': 'Trash',
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
    { label: 'Ask CAMVIA', path: '/ask-edu', icon: Sparkles },
    { label: 'Reports', path: '/reports', icon: Gauge },
    { label: 'Administration', path: '/administration', icon: UserCog },
    { label: 'Trash', path: '/trash', icon: Trash2 },
  ],
  principal: [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { label: 'Students', path: '/students', icon: GraduationCap },
    { label: 'Attendance', path: '/attendance', icon: ClipboardCheck },
    { label: 'Alerts', path: '/alerts', icon: BellRing },
    { label: 'Approval Center', path: '/approvals', icon: ShieldCheck },
    { label: 'Parent Communication', path: '/communication', icon: MessageSquareText },
    { label: 'Ask CAMVIA', path: '/ask-edu', icon: Sparkles },
    { label: 'Reports', path: '/reports', icon: Gauge },
  ],
  finance: [
    { label: 'Dashboard', path: '/finance/dashboard', icon: LayoutDashboard },
    { label: 'Students', path: '/students', icon: GraduationCap },
    { label: 'Fees & Collections', path: '/fees', icon: Wallet },
    { label: 'Alerts', path: '/alerts', icon: BellRing },
    { label: 'Parent Communication', path: '/communication', icon: MessageSquareText },
    { label: 'Ask CAMVIA', path: '/ask-edu', icon: Sparkles },
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
  admin: ['/dashboard', '/students', '/attendance', '/fees', '/alerts', '/approvals', '/communication', '/ask-edu', '/administration', '/reports', '/users', '/trash'],
  principal: ['/dashboard', '/students', '/attendance', '/alerts', '/approvals', '/communication', '/ask-edu', '/reports'],
  finance: ['/finance/dashboard', '/students', '/fees', '/alerts', '/communication', '/ask-edu'],
  teacher: ['/teacher/dashboard', '/my-classes', '/students', '/attendance', '/communication', '/alerts'],
}

const dashboardFixtures: Record<Role, DashboardConfig> = {
  admin: {
    stats: [
      { label: 'Students', value: '0', subLabel: 'Total students', tone: 'blue', icon: Users },
      { label: 'Attendance', value: '0%', subLabel: 'Today', tone: 'cyan', icon: ClipboardCheck },
      { label: 'Collected This Month', value: 'PKR 0', subLabel: 'Fee collections', tone: 'green', icon: Wallet },
      { label: 'Outstanding', value: 'PKR 0', subLabel: 'Current fee balance', tone: 'purple', icon: CreditCard },
      { label: 'Overdue', value: 'PKR 0', subLabel: 'Past-due balance', tone: 'red', icon: AlertTriangle },
      { label: 'Parent Communications Awaiting Approval', value: '0', subLabel: 'Pending review', tone: 'amber', icon: MessageSquareText },
      { label: 'Alerts', value: '0', subLabel: 'Need attention', tone: 'amber', icon: BellRing },
    ],
    morningBrief: {
      summary: 'Attendance and school metrics will appear once student and class data is added.',
      cta: 'Add Students',
    },
    attention: [],
    quickActions: [
      { label: 'Add Student', description: 'Create a student record for this school', icon: GraduationCap, path: '/students' },
      { label: 'Add User', description: 'Invite a staff or teacher account', icon: UserCog, path: '/users' },
      { label: 'Mark Attendance', description: 'Open today’s class attendance workflow', icon: ClipboardCheck, path: '/attendance' },
      { label: 'View Alerts', description: 'Review active school follow-ups', icon: BellRing, path: '/alerts' },
    ],
    trend: [],
  },
  principal: {
    stats: [
      { label: 'Students', value: '0', subLabel: 'Total students', tone: 'blue', icon: Users },
      { label: 'Attendance', value: '0%', subLabel: 'Today', tone: 'blue', icon: ClipboardCheck },
      { label: 'Present', value: '0', subLabel: 'Students present', tone: 'green', icon: Users },
      { label: 'Absent', value: '0', subLabel: 'Students absent', tone: 'amber', icon: AlertTriangle },
      { label: 'Attendance Alerts', value: '0', subLabel: 'Based on recorded sessions', tone: 'red', icon: BellRing },
      { label: 'Collected This Month', value: 'PKR 0', subLabel: 'Fee collections', tone: 'green', icon: Wallet },
      { label: 'Outstanding', value: 'PKR 0', subLabel: 'Current fee balance', tone: 'purple', icon: CreditCard },
      { label: 'Overdue', value: 'PKR 0', subLabel: 'Past-due balance', tone: 'amber', icon: AlertTriangle },
      { label: 'Parent Communications Awaiting Approval', value: '0', subLabel: 'Pending review', tone: 'purple', icon: MessageSquareText },
    ],
    morningBrief: {
      summary: 'Attendance and school metrics will appear once student and class data is added.',
      cta: 'View Students',
    },
    attention: [],
    quickActions: [
      { label: 'View Attendance', description: 'Review daily attendance performance and risks', icon: ClipboardCheck, path: '/attendance' },
      { label: 'View Students', description: 'Open student records and academic summaries', icon: GraduationCap, path: '/students' },
      { label: 'Review Approvals', description: 'Approve submitted parent communications', icon: ShieldCheck, path: '/approvals' },
      { label: 'Review Alerts', description: 'Check the latest school and campus alerts', icon: BellRing, path: '/alerts' },
    ],
    trend: [],
  },
  finance: {
    stats: [
      { label: 'Expected', value: 'PKR 0', subLabel: 'Total expected fees', tone: 'blue', icon: Banknote },
      { label: 'Collected', value: 'PKR 0', subLabel: 'This month', tone: 'green', icon: CircleDollarSign },
      { label: 'Outstanding', value: 'PKR 0', subLabel: 'Current balance', tone: 'purple', icon: CreditCard },
      { label: 'Overdue', value: 'PKR 0', subLabel: 'Past due amount', tone: 'red', icon: AlertTriangle },
      { label: 'Fee Reminders Awaiting Review', value: '0', subLabel: 'Pending approval', tone: 'amber', icon: MessageSquareText },
    ],
    morningBrief: {
      summary: 'Fee collection totals will appear once student fee invoices are recorded.',
      cta: 'View Fees',
    },
    attention: [],
    quickActions: [
      { label: 'View Outstanding Fees', description: 'Review unpaid balances and collection priorities', icon: Wallet, path: '/fees' },
      { label: 'Prepare Fee Reminder', description: 'Draft and send parent payment follow-ups', icon: MessageSquareText, path: '/communication' },
      { label: 'View Collections', description: 'Track this month’s cash collections and trends', icon: TrendingUp, path: '/fees' },
    ],
    trend: [],
  },
  teacher: {
    stats: [
      { label: 'My Classes', value: '0', subLabel: 'Assigned classes', tone: 'blue', icon: BookCheck },
      { label: 'Students', value: '0', subLabel: 'Assigned students', tone: 'cyan', icon: Users },
      { label: 'Attendance', value: '0%', subLabel: "Today's attendance", tone: 'green', icon: ClipboardCheck },
      { label: 'Attendance Alerts', value: '0', subLabel: 'Based on recorded sessions', tone: 'amber', icon: AlertTriangle },
      { label: 'Draft Attendance Messages', value: '0', subLabel: 'Ready to submit', tone: 'purple', icon: MessageSquareText },
    ],
    morningBrief: {
      summary: 'Attendance summary will appear once classroom sessions are recorded.',
      cta: 'View Attendance',
    },
    attention: [],
    quickActions: [
      { label: 'Take Attendance', description: 'Mark class attendance and review classroom status', icon: ClipboardCheck, path: '/attendance' },
      { label: 'View My Students', description: 'Open classroom records for assigned learners', icon: GraduationCap, path: '/students' },
      { label: 'Review Alerts', description: 'Check attendance and student follow-up notifications', icon: BellRing, path: '/alerts' },
    ],
    trend: [],
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

function AttendanceRoute({ user, students, attendance, loading, error, onRetry, onRefresh, onCorrectAttendance }: {
  user: SessionUser
  students: Student[]
  attendance: AttendanceState
  loading: boolean
  error: string
  onRetry: () => void
  onRefresh?: () => void
  onCorrectAttendance?: (payload: {
    sessionId: string
    records: Array<{ student_id: string; status: 'PRESENT' | 'ABSENT' | 'LATE'; note?: string }>
    reason: string
  }) => Promise<void>
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
      onRefresh={onRefresh}
      onCorrectAttendance={onCorrectAttendance}
      onPrepareMessage={(studentId) => navigate(
        `/communication?studentId=${encodeURIComponent(studentId)}&sourceType=ATTENDANCE&sourceId=${encodeURIComponent(studentId)}`,
      )}
    />
  )
}

function App() {
  const [session, setSession] = useState<SessionUser | null>(null)
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured)
  const [authError, setAuthError] = useState(isSupabaseConfigured ? '' : 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  const [students, setStudents] = useState<Student[]>([])
  const [studentsLoading, setStudentsLoading] = useState(isSupabaseConfigured)
  const [studentsError, setStudentsError] = useState('')
  const [liveProfiles, setLiveProfiles] = useState<SchoolUser[]>([])
  const [profilesLoading, setProfilesLoading] = useState(isSupabaseConfigured)
  const [profilesError, setProfilesError] = useState('')
  const [attendance, setAttendance] = useState<AttendanceState>(emptyAttendanceState)
  const [attendanceLoading, setAttendanceLoading] = useState(isSupabaseConfigured)
  const [attendanceError, setAttendanceError] = useState('')
  const [fees, setFees] = useState<FeeState>({ invoices: [], payments: [] })
  const [feesLoading, setFeesLoading] = useState(isSupabaseConfigured)
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
    if (owner.role !== 'admin' || !owner.organizationId || !owner.schoolId) {
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
    setSession(nextSession)
    setAdministration(null)
    resolvedUserId.current = profile.id
    setAuthError('')
    setAuthLoading(false)

    const userRole = nextSession.role
    const needsAttendance = userRole === 'admin' || userRole === 'principal' || userRole === 'teacher'
    const needsFees = userRole === 'admin' || userRole === 'principal' || userRole === 'finance'
    const needsComms = true
    const needsProfiles = userRole === 'admin' || userRole === 'principal'
    const needsAdmin = userRole === 'admin'

    setAdministrationLoading(needsAdmin)
    setAdministrationError('')
    setProfilesLoading(needsProfiles)
    setProfilesError('')
    setAlertsLoading(true)
    setAlertsError('')
    setStudentsLoading(true)
    setStudentsError('')
    setAttendanceLoading(needsAttendance)
    setAttendanceError('')
    setFeesLoading(needsFees)
    setFeesError('')
    setCommunicationLoading(needsComms)
    setCommunicationError('')

    const loadedStudentRows = await refreshStudents(nextSession)
    const loadedStudents = loadedStudentRows ?? []
    const studentLoadFailed = loadedStudentRows === null

    const parallelTasks: Promise<unknown>[] = []

    if (needsAttendance) {
      parallelTasks.push(
        fetchAttendanceState()
          .then((nextAttendance) => {
            if (resolutionId === authResolutionId.current) setAttendance(nextAttendance)
          })
          .catch((error) => {
            console.error('[Supabase] Attendance request failed:', error)
            if (resolutionId === authResolutionId.current) {
              setAttendanceError('Attendance could not be loaded from Supabase. Please retry.')
              setAttendance(emptyAttendanceState)
            }
          })
          .finally(() => {
            if (resolutionId === authResolutionId.current) setAttendanceLoading(false)
          })
      )
    }

    if (needsFees) {
      if (studentLoadFailed) {
        setFeesError('Student scope could not be loaded for fee records.')
        setFeesLoading(false)
      } else {
        parallelTasks.push(
          fetchFeeState(loadedStudents)
            .then((nextFees) => {
              if (resolutionId === authResolutionId.current) setFees(nextFees)
            })
            .catch((error) => {
              console.error('[Supabase] Fee request failed:', error)
              if (resolutionId === authResolutionId.current) {
                setFeesError('Fee information could not be loaded from Supabase. Please retry.')
                setFees({ invoices: [], payments: [] })
              }
            })
            .finally(() => {
              if (resolutionId === authResolutionId.current) setFeesLoading(false)
            })
        )
      }
    }

    if (needsComms) {
      if (studentLoadFailed) {
        setCommunicationError('Student scope could not be loaded for communication.')
        setCommunicationLoading(false)
      } else {
        parallelTasks.push(
          fetchCommunicationState(loadedStudents)
            .then((nextCommunication) => {
              if (resolutionId === authResolutionId.current) {
                window.localStorage.removeItem('edupulse_communication')
                setCommunication(nextCommunication)
              }
            })
            .catch((error) => {
              console.error('[Supabase] Communication request failed:', error)
              if (resolutionId === authResolutionId.current) {
                setCommunicationError('Parent communication could not be loaded from Supabase. Please retry.')
                setCommunication(emptyCommunicationState)
              }
            })
            .finally(() => {
              if (resolutionId === authResolutionId.current) setCommunicationLoading(false)
            })
        )
      }
    }

    parallelTasks.push(refreshAlerts(profile.id))
    if (needsProfiles) parallelTasks.push(refreshProfiles(nextSession))
    if (needsAdmin) parallelTasks.push(refreshAdministration(nextSession))

    await Promise.allSettled(parallelTasks)
    return nextSession
  }

  useEffect(() => {
    let alive = true
    const client = supabase
    if (!isSupabaseConfigured || !client) {
      return
    }

    const isPasswordSetupPath = () => {
      if (typeof window === 'undefined') return false
      const p = window.location.pathname
      const h = window.location.hash
      return (
        p.startsWith('/set-password') ||
        p.startsWith('/reset-password') ||
        p.startsWith('/auth/callback') ||
        h.includes('type=invite') ||
        h.includes('type=recovery')
      )
    }

    const resolveUser = async (userId: string) => {
      if (isPasswordSetupPath()) {
        setAuthLoading(false)
        return
      }
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
          setAuthError('This account is not configured for CAMVIA access.')
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

    const { data: authListener } = client.auth.onAuthStateChange((event, authSession) => {
      window.setTimeout(() => {
        if (!alive) return
        if (event === 'PASSWORD_RECOVERY' || isPasswordSetupPath()) {
          setAuthLoading(false)
          return
        }
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
      if (isPasswordSetupPath()) {
        setAuthLoading(false)
        return
      }
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

  const handleLogin = async (email: string, password: string): Promise<{ role?: Role; error?: string; lockWaitSeconds?: number }> => {
    if (!isSupabaseConfigured) {
      return { error: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before enabling login.' }
    }

    const result = await signInWithEmail(email, password)

    if (!result.success || !result.profile) {
      return { error: result.error ?? 'Unable to sign in with Supabase Auth.', lockWaitSeconds: result.lockWaitSeconds }
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
      dispatchBuddyEvent('operation-error')
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
      dispatchBuddyEvent('operation-error')
      console.error('[Supabase] Campus settings update failed:', error instanceof Error ? error.message : 'Unknown error')
      throw error
    }
  }

  const requireSchoolAdmin = () => {
    if (!session || session.role !== 'admin') {
      throw new Error('Only an active school administrator can manage user accounts.')
    }
    return session
  }

  const handleInviteSchoolUser = async (input: SchoolUserInput) => {
    const owner = requireSchoolAdmin()
    try {
      await inviteSchoolUser(input)
      await refreshProfiles(owner)
      setToast({ type: 'success', text: 'Invitation sent. The new account is listed in Users.' })
    } catch (error) {
      dispatchBuddyEvent('operation-error')
      throw error
    }
  }

  const handleUpdateSchoolUser = async (targetUserId: string, input: SchoolUserInput) => {
    const owner = requireSchoolAdmin()
    try {
      await updateSchoolUser(targetUserId, input)
      await refreshProfiles(owner)
      setToast({ type: 'success', text: 'User account updated.' })
    } catch (error) {
      dispatchBuddyEvent('operation-error')
      throw error
    }
  }

  const handleDeactivateSchoolUser = async (targetUserId: string) => {
    const owner = requireSchoolAdmin()
    try {
      await deactivateSchoolUser(targetUserId)
      await refreshProfiles(owner)
      setToast({ type: 'success', text: 'User deactivated. Historical records were retained.' })
    } catch (error) {
      dispatchBuddyEvent('operation-error')
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

  const handleAddStudent = async (payload: NewStudent, campusId: string) => {
    if (!session || (session.role !== 'admin' && session.role !== 'teacher')) {
      throw new Error('Only active administrators and teachers can add students.')
    }
    if (!campusId) throw new Error('Select an authorized campus.')

    try {
      const sanitizedPayload: NewStudent = session.role === 'teacher'
        ? {
            ...payload,
            guardian: { name: '', phone: '', email: '' },
          }
        : payload
      await createLiveStudent(sanitizedPayload, campusId)
      const refreshedStudents = await refreshStudents(session)
      if (!refreshedStudents || resolvedUserId.current !== session.authUserId) {
        throw new Error('Student was created, but the current student list could not be refreshed.')
      }
      dispatchBuddyEvent('student-created')
      await refreshAlerts(session.authUserId)
      setToast({ type: 'success', text: 'Student added successfully.' })
    } catch (error) {
      dispatchBuddyEvent('operation-error')
      console.error('[Supabase] Student creation failed:', error instanceof Error ? error.message : 'Unknown error')
      throw new Error(error instanceof Error ? error.message : 'Unable to add this student.')
    }
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
    try {
      const nextState = await saveLiveAttendance(session, attendanceClass, submission)
      setAttendance(nextState)
      dispatchBuddyEvent('attendance-saved')
      await refreshAlerts(session.authUserId)
      return nextState
    } catch (error) {
      dispatchBuddyEvent('operation-error')
      throw error
    }
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
      dispatchBuddyEvent('fee-recorded')
      setToast({ type: 'success', text: 'Payment recorded successfully.' })
      await refreshAlerts(session.authUserId)
      return true
    } catch (error) {
      dispatchBuddyEvent('operation-error')
      const message = error instanceof Error ? error.message : 'Unable to record fee payment.'
      console.error('[Supabase] Fee payment failed:', message)
      setToast({ type: 'error', text: message })
      return false
    }
  }

  const handleCreateFeeInvoice = async (submission: FeeInvoiceCreationInput): Promise<boolean> => {
    if (!session) {
      setToast({ type: 'error', text: 'Sign in to create fee invoices.' })
      return false
    }
    try {
      const nextFees = await createLiveFeeInvoice(students, submission)
      setFees(nextFees)
      await refreshAlerts(session.authUserId)
      setToast({ type: 'success', text: 'Fee invoice created successfully.' })
      return true
    } catch (error) {
      dispatchBuddyEvent('operation-error')
      const message = error instanceof Error ? error.message : 'Invoice could not be created. Please review the details.'
      console.error('[Supabase] Fee invoice creation failed:', error)
      setToast({ type: 'error', text: message })
      throw error
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
      dispatchBuddyEvent('operation-error')
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
      const nextState = await transitionCommunication(operation, students)
      setCommunication(nextState)
      if (operation.type === 'send') dispatchBuddyEvent('communication-sent')
      await refreshAlerts(session.authUserId)
      return true
    } catch (error) {
      dispatchBuddyEvent('operation-error')
      const message = error instanceof Error ? error.message : 'The communication workflow action could not be completed.'
      console.error('[Supabase] Communication transition failed:', message)
      setToast({ type: 'error', text: message })
      return false
    }
  }

  const handleDeleteCommunicationDraft = async (messageId: string, reason: string): Promise<boolean> => {
    if (!session) {
      setToast({ type: 'error', text: 'Sign in to manage parent communication.' })
      return false
    }
    try {
      setCommunication(await deleteCommunicationDraft(messageId, reason, students))
      await refreshAlerts(session.authUserId)
      setToast({ type: 'success', text: 'Communication draft moved to Trash.' })
      return true
    } catch (error) {
      dispatchBuddyEvent('operation-error')
      const message = error instanceof Error ? error.message : 'The communication draft could not be moved to Trash.'
      console.error('[Supabase] Communication draft move to trash failed:', message)
      setToast({ type: 'error', text: message })
      return false
    }
  }

  const handleCorrectAttendanceSession = async (payload: {
    sessionId: string
    records: Array<{ student_id: string; status: 'PRESENT' | 'ABSENT' | 'LATE'; note?: string }>
    reason: string
  }): Promise<void> => {
    if (!session) {
      setToast({ type: 'error', text: 'Sign in to manage attendance.' })
      return
    }
    try {
      const updated = await correctAttendanceSession(payload)
      setAttendance(updated)
      setToast({ type: 'success', text: 'Attendance session corrected successfully.' })
      dispatchBuddyEvent('attendance-saved')
    } catch (error) {
      dispatchBuddyEvent('operation-error')
      const message = error instanceof Error ? error.message : 'Failed to correct attendance session.'
      console.error('[Supabase] Attendance correction failed:', message)
      setToast({ type: 'error', text: message })
      throw error
    }
  }

  const visibleAlerts = session && alertSnapshot.ownerId === session.authUserId ? alertSnapshot.items : []
  const visibleAlertsLoading = !session || alertSnapshot.ownerId !== session.authUserId || alertsLoading
  const visibleAlertsError = alertSnapshot.ownerId === session?.authUserId ? alertsError : ''
  const handleRefreshAlerts = async () => {
    if (session) await refreshAlerts(session.authUserId)
  }

  const handleRefreshAll = async () => {
    if (!session) return
    await Promise.allSettled([
      refreshStudents(session),
      handleRefreshAttendance(),
      handleRefreshFees(),
      handleRefreshCommunication(),
      handleRefreshAlerts(),
    ])
  }

  return (
    <BrowserRouter>
      <AuthRedirectHandler />
      <Suspense fallback={<div className="app-loading-state" role="status">Loading page…</div>}>
      <AskCamviaProvider
        key={session?.authUserId ?? 'anonymous'}
        user={session}
        students={students}
        attendance={attendance}
        attendanceLoading={attendanceLoading}
        attendanceError={attendanceError}
        fees={fees}
        communication={communication}
        alerts={visibleAlerts}
        alertsLoading={visibleAlertsLoading}
        alertsError={visibleAlertsError}
      >
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={handleLogin} loading={authLoading} authError={authError} />} />
        <Route path="/set-password" element={<SetPasswordPage mode="invite" />} />
        <Route path="/reset-password" element={<SetPasswordPage mode="reset" />} />
        <Route path="/auth/callback" element={<AuthCallbackHandler />} />

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
            <Route path="/dashboard" element={<DashboardPage user={session} students={students} attendance={attendance} attendanceLoading={attendanceLoading} attendanceError={attendanceError} onRetry={handleRefreshAttendance} fees={fees} feesLoading={feesLoading} feesError={feesError} onRetryFees={handleRefreshFees} communication={communication} alerts={visibleAlerts} alertsLoading={visibleAlertsLoading} alertsError={visibleAlertsError} onRetryAlerts={handleRefreshAlerts} profiles={liveProfiles} profilesLoading={profilesLoading} profilesError={profilesError} academicYear={administration?.school.academic_year ?? null} />} />
            <Route path="/finance/dashboard" element={<DashboardPage user={session} students={students} attendance={attendance} attendanceLoading={attendanceLoading} attendanceError={attendanceError} onRetry={handleRefreshAttendance} fees={fees} feesLoading={feesLoading} feesError={feesError} onRetryFees={handleRefreshFees} communication={communication} alerts={visibleAlerts} alertsLoading={visibleAlertsLoading} alertsError={visibleAlertsError} onRetryAlerts={handleRefreshAlerts} profiles={liveProfiles} profilesLoading={profilesLoading} profilesError={profilesError} academicYear={administration?.school.academic_year ?? null} />} />
            <Route path="/teacher/dashboard" element={<DashboardPage user={session} students={students} attendance={attendance} attendanceLoading={attendanceLoading} attendanceError={attendanceError} onRetry={handleRefreshAttendance} fees={fees} feesLoading={feesLoading} feesError={feesError} onRetryFees={handleRefreshFees} communication={communication} alerts={visibleAlerts} alertsLoading={visibleAlertsLoading} alertsError={visibleAlertsError} onRetryAlerts={handleRefreshAlerts} profiles={liveProfiles} profilesLoading={profilesLoading} profilesError={profilesError} academicYear={administration?.school.academic_year ?? null} />} />
            <Route
              path="/students"
              element={
                session ? (
                  <StudentsPage
                    key={session.authUserId}
                    user={session}
                    students={students}
                    loading={studentsLoading}
                    error={studentsError}
                    onRetry={() => session ? refreshStudents(session) : undefined}
                    onAddStudent={handleAddStudent}
                    onImportStudents={handleImportStudents}
                    onRefresh={() => session ? refreshStudents(session) : undefined}
                  />
                ) : null
              }
            />
            <Route
              path="/students/:studentId"
              element={session ? <StudentDetailPage user={session} students={students} attendance={attendance} attendanceLoading={attendanceLoading} attendanceError={attendanceError} fees={fees} feesLoading={feesLoading} feesError={feesError} onRetryFees={handleRefreshFees} communication={communication} users={liveProfiles} alerts={visibleAlerts} alertsLoading={visibleAlertsLoading} alertsError={visibleAlertsError} onRefresh={() => session ? refreshStudents(session) : undefined} /> : null}
            />
            <Route
              path="/attendance"
              element={session ? <AttendanceRoute user={session} students={students} attendance={attendance} loading={attendanceLoading} error={attendanceError} onRetry={handleRefreshAttendance} onRefresh={handleRefreshAttendance} onCorrectAttendance={handleCorrectAttendanceSession} /> : null}
            />
            <Route
              path="/attendance/take/:classId"
              element={session ? <TakeAttendancePage user={session} students={students} attendance={attendance} loading={attendanceLoading} error={attendanceError} onRetry={handleRefreshAttendance} onSave={handleSaveAttendance} onRefresh={handleRefreshAttendance} onCorrectAttendance={handleCorrectAttendanceSession} /> : null}
            />
            <Route path="/fees" element={session ? <FeesPage user={session} students={students} feeState={fees} feeLoading={feesLoading} feeError={feesError} onRetry={handleRefreshFees} onRefresh={handleRefreshFees} schoolUsers={liveProfiles} onRecordPayment={handleRecordFeePayment} onCreateInvoice={handleCreateFeeInvoice} /> : null} />
            <Route path="/fees/:studentId" element={session ? <FeeStudentDetailPage user={session} students={students} feeState={fees} feeLoading={feesLoading} feeError={feesError} onRetry={handleRefreshFees} onRefresh={handleRefreshFees} schoolUsers={liveProfiles} onRecordPayment={handleRecordFeePayment} onCreateInvoice={handleCreateFeeInvoice} /> : null} />
            <Route path="/communication" element={session ? <CommunicationPage user={session} students={students} state={communication} attendance={attendance} fees={fees} users={liveProfiles} loading={communicationLoading} loadError={communicationError} onRetry={handleRefreshCommunication} onRefresh={handleRefreshCommunication} onSaveDraft={handleSaveCommunicationDraft} onOperation={handleCommunicationOperation} onDeleteDraft={handleDeleteCommunicationDraft} /> : null} />
            <Route path="/alerts" element={session ? <AlertsPage user={session} alerts={visibleAlerts} loading={visibleAlertsLoading} error={visibleAlertsError} onRetry={handleRefreshAlerts} /> : null} />
            <Route path="/approvals" element={session ? <ApprovalsPage user={session} students={students} communication={communication} loading={communicationLoading} error={communicationError} onRetry={handleRefreshCommunication} onOperation={handleCommunicationOperation} /> : null} />
            <Route path="/ask-edu" element={session ? <AskEduPage /> : null} />
            <Route path="/reports" element={session ? <ReportsPage user={session} students={students} attendance={attendance} fees={fees} communication={communication} /> : null} />
            <Route path="/my-classes" element={session ? <MyClassesPage user={session} students={students} attendance={attendance} attendanceLoading={attendanceLoading} attendanceError={attendanceError} onRetry={handleRefreshAttendance} /> : null} />
            <Route
              path="/administration"
              element={
                session?.role === 'admin' ? <AdministrationPage
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
                  onInviteUser={handleInviteSchoolUser}
                  onUpdateUser={handleUpdateSchoolUser}
                  onDeactivateUser={handleDeactivateSchoolUser}
              /> : null
              }
            />
            <Route
              path="/users"
              element={session?.role === 'admin' ? <ProfilesDirectoryPage
                user={session}
                profiles={liveProfiles}
                campuses={administration?.campuses ?? []}
                loading={profilesLoading}
                error={profilesError}
                onRetry={() => session ? refreshProfiles(session) : undefined}
                onInviteUser={handleInviteSchoolUser}
                onUpdateUser={handleUpdateSchoolUser}
                onDeactivateUser={handleDeactivateSchoolUser}
              /> : null}
            />
            <Route
              path="/trash"
              element={session?.role === 'admin' ? <TrashPage onRefreshAll={handleRefreshAll} /> : null}
            />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to={session ? defaultDashboardForRole(session.role) : '/login'} replace />} />
      </Routes>
      </AskCamviaProvider>
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

function AuthRedirectHandler() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.length > 1) {
      const params = new URLSearchParams(hash.substring(1))
      const type = params.get('type')
      const error = params.get('error') || params.get('error_code')
      const errorDescription = params.get('error_description')

      if (type === 'invite' && location.pathname !== '/set-password') {
        navigate({ pathname: '/set-password', hash }, { replace: true })
        return
      }

      if (type === 'recovery' && location.pathname !== '/reset-password') {
        navigate({ pathname: '/reset-password', hash }, { replace: true })
        return
      }

      if (error && (location.pathname === '/' || location.pathname === '/login')) {
        if (hash.includes('invite') || (errorDescription && /invite/i.test(errorDescription))) {
          navigate({ pathname: '/set-password', hash }, { replace: true })
          return
        }
        if (hash.includes('recovery') || (errorDescription && /password|reset|recovery/i.test(errorDescription))) {
          navigate({ pathname: '/reset-password', hash }, { replace: true })
          return
        }
      }
    }

    const search = window.location.search
    if (search && search.length > 1) {
      const searchParams = new URLSearchParams(search)
      const code = searchParams.get('code')
      const error = searchParams.get('error')
      const errorDescription = searchParams.get('error_description')

      if (code && location.pathname === '/') {
        navigate({ pathname: '/auth/callback', search }, { replace: true })
        return
      }

      if (error && (location.pathname === '/' || location.pathname === '/login')) {
        if (errorDescription && /invite/i.test(errorDescription)) {
          navigate({ pathname: '/set-password', search }, { replace: true })
        }
      }
    }
  }, [location.pathname, navigate])

  return null
}

function AuthCallbackHandler() {
  const navigate = useNavigate()
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let active = true

    const processAuth = async () => {
      const hash = window.location.hash
      const search = window.location.search
      const params = new URLSearchParams(hash ? hash.substring(1) : search)

      const error = params.get('error') || params.get('error_code')
      const errorDescription = params.get('error_description')
      if (error) {
        if (!active) return
        setErrorMessage(errorDescription ? decodeURIComponent(errorDescription.replace(/\+/g, ' ')) : 'Authentication link is invalid or has expired.')
        return
      }

      const type = params.get('type')
      const code = new URLSearchParams(search).get('code')

      if (code && supabase) {
        try {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError
        } catch (err) {
          if (!active) return
          setErrorMessage(err instanceof Error ? err.message : 'Unable to verify authentication link.')
          return
        }
      }

      if (type === 'invite') {
        navigate({ pathname: '/set-password', hash: window.location.hash }, { replace: true })
        return
      }
      if (type === 'recovery') {
        navigate({ pathname: '/reset-password', hash: window.location.hash }, { replace: true })
        return
      }

      if (supabase) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          navigate('/set-password', { replace: true })
          return
        }
      }

      navigate('/login', { replace: true })
    }

    void processAuth()

    return () => {
      active = false
    }
  }, [navigate])

  if (errorMessage) {
    return (
      <div className="login-page">
        <div className="login-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 32px', textAlign: 'center' }}>
          <AlertTriangle size={54} color="#e04848" style={{ marginBottom: '20px' }} />
          <h2 style={{ fontSize: '26px', fontWeight: 800, marginBottom: '12px' }}>Authentication Error</h2>
          <p style={{ color: '#556987', maxWidth: '440px', marginBottom: '24px', fontSize: '15px', lineHeight: 1.5 }}>
            {errorMessage}
          </p>
          <button type="button" className="primary-button" style={{ maxWidth: '240px' }} onClick={() => navigate('/login', { replace: true })}>
            Return to Sign In
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-loading-state" role="status">
      Verifying your security credentials…
    </div>
  )
}

function SetPasswordPage({ mode }: { mode: 'invite' | 'reset' }) {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    if (!supabase) return 'Supabase is not configured in this environment.'
    const hash = window.location.hash
    const search = window.location.search
    const params = new URLSearchParams(hash ? hash.substring(1) : search)
    const errorParam = params.get('error') || params.get('error_code')
    const errorDesc = params.get('error_description')
    if (errorParam) {
      return errorDesc
        ? decodeURIComponent(errorDesc.replace(/\+/g, ' '))
        : 'This link is invalid or has expired. Please contact your administrator.'
    }
    return ''
  })
  const [status, setStatus] = useState<'checking' | 'ready' | 'success' | 'expired'>(() => {
    if (typeof window === 'undefined') return 'checking'
    if (!supabase) return 'expired'
    const hash = window.location.hash
    const search = window.location.search
    const params = new URLSearchParams(hash ? hash.substring(1) : search)
    const errorParam = params.get('error') || params.get('error_code')
    if (errorParam) return 'expired'
    return 'checking'
  })
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loginTheme, setLoginTheme] = useState<'light' | 'dark'>(() => {
    try {
      return window.localStorage.getItem('camvia_login_theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  const toggleLoginTheme = () => {
    const nextTheme = loginTheme === 'light' ? 'dark' : 'light'
    setLoginTheme(nextTheme)
    try {
      window.localStorage.setItem('camvia_login_theme', nextTheme)
    } catch {
      // Theme switching still works when browser storage is unavailable.
    }
  }

  useEffect(() => {
    if (status === 'expired' || !supabase) return
    let active = true
    const client = supabase

    const checkSession = async () => {
      const { data: { session } } = await client.auth.getSession()
      if (session?.user) {
        if (!active) return
        setUserEmail(session.user.email ?? null)
        setStatus('ready')
        return
      }

      let attempts = 0
      const timer = window.setInterval(async () => {
        attempts += 1
        const { data: { session: delayedSession } } = await client.auth.getSession()
        if (delayedSession?.user) {
          window.clearInterval(timer)
          if (!active) return
          setUserEmail(delayedSession.user.email ?? null)
          setStatus('ready')
          return
        }
        if (attempts >= 5) {
          window.clearInterval(timer)
          if (!active) return
          setStatus('expired')
          setErrorMessage(
            mode === 'invite'
              ? 'This invitation link is invalid, expired, or has already been used. Please contact your school administrator to request a new invitation.'
              : 'This password reset link is invalid or has expired. Please request a new password reset link from the sign in page.'
          )
        }
      }, 500)
    }

    void checkSession()

    const { data: authListener } = client.auth.onAuthStateChange((_event, session) => {
      if (session?.user && active) {
        setUserEmail(session.user.email ?? null)
        setStatus('ready')
      }
    })

    return () => {
      active = false
      authListener?.subscription.unsubscribe()
    }
  }, [mode, status])

  const hasMinLength = password.length >= 8
  const hasUppercase = /[A-Z]/.test(password)
  const hasLowercase = /[a-z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const passwordsMatch = password.length > 0 && password === confirmPassword
  const isFormValid = hasMinLength && hasUppercase && hasLowercase && hasNumber && passwordsMatch

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!isFormValid || submitting) return

    setSubmitting(true)
    setErrorMessage('')

    try {
      const result = await updateUserPassword(password)
      if (!result.success) {
        setErrorMessage(result.error ?? 'Unable to set password. Please try again.')
        setSubmitting(false)
        return
      }

      await signOutSupabase()
      setStatus('success')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to update password. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page" data-theme={loginTheme}>
      <div className="login-panel">
        <div className="login-brand-panel">
          <div className="login-logo" role="img" aria-label="CAMVIA — Smarter Schools. Brighter Futures." />
          <p className="login-brand-eyebrow">AI-powered school management</p>
          <h1 className="login-headline">See More.<br />Understand Better.<br /><span>Act Sooner.</span></h1>
          <p className="login-description">CAMVIA brings intelligence to school management with AI-powered insights, helping schools operate smarter and create brighter futures for every learner.</p>
          <div className="login-benefits">
            <div><span className="login-benefit-icon"><Eye aria-hidden="true" /></span><p><strong>See.</strong><small>Real-time insights</small></p></div>
            <div><span className="login-benefit-icon"><Lightbulb aria-hidden="true" /></span><p><strong>Understand.</strong><small>Smarter decisions</small></p></div>
            <div><span className="login-benefit-icon"><ChartNoAxesColumnIncreasing aria-hidden="true" /></span><p><strong>Act.</strong><small>Better outcomes</small></p></div>
          </div>
          <div className="login-campus" aria-hidden="true" />
        </div>

        <div className="login-form-panel">
          <button
            type="button"
            className="login-theme-toggle"
            onClick={toggleLoginTheme}
            aria-label={`Switch to ${loginTheme === 'light' ? 'dark' : 'light'} mode`}
          >
            {loginTheme === 'light' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
            {loginTheme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>

          {status === 'checking' ? (
            <div className="status-card checking">
              <div className="app-loading-state" style={{ minHeight: '260px' }}>
                Verifying your security credentials…
              </div>
            </div>
          ) : status === 'expired' ? (
            <div className="status-card error">
              <div className="login-header">
                <p className="eyebrow" style={{ color: '#e04848' }}>Access Notice</p>
                <h2>{mode === 'invite' ? 'Invitation Expired' : 'Link Expired'}</h2>
                <p className="login-intro">
                  {errorMessage || (mode === 'invite'
                    ? 'This invitation link is invalid or has expired. Please contact your school administrator to receive a new invitation.'
                    : 'This password reset link is invalid or has expired. Please request a new password reset link.')}
                </p>
              </div>
              <div className="status-card-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => navigate('/login', { replace: true })}
                >
                  Return to Sign In
                  <ArrowRight size={20} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : status === 'success' ? (
            <div className="status-card success">
              <div className="login-header">
                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', borderRadius: '50%', background: '#eaf8f1', color: '#16834d', marginBottom: '16px' }}>
                  <CheckCircle2 size={32} />
                </div>
                <p className="eyebrow" style={{ color: '#16834d' }}>Setup Complete</p>
                <h2>Password Saved</h2>
                <p className="login-intro">
                  Your password has been configured successfully. You can now sign in to your CAMVIA account.
                </p>
              </div>
              <div className="status-card-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => navigate('/login', { state: { notice: 'Password saved successfully. Please sign in.' }, replace: true })}
                >
                  Proceed to Sign In
                  <ArrowRight size={20} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="login-header">
                <p className="eyebrow">{mode === 'invite' ? 'Account Setup' : 'Password Recovery'}</p>
                <h2>{mode === 'invite' ? 'Set Your Password' : 'Reset Password'}</h2>
                <p className="login-intro">
                  {mode === 'invite'
                    ? 'Welcome to CAMVIA! Choose a secure password to complete your account setup.'
                    : 'Enter and confirm a new secure password for your CAMVIA account.'}
                </p>
              </div>

              {userEmail ? (
                <div className="verified-account-card">
                  <KeyRound size={18} aria-hidden="true" />
                  <span>Account: <strong>{userEmail}</strong></span>
                </div>
              ) : null}

              <form onSubmit={handleSubmit} className="login-form">
                <label>
                  <span>New Password</span>
                  <div className="password-field login-input-field">
                    <LockKeyhole aria-hidden="true" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      disabled={submitting}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter new password"
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      disabled={submitting}
                      onClick={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                    </button>
                  </div>
                </label>

                <label>
                  <span>Confirm Password</span>
                  <div className="password-field login-input-field">
                    <LockKeyhole aria-hidden="true" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      disabled={submitting}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Confirm new password"
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      aria-pressed={showConfirmPassword}
                      disabled={submitting}
                      onClick={() => setShowConfirmPassword((current) => !current)}
                    >
                      {showConfirmPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                    </button>
                  </div>
                </label>

                <div className="password-rules-card">
                  <p className="password-rules-title">Password Requirements:</p>
                  <ul className="password-rules-list">
                    <li className={`password-rule-item ${hasMinLength ? 'met' : ''}`}>
                      <CheckCircle2 size={14} /> At least 8 characters
                    </li>
                    <li className={`password-rule-item ${hasUppercase && hasLowercase ? 'met' : ''}`}>
                      <CheckCircle2 size={14} /> Uppercase and lowercase letters
                    </li>
                    <li className={`password-rule-item ${hasNumber ? 'met' : ''}`}>
                      <CheckCircle2 size={14} /> At least one number (0-9)
                    </li>
                    <li className={`password-rule-item ${passwordsMatch ? 'met' : ''}`}>
                      <CheckCircle2 size={14} /> Passwords match
                    </li>
                  </ul>
                </div>

                {errorMessage ? (
                  <p className="error-message" role="alert">{errorMessage}</p>
                ) : null}

                <button
                  type="submit"
                  className="primary-button"
                  disabled={!isFormValid || submitting}
                >
                  {submitting ? 'Saving Password…' : mode === 'invite' ? 'Set Password & Continue' : 'Update Password'}
                  <ArrowRight size={22} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="secondary-button"
                  disabled={submitting}
                  onClick={() => navigate('/login', { replace: true })}
                >
                  Cancel & Return to Sign In
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function LoginPage({ onLogin, loading, authError }: {
  onLogin: (email: string, password: string) => Promise<{ role?: Role; error?: string; lockWaitSeconds?: number }>
  loading: boolean
  authError: string
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [lockSeconds, setLockSeconds] = useState<number>(() => getActiveLockout().waitSeconds)
  const [loginNotice, setLoginNotice] = useState<string>(() => {
    const state = location.state as { notice?: string } | null
    return state?.notice ?? ''
  })

  const isLocked = lockSeconds > 0

  // Synchronize active lockout countdown
  useEffect(() => {
    if (!isLocked) return

    const timer = window.setInterval(() => {
      setLockSeconds((prev) => {
        if (prev <= 1) {
          setError('')
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [isLocked])

  // Password reset flow states
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)
  const [resetError, setResetError] = useState('')

  const [loginTheme, setLoginTheme] = useState<'light' | 'dark'>(() => {
    try {
      return window.localStorage.getItem('camvia_login_theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  const toggleLoginTheme = () => {
    const nextTheme = loginTheme === 'light' ? 'dark' : 'light'
    setLoginTheme(nextTheme)
    try {
      window.localStorage.setItem('camvia_login_theme', nextTheme)
    } catch {
      // Theme switching still works when browser storage is unavailable.
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting || loading || lockSeconds > 0) return

    setSubmitting(true)
    setError('')
    setLoginNotice('')
    try {
      const result = await onLogin(email, password)
      setPassword('')
      if (result.role) {
        navigate(defaultDashboardForRole(result.role))
        return
      }
      if (result.lockWaitSeconds && result.lockWaitSeconds > 0) {
        setLockSeconds(result.lockWaitSeconds)
      }
      setError(result.error ?? 'Unable to sign in.')
    } catch {
      setError('Unable to sign in. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResetSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (resetSubmitting) return

    setResetSubmitting(true)
    setResetError('')
    setResetSuccess(false)

    try {
      const result = await resetPasswordForEmail(resetEmail)
      if (result.success) {
        setResetSuccess(true)
      } else {
        setResetError(result.error ?? 'Unable to send password reset email.')
      }
    } catch {
      setResetError('Unable to send password reset email. Please try again.')
    } finally {
      setResetSubmitting(false)
    }
  }

  return (
    <div className="login-page" data-theme={loginTheme}>
      <div className="login-panel">
        <div className="login-brand-panel">
          <div className="login-logo" role="img" aria-label="CAMVIA — Smarter Schools. Brighter Futures." />
          <p className="login-brand-eyebrow">AI-powered school management</p>
          <h1 className="login-headline">See More.<br />Understand Better.<br /><span>Act Sooner.</span></h1>
          <p className="login-description">CAMVIA brings intelligence to school management with AI-powered insights, helping schools operate smarter and create brighter futures for every learner.</p>
          <div className="login-benefits">
            <div><span className="login-benefit-icon"><Eye aria-hidden="true" /></span><p><strong>See.</strong><small>Real-time insights</small></p></div>
            <div><span className="login-benefit-icon"><Lightbulb aria-hidden="true" /></span><p><strong>Understand.</strong><small>Smarter decisions</small></p></div>
            <div><span className="login-benefit-icon"><ChartNoAxesColumnIncreasing aria-hidden="true" /></span><p><strong>Act.</strong><small>Better outcomes</small></p></div>
          </div>
          <div className="login-campus" aria-hidden="true" />
        </div>

        <div className="login-form-panel">
          <button
            type="button"
            className="login-theme-toggle"
            onClick={toggleLoginTheme}
            aria-label={`Switch to ${loginTheme === 'light' ? 'dark' : 'light'} mode`}
          >
            {loginTheme === 'light' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
            {loginTheme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>

          {loginNotice ? (
            <div className="status-banner-success" role="status">
              <CheckCircle2 size={18} />
              <span>{loginNotice}</span>
            </div>
          ) : null}

          {forgotPasswordMode ? (
            <>
              <div className="login-header">
                <p className="eyebrow">Password recovery</p>
                <h2>Reset password</h2>
                <p className="login-intro">Enter your registered email address and we will send you a secure link to reset your password.</p>
              </div>

              {resetSuccess ? (
                <div className="status-card success">
                  <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '52px', height: '52px', borderRadius: '50%', background: '#eaf8f1', color: '#16834d', marginBottom: '16px' }}>
                    <CheckCircle2 size={28} />
                  </div>
                  <h3>Check your inbox</h3>
                  <p className="login-intro" style={{ marginBottom: '24px' }}>
                    If an account exists for <strong>{resetEmail}</strong>, instructions to reset your password have been sent. Please check your inbox and spam folder.
                  </p>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      setForgotPasswordMode(false)
                      setResetSuccess(false)
                      setResetError('')
                    }}
                  >
                    Return to Sign In
                  </button>
                </div>
              ) : (
                <form onSubmit={handleResetSubmit} className="login-form" aria-busy={resetSubmitting}>
                  <label>
                    <span>Email</span>
                    <div className="login-input-field">
                      <Mail aria-hidden="true" />
                      <input
                        type="email"
                        autoComplete="email"
                        required
                        disabled={resetSubmitting}
                        value={resetEmail}
                        onChange={(event) => setResetEmail(event.target.value)}
                        placeholder="name@school.edu"
                      />
                    </div>
                  </label>

                  {resetError ? <p className="error-message" role="alert">{resetError}</p> : null}

                  <button type="submit" className="primary-button" disabled={resetSubmitting}>
                    {resetSubmitting ? 'Sending instructions…' : 'Send Reset Link'}
                    <ArrowRight size={22} aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    className="secondary-button"
                    disabled={resetSubmitting}
                    onClick={() => {
                      setForgotPasswordMode(false)
                      setResetError('')
                    }}
                  >
                    Back to Sign In
                  </button>
                </form>
              )}
            </>
          ) : (
            <>
              <div className="login-header">
                <p className="eyebrow">Secure login</p>
                <h2>Welcome back</h2>
                <p className="login-intro">Sign in to your CAMVIA account and continue building brighter futures.</p>
              </div>

              <form onSubmit={handleSubmit} className="login-form" aria-busy={loading || submitting}>
                <label>
                  <span>Email</span>
                  <div className="login-input-field">
                    <Mail aria-hidden="true" />
                    <input
                      type="email"
                      autoComplete="username"
                      required
                      disabled={loading || submitting}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@school.edu"
                    />
                  </div>
                </label>

                <label>
                  <span>Password</span>
                  <div className="password-field login-input-field">
                    <LockKeyhole aria-hidden="true" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      disabled={loading || submitting || lockSeconds > 0}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter password"
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      disabled={loading || submitting || lockSeconds > 0}
                      onClick={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                    </button>
                  </div>
                </label>

                {lockSeconds > 0 ? (
                  <div className="error-message lock-message" role="alert">
                    <div className="lock-message-header">
                      <LockKeyhole size={14} aria-hidden="true" />
                      <span>Too many unsuccessful login attempts.</span>
                    </div>
                    <p className="lock-countdown">
                      Please try again in <strong>{formatMMSS(lockSeconds)}</strong>
                    </p>
                  </div>
                ) : error || authError ? (
                  <p className="error-message" role="alert">{error || authError}</p>
                ) : null}

                <button type="submit" className="primary-button" disabled={loading || submitting || lockSeconds > 0}>
                  <span>
                    {loading
                      ? 'Checking session…'
                      : submitting
                      ? 'Signing in…'
                      : lockSeconds > 0
                      ? `Locked (${formatMMSS(lockSeconds)})`
                      : 'Sign In'}
                  </span>
                  {lockSeconds <= 0 && <ArrowRight size={20} aria-hidden="true" />}
                </button>

                <button
                  type="button"
                  className="forgot-password-link"
                  disabled={loading || submitting}
                  onClick={() => {
                    setForgotPasswordMode(true)
                    setResetEmail(email)
                    setResetError('')
                    setResetSuccess(false)
                  }}
                >
                  Forgot Password?
                </button>
              </form>
            </>
          )}
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const pageTitle = location.pathname.startsWith('/students/')
    ? 'Student 360'
    : location.pathname.startsWith('/attendance/take/')
      ? 'Attendance'
      : location.pathname.startsWith('/fees/')
        ? 'Fees & Collections'
      : routeTitles[location.pathname] ?? 'Dashboard'
  useEffect(() => {
    if (user) document.title = `${pageTitle} | CAMVIA`
  }, [pageTitle, user])

  const [prevPath, setPrevPath] = useState(location.pathname)
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname)
    setSidebarOpen(false)
  }

  if (!user) {
    return null
  }

  const nav = user.role === 'admin' || user.role === 'principal'
    ? [
      navByRole[user.role][0],
      navByRole[user.role][1],
      navByRole[user.role][2],
      ...(user.role === 'admin' ? [navByRole.admin[3]] : []),
      ...navByRole[user.role].filter((item) => (
        item.path !== '/dashboard' &&
        item.path !== '/students' &&
        item.path !== '/attendance' &&
        item.path !== '/fees'
      )).sort((left, right) => {
        const order = ['/communication', '/alerts', '/approvals', '/ask-edu', '/reports', '/administration', '/trash']
        const leftIndex = order.indexOf(left.path)
        const rightIndex = order.indexOf(right.path)
        return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex)
      }),
    ]
    : navByRole[user.role]
  const initials = user.name
    .split(' ')
    .map((namePart) => namePart[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className={`app-shell ${user.role === 'admin' || user.role === 'principal' ? 'executive-shell' : ''}`}>
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-row">
            <img className="sidebar-logo" src={camviaLogo} alt="CAMVIA" />
            <button
              type="button"
              className="icon-button sidebar-close-btn"
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <span className="sidebar-subtitle">School Management System</span>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          {nav.map((item) => {
            const Icon = item.icon
            const label = (user.role === 'admin' || user.role === 'principal') && item.label === 'Parent Communication'
              ? 'Communication'
              : item.label
            const isActive = location.pathname === item.path ||
              (item.path === '/students' && location.pathname.startsWith('/students/')) ||
              (item.path === '/attendance' && location.pathname.startsWith('/attendance/take/'))

            return (
              <button
                key={item.path}
                type="button"
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  navigate(item.path)
                  setSidebarOpen(false)
                }}
              >
                <span className="nav-icon-wrap"><Icon size={18} /></span>
                <span>{label}</span>
                {isActive ? <span className="nav-active-indicator" aria-hidden="true" /> : null}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-campus-selector" aria-label={`Selected campus: ${user.campusName}`}>
          <Building2 size={20} aria-hidden="true" />
          <span>{user.campusName}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-profile-card">
            <div className="sidebar-profile-avatar">{initials}</div>
            <div className="sidebar-profile-meta">
              <span className="sidebar-profile-name">{user.name}</span>
              <span className="sidebar-profile-role">{roleLabels[user.role]}</span>
            </div>
          </div>

          <button
            type="button"
            className="nav-item profile-item"
            onClick={() => {
              navigate(defaultDashboardForRole(user.role))
              setSidebarOpen(false)
            }}
          >
            <span className="nav-icon-wrap"><UserCog size={18} /></span>
            <span>Profile</span>
          </button>

          <button
            type="button"
            className="nav-item danger-item"
            onClick={() => {
              setSidebarOpen(false)
              onLogout()
            }}
          >
            <span className="nav-icon-wrap"><LogOut size={18} /></span>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {sidebarOpen ? (
        <div
          className="sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div className="content-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button mobile-menu-btn"
              aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen((value) => !value)}
            >
              <Menu size={20} />
            </button>
            <span className="topbar-page-label">{pageTitle}</span>
            <span className="topbar-crumb-sep">•</span>
            <span className="topbar-school-name">{user.schoolName}</span>
          </div>

          <div className="topbar-actions">
            <div className="search-box">
              <Search size={15} />
              <input type="text" placeholder="Search students, staff, or records..." readOnly aria-label="Search" />
            </div>

            <button type="button" className="icon-button notification-btn" aria-label="Notifications">
              <Bell size={18} />
              <span className="notification-dot" />
            </button>

            <div
              className="profile-panel"
              role="button"
              tabIndex={0}
              aria-label="User profile menu"
              aria-expanded={profileOpen}
              onClick={() => setProfileOpen((value) => !value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setProfileOpen((value) => !value)
                }
              }}
            >
              <div className="profile-avatar">{initials}</div>

              <div className="profile-details">
                <strong>{user.name}</strong>
                <span>{roleLabels[user.role]}</span>
              </div>

              <button
                type="button"
                className="profile-toggle"
                aria-label="Open profile menu"
                onClick={(e) => {
                  e.stopPropagation()
                  setProfileOpen((value) => !value)
                }}
              >
                <ChevronDown size={14} />
              </button>

              {profileOpen ? (
                <div className="profile-menu" onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => { setProfileOpen(false); navigate(defaultDashboardForRole(user.role)) }}>My Profile</button>
                  <button type="button" onClick={() => { setProfileOpen(false); onRestartTour(user.role) }}>Restart Tour</button>
                  <button type="button" onClick={() => { setProfileOpen(false); onLogout() }}>Logout</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="mobile-campus-strip">
          <div className="campus-selector-pill mobile-campus-pill" title="Selected campus">
            <Building2 size={13} />
            <span className="campus-pill-name">{user.campusName}</span>
            <span className="campus-pill-sep">•</span>
            <span className="campus-pill-school">{user.schoolName}</span>
            <ChevronDown size={13} className="selector-chevron" />
          </div>
        </div>

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
      <Suspense fallback={null}>
        <AIBuddy />
      </Suspense>
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

function DashboardPage({ user, students, attendance, attendanceLoading, attendanceError, onRetry, fees, feesLoading, feesError, onRetryFees, communication, alerts, alertsLoading, alertsError, onRetryAlerts, profiles, profilesLoading, profilesError, academicYear }: {
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
  profiles: SchoolUser[]
  profilesLoading: boolean
  profilesError: string
  academicYear: string | null
}) {
  const [prevRole, setPrevRole] = useState(user?.role)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  if (prevRole !== user?.role) {
    setPrevRole(user?.role)
    setStatus('loading')
  }

  useEffect(() => {
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
    dashboard = (
      <SchoolDashboard
        user={user}
        config={config}
        students={students}
        attendance={attendance}
        fees={fees}
        communication={communication}
        alerts={alerts}
        attendanceError={Boolean(attendanceError)}
        profiles={profiles}
        profilesLoading={profilesLoading}
        profilesError={profilesError}
        academicYear={academicYear}
      />
    )
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
        summary: feesUnavailable ? 'Live fee metrics are currently unavailable.' : (currentMonthCollections > 0 || feeMetrics.outstanding > 0)
          ? `${formatFeeCurrency(currentMonthCollections)} collected this month. ${formatFeeCurrency(feeMetrics.outstanding)} remains outstanding, including ${formatFeeCurrency(feeMetrics.overdue)} overdue. ${communicationSummary.feeAwaitingApproval} fee reminders await review.`
          : 'No fee invoices or payments have been recorded yet. Add students and generate invoices to begin tracking collections.',
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
    if (stat.label === 'Present') return { ...stat, value: attendanceUnavailable ? '—' : String(todayCounts.present) }
    if (stat.label === 'Absent') return { ...stat, value: attendanceUnavailable ? '—' : String(todayCounts.absent) }
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
    ? `Today's recorded attendance is ${rate} across ${todayCounts.total} student records in ${scopeText}.${attendanceAttention.length ? ` ${attendanceAttention.length} attendance items meet the current attention rules.` : ''}`
    : attendanceAttention.length
      ? `No attendance has been recorded today in ${scopeText}. ${attendanceAttention.length} items meet the current attention rules based on previously recorded sessions.`
      : `No attendance has been recorded today in ${scopeText}. Add students and mark class attendance to begin tracking daily trends.`

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
      path: alert.studentId
        ? user.role === 'principal'
          ? `/students/${encodeURIComponent(alert.studentId)}`
          : `/fees/${encodeURIComponent(alert.studentId)}`
        : user.role === 'principal' ? '/alerts' : '/fees',
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

function SchoolDashboard({
  user,
  config,
  students,
  attendance,
  fees,
  communication,
  alerts,
  attendanceError,
  profiles,
  profilesLoading,
  profilesError,
  academicYear,
}: {
  user: SessionUser
  config: DashboardConfig
  students: Student[]
  attendance: AttendanceState
  fees: FeeState
  communication: CommunicationState
  alerts: AlertItem[]
  attendanceError: boolean
  profiles: SchoolUser[]
  profilesLoading: boolean
  profilesError: string
  academicYear: string | null
}) {
  const navigate = useNavigate()
  const activities = getDashboardActivities(user, students, attendance, fees, communication, alerts)
  const attendanceStat = config.stats.find((stat) => stat.label === 'Attendance')

  return (
    <section className="dashboard-page executive-dashboard">
      <DashboardHeader user={user} title={user.role === 'admin' ? 'Executive Dashboard' : 'School Operations Dashboard'} academicYear={academicYear} />

      <ExecutiveKpiGrid
        stats={config.stats}
        campusId={user.campusId}
        profiles={profiles}
        profilesLoading={profilesLoading}
        profilesError={profilesError}
      />

      <div className="executive-analytics-grid">
        <DashboardSection
          title="Attendance Overview"
          icon={<CalendarDays size={18} className="panel-title-icon text-blue" />}
          badgeText="Last 7 recorded days"
        >
          <AttendanceOverview
            data={config.trend}
            currentRate={attendanceStat?.value ?? '—'}
            error={attendanceError}
          />
        </DashboardSection>
        <DashboardSection
          title="Student Distribution"
          icon={<Users size={18} className="panel-title-icon text-blue" />}
          badgeText={`${students.length} students`}
        >
          <StudentDistribution students={students} />
        </DashboardSection>
      </div>

      <div className="executive-operations-grid">
        <DashboardSection title="Needs Attention" badgeText={`${config.attention.length} items`}>
          <AttentionList items={config.attention} onNavigate={navigate} />
        </DashboardSection>
        <DashboardSection
          title="Recent Activities"
          icon={<Activity size={18} className="panel-title-icon text-blue" />}
          badgeText={`${activities.length} recent`}
        >
          <RecentActivities activities={activities} navigate={navigate} />
        </DashboardSection>
        <DashboardSection title="Quick Actions" badgeText="Shortcuts">
          <QuickActions actions={config.quickActions} navigate={navigate} />
        </DashboardSection>
      </div>
    </section>
  )
}

function ExecutiveKpiGrid({ stats, campusId, profiles, profilesLoading, profilesError }: {
  stats: StatItem[]
  campusId: string | null
  profiles: SchoolUser[]
  profilesLoading: boolean
  profilesError: string
}) {
  const labels = ['Students', 'Attendance', 'Collected This Month', 'Total Teachers']
  const selectedStats = labels.flatMap((label) => {
    if (label === 'Total Teachers') {
      const activeTeachers = profiles.filter((profile) => (
        profile.role === 'teacher' &&
        profile.status === 'Active' &&
        (!campusId || profile.campusId === campusId)
      ))
      return [{
        label,
        value: profilesLoading || profilesError ? '—' : String(activeTeachers.length),
        subLabel: profilesLoading ? 'Loading teacher records' : profilesError ? 'Teacher data unavailable' : 'Active teachers',
        tone: 'purple' as const,
        icon: GraduationCap,
      }]
    }
    const stat = stats.find((item) => item.label === label)
    if (!stat) return []
    const displayLabel = label === 'Students' ? 'Total Students' : label === 'Collected This Month' ? 'Fees Collected' : label
    return [{ ...stat, label: displayLabel }]
  })

  return (
    <div className="executive-kpi-grid">
      {selectedStats.map((stat) => <StatCard key={stat.label} stat={stat} />)}
    </div>
  )
}

function AttendanceOverview({ data, currentRate, error }: {
  data: TrendPoint[]
  currentRate: string
  error: boolean
}) {
  if (error || !data.length) {
    return (
      <div className="executive-chart-empty" role={error ? 'alert' : undefined}>
        <span className="executive-empty-icon"><ClipboardCheck size={18} /></span>
        <strong>{error ? 'Attendance data is unavailable' : 'No attendance recorded yet'}</strong>
        <p>{error ? 'Retry attendance to refresh this overview.' : 'Recorded attendance sessions will appear here.'}</p>
      </div>
    )
  }

  const width = 620
  const height = 220
  const left = 38
  const right = 10
  const top = 14
  const bottom = 36
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const points = data.map((point, index) => ({
    ...point,
    x: left + (index * plotWidth) / Math.max(data.length - 1, 1),
    y: top + ((100 - point.value) / 100) * plotHeight,
  }))
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `${left},${top + plotHeight} ${line} ${left + plotWidth},${top + plotHeight}`

  return (
    <div className="attendance-overview">
      <div className="attendance-chart-summary">
        <div>
          <span>Today&apos;s attendance</span>
          <strong>{currentRate}</strong>
        </div>
        <span className="chart-period-label">Recorded sessions</span>
      </div>
      <svg className="attendance-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Attendance percentage over the last seven recorded days">
        {[0, 50, 100].map((tick) => {
          const y = top + ((100 - tick) / 100) * plotHeight
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={width - right} y2={y} />
              <text x={left - 10} y={y + 4} textAnchor="end">{tick}%</text>
            </g>
          )
        })}
        <polygon className="attendance-chart-area" points={area} />
        <polyline className="attendance-chart-line" points={line} />
        {points.map((point) => (
          <g key={`${point.day}-${point.x}`}>
            <circle className="attendance-chart-point" cx={point.x} cy={point.y} r="4" />
            <title>{`${point.day}: ${point.value}%`}</title>
            <text className="attendance-chart-day" x={point.x} y={height - 10} textAnchor="middle">{point.day}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function StudentDistribution({ students }: { students: Student[] }) {
  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const student of students) {
      const className = student.className.trim() || 'Unassigned class'
      counts.set(className, (counts.get(className) ?? 0) + 1)
    }
    const sorted = [...counts.entries()]
      .sort(([leftName, leftCount], [rightName, rightCount]) => rightCount - leftCount || leftName.localeCompare(rightName))
    const visible = sorted.slice(0, 4).map(([label, count]) => ({ label, count }))
    const remaining = sorted.slice(4).reduce((total, [, count]) => total + count, 0)
    if (remaining) visible.push({ label: 'Other classes', count: remaining })
    return visible
  }, [students])

  if (!students.length) {
    return (
      <div className="executive-chart-empty">
        <span className="executive-empty-icon"><Users size={18} /></span>
        <strong>No student records yet</strong>
        <p>Students will be grouped by class when records are available.</p>
      </div>
    )
  }

  const colors = ['#3B82F6', '#14B8A6', '#A78BFA', '#1E2A78', '#E5E7EB']
  const radius = 48
  const circumference = 2 * Math.PI * radius
  const segments = groups.map((group, index) => ({
    group,
    length: (group.count / students.length) * circumference,
    offset: (groups.slice(0, index).reduce((total, previous) => total + previous.count, 0) / students.length) * circumference,
  }))

  return (
    <div className="student-distribution">
      <div className="distribution-donut">
        <svg viewBox="0 0 120 120" role="img" aria-label={`Student distribution across ${groups.length} class groups`}>
          <circle className="distribution-track" cx="60" cy="60" r={radius} />
          {segments.map(({ group, length, offset }, index) => (
            <circle
              key={group.label}
              className="distribution-segment"
              cx="60"
              cy="60"
              r={radius}
              stroke={colors[index % colors.length]}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
            >
              <title>{`${group.label}: ${group.count} students`}</title>
            </circle>
          ))}
        </svg>
        <div className="distribution-total">
          <strong>{students.length}</strong>
          <span>students</span>
        </div>
      </div>
      <ul className="distribution-legend">
        {groups.map((group, index) => (
          <li key={group.label}>
            <span className="distribution-label">
              <i style={{ backgroundColor: colors[index % colors.length] }} />
              <span>{group.label}</span>
            </span>
            <span className="distribution-count">
              {group.count}
              <small>{Math.round((group.count / students.length) * 100)}%</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function getDashboardActivities(
  user: SessionUser,
  students: Student[],
  attendance: AttendanceState,
  fees: FeeState,
  communication: CommunicationState,
  alerts: AlertItem[],
): DashboardActivity[] {
  const activities: DashboardActivity[] = []
  const classesById = new Map(getAttendanceClasses(students).map((attendanceClass) => [attendanceClass.id, attendanceClass]))

  for (const session of attendance.sessions) {
    const attendanceClass = classesById.get(session.classId)
    if (!attendanceClass || session.status !== 'COMPLETED') continue
    activities.push({
      id: `attendance-${session.id}`,
      title: 'Attendance recorded',
      detail: `${attendanceClass.className} · ${attendanceClass.section}`,
      occurredAt: session.completedAt ?? `${session.date}T12:00:00`,
      path: `/attendance/take/${encodeURIComponent(session.classId)}?date=${session.date}`,
      icon: ClipboardCheck,
      tone: 'teal',
    })
  }

  const accessibleInvoices = getFeeInvoices(fees, students, user)
  const invoiceById = new Map(accessibleInvoices.map((invoice) => [invoice.id, invoice]))
  for (const payment of fees.payments) {
    const invoice = invoiceById.get(payment.invoiceId)
    if (!invoice || payment.voidedAt) continue
    activities.push({
      id: `payment-${payment.id}`,
      title: 'Fee payment recorded',
      detail: `${invoice.student.firstName} ${invoice.student.lastName} · ${formatFeeCurrency(payment.amount)}`,
      occurredAt: payment.date,
      path: user.role === 'principal'
        ? `/students/${encodeURIComponent(invoice.studentId)}`
        : `/fees/${encodeURIComponent(invoice.studentId)}`,
      icon: Wallet,
      tone: 'purple',
    })
  }

  for (const message of getAccessibleCommunication(communication, students, user)) {
    const isSent = message.status === 'SENT'
    const isApproved = message.status === 'APPROVED'
    const label = isSent
      ? 'Parent communication sent'
      : isApproved
        ? 'Communication approved'
        : message.status === 'AWAITING_APPROVAL'
          ? 'Communication submitted for review'
          : message.status === 'REJECTED'
            ? 'Communication returned for revision'
            : 'Communication draft created'
    activities.push({
      id: `communication-${message.id}`,
      title: label,
      detail: `${message.student.firstName} ${message.student.lastName} · ${message.type}`,
      occurredAt: isSent ? message.sentAt ?? message.updatedAt : isApproved ? message.approvedAt ?? message.updatedAt : message.createdAt,
      path: '/communication',
      icon: MessageSquareText,
      tone: 'blue',
    })
  }

  for (const alert of alerts) {
    if (alert.status === 'RESOLVED') continue
    const item = alertToAttention(alert, user)
    activities.push({
      id: `alert-${alert.id}`,
      title: alert.title,
      detail: alert.detail,
      occurredAt: alert.createdAt,
      path: item.path ?? '/alerts',
      icon: BellRing,
      tone: 'blue',
    })
  }

  return activities
    .filter((activity) => Number.isFinite(Date.parse(activity.occurredAt)))
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, 5)
}

function RecentActivities({ activities, navigate }: {
  activities: DashboardActivity[]
  navigate: (path: string) => void
}) {
  const [now] = useState(() => Date.now())
  if (!activities.length) {
    return (
      <div className="executive-activity-empty">
        <span className="executive-empty-icon"><CalendarDays size={18} /></span>
        <strong>No recent activity</strong>
        <p>Completed attendance, payments and communication updates will appear here.</p>
      </div>
    )
  }

  return (
    <ol className="executive-activity-list">
      {activities.map((activity) => {
        const Icon = activity.icon
        return (
          <li key={activity.id}>
            <span className={`activity-icon activity-${activity.tone}`}><Icon size={15} /></span>
            <button type="button" className="activity-copy" onClick={() => navigate(activity.path)}>
              <strong>{activity.title}</strong>
              <span>{activity.detail}</span>
              <time dateTime={activity.occurredAt}>{formatRelativeActivityTime(activity.occurredAt, now)}</time>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function formatRelativeActivityTime(value: string, now: number): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'Time unavailable'
  const elapsedMinutes = Math.round((timestamp - now) / 60_000)
  if (elapsedMinutes > 1) {
    return new Intl.DateTimeFormat('en-PK', { day: 'numeric', month: 'short' }).format(timestamp)
  }
  const minutes = Math.abs(elapsedMinutes)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d ago` : new Intl.DateTimeFormat('en-PK', { day: 'numeric', month: 'short' }).format(timestamp)
}

function FinanceDashboard({ user, config }: { user: SessionUser; config: DashboardConfig }) {
  const navigate = useNavigate()

  return (
    <section className="dashboard-page">
      <DashboardHeader user={user} title="Finance Dashboard" />

      <DashboardKpiGrid stats={config.stats} />

      {config.morningBrief ? (
        <MorningBrief
          summary={config.morningBrief.summary}
          cta={config.morningBrief.cta}
          onAction={() => navigate('/fees')}
        />
      ) : null}

      <div className="dashboard-grid">
        <DashboardSection title="Needs Attention">
          <AttentionList items={config.attention} onNavigate={navigate} />
        </DashboardSection>

        <DashboardSection title="Quick Actions">
          <QuickActions actions={config.quickActions} navigate={navigate} />
        </DashboardSection>
      </div>

      <DashboardSection title="Collections — This Month">
        <SimpleTrendChart data={config.trend} emptyMessage="Collection trend will appear after payments are recorded." />
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

      <DashboardKpiGrid stats={config.stats} />

      {config.morningBrief ? (
        <MorningBrief
          summary={config.morningBrief.summary}
          cta={config.morningBrief.cta}
          onAction={() => navigate('/attendance')}
        />
      ) : null}

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
        <DashboardSection title="Needs Attention">
          <AttentionList items={config.attention} onNavigate={navigate} />
        </DashboardSection>

        <DashboardSection title="Quick Actions">
          <QuickActions actions={config.quickActions} navigate={navigate} />
        </DashboardSection>
      </div>
    </section>
  )
}

function PageHeader({ user, title, academicYear }: { user: SessionUser; title: string; academicYear?: string | null }) {
  const firstName = user.name.split(' ')[0]
  const greetingName = academicYear !== undefined ? user.name : firstName
  const [dateContext] = useState(() => {
    const now = new Date()
    return {
      hour: now.getHours(),
      formatted: new Intl.DateTimeFormat('en-PK', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(now),
    }
  })
  const greeting = dateContext.hour < 12 ? 'Good Morning' : dateContext.hour < 17 ? 'Good Afternoon' : 'Good Evening'
  const academicYearValue = academicYear?.trim() ?? ''
  const academicYearRange = academicYearValue.match(/^(\d{4})-(\d{4})$/)
  const academicYearLabel = academicYearRange
    ? `Academic Year ${academicYearRange[1]} – ${academicYearRange[2].slice(-2)}`
    : academicYearValue
      ? `Academic Year ${academicYearValue}`
      : 'Academic year unavailable'
  const badgeLabel = title.toUpperCase().includes('FINANCE')
    ? 'FINANCE DASHBOARD'
    : title.toUpperCase().includes('TEACHER')
      ? 'TEACHER DASHBOARD'
      : 'EXECUTIVE DASHBOARD'

  return (
    <div className="hero-panel">
      <div className="hero-left">
        <span className="hero-badge">{badgeLabel}</span>
        <h1>{greeting}, <span className="hero-greeting-name">{greetingName}</span> <span aria-hidden="true">👋</span></h1>
        <p>Here&apos;s what&apos;s happening at {user.schoolName} today.</p>
      </div>

      <div className="hero-right">
        <div className="hero-meta">
          <div className="meta-pill muted-pill">
            <CalendarDays size={14} />
            <span>{dateContext.formatted}</span>
          </div>
          {academicYear !== undefined ? (
            <div className="meta-pill academic-year-pill">
              <BookOpenText size={14} />
              <span>{academicYearLabel}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </div>
          ) : (
            <div className="meta-pill">
              <Building2 size={14} />
              <span>{user.schoolName}</span>
            </div>
          )}
        </div>
        <div className="hero-illustration-wrap" aria-hidden="true">
          <img className="school-building-image" src={schoolBuildingIllustration} alt="" />
        </div>
      </div>
    </div>
  )
}

function DashboardHeader({ user, title, academicYear }: { user: SessionUser; title: string; academicYear?: string | null }) {
  return <PageHeader user={user} title={title} academicYear={academicYear} />
}

function DashboardKpiGrid({ stats }: { stats: StatItem[] }) {
  if (stats.length === 7) {
    return (
      <div className="stats-kpi-container">
        <div className="stats-kpi-row stats-kpi-row-3">
          {stats.slice(0, 3).map((stat) => (
            <StatCard key={stat.label} stat={stat} />
          ))}
        </div>
        <div className="stats-kpi-row stats-kpi-row-4">
          {stats.slice(3).map((stat) => (
            <StatCard key={stat.label} stat={stat} />
          ))}
        </div>
      </div>
    )
  }

  if (stats.length === 6) {
    return (
      <div className="stats-kpi-container">
        <div className="stats-kpi-row stats-kpi-row-3">
          {stats.slice(0, 3).map((stat) => (
            <StatCard key={stat.label} stat={stat} />
          ))}
        </div>
        <div className="stats-kpi-row stats-kpi-row-3">
          {stats.slice(3).map((stat) => (
            <StatCard key={stat.label} stat={stat} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="stats-kpi-container">
      <div className="stats-kpi-row stats-kpi-row-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </div>
    </div>
  )
}

function MetricCard({ stat }: { stat: StatItem }) {
  const Icon = stat.icon
  const label = stat.label.toLowerCase()
  const accent = label.includes('student')
    ? 'students'
    : label.includes('alert')
      ? 'alerts'
      : label.includes('attendance') || label === 'present'
      ? 'attendance'
      : label.includes('collected')
        ? 'collected'
        : label.includes('outstanding')
          ? 'outstanding'
          : label.includes('overdue') || label === 'absent'
            ? 'overdue'
            : label.includes('communication') || label.includes('reminder')
              ? 'communications'
              : 'default'

  return (
    <article className={`stat-card ${stat.tone} metric-${accent}`}>
      <div className="stat-card-main">
        <span className="stat-icon-box">
          <Icon size={19} strokeWidth={2.2} />
        </span>
        <div className="stat-card-text">
          <span className="stat-label">{stat.label}</span>
          <strong className="stat-value">{stat.value}</strong>
          <small className="stat-sublabel">{stat.subLabel}</small>
        </div>
      </div>
      {stat.trendLabel ? (
        <span className="stat-trend">
          <TrendingUp size={12} />
          {stat.trendLabel}
        </span>
      ) : null}
      <span className="stat-spark" aria-hidden="true" />
      <span className="stat-decoration" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </article>
  )
}

function StatCard({ stat }: { stat: StatItem }) {
  return <MetricCard stat={stat} />
}

function MorningBrief({ summary, cta, onAction }: { summary: string; cta: string; onAction?: () => void }) {
  return (
    <div className="morning-brief">
      <div className="brief-ai-avatar">
        <Sparkles size={22} />
      </div>
      <div className="brief-center-content">
        <h3 className="brief-title">AI Morning Brief ✨</h3>
        <p className="brief-summary">{summary}</p>
      </div>
      <div className="brief-right-actions">
        <span className="brief-badge">Powered by CAMVIA AI</span>
        <button type="button" className="brief-cta-btn" onClick={onAction}>
          <span>{cta}</span>
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

function SectionCard({
  title,
  icon,
  badgeText = 'Updated',
  children,
}: {
  title: string
  icon?: ReactNode
  badgeText?: string
  children: ReactNode
}) {
  const renderedIcon = icon ?? (
    title.toLowerCase().includes('attention') ? (
      <AlertTriangle size={18} className="panel-title-icon text-amber" />
    ) : title.toLowerCase().includes('quick') ? (
      <Zap size={18} className="panel-title-icon text-blue" />
    ) : title.toLowerCase().includes('attendance') || title.toLowerCase().includes('trend') || title.toLowerCase().includes('collection') ? (
      <TrendingUp size={18} className="panel-title-icon text-blue" />
    ) : title.toLowerCase().includes('classes') ? (
      <BookCheck size={18} className="panel-title-icon text-blue" />
    ) : null
  )

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div className="panel-title-group">
          {renderedIcon}
          <h3>{title}</h3>
        </div>
        {badgeText ? <span className="status-pill updated-pill">{badgeText}</span> : null}
      </div>
      {children}
    </section>
  )
}

function DashboardSection({
  title,
  icon,
  badgeText = 'Updated',
  children,
}: {
  title: string
  icon?: ReactNode
  badgeText?: string
  children: ReactNode
}) {
  return (
    <SectionCard title={title} icon={icon} badgeText={badgeText}>
      {children}
    </SectionCard>
  )
}

function AttentionItemCard({ item, onNavigate }: { item: AttentionItem; onNavigate?: (path: string) => void }) {
  return (
    <li className={`attention-row attention-${item.level.toLowerCase()}`} key={`${item.level}-${item.title}`}>
      <div className="attention-copy">
        <span className={`severity-chip severity-${item.level.toLowerCase()}`}>{item.level}</span>
        <div className="attention-text">
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
        </div>
      </div>
      <div className="attention-actions">
        <button
          type="button"
          className="attention-action-btn"
          onClick={() => item.path && onNavigate?.(item.path)}
        >
          <span>{item.cta || 'View Student'}</span>
          <ArrowRight size={14} />
        </button>
      </div>
    </li>
  )
}

function AttentionList({ items, onNavigate }: { items: AttentionItem[]; onNavigate?: (path: string) => void }) {
  if (!items.length) {
    return (
      <div className="executive-no-attention">
        <span className="executive-empty-icon"><CheckCircle2 size={16} /></span>
        <span>No items need follow-up right now.</span>
      </div>
    )
  }
  return (
    <ul className="list-stack">
      {items.map((item) => (
        <AttentionItemCard key={`${item.level}-${item.title}`} item={item} onNavigate={onNavigate} />
      ))}
    </ul>
  )
}

function QuickActionCard({ action, navigate }: { action: QuickAction; navigate: (path: string) => void }) {
  const Icon = action.icon
  const label = action.label.toLowerCase()
  const tone = label.includes('alert')
    ? 'alerts'
    : label.includes('attendance')
      ? 'attendance'
      : label.includes('student') || label.includes('user')
        ? 'students'
        : label.includes('fee') || label.includes('collection')
          ? 'finance'
          : 'communication'

  return (
    <button key={action.label} type="button" className={`action-chip action-${tone}`} onClick={() => navigate(action.path)}>
      <span className="quick-action-icon">
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <span className="quick-action-copy">
        <strong>{action.label}</strong>
        <small>{action.description}</small>
      </span>
      <ChevronRight size={16} className="quick-action-chevron" />
    </button>
  )
}

function QuickActions({ actions, navigate }: { actions: QuickAction[]; navigate: (path: string) => void }) {
  return (
    <div className="action-list">
      {actions.map((action) => (
        <QuickActionCard key={action.label} action={action} navigate={navigate} />
      ))}
    </div>
  )
}

function SimpleTrendChart({ data, emptyMessage = 'Trend data will appear after attendance has been recorded.' }: { data: TrendPoint[]; emptyMessage?: string }) {
  if (!data.length) {
    return (
      <div className="chart-empty-state">
        <TrendingUp size={24} className="chart-empty-icon" />
        <p className="student-muted">{emptyMessage}</p>
      </div>
    )
  }
  const width = 800
  const height = 220
  const padding = 28
  const maxValue = Math.max(...data.map((point) => point.value))
  const minValue = Math.min(...data.map((point) => point.value))

  const coords = data.map((point, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(data.length - 1, 1)
    const y = height - padding - ((point.value - minValue) / Math.max(maxValue - minValue, 1)) * (height - padding * 2)
    return { x, y }
  })

  const points = coords.map(({ x, y }) => `${x},${y}`).join(' ')
  const areaPath = `${coords.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')} L ${coords.at(-1)?.x ?? width - padding} ${height - padding} L ${coords[0]?.x ?? padding} ${height - padding} Z`

  return (
    <div className="chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Attendance trend chart">
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2F6BFF" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#2F6BFF" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => {
          const y = padding + (line * (height - padding * 2)) / 3
          return (
            <line
              key={line}
              x1={padding}
              x2={width - padding}
              y1={y}
              y2={y}
              className="chart-gridline"
            />
          )
        })}
        <path d={areaPath} fill="url(#trend-fill)" />
        <polyline
          points={points}
          fill="none"
          stroke="#2F6BFF"
          strokeWidth="3.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {coords.map((point, index) => {
          const day = data[index].day
          return (
            <g key={day}>
              <circle cx={point.x} cy={point.y} r="6" fill="#FFFFFF" stroke="#2F6BFF" strokeWidth="2.5" />
              <text x={point.x} y={height - 6} textAnchor="middle" className="chart-label">
                {day}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
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

export default App
