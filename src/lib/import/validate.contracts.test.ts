// src/lib/import/validate.contracts.test.ts
// Item I: valor_mensalidade opcional na planilha de contratos, com fallback RESTRITO para a turma:
// só vale quando a turma tem um único valor definido (meio período XOR integral).
import { describe, it, expect } from 'vitest';
import { validateContractsRows } from './validate';
import type { ImportContext } from './types';

type Cls = { id: string; name: string; monthly_fee?: number | null; monthly_fee_integral?: number | null };

const ctx = (classes: Cls[], students = [{ id: 's1', full_name: 'Ana Souza', email: null, birth_date: null }]): ImportContext =>
  ({
    schoolId: 'escola-1',
    existingClasses: classes,
    existingTeachers: [],
    existingStudents: students,
    existingActiveContractStudentIds: new Set<string>(),
  }) as ImportContext;

const row = (o: Record<string, string> = {}): Record<string, string> => ({
  aluno: 'Ana Souza', turma: '', valor_mensalidade: '', desconto_percentual: '', dia_vencimento: '',
  data_inicio: '01/02/2026', data_fim: '', status: '', gerar_mensalidades: '', ...o,
});

const turmaSo = (o: Partial<Cls> = {}): Cls => ({ id: 'c1', name: '5º A', monthly_fee: 650, monthly_fee_integral: null, ...o });

describe('validateContractsRows: valor_mensalidade (item I)', () => {
  it('valor informado vale, mesmo que a turma tenha outro (valor negociado) e sem nota', () => {
    const r = validateContractsRows([row({ turma: '5º A', valor_mensalidade: '720,00' })], ctx([turmaSo()]));
    expect(r.errors).toEqual([]);
    expect(r.valid[0].data.monthly_amount).toBe(720);
    expect(r.notes ?? []).toEqual([]);
  });

  it('vazio + turma com UM valor (meio período): usa o da turma e avisa qual', () => {
    const r = validateContractsRows([row({ turma: '5º A' })], ctx([turmaSo()]));
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].data.monthly_amount).toBe(650);
    expect(r.valid[0].data.class_id).toBe('c1');
    expect(r.notes).toHaveLength(1);
    expect(r.notes![0].row).toBe(2);
    expect(r.notes![0].message).toMatch(/5º A/);
    expect(r.notes![0].message).toMatch(/meio período/);
    expect(r.notes![0].message).toMatch(/650,00/);
  });

  it('vazio + turma com UM valor (só integral): usa e avisa "integral"', () => {
    const r = validateContractsRows([row({ turma: '5º A' })], ctx([turmaSo({ monthly_fee: null, monthly_fee_integral: 900 })]));
    expect(r.errors).toEqual([]);
    expect(r.valid[0].data.monthly_amount).toBe(900);
    expect(r.notes![0].message).toMatch(/integral/);
  });

  it('vazio + turma com DOIS valores: erro de linha, linha NÃO importada, mensagem cita os dois valores', () => {
    const r = validateContractsRows([row({ turma: '5º A' })], ctx([turmaSo({ monthly_fee: 650, monthly_fee_integral: 900 })]));
    expect(r.valid).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 2, field: 'valor_mensalidade' });
    expect(r.errors[0].message).toMatch(/dois valores/);
    expect(r.errors[0].message).toMatch(/650,00/);
    expect(r.errors[0].message).toMatch(/900,00/);
    expect(r.errors[0].message).toMatch(/valor_mensalidade/);
    expect(r.notes ?? []).toEqual([]);
  });

  it('vazio + sem turma: erro de linha', () => {
    const r = validateContractsRows([row()], ctx([turmaSo()]));
    expect(r.valid).toEqual([]);
    expect(r.errors[0]).toMatchObject({ row: 2, field: 'valor_mensalidade' });
    expect(r.errors[0].message).toMatch(/valor_mensalidade|turma/);
  });

  it('vazio + turma sem nenhum valor (nulo ou zero): erro de linha', () => {
    for (const cls of [turmaSo({ monthly_fee: null, monthly_fee_integral: null }), turmaSo({ monthly_fee: 0, monthly_fee_integral: 0 })]) {
      const r = validateContractsRows([row({ turma: '5º A' })], ctx([cls]));
      expect(r.valid).toEqual([]);
      expect(r.errors[0].message).toMatch(/não tem mensalidade cadastrada/);
    }
  });

  it('valor informado mas inválido continua erro (não cai no fallback)', () => {
    const r = validateContractsRows([row({ turma: '5º A', valor_mensalidade: 'abc' })], ctx([turmaSo()]));
    expect(r.valid).toEqual([]);
    expect(r.errors[0].message).toMatch(/abc/);
  });

  it('turma inexistente com valor vazio: o erro é o da turma', () => {
    const r = validateContractsRows([row({ turma: 'Inexistente' })], ctx([turmaSo()]));
    expect(r.errors[0]).toMatchObject({ field: 'turma' });
  });

  it('a linha com erro não derruba as outras: só as válidas seguem', () => {
    const students = [
      { id: 's1', full_name: 'Ana Souza', email: null, birth_date: null },
      { id: 's2', full_name: 'Bia Lima', email: null, birth_date: null },
    ];
    const classes = [turmaSo(), turmaSo({ id: 'c2', name: '6º B', monthly_fee: 700, monthly_fee_integral: 950 })];
    const r = validateContractsRows(
      [row({ turma: '5º A' }), row({ aluno: 'Bia Lima', turma: '6º B' })],
      ctx(classes, students),
    );
    expect(r.valid.map((v) => v.row)).toEqual([2]);
    expect(r.errors.map((e) => e.row)).toEqual([3]);
    expect(r.totalRows).toBe(2);
  });
});
