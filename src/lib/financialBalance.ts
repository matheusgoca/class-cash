import { getTuitionValue } from "./calculations";
import { parseLocalDate } from "./dateUtils";

interface TuitionLike {
  amount: number | string;
  final_amount?: number | string | null;
  status: string;
  due_date: string;
  paid_date: string | null;
}

interface AmountLike {
  amount: number | string;
  status: string;
  due_date: string;
  paid_date: string | null;
}

interface MonthlyBalanceInput {
  tuitions: TuitionLike[];
  serviceCharges: AmountLike[];
  expenses: AmountLike[];
  monthlySalaries: number;
  year: number;
  month: number; // 0-indexed, como Date#getMonth()
}

interface MonthlyBalanceResult {
  realized: number;
  realizedRevenue: number;
  realizedExpenses: number;
  forecast: number;
  forecastRevenue: number;
  forecastExpenses: number;
}

function isInMonth(dateStr: string, year: number, month: number): boolean {
  const d = parseLocalDate(dateStr);
  return d.getFullYear() === year && d.getMonth() === month;
}

/**
 * Saldo Realizado (caixa, por `paid_date`) e Previsto (competência, por
 * `due_date`) do mesmo mês — decisão tomada em docs/PLANO_SPRINTS_NOV2026.md
 * (seção 1, item C, 12/11/2026). Salário entra integral nos dois regimes:
 * não há histórico de pagamento de salário no sistema ainda (item F do plano).
 */
export function calculateMonthlyBalance({
  tuitions,
  serviceCharges,
  expenses,
  monthlySalaries,
  year,
  month,
}: MonthlyBalanceInput): MonthlyBalanceResult {
  let realizedRevenue = 0;
  let forecastRevenue = 0;
  for (const t of tuitions) {
    if (t.status === "cancelled") continue;
    if (isInMonth(t.due_date, year, month)) forecastRevenue += getTuitionValue(t);
    if (t.status === "paid" && t.paid_date && isInMonth(t.paid_date, year, month)) {
      realizedRevenue += getTuitionValue(t);
    }
  }
  for (const s of serviceCharges) {
    if (s.status === "cancelled") continue;
    if (isInMonth(s.due_date, year, month)) forecastRevenue += Number(s.amount);
    if (s.status === "paid" && s.paid_date && isInMonth(s.paid_date, year, month)) {
      realizedRevenue += Number(s.amount);
    }
  }

  let realizedExpenses = 0;
  let forecastExpenses = 0;
  for (const e of expenses) {
    if (e.status === "cancelled") continue;
    if (isInMonth(e.due_date, year, month)) forecastExpenses += Number(e.amount);
    if (e.status === "paid" && e.paid_date && isInMonth(e.paid_date, year, month)) {
      realizedExpenses += Number(e.amount);
    }
  }

  return {
    realizedRevenue,
    realizedExpenses,
    realized: realizedRevenue - monthlySalaries - realizedExpenses,
    forecastRevenue,
    forecastExpenses,
    forecast: forecastRevenue - monthlySalaries - forecastExpenses,
  };
}
