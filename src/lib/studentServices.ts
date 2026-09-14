import { supabase } from '@/integrations/supabase/client';
import { generateServiceCharges } from '@/lib/generateServiceCharges';

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface SubscribeStudentToServiceParams {
  schoolId: string;
  studentId: string;
  serviceId: string;
  price: number;
  dueDay: number;
  startDate: string; // 'YYYY-MM-DD'
}

export async function subscribeStudentToService(
  params: SubscribeStudentToServiceParams
): Promise<{ inserted: number }> {
  const { schoolId, studentId, serviceId, price, dueDay, startDate } = params;

  const { data: created, error } = await (supabase as any)
    .from('student_services')
    .insert({
      school_id: schoolId,
      student_id: studentId,
      service_id: serviceId,
      price,
      due_day: dueDay,
      start_date: startDate,
    })
    .select('id')
    .single();

  if (error) throw error;

  const { inserted, error: genError } = await generateServiceCharges(created.id);
  if (genError) throw new Error(genError);

  return { inserted };
}

export async function cancelStudentService(studentServiceId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('student_services')
    .update({ active: false, end_date: todayStr() })
    .eq('id', studentServiceId);

  if (error) throw error;
}
