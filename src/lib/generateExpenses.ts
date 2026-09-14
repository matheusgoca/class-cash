import { supabase } from '@/integrations/supabase/client';

// Formats a Date as 'YYYY-MM-DD' using its local fields — never toISOString(),
// which converts to UTC first and can shift the date by a day in timezones
// with a positive offset, breaking both the stored due_date and the
// existingDates idempotency check below. Mirrors generateTuitions.ts.
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface RecurringExpense {
  id: string;
  school_id: string;
  category_id: string;
  class_id: string | null;
  description: string;
  amount: number;
  due_day: number;
  start_date: string; // 'YYYY-MM-DD'
  end_date: string | null;
}

/**
 * Generates monthly expense entries (lançamentos) for a recurring expense (molde).
 * Idempotent: skips months that already have an expense for this recurring_expense_id.
 * Mirrors src/lib/generateTuitions.ts.
 *
 * When end_date is null (ongoing expense), generates up to `monthsAhead` months
 * from today so it doesn't try to generate an unbounded number of rows.
 *
 * @returns number of expenses inserted
 */
export async function generateExpenses(
  recurringExpenseId: string,
  monthsAhead: number = 12
): Promise<{ inserted: number; error?: string }> {
  // 1. Fetch recurring expense
  const { data: recurring, error: fetchError } = await (supabase as any)
    .from('recurring_expenses')
    .select('id, school_id, category_id, class_id, description, amount, due_day, start_date, end_date')
    .eq('id', recurringExpenseId)
    .single();

  if (fetchError || !recurring) {
    return { inserted: 0, error: fetchError?.message ?? 'Despesa recorrente não encontrada' };
  }

  const { school_id, category_id, class_id, description, amount, due_day, start_date, end_date } =
    recurring as RecurringExpense;

  // 2. Fetch existing expenses for this recurring expense (to skip duplicates)
  const { data: existing } = await (supabase as any)
    .from('expenses')
    .select('due_date')
    .eq('recurring_expense_id', recurringExpenseId);

  const existingDates = new Set<string>((existing ?? []).map((e: any) => e.due_date));

  // 3. Build list of months between start_date and end_date (or today + monthsAhead when open-ended)
  // Parse as local time to avoid UTC offset shifting the month.
  const [sy, sm, sd] = start_date.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // end is the real business boundary (only set when end_date exists) — used to
  // clamp generated due dates. horizon is just a technical loop limit for
  // open-ended expenses and never clamps a due date.
  let end: Date | null = null;
  let endYear: number;
  let endMonth: number;

  if (end_date) {
    const [ey, em, ed] = end_date.split('-').map(Number);
    end = new Date(ey, em - 1, ed);
    endYear = end.getFullYear();
    endMonth = end.getMonth();
  } else {
    const horizon = new Date(today.getFullYear(), today.getMonth() + monthsAhead, 1);
    endYear = horizon.getFullYear();
    endMonth = horizon.getMonth();
  }

  const toInsert: object[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (
    cursor.getFullYear() < endYear ||
    (cursor.getFullYear() === endYear && cursor.getMonth() <= endMonth)
  ) {
    // Clamp due_day to last day of the month (e.g. due_day=28 stays valid everywhere,
    // but guards against any future change that allows 29-31)
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const day = Math.min(due_day, lastDay);
    const dueDate = new Date(cursor.getFullYear(), cursor.getMonth(), day);

    // Skip months where the computed due date falls outside the recurring
    // expense's actual start/end — e.g. one starting on the 20th with
    // due_day=5 would otherwise get a first lançamento due before it started.
    if (dueDate >= start && (!end || dueDate <= end)) {
      const dueDateStr = toDateStr(dueDate);

      if (!existingDates.has(dueDateStr)) {
        const status = dueDate < today ? 'overdue' : 'pending';

        toInsert.push({
          recurring_expense_id: recurringExpenseId,
          school_id,
          category_id,
          class_id,
          amount,
          due_date: dueDateStr,
          status,
          description: `${description} - ${cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`,
        });
      }
    }

    cursor.setMonth(cursor.getMonth() + 1);
  }

  if (toInsert.length === 0) {
    return { inserted: 0 };
  }

  // 4. Insert
  const { error: insertError } = await (supabase as any)
    .from('expenses')
    .insert(toInsert);

  if (insertError) {
    return { inserted: 0, error: insertError.message };
  }

  return { inserted: toInsert.length };
}
