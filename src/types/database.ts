export type RoleName = 'ADMIN' | 'PRINCIPAL' | 'FINANCE' | 'TEACHER'
export type ProfileStatus = 'ACTIVE' | 'INACTIVE'

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['organizations']['Insert']>
      }
      schools: {
        Row: {
          id: string
          organization_id: string
          name: string
          short_name: string
          email: string | null
          phone: string | null
          address: string | null
          country: string | null
          timezone: string | null
          academic_year: string | null
          status: string
          created_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          short_name: string
          email?: string | null
          phone?: string | null
          address?: string | null
          country?: string | null
          timezone?: string | null
          academic_year?: string | null
          status?: string
          created_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['schools']['Insert']>
      }
      campuses: {
        Row: {
          id: string
          organization_id: string
          school_id: string
          name: string
          code: string
          address: string | null
          status: string
          created_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          school_id: string
          name: string
          code: string
          address?: string | null
          status?: string
          created_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['campuses']['Insert']>
      }
      integration_configs: {
        Row: {
          id: string
          organization_id: string
          school_id: string
          provider_key: 'EMAIL' | 'SMS' | 'WHATSAPP'
          status: 'NOT_CONFIGURED' | 'CONFIGURED' | 'DISABLED'
          external_identifier: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          school_id: string
          provider_key: 'EMAIL' | 'SMS' | 'WHATSAPP'
          status?: 'NOT_CONFIGURED' | 'CONFIGURED' | 'DISABLED'
          external_identifier?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['integration_configs']['Insert']>
      }
      roles: {
        Row: {
          name: RoleName
          description: string | null
        }
        Insert: {
          name: RoleName
          description?: string | null
        }
        Update: Partial<Database['public']['Tables']['roles']['Insert']>
      }
      profiles: {
        Row: {
          id: string
          organization_id: string | null
          school_id: string | null
          campus_id: string | null
          full_name: string
          email: string
          status: ProfileStatus
          role: RoleName
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          organization_id?: string | null
          school_id?: string | null
          campus_id?: string | null
          full_name: string
          email: string
          status?: ProfileStatus
          role: RoleName
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      user_roles: {
        Row: {
          user_id: string
          role: RoleName
          created_at: string
        }
        Insert: {
          user_id: string
          role: RoleName
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['user_roles']['Insert']>
      }
      teacher_class_assignments: {
        Row: {
          id: string
          user_id: string
          school_id: string
          campus_id: string
          class_name: string
          section: string
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          school_id: string
          campus_id: string
          class_name: string
          section: string
          active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['teacher_class_assignments']['Insert']>
      }
      students: {
        Row: {
          id: string
          organization_id: string
          school_id: string
          campus_id: string
          student_code: string
          first_name: string
          last_name: string
          class_name: string
          section: string
          roll_number: string | null
          date_of_birth: string | null
          gender: string | null
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          school_id: string
          campus_id: string
          student_code: string
          first_name: string
          last_name: string
          class_name: string
          section: string
          roll_number?: string | null
          date_of_birth?: string | null
          gender?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['students']['Insert']>
      }
      guardians: {
        Row: {
          id: string
          organization_id: string
          school_id: string
          campus_id: string
          first_name: string
          last_name: string
          relationship: string | null
          phone: string | null
          email: string | null
          address: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          school_id: string
          campus_id: string
          first_name: string
          last_name: string
          relationship?: string | null
          phone?: string | null
          email?: string | null
          address?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['guardians']['Insert']>
      }
      student_guardians: {
        Row: {
          student_id: string
          guardian_id: string
          relationship: string | null
          is_primary: boolean
          created_at: string
        }
        Insert: {
          student_id: string
          guardian_id: string
          relationship?: string | null
          is_primary?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['student_guardians']['Insert']>
      }
      fee_invoices: {
        Row: {
          id: string
          organization_id: string
          school_id: string
          campus_id: string
          student_id: string
          fee_period: string
          due_date: string
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          school_id: string
          campus_id: string
          student_id: string
          fee_period: string
          due_date: string
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['fee_invoices']['Insert']>
      }
      fee_invoice_items: {
        Row: {
          id: string
          invoice_id: string
          label: string
          amount: number
          created_at: string
        }
        Insert: {
          id?: string
          invoice_id: string
          label: string
          amount: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['fee_invoice_items']['Insert']>
      }
      fee_payments: {
        Row: {
          id: string
          invoice_id: string
          student_id: string
          amount: number
          payment_date: string
          payment_method: 'Cash' | 'Bank Transfer' | 'Card' | 'Online'
          reference: string
          note: string
          idempotency_key: string
          received_by: string
          created_at: string
        }
        Insert: {
          id?: string
          invoice_id: string
          student_id: string
          amount: number
          payment_date: string
          payment_method: 'Cash' | 'Bank Transfer' | 'Card' | 'Online'
          reference?: string
          note?: string
          idempotency_key: string
          received_by: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['fee_payments']['Insert']>
      }
      communication_messages: {
        Row: {
          id: string
          organization_id: string
          school_id: string
          campus_id: string
          student_id: string
          created_by: string
          message_type: 'Attendance Reminder' | 'Fee Reminder' | 'General Notice' | 'Follow-up'
          channel: 'WhatsApp' | 'SMS' | 'Email'
          body: string
          source_type: 'ATTENDANCE' | 'FEE' | 'STUDENT' | 'MANUAL'
          source_id: string
          status: 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SENT'
          requires_approval: boolean
          submitted_at: string | null
          approved_by: string | null
          approved_at: string | null
          rejected_by: string | null
          rejected_at: string | null
          rejection_reason: string
          sent_by: string | null
          sent_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          school_id: string
          campus_id: string
          student_id: string
          created_by: string
          message_type: 'Attendance Reminder' | 'Fee Reminder' | 'General Notice' | 'Follow-up'
          channel: 'WhatsApp' | 'SMS' | 'Email'
          body: string
          source_type: 'ATTENDANCE' | 'FEE' | 'STUDENT' | 'MANUAL'
          source_id: string
          status?: 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SENT'
          requires_approval?: boolean
          submitted_at?: string | null
          approved_by?: string | null
          approved_at?: string | null
          rejected_by?: string | null
          rejected_at?: string | null
          rejection_reason?: string
          sent_by?: string | null
          sent_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['communication_messages']['Insert']>
      }
      communication_recipients: {
        Row: { id: string; message_id: string; student_id: string; guardian_id: string; created_at: string }
        Insert: { id?: string; message_id: string; student_id: string; guardian_id: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['communication_recipients']['Insert']>
      }
      communication_events: {
        Row: {
          id: string
          message_id: string
          actor_id: string
          action: 'Created' | 'Edited' | 'Submitted' | 'Approved' | 'Rejected' | 'Sent'
          created_at: string
        }
        Insert: {
          id?: string
          message_id: string
          actor_id: string
          action: 'Created' | 'Edited' | 'Submitted' | 'Approved' | 'Rejected' | 'Sent'
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['communication_events']['Insert']>
      }
      attendance_sessions: {
        Row: {
          id: string
          organization_id: string
          school_id: string
          campus_id: string
          class_name: string
          section: string
          attendance_date: string
          created_by: string
          updated_by: string
          status: 'IN_PROGRESS' | 'COMPLETED'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          school_id: string
          campus_id: string
          class_name: string
          section: string
          attendance_date: string
          created_by: string
          updated_by: string
          status?: 'IN_PROGRESS' | 'COMPLETED'
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['attendance_sessions']['Insert']>
      }
      attendance_records: {
        Row: {
          id: string
          attendance_session_id: string
          student_id: string
          status: 'PRESENT' | 'ABSENT' | 'LATE'
          note: string
          marked_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          attendance_session_id: string
          student_id: string
          status: 'PRESENT' | 'ABSENT' | 'LATE'
          note?: string
          marked_by: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['attendance_records']['Insert']>
      }
    }
    Views: {
      live_alerts: {
        Row: {
          id: string
          organization_id: string
          school_id: string
          campus_id: string | null
          student_id: string | null
          class_name: string | null
          section: string | null
          priority: string
          status: string
          source_type: string
          source_id: string
          title: string
          detail: string
          created_at: string
          priority_rank: number
          status_rank: number
        }
      }
    }
    Functions: {
      can_access_attendance_scope: {
        Args: {
          target_organization_id: string
          target_school_id: string
          target_campus_id: string
          target_class_name: string
          target_section: string
        }
        Returns: boolean
      }
      can_manage_attendance_scope: {
        Args: {
          target_organization_id: string
          target_school_id: string
          target_campus_id: string
          target_class_name: string
          target_section: string
        }
        Returns: boolean
      }
      can_access_attendance_record: {
        Args: { target_session_id: string; target_student_id: string }
        Returns: boolean
      }
      can_manage_attendance_record: {
        Args: { target_session_id: string; target_student_id: string }
        Returns: boolean
      }
      save_attendance_session: {
        Args: {
          target_organization_id: string
          target_school_id: string
          target_campus_id: string
          target_class_name: string
          target_section: string
          target_attendance_date: string
          target_records: Array<{
            student_id: string
            status: 'PRESENT' | 'ABSENT' | 'LATE'
            note: string
          }>
        }
        Returns: string
      }
      can_access_fee_scope: {
        Args: {
          target_organization_id: string
          target_school_id: string
          target_campus_id: string
          target_student_id: string
        }
        Returns: boolean
      }
      can_manage_fee_scope: {
        Args: {
          target_organization_id: string
          target_school_id: string
          target_campus_id: string
          target_student_id: string
        }
        Returns: boolean
      }
      can_access_fee_invoice: {
        Args: { target_invoice_id: string; target_student_id?: string }
        Returns: boolean
      }
      can_manage_fee_invoice: {
        Args: { target_invoice_id: string; target_student_id?: string }
        Returns: boolean
      }
      record_fee_payment: {
        Args: {
          target_invoice_id: string
          target_student_id: string
          target_amount: number
          target_payment_date: string
          target_payment_method: 'Cash' | 'Bank Transfer' | 'Card' | 'Online'
          target_reference: string
          target_note: string
          target_idempotency_key: string
        }
        Returns: string
      }
      can_access_communication_student: {
        Args: { target_student_id: string }
        Returns: boolean
      }
      can_access_communication_message: {
        Args: { target_message_id: string }
        Returns: boolean
      }
      save_communication_draft: {
        Args: {
          target_student_id: string
          target_guardian_id: string
          target_message_type: 'Attendance Reminder' | 'Fee Reminder' | 'General Notice' | 'Follow-up'
          target_channel: 'WhatsApp' | 'SMS' | 'Email'
          target_body: string
          target_source_type: 'ATTENDANCE' | 'FEE' | 'STUDENT' | 'MANUAL'
          target_source_id: string
          target_message_id?: string | null
          target_submit?: boolean
        }
        Returns: string
      }
      transition_communication_message: {
        Args: { target_message_id: string; target_operation: 'submit' | 'approve' | 'reject' | 'send'; target_rejection_reason?: string }
        Returns: undefined
      }
    }
  }
}
