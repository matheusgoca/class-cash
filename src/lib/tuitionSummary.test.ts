import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { summarizeTuitions } from './tuitionSummary';

const T = (o: Record<string, unknown> = {}) => ({
  amount: 1000, final_amount: null as number | null, status: 'pending', due_date: '2099-01-10', payment_method: null as string | null, ...o,
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0)); });
afterEach(() => vi.useRealTimers());

describe('summarizeTuitions (bloco H)', () => {
  it('bolsa não conta como "paga": vai para o contador separado de bolsistas e não soma valor', () => {
    const s = summarizeTuitions([
      T({ status: 'paid', due_date: '2026-11-01', final_amount: 985, payment_method: 'PIX' }),
      T({ status: 'paid', due_date: '2026-11-01', amount: 0, final_amount: 0, payment_method: 'bolsa' }),
      T({ status: 'paid', due_date: '2027-03-01', amount: 0, final_amount: 0, payment_method: 'bolsa' }),
      T({ status: 'pending' }),
      T({ status: 'overdue', due_date: '2026-10-01', amount: 400 }),
      T({ status: 'cancelled' }),
    ]);
    expect(s.paid).toBe(1);
    expect(s.paidAmount).toBe(985);
    expect(s.scholarship).toBe(2);
    expect(s.pending).toBe(1);
    expect(s.overdue).toBe(1);
    expect(s.overdueAmount).toBe(400);
    expect(s.cancelled).toBe(1);
    expect(s.total).toBe(6);
  });

  it('pendente com vencimento passado vira vencida', () => {
    const s = summarizeTuitions([T({ status: 'pending', due_date: '2026-11-10' })]);
    expect(s.overdue).toBe(1);
    expect(s.pending).toBe(0);
  });
});
