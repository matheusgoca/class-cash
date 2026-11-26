// Estorno de baixa (S6b, bloco D). Regras espelham o RPC reverse_tuition_payment
// (supabase/migrations/20261126100000_tuition_reversal.sql): só mensalidade paga e que não é de bolsa.
import { getTuitionValue, formatCurrency } from '@/lib/calculations';
import { parseLocalDate } from '@/lib/dateUtils';
import { SCHOLARSHIP_METHOD, isScholarshipTuition } from '@/lib/scholarship';

export { SCHOLARSHIP_METHOD };

export function canReverseTuition(t: { status: string; payment_method: string | null }): boolean {
  if (t.status !== 'paid') return false;
  return !isScholarshipTuition(t);
}

/** O que muda no Realizado (caixa, por paid_date) quando a baixa é desfeita. */
export function reversalImpact(t: { paid_date: string | null; final_amount: number | null; amount: number }) {
  const d = parseLocalDate(t.paid_date as string);
  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(d).replace(' de ', ' de ');
  const amount = getTuitionValue({ amount: t.amount, final_amount: t.final_amount });
  return {
    monthLabel,
    amount,
    message: `O Realizado de ${monthLabel} vai diminuir ${formatCurrency(amount)}. A mensalidade volta a ficar pendente.`,
  };
}
