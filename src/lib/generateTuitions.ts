import { supabase } from '@/integrations/supabase/client';
import { buildTuitionRows } from '@/lib/tuitionRows';

interface Contract {
  id: string;
  student_id: string;
  school_id: string;
  start_date: string;   // 'YYYY-MM-DD'
  end_date: string;     // 'YYYY-MM-DD'
  final_amount: number; // generated column (monthly_amount * (1 - discount/100))
  due_day: number;      // day of month the tuition is due
}

/**
 * Generates monthly tuitions for a contract.
 * Idempotent: skips months that already have a tuition for this contract.
 *
 * @returns number of tuitions inserted
 */
export async function generateTuitions(contractId: string): Promise<{ inserted: number; error?: string }> {
  // 1. Fetch contract
  const { data: contract, error: fetchError } = await (supabase as any)
    .from('contracts')
    .select('id, student_id, school_id, start_date, end_date, final_amount, due_day')
    .eq('id', contractId)
    .single();

  if (fetchError || !contract) {
    return { inserted: 0, error: fetchError?.message ?? 'Contrato não encontrado' };
  }

  const { student_id, school_id, start_date, end_date, final_amount, due_day } = contract as Contract;

  // 2. Fetch existing tuitions for this contract (to skip duplicates)
  const { data: existing } = await (supabase as any)
    .from('tuitions')
    .select('due_date')
    .eq('contract_id', contractId);

  const existingDates = new Set<string>((existing ?? []).map((t: any) => t.due_date));

  // 3. Linhas de mensalidade (regra única em tuitionRows.ts)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const toInsert: object[] = buildTuitionRows(
    { startDate: start_date, endDate: end_date, dueDay: due_day, finalAmount: final_amount },
    today,
    existingDates,
  ).map((r) => ({
    contract_id: contractId,
    student_id,
    school_id,
    amount: r.amount,
    final_amount: null,       // preenchido quando o pagamento é confirmado
    due_date: r.due_date,
    status: r.status,
    description: r.description,
  }));

  if (toInsert.length === 0) {
    return { inserted: 0 };
  }

  // 4. Insert via RPC — marca audit_logs.source='generated' em vez de
  // 'manual' (ver supabase/migrations/20261112193000_generated_source_rpcs.sql)
  const { error: insertError } = await supabase.rpc('insert_generated_tuitions', {
    p_school_id: school_id,
    p_rows: toInsert,
  });

  if (insertError) {
    return { inserted: 0, error: insertError.message };
  }

  return { inserted: toInsert.length };
}
