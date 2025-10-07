// TypeScript interfaces matching exact Supabase schema

export interface Student {
  id: string;
  name: string;
  birth_date: string;
  guardian_contact: string;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  email: string | null;
  phone: string | null;
  enrollment_date: string | null;
  full_tuition_value: number | null;
  discount: number | null;
  final_tuition_value: number | null;
}

export interface Enrollment {
  id: string;
  student_id: string;
  class_id: string;
  enrolled_at: string;
  students?: Student;
  classes?: Class;
}

export interface Teacher {
  id: string;
  email: string;
  specialization: string;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  full_name: string;
  salary: number | null;
  phone: string | null;
}

export interface Class {
  id: string;
  name: string;
  teacher_id: string | null;
  max_capacity: number;
  color: string;
  created_at: string;
  updated_at: string;
  description: string | null;
  tuition_per_student: number | null;
  grade: string | null;
  monthly_fee: number | null;
  teachers?: { full_name: string; specialization: string };
  student_count?: number;
}

export interface Contract {
  id: string;
  student_id: string;
  class_id: string | null;
  start_date: string;
  end_date: string;
  monthly_amount: number;
  discount: number;
  status: "active" | "suspended" | "cancelled";
  created_at: string;
  updated_at: string;
  students?: { name: string };
  classes?: { name: string };
}

export interface Tuition {
  id: string;
  student_id: string;
  amount: number;
  due_date: string;
  description: string;
  category: string;
  status: "pending" | "paid" | "overdue" | "cancelled";
  paid_date: string | null;
  payment_method: string | null;
  created_at: string;
  updated_at: string;
  contract_id: string | null;
  discount_applied: number | null;
  penalty_amount: number | null;
  final_amount: number | null;
  students?: { name: string; classes?: { name: string } | null } | null;
  contracts?: { monthly_amount: number; discount: number } | null;
}

export interface Payment {
  id: string;
  contract_id: string;
  due_date: string;
  payment_date: string | null;
  amount: number;
  status: "pending" | "paid" | "overdue";
  created_at: string;
}

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: "admin" | "financial" | "teacher";
  created_at: string;
  updated_at: string;
}

export interface ClassTeacher {
  id: string;
  class_id: string;
  teacher_id: string;
  created_at: string;
}

export interface FinancialHealth {
  classId: string;
  percentage: number;
  status: "excellent" | "good" | "warning" | "critical";
  totalStudents: number;
  paidStudents: number;
  totalRevenue: number;
  paidRevenue: number;
}

export type PaymentStatus = "pending" | "paid" | "overdue" | "cancelled";
export type UserRole = "admin" | "financial" | "teacher";
