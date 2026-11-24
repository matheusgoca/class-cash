// src/lib/tuitionRows.test.ts
import { describe, it, expect } from 'vitest';
import { buildTuitionRows } from './tuitionRows';

const base = { startDate: '2031-03-01', endDate: '2032-02-29', dueDay: 5, finalAmount: 99 };
const monthName = (y: number, m: number) =>
  new Date(y, m, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

describe('buildTuitionRows', () => {
  it('gera 12 mensalidades de março/2031 a fevereiro/2032, no dia 5', () => {
    const rows = buildTuitionRows(base, new Date(2031, 0, 15));
    expect(rows).toHaveLength(12);
    expect(rows[0].due_date).toBe('2031-03-05');
    expect(rows[11].due_date).toBe('2032-02-05');
    expect(rows.every((r) => r.amount === 99)).toBe(true);
    expect(rows[0].description).toBe(`Mensalidade ${monthName(2031, 2)}`);
  });

  it('status: vencida (overdue) se já passou de hoje, senão pendente', () => {
    const rows = buildTuitionRows(base, new Date(2031, 4, 10)); // 10/05/2031
    expect(rows.filter((r) => r.status === 'overdue').map((r) => r.due_date)).toEqual(['2031-03-05', '2031-04-05', '2031-05-05']);
    expect(rows.find((r) => r.due_date === '2031-06-05')?.status).toBe('pending');
  });

  it('ajusta o vencimento ao último dia do mês (dia 31 em fevereiro, ano comum e bissexto)', () => {
    const rows = buildTuitionRows({ ...base, startDate: '2031-01-01', endDate: '2032-03-31', dueDay: 31 }, new Date(2030, 0, 1));
    expect(rows.find((r) => r.due_date.startsWith('2031-02'))?.due_date).toBe('2031-02-28');
    expect(rows.find((r) => r.due_date.startsWith('2032-02'))?.due_date).toBe('2032-02-29');
  });

  it('ignora o mês cujo vencimento cai antes do início do contrato', () => {
    // começa dia 20 com vencimento dia 5: a 1ª mensalidade é a do mês seguinte
    const rows = buildTuitionRows({ ...base, startDate: '2031-03-20', endDate: '2031-06-30' }, new Date(2031, 0, 1));
    expect(rows.map((r) => r.due_date)).toEqual(['2031-04-05', '2031-05-05', '2031-06-05']);
  });

  it('ignora o mês cujo vencimento cai depois do fim do contrato', () => {
    const rows = buildTuitionRows({ ...base, startDate: '2031-03-01', endDate: '2031-05-03' }, new Date(2031, 0, 1));
    expect(rows.map((r) => r.due_date)).toEqual(['2031-03-05', '2031-04-05']);
  });

  it('idempotente: não repete vencimentos já existentes', () => {
    const rows = buildTuitionRows(base, new Date(2031, 0, 1), new Set(['2031-03-05', '2031-04-05']));
    expect(rows).toHaveLength(10);
    expect(rows[0].due_date).toBe('2031-05-05');
  });
});
