import { supabase } from '@/integrations/supabase/client';

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

  // 3. Build list of months between start_date and end_date
  // Parse as local time to avoid UTC offset shifting the month (e.g. UTC-3: '2026-04-01' → Mar 31)
  const [sy, sm, sd] = start_date.split('-').map(Number);
  const [ey, em, ed] = end_date.split('-').map(Number);
  const start   = new Date(sy, sm - 1, sd);
  const end     = new Date(ey, em - 1, ed);
  const today   = new Date();
  today.setHours(0, 0, 0, 0);

  const endYear  = end.getFullYear();
  const endMonth = end.getMonth();

  const toInsert: object[] = [];

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (
    cursor.getFullYear() < endYear ||
    (cursor.getFullYear() === endYear && cursor.getMonth() <= endMonth)
  ) {
    // Clamp due_day to last day of the month (e.g. due_day=31 in Feb → 28/29)
    const lastDay  = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const day      = Math.min(due_day, lastDay);
    const dueDate  = new Date(cursor.getFullYear(), cursor.getMonth(), day);
    const dueDateStr = dueDate.toISOString().split('T')[0];

    if (!existingDates.has(dueDateStr)) {
      const status = dueDate < today ? 'overdue' : 'pending';

      toInsert.push({
        contract_id: contractId,
        student_id,
        school_id,
        amount:      final_amount,
        final_amount: null,       // filled when payment is confirmed
        due_date:    dueDateStr,
        status,
        description: `Mensalidade ${cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`,
      });
    }

    cursor.setMonth(cursor.getMonth() + 1);
  }

  if (toInsert.length === 0) {
    return { inserted: 0 };
  }

  // 4. Insert
  const { error: insertError } = await (supabase as any)
    .from('tuitions')
    .insert(toInsert);

  if (insertError) {
    return { inserted: 0, error: insertError.message };
  }

  return { inserted: toInsert.length };
}
