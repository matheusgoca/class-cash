import { describe, it, expect } from 'vitest';
import { isScholarshipTuition, SCHOLARSHIP_LABEL, SCHOLARSHIP_METHOD } from './scholarship';

describe('bolsa 100%', () => {
  it('a mensalidade de bolsa é identificada pela forma de pagamento "bolsa" (sem diferenciar maiúsculas)', () => {
    expect(SCHOLARSHIP_METHOD).toBe('bolsa');
    expect(SCHOLARSHIP_LABEL).toBe('Bolsa 100%');
    expect(isScholarshipTuition({ payment_method: 'bolsa' })).toBe(true);
    expect(isScholarshipTuition({ payment_method: ' Bolsa ' })).toBe(true);
    expect(isScholarshipTuition({ payment_method: 'PIX' })).toBe(false);
    expect(isScholarshipTuition({ payment_method: null })).toBe(false);
    expect(isScholarshipTuition({})).toBe(false);
  });
});
