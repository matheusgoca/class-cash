// src/lib/studentPayload.ts
// Item I: o aluno não digita valor. Os campos legados do cadastro (full_tuition_value, discount,
// final_tuition_value) continuam no banco, mas NUNCA são enviados daqui: criar usa o default do banco
// e editar não apaga o que já existe.
import { toDateStr } from '@/lib/dateUtils';

const LEGACY_VALUE_FIELDS = ['full_tuition_value', 'discount', 'final_tuition_value'] as const;

interface StudentFormValues {
  class_id?: string | null;
  birth_date?: Date | string;
  enrollment_date?: Date | string;
  [key: string]: unknown;
}

export function buildStudentPayload(formData: StudentFormValues, schoolId: string) {
  const { class_id, birth_date, enrollment_date, ...rest } = formData;
  const clean: Record<string, unknown> = { ...rest };
  for (const f of LEGACY_VALUE_FIELDS) delete clean[f];
  return {
    classId: class_id ?? null,
    payload: {
      ...clean,
      birth_date: birth_date instanceof Date ? toDateStr(birth_date) : birth_date,
      enrollment_date: enrollment_date instanceof Date ? toDateStr(enrollment_date) : enrollment_date,
      school_id: schoolId,
    } as Record<string, unknown>,
  };
}
