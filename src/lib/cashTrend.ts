// Gráfico de 6 meses do Dashboard (S6b, bloco F2): receita x custo por mês do PAGAMENTO (caixa).
// Usa calculateMonthlyBalance, a mesma função do cartão "Saldo Realizado", então o resultado de cada mês coincide com o cartão
// por construção. Receita = mensalidades pagas + serviços pagos (antes o gráfico só somava mensalidades e ficava abaixo do
// cartão "Receita Recebida"); custo = salários (total atual repetido nos meses, como no cartão) + despesas pagas.
import { calculateMonthlyBalance } from './financialBalance';

type Row = { amount: number | string; status: string; due_date: string; paid_date: string | null };
type TuitionRow = Row & { final_amount?: number | string | null };

export interface CashTrendPoint {
  name: string;
  receita: number;
  custo: number;
  resultado: number;
}

export function buildCashTrend(
  months: { key: string; name: string }[],
  data: { tuitions: TuitionRow[]; serviceCharges: Row[]; expenses: Row[]; monthlySalaries: number },
): CashTrendPoint[] {
  return months.map((m) => {
    const [year, month1] = m.key.split('-').map(Number);
    const b = calculateMonthlyBalance({ ...data, year, month: month1 - 1 });
    return { name: m.name, receita: b.realizedRevenue, custo: data.monthlySalaries + b.realizedExpenses, resultado: b.realized };
  });
}
