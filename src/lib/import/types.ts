// Shared types for the bulk-import feature (Configurações → Importação).
// Import order matters: classes and teachers must exist before students and
// contracts, since students/contracts reference them by name/e-mail.

export type ImportEntityKey = 'classes' | 'teachers' | 'students' | 'contracts';

export const IMPORT_ENTITY_ORDER: ImportEntityKey[] = ['classes', 'teachers', 'students', 'contracts'];

export const IMPORT_ENTITY_LABELS: Record<ImportEntityKey, string> = {
  classes: 'Turmas',
  teachers: 'Professores',
  students: 'Alunos',
  contracts: 'Matrículas',
};

export interface ImportRowError {
  row: number; // 1-based, matching the spreadsheet's visible row number (header = row 1)
  field?: string;
  message: string;
}

export interface ImportValidationResult<T> {
  valid: Array<{ row: number; data: T }>;
  errors: ImportRowError[];
  totalRows: number;
}

export interface ImportRowOutcome {
  row: number;
  success: boolean;
  message: string;
}

export interface ImportExecutionResult {
  outcomes: ImportRowOutcome[];
  successCount: number;
  failureCount: number;
}

// ---- Per-entity shapes the validators produce and the executors consume ----

export interface ValidatedClassRow {
  name: string;
  grade: string | null;
  description: string | null;
  max_capacity: number;
  monthly_fee: number | null;
  color: string;
  teacher_ids: string[];
}

export interface ValidatedTeacherRow {
  full_name: string;
  email: string;
  phone: string | null;
  salary: number | null;
  status: 'active' | 'inactive';
}

export interface ValidatedStudentRow {
  full_name: string;
  birth_date: string; // ISO yyyy-mm-dd
  enrollment_date: string; // ISO yyyy-mm-dd
  email: string | null;
  phone: string | null;
  guardian_contact: string | null;
  status: 'active' | 'inactive';
  class_id: string | null;
}

export interface ValidatedContractRow {
  student_id: string;
  class_id: string | null;
  monthly_amount: number;
  discount: number;
  due_day: number;
  start_date: string; // ISO yyyy-mm-dd
  end_date: string; // ISO yyyy-mm-dd
  status: 'active' | 'suspended' | 'cancelled';
  generate_tuitions: boolean;
}

// ---- Lookup context the validators need, fetched once per import session ----

export interface ImportContext {
  schoolId: string;
  existingClasses: Array<{ id: string; name: string }>;
  existingTeachers: Array<{ id: string; email: string }>;
  existingStudents: Array<{ id: string; full_name: string; email: string | null }>;
}
