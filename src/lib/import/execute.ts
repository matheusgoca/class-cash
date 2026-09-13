import { supabase } from '@/integrations/supabase/client';
import { generateTuitions } from '@/lib/generateTuitions';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';
import {
  ImportExecutionResult,
  ValidatedClassRow,
  ValidatedContractRow,
  ValidatedStudentRow,
  ValidatedTeacherRow,
} from './types';

// Every executor inserts rows ONE AT A TIME rather than in a single bulk
// insert. A bulk insert is one Postgres statement — if any single row hits a
// constraint (e.g. a duplicate teacher e-mail), the whole statement rolls
// back and even the good rows are lost. Row-by-row means one bad row just
// gets reported as a failure while the rest of the import still goes through
// — the behavior an admin dropping in a real spreadsheet actually wants.

export async function executeClassesImport(
  rows: Array<{ row: number; data: ValidatedClassRow }>,
  schoolId: string
): Promise<ImportExecutionResult> {
  const outcomes: ImportExecutionResult['outcomes'] = [];

  for (const { row, data } of rows) {
    // Reuses the same atomic RPC the manual "Nova Turma" flow uses (see QA
    // #9): class + teacher links are created in one transaction, so an
    // imported class can never end up half-saved with no teacher.
    const { error } = await (supabase as any).rpc('save_class_with_teachers', {
      p_class_id: null,
      p_school_id: schoolId,
      p_name: data.name,
      p_grade: data.grade,
      p_description: data.description,
      p_max_capacity: data.max_capacity,
      p_monthly_fee: data.monthly_fee,
      p_color: data.color,
      p_teacher_ids: data.teacher_ids,
    });

    outcomes.push(
      error
        ? { row, success: false, message: getFriendlyErrorMessage(error) }
        : { row, success: true, message: `Turma "${data.name}" criada.` }
    );
  }

  return summarize(outcomes);
}

export async function executeTeachersImport(
  rows: Array<{ row: number; data: ValidatedTeacherRow }>,
  schoolId: string
): Promise<ImportExecutionResult> {
  const outcomes: ImportExecutionResult['outcomes'] = [];

  for (const { row, data } of rows) {
    const { error } = await supabase.from('teachers').insert([{ ...data, school_id: schoolId }]);
    outcomes.push(
      error
        ? { row, success: false, message: getFriendlyErrorMessage(error) }
        : { row, success: true, message: `Professor "${data.full_name}" criado.` }
    );
  }

  return summarize(outcomes);
}

export async function executeStudentsImport(
  rows: Array<{ row: number; data: ValidatedStudentRow }>,
  schoolId: string
): Promise<ImportExecutionResult> {
  const outcomes: ImportExecutionResult['outcomes'] = [];

  for (const { row, data } of rows) {
    const { class_id, ...studentFields } = data;
    const { data: created, error } = await supabase
      .from('students')
      .insert([{ ...studentFields, school_id: schoolId }])
      .select('id')
      .single();

    if (error) {
      outcomes.push({ row, success: false, message: getFriendlyErrorMessage(error) });
      continue;
    }

    if (class_id && created) {
      const { error: enrollmentError } = await (supabase as any)
        .from('enrollments')
        .insert({ student_id: created.id, class_id });
      if (enrollmentError) {
        outcomes.push({
          row,
          success: false,
          message: `Aluno "${data.full_name}" criado, mas houve erro ao vincular a turma: ${getFriendlyErrorMessage(enrollmentError)}`,
        });
        continue;
      }
    }

    outcomes.push({ row, success: true, message: `Aluno "${data.full_name}" criado.` });
  }

  return summarize(outcomes);
}

export async function executeContractsImport(
  rows: Array<{ row: number; data: ValidatedContractRow }>,
  schoolId: string
): Promise<ImportExecutionResult> {
  const outcomes: ImportExecutionResult['outcomes'] = [];

  for (const { row, data } of rows) {
    const { generate_tuitions, ...contractFields } = data;
    const { data: created, error } = await supabase
      .from('contracts')
      .insert([{ ...contractFields, school_id: schoolId }])
      .select('id')
      .single();

    if (error) {
      outcomes.push({ row, success: false, message: getFriendlyErrorMessage(error) });
      continue;
    }

    if (generate_tuitions && data.status === 'active' && created) {
      const { inserted, error: genError } = await generateTuitions(created.id);
      if (genError) {
        outcomes.push({
          row,
          success: false,
          message: `Matrícula criada, mas houve erro ao gerar mensalidades: ${genError}`,
        });
        continue;
      }
      outcomes.push({ row, success: true, message: `Matrícula criada e ${inserted} mensalidade(s) gerada(s).` });
      continue;
    }

    outcomes.push({ row, success: true, message: 'Matrícula criada.' });
  }

  return summarize(outcomes);
}

function summarize(outcomes: ImportExecutionResult['outcomes']): ImportExecutionResult {
  return {
    outcomes,
    successCount: outcomes.filter((o) => o.success).length,
    failureCount: outcomes.filter((o) => !o.success).length,
  };
}
