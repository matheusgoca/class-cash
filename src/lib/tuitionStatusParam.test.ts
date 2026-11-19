import { describe, it, expect } from 'vitest';
import { parseStatusParam } from './tuitionStatusParam';

describe('parseStatusParam', () => {
  it('aceita os três status conhecidos', () => {
    expect(parseStatusParam('pending')).toBe('pending');
    expect(parseStatusParam('overdue')).toBe('overdue');
    expect(parseStatusParam('paid')).toBe('paid');
  });
  it('cai em "all" para ausente ou desconhecido', () => {
    expect(parseStatusParam(null)).toBe('all');
    expect(parseStatusParam('')).toBe('all');
    expect(parseStatusParam('cancelled')).toBe('all');
  });
});
