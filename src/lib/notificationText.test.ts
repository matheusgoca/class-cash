import { describe, it, expect } from 'vitest';
import { describeNotification, groupByDay, formatRelativeTime, type NotificationItem } from './notificationText';

const base: NotificationItem = {
  id: '1', event: 'tuition_due', reference_date: '2026-11-19', offset_days: 3,
  item_count: 8, total_amount: 4000, details: {}, read_at: null, created_at: '2026-11-19T08:00:00Z',
};
const mk = (o: Partial<NotificationItem>): NotificationItem => ({ ...base, ...o });

describe('describeNotification', () => {
  it('tuition_due plural, singular, hoje e amanhã', () => {
    expect(describeNotification(mk({})).title).toBe('8 mensalidades vencem em 3 dias');
    expect(describeNotification(mk({ item_count: 1, offset_days: 1 })).title).toBe('1 mensalidade vence amanhã');
    expect(describeNotification(mk({ item_count: 2, offset_days: 0 })).title).toBe('2 mensalidades vencem hoje');
    expect(describeNotification(mk({ item_count: 1, offset_days: 0 })).title).toBe('1 mensalidade vence hoje');
    const v = describeNotification(mk({}));
    expect(v.category).toBe('cobranca');
    expect(v.categoryLabel).toBe('Cobrança');
    expect(v.actionLabel).toBe('Ver cobranças');
    expect(v.actionPath).toBe('/mensalidades?status=pending');
  });
  it('tuition_overdue com valor e turmas', () => {
    const v = describeNotification(mk({ event: 'tuition_overdue', item_count: 12, offset_days: 5, total_amount: 6840, details: { class_count: 3 } }));
    expect(v.title).toBe('12 mensalidades vencidas há mais de 5 dias');
    expect(v.subtitle).toContain('em atraso, em 3 turmas.');
    expect(v.subtitle).toMatch(/^R\$\s6\.840,00/);
    expect(v.actionPath).toBe('/mensalidades?status=overdue');
  });
  it('tuition_overdue singular e 1 turma; offset 1 usa "dia"', () => {
    const v = describeNotification(mk({ event: 'tuition_overdue', item_count: 1, offset_days: 1, total_amount: 100, details: { class_count: 1 } }));
    expect(v.title).toBe('1 mensalidade vencida há mais de 1 dia');
    expect(v.subtitle).toContain('em 1 turma.');
  });
  it('renegotiation_installment', () => {
    const v = describeNotification(mk({ event: 'renegotiation_installment', item_count: 3, offset_days: 1 }));
    expect(v.title).toBe('3 parcelas de renegociação vencem amanhã');
    expect(describeNotification(mk({ event: 'renegotiation_installment', item_count: 1, offset_days: 2 })).title)
      .toBe('1 parcela de renegociação vence em 2 dias');
    expect(v.category).toBe('renegociacao');
    expect(v.actionLabel).toBe('Ver parcelas');
    expect(v.actionPath).toBe('/mensalidades?status=pending');
  });
  it('expense_due com 1 item usa a descrição; vários, a contagem', () => {
    const one = describeNotification(mk({ event: 'expense_due', item_count: 1, offset_days: 2, total_amount: 4200, details: { description: 'Aluguel' } }));
    expect(one.title).toBe('Despesa a pagar: Aluguel');
    expect(one.subtitle).toMatch(/^Vence em 2 dias · R\$\s4\.200,00$/);
    expect(one.actionLabel).toBe('Ver despesa');
    const many = describeNotification(mk({ event: 'expense_due', item_count: 4, offset_days: 2, total_amount: 800 }));
    expect(many.title).toBe('4 despesas vencem em 2 dias');
    expect(many.actionLabel).toBe('Ver despesas');
    expect(many.actionPath).toBe('/despesas');
    expect(describeNotification(mk({ event: 'expense_due', item_count: 1, offset_days: 0, total_amount: 10, details: {} })).title)
      .toBe('1 despesa vence hoje');
  });
  it('reenrollment com rematriculados, recusados e pendentes', () => {
    const v = describeNotification(mk({ event: 'reenrollment', item_count: 18, offset_days: 45, total_amount: null, details: { renewed_count: 6 } }));
    expect(v.title).toBe('18 contratos terminam em 45 dias');
    expect(v.subtitle).toBe('6 já rematriculados · 12 pendentes');
    expect(v.category).toBe('rematricula');
    expect(v.actionLabel).toBe('Abrir rematrícula');
    expect(v.actionPath).toBe('/rematricula');
    const withDeclined = describeNotification(mk({ event: 'reenrollment', item_count: 18, offset_days: 45, total_amount: null, details: { renewed_count: 6, declined_count: 3 } }));
    expect(withDeclined.subtitle).toBe('6 já rematriculados · 3 não vão renovar · 9 pendentes');
    const one = describeNotification(mk({ event: 'reenrollment', item_count: 3, offset_days: 45, total_amount: null, details: { renewed_count: 1, declined_count: 1 } }));
    expect(one.subtitle).toBe('1 já rematriculado · 1 não vai renovar · 1 pendente');
    expect(describeNotification(mk({ event: 'reenrollment', item_count: 1, offset_days: 1, details: { renewed_count: 0 } })).title)
      .toBe('1 contrato termina amanhã');
  });
});

describe('groupByDay', () => {
  const now = new Date(2026, 10, 19, 10, 0); // 19/11/2026 10:00 local (quinta)
  it('agrupa em Hoje / Ontem / Esta semana / Anteriores e omite vazios', () => {
    const items = [
      mk({ id: 'a', reference_date: '2026-11-19' }),
      mk({ id: 'b', reference_date: '2026-11-18' }),
      mk({ id: 'c', reference_date: '2026-11-16' }),
      mk({ id: 'd', reference_date: '2026-11-01' }),
    ];
    const g = groupByDay(items, now);
    expect(g.map((x) => x.label)).toEqual(['Hoje', 'Ontem', 'Esta semana', 'Anteriores']);
    expect(g.map((x) => x.items[0].id)).toEqual(['a', 'b', 'c', 'd']);
    expect(groupByDay([items[0]], now).map((x) => x.label)).toEqual(['Hoje']);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date(2026, 10, 19, 10, 0);
  it('hoje com hora, ontem e dia da semana', () => {
    expect(formatRelativeTime(new Date(2026, 10, 19, 5, 0).toISOString(), now)).toBe('hoje 05:00');
    expect(formatRelativeTime(new Date(2026, 10, 18, 5, 0).toISOString(), now)).toBe('ontem');
    expect(formatRelativeTime(new Date(2026, 10, 16, 5, 0).toISOString(), now)).toBe('seg');
  });
});
