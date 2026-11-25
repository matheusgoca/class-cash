// src/lib/renewal.test.ts
import { describe, it, expect } from 'vitest';
import {
  applyAdjustment, buildRenewalPlan, capacityWarnings, chunk, finalAmountOf, MAX_MONTHLY_AMOUNT, nextTerm,
  renewalState, summarizeWindow, type DecisionRow, type RenewalClass, type RenewalContract,
} from './renewal';

const src = (o: Partial<RenewalContract> = {}): RenewalContract => ({
  id: 'k1', student_id: 'st1', student_name: 'Ana', class_id: 'c1', class_name: '5º A',
  start_date: '2030-03-01', end_date: '2031-02-28', monthly_amount: 100, discount: 10, due_day: 5, period: 'integral', ...o,
});
const today = new Date(2031, 0, 15);
const opts = (o: Partial<Parameters<typeof buildRenewalPlan>[1]> = {}) => ({ pct: 10, classMap: {}, overrides: {}, today, ...o });

describe('nextTerm', () => {
  it('começa no dia seguinte e termina no último dia do 12º mês', () => {
    expect(nextTerm('2031-02-28')).toEqual({ start: '2031-03-01', end: '2032-02-29' });
    expect(nextTerm('2031-12-31')).toEqual({ start: '2032-01-01', end: '2032-12-31' });
    expect(nextTerm('2032-02-29')).toEqual({ start: '2032-03-01', end: '2033-02-28' });
  });
});

describe('valores', () => {
  it('applyAdjustment arredonda a centavos', () => {
    expect(applyAdjustment(100, 8)).toBe(108);
    expect(applyAdjustment(99.99, 8)).toBe(107.99);
    expect(applyAdjustment(100, 0)).toBe(100);
    expect(applyAdjustment(100, -10)).toBe(90);
  });
  it('finalAmountOf espelha monthly_amount * (1 - discount/100)', () => {
    expect(finalAmountOf(110, 10)).toBeCloseTo(99, 10);
    expect(finalAmountOf(200, 0)).toBe(200);
    expect(finalAmountOf(100, null)).toBe(100);
  });
});

describe('buildRenewalPlan', () => {
  it('reajusta, mantém a turma e gera o item do RPC com as mensalidades', () => {
    const { rows, items, totals } = buildRenewalPlan([src()], opts());
    expect(rows[0]).toMatchObject({ contractId: 'k1', fromClassId: 'c1', toClassId: 'c1', currentMonthly: 100, newMonthly: 110, monthlyEdited: false, classChanged: false, start: '2031-03-01', end: '2032-02-29', tuitionCount: 12, error: null });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source_contract_id: 'k1', class_id: 'c1', monthly_amount: 110, start_date: '2031-03-01', end_date: '2032-02-29' });
    expect(items[0].tuitions).toHaveLength(12);
    expect(items[0].tuitions[0]).toMatchObject({ due_date: '2031-03-05', amount: 99, status: 'pending' });
    expect(totals).toEqual({ contracts: 1, tuitions: 12, monthlyTotal: 110, monthlyNetTotal: 99 });
  });

  it('o total líquido desconta o desconto de cada contrato (bolsa 100% entra com zero); o bruto segue como detalhe', () => {
    const { totals } = buildRenewalPlan(
      [src({ id: 'k1', monthly_amount: 1000, discount: 0 }), src({ id: 'k2', monthly_amount: 333.33, discount: 10 }), src({ id: 'k3', monthly_amount: 1500, discount: 100 })],
      opts({ pct: 7 }),
    );
    expect(totals.monthlyTotal).toBe(3031.66); // 1070 + 356.66 + 1605
    expect(totals.monthlyNetTotal).toBe(1390.99); // 1070 + 320.99 + 0
  });

  it('mapa de turmas: a turma de origem vai para o destino; null (sem turma) usa a chave ""', () => {
    const a = buildRenewalPlan([src(), src({ id: 'k2', class_id: null, class_name: null })], opts({ classMap: { c1: 'c2', '': 'c9' } }));
    expect(a.rows.map((r) => r.toClassId)).toEqual(['c2', 'c9']);
    expect(a.rows[0].classChanged).toBe(true);
    expect(a.items.map((i) => i.class_id)).toEqual(['c2', 'c9']);
  });

  it('turma sem mapeamento fica igual; override por linha vence o mapa (inclusive para null)', () => {
    const a = buildRenewalPlan([src()], opts());
    expect(a.items[0].class_id).toBe('c1');
    const b = buildRenewalPlan([src()], opts({ classMap: { c1: 'c2' }, overrides: { k1: { classId: null } } }));
    expect(b.items[0].class_id).toBeNull(); // null, nunca string vazia
    expect(b.rows[0].classChanged).toBe(true);
  });

  it('valor editado à mão não muda quando o percentual muda', () => {
    const edited = { k1: { monthly: 123.45 } };
    const a = buildRenewalPlan([src(), src({ id: 'k2' })], opts({ pct: 5, overrides: edited }));
    const b = buildRenewalPlan([src(), src({ id: 'k2' })], opts({ pct: 20, overrides: edited }));
    expect(a.rows[0]).toMatchObject({ newMonthly: 123.45, monthlyEdited: true });
    expect(b.rows[0].newMonthly).toBe(123.45);
    expect(a.rows[1].newMonthly).toBe(105);
    expect(b.rows[1].newMonthly).toBe(120);
  });

  it('valor zero ou negativo marca erro e fica fora dos itens', () => {
    const { rows, items, totals } = buildRenewalPlan([src(), src({ id: 'k2' })], opts({ overrides: { k1: { monthly: 0 } } }));
    expect(rows[0].error).toBe('INVALID_AMOUNT');
    expect(items.map((i) => i.source_contract_id)).toEqual(['k2']);
    expect(totals.contracts).toBe(1);
  });

  it('valor mensal acima do teto (R$ 30.000) marca AMOUNT_TOO_HIGH e fica fora dos itens', () => {
    expect(MAX_MONTHLY_AMOUNT).toBe(30000);
    const { rows, items, totals } = buildRenewalPlan(
      [src(), src({ id: 'k2' }), src({ id: 'k3' })],
      opts({ overrides: { k1: { monthly: 30000.01 }, k2: { monthly: 30000 } } }),
    );
    expect(rows[0].error).toBe('AMOUNT_TOO_HIGH');
    expect(rows[1].error).toBeNull(); // exatamente no teto passa
    expect(items.map((i) => i.source_contract_id)).toEqual(['k2', 'k3']);
    expect(totals.contracts).toBe(2);
  });

  it('o reajuste em % que passa do teto também é barrado na prévia', () => {
    const { rows, items } = buildRenewalPlan([src({ monthly_amount: 29000 })], opts({ pct: 10 })); // 29000 + 10% = 31900
    expect(rows[0].newMonthly).toBe(31900);
    expect(rows[0].error).toBe('AMOUNT_TOO_HIGH');
    expect(items).toHaveLength(0);
  });

  it('mensalidades vencidas se "hoje" é depois do vencimento', () => {
    const { items } = buildRenewalPlan([src()], opts({ today: new Date(2031, 4, 10) }));
    expect(items[0].tuitions.filter((t) => t.status === 'overdue')).toHaveLength(3);
  });

  it('o valor da mensalidade é o final arredondado a centavos (desconto com centavos)', () => {
    const { items } = buildRenewalPlan([src({ monthly_amount: 100.05, discount: 10 })], opts({ pct: 0 }));
    expect(items[0].monthly_amount).toBe(100.05);
    expect(items[0].tuitions[0].amount).toBe(90.05); // 100.05 * 0.9 = 90.045 -> 90.05
  });
});

