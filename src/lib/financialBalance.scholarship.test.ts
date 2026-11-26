import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calculateMonthlyDelinquency } from './financialBalance';

const T = (o: Record<string, unknown> = {}) => ({
  amount: 1000, final_amount: null as number | null, status: 'pending', due_date: '2026-11-10', paid_date: null as string | null, payment_method: null as string | null, ...o,
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0)); });
afterEach(() => vi.useRealTimers());

describe('calculateMonthlyDelinquency (bloco H: bolsa fora do numerador e do denominador)', () => {
  it('mesma conta de antes quando não há bolsa: vencida / (paga + vencida)', () => {
    const r = calculateMonthlyDelinquency({
      tuitions: [T({ status: 'paid', due_date: '2026-11-05', paid_date: '2026-11-05' }), T({ status: 'overdue', amount: 500 }), T({ status: 'pending', due_date: '2026-11-30' })],
      year: 2026, month: 10,
    });
    expect(r).toEqual({ overdue: 500, dued: 1500, rate: 33.3 });
  });

  it('a bolsa não entra no numerador nem no denominador, mesmo que o valor da linha viesse maior que zero', () => {
    const base = [T({ status: 'paid', due_date: '2026-11-05', paid_date: '2026-11-05' }), T({ status: 'overdue', amount: 500 })];
    const sem = calculateMonthlyDelinquency({ tuitions: base, year: 2026, month: 10 });
    const com = calculateMonthlyDelinquency({
      tuitions: [...base, T({ status: 'paid', payment_method: 'bolsa', amount: 800, final_amount: null, paid_date: '2026-11-10' }), T({ status: 'overdue', payment_method: 'bolsa', amount: 900 })],
      year: 2026, month: 10,
    });
    expect(com).toEqual(sem);
  });

  it('canceladas não contam; mês sem vencidas devolve taxa 0', () => {
    expect(calculateMonthlyDelinquency({ tuitions: [T({ status: 'cancelled' })], year: 2026, month: 10 })).toEqual({ overdue: 0, dued: 0, rate: 0 });
    expect(calculateMonthlyDelinquency({ tuitions: [T({ status: 'overdue' })], year: 2026, month: 9 })).toEqual({ overdue: 0, dued: 0, rate: 0 });
  });

  it('pendente já vencida (o job ainda não promoveu) conta como vencida, como no app', () => {
    const r = calculateMonthlyDelinquency({ tuitions: [T({ status: 'pending', due_date: '2026-11-10' })], year: 2026, month: 10 });
    expect(r).toEqual({ overdue: 1000, dued: 1000, rate: 100 });
  });
});
