import { getTuitionValue, isTuitionOverdue } from "@/lib/calculations";
import { isScholarshipTuition } from "@/lib/scholarship";

export interface TuitionSummary {
  total: number;
  pending: number;
  paid: number;
  overdue: number;
  cancelled: number;
  /** Mensalidades de bolsa 100% (bloco H): contadas à parte, fora de "pagas" e sem somar valor. */
  scholarship: number;
  totalAmount: number;
  pendingAmount: number;
  paidAmount: number;
  overdueAmount: number;
}

interface SummarizableTuition {
  amount: number | string;
  final_amount?: number | string | null;
  status: string;
  due_date: string;
  payment_method?: string | null;
}

/** Resumo da tela de Mensalidades (cartões por status e valor). Pendente já vencida conta como vencida. */
export function summarizeTuitions(tuitions: SummarizableTuition[]): TuitionSummary {
  return tuitions.reduce<TuitionSummary>(
    (acc, tuition) => {
      const status = isTuitionOverdue(tuition.due_date, tuition.status) ? "overdue" : tuition.status;
      acc.total += 1;
      // Canceladas (ex.: substituídas por renegociação) não são receita.
      if (status !== "cancelled") acc.totalAmount += getTuitionValue(tuition);
      switch (status) {
        case "pending":
          acc.pending += 1;
          acc.pendingAmount += getTuitionValue(tuition);
          break;
        case "paid":
          if (isScholarshipTuition(tuition)) {
            acc.scholarship += 1;
          } else {
            acc.paid += 1;
            acc.paidAmount += getTuitionValue(tuition);
          }
          break;
        case "overdue":
          acc.overdue += 1;
          acc.overdueAmount += getTuitionValue(tuition);
          break;
        case "cancelled":
          acc.cancelled += 1;
          break;
      }
      return acc;
    },
    { total: 0, pending: 0, paid: 0, overdue: 0, cancelled: 0, scholarship: 0, totalAmount: 0, pendingAmount: 0, paidAmount: 0, overdueAmount: 0 },
  );
}
