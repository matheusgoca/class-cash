import { supabase } from '@/integrations/supabase/client';
import { generateServiceCharges } from '@/lib/generateServiceCharges';
import { toDateStr } from '@/lib/dateUtils';

export interface SubscribeStudentToServiceParams {
  schoolId: string;
  studentId: string;
  serviceId: string;
  price: number;
  dueDay: number;
  startDate: string; // 'YYYY-MM-DD'
  installments?: number | null; // obrigatório na prática só para serviços 'anual_parcelado'
}

export async function subscribeStudentToService(
  params: SubscribeStudentToServiceParams
): Promise<{ inserted: number }> {
  const { schoolId, studentId, serviceId, price, dueDay, startDate, installments } = params;

  // Sem essa checagem, reabrir "Cobrar serviço" pro mesmo aluno/serviço criava
  // uma segunda assinatura ativa, e cada uma gerava suas próprias cobranças
  // mensais de forma independente — aluno cobrado em dobro todo mês.
  const { data: existing } = await (supabase as any)
    .from('student_services')
    .select('id')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('service_id', serviceId)
    .eq('active', true)
    .maybeSingle();

  if (existing) {
    throw new Error('Este aluno já tem uma assinatura ativa deste serviço.');
  }

  const { data: created, error } = await (supabase as any)
    .from('student_services')
    .insert({
      school_id: schoolId,
      student_id: studentId,
      service_id: serviceId,
      price,
      due_day: dueDay,
      start_date: startDate,
      installments: installments ?? null,
    })
    .select('id')
    .single();

  if (error) throw error;

  const { inserted, error: genError } = await generateServiceCharges(created.id);
  if (genError) throw new Error(genError);

  return { inserted };
}

export async function cancelStudentService(schoolId: string, studentServiceId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('student_services')
    .update({ active: false, end_date: toDateStr(new Date()) })
    .eq('id', studentServiceId)
    .eq('school_id', schoolId);

  if (error) throw error;

  // Sem isso, até 11 meses de cobrança futura já gerada continuavam
  // "pending" ativas depois do cancelamento da assinatura.
  const { error: chargesError } = await (supabase as any)
    .from('service_charges')
    .update({ status: 'cancelled' })
    .eq('student_service_id', studentServiceId)
    .eq('school_id', schoolId)
    .eq('status', 'pending')
    .gt('due_date', toDateStr(new Date()));

  if (chargesError) throw chargesError;
}
