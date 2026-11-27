import { describe, it, expect } from 'vitest';
import { formatCurrency } from './calculations';

describe('formatCurrency nunca mostra NaN', () => {
  it.each([NaN, Infinity, -Infinity, undefined, null])('%s vira R$ 0,00', (v) => {
    expect(formatCurrency(v as unknown as number)).toMatch(/^R\$\s0,00$/);
  });
  it('valores normais continuam iguais', () => {
    expect(formatCurrency(1234.5)).toMatch(/^R\$\s1\.234,50$/);
    expect(formatCurrency(0)).toMatch(/^R\$\s0,00$/);
    expect(formatCurrency(-10)).toMatch(/R\$\s10,00/);
  });
});
