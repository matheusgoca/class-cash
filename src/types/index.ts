export interface Student {
  id: string;
  name: string;
  birthDate: string;
  classId: string;
  guardianContact: string;
  status: "active" | "inactive";
  createdAt: string;
}

export interface Teacher {
  id: string;
  name: string;
  email: string;
  classIds: string[];
  subject: string;
  status: "active" | "inactive";
  createdAt: string;
}

export interface Class {
  id: string;
  name: string;
  teacherId: string;
  studentIds: string[];
  maxCapacity: number;
  color: string;
  createdAt: string;
}

export interface Tuition {
  id: string;
  studentId: string;
  amount: number;
  dueDate: string;
  description: string;
  category: string;
  status: "pending" | "paid" | "overdue";
  paidDate?: string;
  paymentMethod?: string;
  createdAt: string;
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

export type PaymentStatus = "pending" | "paid" | "overdue";
export type UserRole = "admin" | "financial" | "teacher";