import { describe, it, expect } from 'vitest';
import { amountsChanged, propagationSummary, type AmountsResult } from './contractAmounts';
import { getFriendlyErrorMessage } from './friendlyError';

const base: AmountsResult = {
  dry_run: true, old_final: 1000, new_final: 1100, changed: true, upcoming: 0, overdue: 0, to_scholarship: 0,
  reopened_upcoming: 0, reopened_overdue: 0, updated: 0, unchanged: { adjusted: 0, renegotiated: 0, paid: 0, cancelled: 0 },
};

describe('amountsChanged', () => {
  it('detecta mudança de valor ou desconto (aceita números em texto, como vêm do banco)', () => {
    expect(amountsChanged({ monthly_amount: '1000.00', discount: '0.00' }, { monthly_amount: 1000, discount: 0 })).toBe(false);
    expect(amountsChanged({ monthly_amount: 1000, discount: 0 }, { monthly_amount: 1100, discount: 0 })).toBe(true);
    expect(amountsChanged({ monthly_amount: 1000, discount: 0 }, { monthly_amount: 1000, discount: 10 })).toBe(true);
  });
});

describe('propagationSummary (aviso antes de confirmar)', () => {
  it('divide em "a vencer", "vencidas" e "não alteradas (motivo)"', () => {
    const s = propagationSummary({ ...base, upcoming: 3, overdue: 2, updated: 5, unchanged: { adjusted: 1, renegotiated: 2, paid: 4, cancelled: 3 } });
    expect(s.headline).toBe('3 a vencer e 2 vencidas serão atualizadas para o novo valor.');
    expect(s.unchanged).toBe('Não serão alteradas: 1 ajustada manualmente, 2 renegociadas, 4 pagas, 3 canceladas.');
  });

  it('singular e omite os motivos zerados', () => {
    const s = propagationSummary({ ...base, upcoming: 1, updated: 1, unchanged: { adjusted: 0, renegotiated: 0, paid: 1, cancelled: 0 } });
    expect(s.headline).toBe('1 a vencer será atualizada para o novo valor.');
    expect(s.unchanged).toBe('Não serão alteradas: 1 paga.');
  });

  it('nada elegível: diz que nenhuma mensalidade muda', () => {
    const s = propagationSummary(base);
    expect(s.headline).toBe('Nenhuma mensalidade será alterada; só o contrato.');
    expect(s.unchanged).toBeNull();
  });

  it('desconto entrando em 100%: as abertas viram bolsa', () => {
    const s = propagationSummary({ ...base, new_final: 0, upcoming: 3, overdue: 3, to_scholarship: 6, updated: 6 });
    expect(s.headline).toBe('6 mensalidades abertas (3 a vencer e 3 vencidas) viram Bolsa 100% e ficam quitadas.');
  });

  it('desconto saindo de 100%: as de bolsa reabrem com o novo valor', () => {
    const s = propagationSummary({ ...base, old_final: 0, new_final: 1100, reopened_upcoming: 3, reopened_overdue: 2, updated: 5 });
    expect(s.headline).toBe('5 mensalidades de bolsa reabrem com o novo valor (3 a vencer e 2 vencidas).');
  });
});

describe('mensagens amigáveis do RPC', () => {
  it('valor e desconto inválidos', () => {
    expect(getFriendlyErrorMessage({ message: 'INVALID_AMOUNT' })).toMatch(/valor/i);
    expect(getFriendlyErrorMessage({ message: 'INVALID_DISCOUNT' })).toMatch(/desconto/i);
  });
});