describe('capacityWarnings', () => {
  const classes: RenewalClass[] = [
    { id: 'c1', name: '5º A', max_capacity: 2 },
    { id: 'c2', name: '6º A', max_capacity: 1 },
    { id: 'c3', name: '7º A', max_capacity: null },
  ];
  it('avisa quando a turma de destino passaria da capacidade; quem sai libera vaga', () => {
    const { rows } = buildRenewalPlan([src({ id: 'a' }), src({ id: 'b' })], opts({ classMap: { c1: 'c2' } }));
    const w = capacityWarnings(rows, classes, { c1: 2, c2: 1 });
    expect(w).toEqual([{ classId: 'c2', className: '6º A', projected: 3, max: 1 }]);
  });
  it('sem capacidade cadastrada ou sem troca de turma: sem aviso', () => {
    const stay = buildRenewalPlan([src()], opts()).rows;
    expect(capacityWarnings(stay, classes, { c1: 2 })).toEqual([]);
    const toNoCap = buildRenewalPlan([src()], opts({ classMap: { c1: 'c3' } })).rows;
    expect(capacityWarnings(toNoCap, classes, { c1: 2, c3: 99 })).toEqual([]);
  });
});

describe('estado da decisão', () => {
  const decisions: Record<string, DecisionRow> = {
    a: { contract_id: 'a', status: 'will_renew', reason: null, note: null },
    b: { contract_id: 'b', status: 'will_not_renew', reason: 'price', note: null },
  };
  it('renovado vence a decisão gravada; sem registro = none', () => {
    const renewed = new Set(['b']);
    expect(renewalState('a', decisions, renewed)).toBe('will_renew');
    expect(renewalState('b', decisions, renewed)).toBe('renewed');
    expect(renewalState('z', decisions, renewed)).toBe('none');
  });
  it('summarizeWindow conta cada estado', () => {
    const cs = [src({ id: 'a' }), src({ id: 'b' }), src({ id: 'c' }), src({ id: 'd' })];
    const s = summarizeWindow(cs, { ...decisions, c: { contract_id: 'c', status: 'contacted', reason: null, note: null } }, new Set(['b']));
    expect(s).toEqual({ none: 1, contacted: 1, will_renew: 1, will_not_renew: 0, renewed: 1 });
  });
});

describe('chunk', () => {
  it('divide em lotes', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 100)).toEqual([[1, 2]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
