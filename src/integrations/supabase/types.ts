export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          changed_fields: string[] | null
          created_at: string
          id: string
          is_master_action: boolean
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          school_id: string | null
          source: string
          table_name: string
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          changed_fields?: string[] | null
          created_at?: string
          id?: string
          is_master_action?: boolean
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          school_id?: string | null
          source?: string
          table_name: string
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          changed_fields?: string[] | null
          created_at?: string
          id?: string
          is_master_action?: boolean
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          school_id?: string | null
          source?: string
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      class_teachers: {
        Row: {
          class_id: string | null
          created_at: string | null
          id: string
          school_id: string | null
          teacher_id: string | null
          weekly_hours: number | null
        }
        Insert: {
          class_id?: string | null
          created_at?: string | null
          id?: string
          school_id?: string | null
          teacher_id?: string | null
          weekly_hours?: number | null
        }
        Update: {
          class_id?: string | null
          created_at?: string | null
          id?: string
          school_id?: string | null
          teacher_id?: string | null
          weekly_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "class_teachers_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_teachers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_teachers_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_teachers_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          grade: string | null
          id: string
          level: string
          max_capacity: number | null
          monthly_fee: number | null
          monthly_fee_integral: number | null
          name: string
          school_id: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          grade?: string | null
          id?: string
          level?: string
          max_capacity?: number | null
          monthly_fee?: number | null
          monthly_fee_integral?: number | null
          name: string
          school_id?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          grade?: string | null
          id?: string
          level?: string
          max_capacity?: number | null
          monthly_fee?: number | null
          monthly_fee_integral?: number | null
          name?: string
          school_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          class_id: string | null
          created_at: string
          discount: number
          due_day: number
          end_date: string
          final_amount: number | null
          id: string
          monthly_amount: number
          period: string
          renewed_from_id: string | null
          school_id: string | null
          start_date: string
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          class_id?: string | null
          created_at?: string
          discount?: number
          due_day?: number
          end_date?: string
          final_amount?: number | null
          id?: string
          monthly_amount?: number
          period?: string
          renewed_from_id?: string | null
          school_id?: string | null
          start_date?: string
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          class_id?: string | null
          created_at?: string
          discount?: number
          due_day?: number
          end_date?: string
          final_amount?: number | null
          id?: string
          monthly_amount?: number
          period?: string
          renewed_from_id?: string | null
          school_id?: string | null
          start_date?: string
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_renewed_from_id_fkey"
            columns: ["renewed_from_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      debug_reports: {
        Row: {
          comment: string
          console_logs: Json
          created_at: string
          id: string
          page_url: string
          resolved_at: string | null
          school_id: string
          screenshot_path: string | null
          status: string
          user_agent: string | null
          user_id: string
          video_path: string | null
        }
        Insert: {
          comment: string
          console_logs?: Json
          created_at?: string
          id?: string
          page_url: string
          resolved_at?: string | null
          school_id: string
          screenshot_path?: string | null
          status?: string
          user_agent?: string | null
          user_id: string
          video_path?: string | null
        }
        Update: {
          comment?: string
          console_logs?: Json
          created_at?: string
          id?: string
          page_url?: string
          resolved_at?: string | null
          school_id?: string
          screenshot_path?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string
          video_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "debug_reports_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          class_id: string | null
          enrolled_at: string | null
          id: string
          student_id: string | null
        }
        Insert: {
          class_id?: string | null
          enrolled_at?: string | null
          id?: string
          student_id?: string | null
        }
        Update: {
          class_id?: string | null
          enrolled_at?: string | null
          id?: string
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          allocation_method: string
          color: string
          created_at: string
          created_by: string | null
          id: string
          is_fixed_cost: boolean
          name: string
          school_id: string
        }
        Insert: {
          allocation_method?: string
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_fixed_cost?: boolean
          name: string
          school_id: string
        }
        Update: {
          allocation_method?: string
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_fixed_cost?: boolean
          name?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category_id: string
          class_id: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string
          id: string
          notes: string | null
          paid_date: string | null
          payment_method: string | null
          recurring_expense_id: string | null
          school_id: string
          status: string
        }
        Insert: {
          amount: number
          category_id: string
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          due_date: string
          id?: string
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          recurring_expense_id?: string | null
          school_id: string
          status?: string
        }
        Update: {
          amount?: number
          category_id?: string
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string
          id?: string
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          recurring_expense_id?: string | null
          school_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_recurring_expense_id_fkey"
            columns: ["recurring_expense_id"]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string | null
          pending_school_name: string | null
          pending_school_plan: string | null
          pending_school_segments: Json | null
          role: string
          school_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          pending_school_name?: string | null
          pending_school_plan?: string | null
          pending_school_segments?: Json | null
          role: string
          school_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          pending_school_name?: string | null
          pending_school_plan?: string | null
          pending_school_segments?: Json | null
          role?: string
          school_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_master_admin: boolean | null
          school_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          is_master_admin?: boolean | null
          school_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_master_admin?: boolean | null
          school_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expenses: {
        Row: {
          active: boolean
          amount: number
          category_id: string
          class_id: string | null
          created_at: string
          created_by: string | null
          description: string
          due_day: number
          end_date: string | null
          id: string
          school_id: string
          start_date: string
        }
        Insert: {
          active?: boolean
          amount: number
          category_id: string
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          due_day: number
          end_date?: string | null
          id?: string
          school_id: string
          start_date: string
        }
        Update: {
          active?: boolean
          amount?: number
          category_id?: string
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_day?: number
          end_date?: string | null
          id?: string
          school_id?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      renegotiations: {
        Row: {
          created_at: string
          created_by: string | null
          first_due_date: string
          id: string
          installments: number
          new_installment_amount: number
          notes: string | null
          original_amount: number
          school_id: string
          student_id: string
          total_renegotiated: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          first_due_date: string
          id?: string
          installments: number
          new_installment_amount: number
          notes?: string | null
          original_amount: number
          school_id: string
          student_id: string
          total_renegotiated: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          first_due_date?: string
          id?: string
          installments?: number
          new_installment_amount?: number
          notes?: string | null
          original_amount?: number
          school_id?: string
          student_id?: string
          total_renegotiated?: number
        }
        Relationships: [
          {
            foreignKeyName: "renegotiations_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renegotiations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      school_services: {
        Row: {
          active: boolean
          created_at: string
          default_installments: number | null
          id: string
          name: string
          price: number
          school_id: string
          type: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          default_installments?: number | null
          id?: string
          name: string
          price: number
          school_id: string
          type?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          default_installments?: number | null
          id?: string
          name?: string
          price?: number
          school_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_services_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          created_at: string | null
          id: string
          logo_url: string | null
          name: string
          owner_user_id: string | null
          plan: string | null
          segments: string[] | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          owner_user_id?: string | null
          plan?: string | null
          segments?: string[] | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          owner_user_id?: string | null
          plan?: string | null
          segments?: string[] | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      service_charges: {
        Row: {
          amount: number
          created_at: string
          description: string
          due_date: string
          id: string
          paid_date: string | null
          payment_method: string | null
          school_id: string
          service_id: string
          status: string
          student_id: string
          student_service_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          due_date: string
          id?: string
          paid_date?: string | null
          payment_method?: string | null
          school_id: string
          service_id: string
          status?: string
          student_id: string
          student_service_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          due_date?: string
          id?: string
          paid_date?: string | null
          payment_method?: string | null
          school_id?: string
          service_id?: string
          status?: string
          student_id?: string
          student_service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_charges_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_charges_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "school_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_charges_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_charges_student_service_id_fkey"
            columns: ["student_service_id"]
            isOneToOne: false
            referencedRelation: "student_services"
            referencedColumns: ["id"]
          },
        ]
      }
      student_services: {
        Row: {
          active: boolean
          created_at: string
          due_day: number
          end_date: string | null
          id: string
          installments: number | null
          price: number
          school_id: string
          service_id: string
          start_date: string
          student_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          due_day: number
          end_date?: string | null
          id?: string
          installments?: number | null
          price: number
          school_id: string
          service_id: string
          start_date: string
          student_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          due_day?: number
          end_date?: string | null
          id?: string
          installments?: number | null
          price?: number
          school_id?: string
          service_id?: string
          start_date?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_services_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "school_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_services_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          birth_date: string
          created_at: string | null
          discount: number | null
          email: string | null
          enrollment_date: string | null
          final_tuition_value: number | null
          full_name: string
          full_tuition_value: number | null
          guardian_contact: string | null
          id: string
          name: string | null
          phone: string | null
          school_id: string | null
          status: string | null
        }
        Insert: {
          birth_date: string
          created_at?: string | null
          discount?: number | null
          email?: string | null
          enrollment_date?: string | null
          final_tuition_value?: number | null
          full_name: string
          full_tuition_value?: number | null
          guardian_contact?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          school_id?: string | null
          status?: string | null
        }
        Update: {
          birth_date?: string
          created_at?: string | null
          discount?: number | null
          email?: string | null
          enrollment_date?: string | null
          final_tuition_value?: number | null
          full_name?: string
          full_tuition_value?: number | null
          guardian_contact?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          school_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          created_at: string | null
          email: string
          full_name: string
          id: string
          phone: string | null
          salary: number | null
          school_id: string | null
          specialization: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          phone?: string | null
          salary?: number | null
          school_id?: string | null
          specialization?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          salary?: number | null
          school_id?: string | null
          specialization?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teachers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      tuitions: {
        Row: {
          amount: number
          category: string
          contract_id: string | null
          created_at: string
          description: string
          discount_applied: number | null
          due_date: string
          final_amount: number | null
          id: string
          paid_date: string | null
          payment_method: string | null
          penalty_amount: number | null
          renegotiation_id: string | null
          school_id: string | null
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string
          contract_id?: string | null
          created_at?: string
          description: string
          discount_applied?: number | null
          due_date: string
          final_amount?: number | null
          id?: string
          paid_date?: string | null
          payment_method?: string | null
          penalty_amount?: number | null
          renegotiation_id?: string | null
          school_id?: string | null
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          contract_id?: string | null
          created_at?: string
          description?: string
          discount_applied?: number | null
          due_date?: string
          final_amount?: number | null
          id?: string
          paid_date?: string | null
          payment_method?: string | null
          penalty_amount?: number | null
          renegotiation_id?: string | null
          school_id?: string | null
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tuitions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tuitions_renegotiation_id_fkey"
            columns: ["renegotiation_id"]
            isOneToOne: false
            referencedRelation: "renegotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tuitions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tuitions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      teachers_directory: {
        Row: {
          full_name: string | null
          id: string | null
          school_id: string | null
          status: string | null
        }
        Insert: {
          full_name?: string | null
          id?: string | null
          school_id?: string | null
          status?: string | null
        }
        Update: {
          full_name?: string | null
          id?: string | null
          school_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teachers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      get_active_teachers_salary_sum: {
        Args: { p_school_id: string }
        Returns: number
      }
      get_current_user_role: { Args: never; Returns: string }
      get_user_by_email: {
        Args: { p_email: string }
        Returns: {
          email: string
          id: string
        }[]
      }
      get_user_role: { Args: { _user_id: string }; Returns: string }
      get_user_school_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_contract: {
        Args: { p_contract: Json; p_school_id: string }
        Returns: string
      }
      import_enrollment: {
        Args: { p_class_id: string; p_school_id: string; p_student_id: string }
        Returns: undefined
      }
      import_student: {
        Args: { p_school_id: string; p_student: Json }
        Returns: string
      }
      import_teacher: {
        Args: { p_school_id: string; p_teacher: Json }
        Returns: string
      }
      insert_generated_expenses: {
        Args: { p_rows: Json; p_school_id: string }
        Returns: number
      }
      insert_generated_tuitions: {
        Args: { p_rows: Json; p_school_id: string }
        Returns: number
      }
      is_master_admin: { Args: never; Returns: boolean }
      promote_overdue_tuitions: { Args: never; Returns: undefined }
      renegotiate_tuitions: {
        Args: {
          p_created_by: string
          p_first_due_date: string
          p_installments: number
          p_new_installment_amount: number
          p_notes: string
          p_school_id: string
          p_student_id: string
          p_tuition_ids: string[]
        }
        Returns: string
      }
      save_class_with_teachers: {
        Args: {
          p_class_id: string
          p_color: string
          p_description: string
          p_grade: string
          p_max_capacity: number
          p_monthly_fee: number
          p_monthly_fee_integral: number
          p_name: string
          p_school_id: string
          p_source?: string
          p_teacher_hours?: number[]
          p_teacher_ids: string[]
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "financial" | "teacher"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "financial", "teacher"],
    },
  },
} as const
A new version of Supabase CLI is available: v3.1.0 (currently installed v2.117.0)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
