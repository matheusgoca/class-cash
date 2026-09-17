import { supabase } from '@/integrations/supabase/client';

// Formats a Date as 'YYYY-MM-DD' using its local fields — never toISOString(),
// which converts to UTC first and can shift the date by a day in timezones
// with a positive offset. Mirrors generateTuitions.ts / generateExpenses.ts.
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface StudentService {
  id: string;
  school_id: string;
  student_id: string;
  service_id: string;
  price: number;
  due_day: number;
  start_date: string; // 'YYYY-MM-DD'
  end_date: string | null;
  installments: number | null;
}

/**
 * Generates monthly service charges (lançamentos) for a student service
 * subscription (molde). Idempotent: skips months that already have a
 * charge for this student_service_id.
 *
 * When end_date is null (ongoing subscription), generates up to
 * `monthsAhead` months from today.
 *
 * @returns number of charges inserted
 */
export async function generateServiceCharges(
  studentServiceId: string,
  monthsAhead: number = 12
): Promise<{ inserted: number; error?: string }> {
  const { data: subscription, error: fetchError } = await (supabase as any)
    .from('student_services')
    .select('id, school_id, student_id, service_id, price, due_day, start_date, end_date, installments, school_services(name, type)')
    .eq('id', studentServiceId)
    .single();

  if (fetchError || !subscription) {
    return { inserted: 0, error: fetchError?.message ?? 'Assinatura não encontrada' };
  }

  const { school_id, student_id, service_id, price, due_day, start_date, end_date, installments } =
    subscription as StudentService;
  const serviceName: string = subscription.school_services?.name ?? 'Serviço';
  const serviceType: string = subscription.school_services?.type ?? 'mensal';

  const { data: existing } = await (supabase as any)
    .from('service_charges')
    .select('due_date')
    .eq('student_service_id', studentServiceId);

  const existingDates = new Set<string>((existing ?? []).map((c: any) => c.due_date));

  const [sy, sm, sd] = start_date.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let end: Date | null = null;
  let endYear: number;
  let endMonth: number;

  if (serviceType === 'anual_parcelado' && installments) {
    // Nº fixo de parcelas a partir do mês de início — ignora end_date e
    // monthsAhead, que são pra assinaturas recorrentes indefinidas.
    const last = new Date(start.getFullYear(), start.getMonth() + installments - 1, 1);
    endYear = last.getFullYear();
    endMonth = last.getMonth();
  } else if (end_date) {
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
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const day = Math.min(due_day, lastDay);
    const dueDate = new Date(cursor.getFullYear(), cursor.getMonth(), day);

    if (dueDate >= start && (!end || dueDate <= end)) {
      const dueDateStr = toDateStr(dueDate);

      if (!existingDates.has(dueDateStr)) {
        const status = dueDate < today ? 'overdue' : 'pending';

        toInsert.push({
          student_service_id: studentServiceId,
          service_id,
          student_id,
          school_id,
          amount: price,
          due_date: dueDateStr,
          status,
          description: `${serviceName} - ${cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`,
        });
      }
    }

    cursor.setMonth(cursor.getMonth() + 1);
  }

  if (toInsert.length === 0) {
    return { inserted: 0 };
  }

  const { error: insertError } = await (supabase as any)
    .from('service_charges')
    .insert(toInsert);

  if (insertError) {
    return { inserted: 0, error: insertError.message };
  }

  return { inserted: toInsert.length };
}
