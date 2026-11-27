import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  parseDashboardAttendanceSummary,
  parseDashboardStudentSummary,
  type DashboardAttendanceSummary,
  type DashboardStudentSummary,
} from './dashboardSummaryContract'

export {
  type DashboardAttendanceSummary,
  type DashboardStudentSummary,
} from './dashboardSummaryContract'

export async function fetchDashboardStudentSummary(): Promise<DashboardStudentSummary> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Dashboard data is unavailable because Supabase is not configured.')
  }

  const { data, error } = await supabase.rpc('get_dashboard_student_summary')
  if (error) {
    if (import.meta.env.DEV) {
      console.error('[CAMVIA Dashboard] Student summary query failed:', {
        operation: 'get_dashboard_student_summary',
        code: error.code,
        message: error.message,
      })
    }
    if (error.code === 'PGRST202') {
      throw new Error('Dashboard summary migration is not installed. Apply migration 049 before using the dashboard.')
    }
    throw new Error('Authorized dashboard student statistics could not be loaded.')
  }

  return parseDashboardStudentSummary(data)
}

export async function fetchDashboardAttendanceSummary(): Promise<DashboardAttendanceSummary> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Dashboard attendance data is unavailable because Supabase is not configured.')
  }

  const { data, error } = await supabase.rpc('get_dashboard_attendance_summary')
  if (error) {
    if (import.meta.env.DEV) {
      console.error('[CAMVIA Dashboard] Attendance summary query failed:', {
        operation: 'get_dashboard_attendance_summary',
        code: error.code,
        message: error.message,
      })
    }
    if (error.code === 'PGRST202') {
      throw new Error('Dashboard attendance migration is not installed. Apply migration 050 before using attendance charts.')
    }
    throw new Error('Authorized dashboard attendance statistics could not be loaded.')
  }

  return parseDashboardAttendanceSummary(data)
}
