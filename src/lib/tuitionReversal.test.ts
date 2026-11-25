import { describe, it, expect } from 'vitest';
import { canReverseTuition, reversalImpact, SCHOLARSHIP_METHOD } from './tuitionReversal';
import { getFriendlyErrorMessage } from './friendlyError';

describe('canReverseTuition', () => {
  it('só mensalidade paga e que não é de bolsa pode ser estornada', () => {
    expect(canReverseTuition({ status: 'paid', payment_method: 'PIX' })).toBe(true);
    expect(canReverseTuition({ status: 'paid', payment_method: null })).toBe(true);
    expect(canReverseTuition({ status: 'pending', payment_method: null })).toBe(false);
    expect(canReverseTuition({ status: 'overdue', payment_method: null })).toBe(false);
    expect(canReverseTuition({ status: 'cancelled', payment_method: null })).toBe(false);
  });
  it('bolsa 100% não se estorna', () => {
    expect(SCHOLARSHIP_METHOD).toBe('bolsa');
    expect(canReverseTuition({ status: 'paid', payment_method: 'bolsa' })).toBe(false);
    expect(canReverseTuition({ status: 'paid', payment_method: 'Bolsa' })).toBe(false);
  });
});

describe('reversalImpact', () => {
  it('diz de qual mês do Realizado sai o valor e quanto (o valor pago, com multa e desconto)', () => {
    const i = reversalImpact({ paid_date: '2026-11-20', final_amount: 985, amount: 1000 });
    expect(i.monthLabel).toBe('novembro de 2026');
    expect(i.amount).toBe(985);
    expect(i.message).toMatch(/Realizado de novembro de 2026/);
    expect(i.message).toMatch(/R\$\s*985,00/);
  });
  it('sem final_amount usa o valor da mensalidade (mesma regra de getTuitionValue)', () => {
    expect(reversalImpact({ paid_date: '2027-01-05', final_amount: null, amount: 850 }).amount).toBe(850);
  });
  it('a data é lida como dia local (31/12 não vira janeiro)', () => {
    expect(reversalImpact({ paid_date: '2026-12-31', final_amount: 100, amount: 100 }).monthLabel).toBe('dezembro de 2026');
  });
});

describe('mensagens amigáveis do estorno e da baixa dupla', () => {
  it.each([
    ['ALREADY_PAID', /já está paga/i],
    ['USE_REVERSAL', /estorno/i],
    ['NOT_PAID', /não está paga/i],
    ['SCHOLARSHIP_LOCKED', /bolsa/i],
    ['NOT_FOUND', /não encontrada/i],
  ])('%s', (code, re) => {
    expect(getFriendlyErrorMessage({ message: code })).toMatch(re);
  });
});
