import { describe, it, expect } from 'vitest';
import { buildCashTrend } from './cashTrend';
import { calculateMonthlyBalance } from './financialBalance';

const months = [{ key: '2026-09', name: 'set/26' }, { key: '2026-10', name: 'out/26' }];
const T = (o: Record<string, unknown> = {}) => ({ amount: 1000, final_amount: null as number | null, status: 'paid', due_date: '2026-09-10', paid_date: '2026-09-12', ...o });
const S = (o: Record<string, unknown> = {}) => ({ amount: 300, status: 'paid', due_date: '2026-09-15', paid_date: '2026-09-15', ...o });
const E = (o: Record<string, unknown> = {}) => ({ amount: 500, status: 'paid', due_date: '2026-09-05', paid_date: '2026-09-05', ...o });

describe('buildCashTrend (gráfico de 6 meses = Saldo Realizado, bloco F2)', () => {
  it('receita = mensalidades pagas + serviços pagos, por mês do pagamento; custo = salários + despesas pagas', () => {
    const t = buildCashTrend(months, { tuitions: [T(), T({ final_amount: 985, paid_date: '2026-10-03' })], serviceCharges: [S(), S({ amount: 100, paid_date: '2026-10-20' })], expenses: [E()], monthlySalaries: 2000 });
    expect(t).toEqual([
      { name: 'set/26', receita: 1300, custo: 2500, resultado: -1200 },
      { name: 'out/26', receita: 1085, custo: 2000, resultado: -915 },
    ]);
  });

  it('o resultado de cada mês é exatamente o Saldo Realizado do cartão (mesma função)', () => {
    const data = { tuitions: [T(), T({ paid_date: '2026-10-03', final_amount: 970 })], serviceCharges: [S({ amount: 250.5 })], expenses: [E({ amount: 77.77 })], monthlySalaries: 1234.56 };
    const trend = buildCashTrend(months, data);
    months.forEach((m, i) => {
      const [y, mo] = m.key.split('-').map(Number);
      const card = calculateMonthlyBalance({ ...data, year: y, month: mo - 1 });
      expect(trend[i].resultado).toBeCloseTo(card.realized, 8);
      expect(trend[i].receita).toBeCloseTo(card.realizedRevenue, 8);
    });
  });

  it('bolsa (valor 0) não soma; cancelada e não paga ficam de fora; mês sem movimento só tem o salário', () => {
    const t = buildCashTrend(months, {
      tuitions: [T({ amount: 0, final_amount: 0, paid_date: '2026-09-10' }), T({ status: 'cancelled' }), T({ status: 'pending', paid_date: null })],
      serviceCharges: [S({ status: 'cancelled' })], expenses: [], monthlySalaries: 800,
    });
    expect(t[0]).toEqual({ name: 'set/26', receita: 0, custo: 800, resultado: -800 });
    expect(t[1]).toEqual({ name: 'out/26', receita: 0, custo: 800, resultado: -800 });
  });
});
