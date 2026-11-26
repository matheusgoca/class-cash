// src/lib/import/validate.contracts.test.ts
// Item I: valor_mensalidade opcional na planilha de contratos, com fallback RESTRITO para a turma:
// só vale quando a turma tem APENAS o valor de meio período. Turma só com integral, com os dois valores,
// sem valor, ou sem turma: erro de linha ("informe o valor"), a linha não é importada e as válidas seguem.
import { describe, it, expect } from 'vitest';
import { validateContractsRows } from './validate';
import { resolveClassFee } from './shared';
import type { ImportContext } from './types';

type Cls = { id: string; name: string; monthly_fee?: number | null; monthly_fee_integral?: number | null };

type Active = { id?: string; student_id: string; start_date: string; end_date: string; status?: string };

const ctx = (classes: Cls[], students = [{ id: 's1', full_name: 'Ana Souza', email: null, birth_date: null }], active: Active[] = []): ImportContext =>
  ({
    schoolId: 'escola-1',
    existingClasses: classes,
    existingTeachers: [],
    existingStudents: students,
    existingActiveContracts: active.map((a) => ({ status: 'active', ...a })),
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

  it('vazio + turma SÓ com valor integral: erro de linha "informe o valor", sem fallback e sem nota', () => {
    const r = validateContractsRows([row({ turma: '5º A' })], ctx([turmaSo({ monthly_fee: null, monthly_fee_integral: 900 })]));
    expect(r.valid).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 2, field: 'valor_mensalidade' });
    expect(r.errors[0].message).toMatch(/Informe "valor_mensalidade"/);
    expect(r.errors[0].message).toMatch(/integral/);
    expect(r.errors[0].message).toMatch(/900,00/);
    expect(r.notes ?? []).toEqual([]);
  });

  it('turma só integral COM valor_mensalidade informado: importa o informado', () => {
    const r = validateContractsRows(
      [row({ turma: '5º A', valor_mensalidade: '950,00' })],
      ctx([turmaSo({ monthly_fee: null, monthly_fee_integral: 900 })]),
    );
    expect(r.errors).toEqual([]);
    expect(r.valid[0].data.monthly_amount).toBe(950);
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

describe('resolveClassFee', () => {
  it('só meio período = fallback permitido', () => {
    expect(resolveClassFee({ monthly_fee: 650, monthly_fee_integral: null })).toEqual({ kind: 'single', amount: 650, period: 'meio período' });
    expect(resolveClassFee({ monthly_fee: '650.50', monthly_fee_integral: 0 })).toEqual({ kind: 'single', amount: 650.5, period: 'meio período' });
  });
  it('só integral = SEM fallback (integral_only)', () => {
    expect(resolveClassFee({ monthly_fee: null, monthly_fee_integral: 900 })).toEqual({ kind: 'integral_only', full: 900 });
    expect(resolveClassFee({ monthly_fee: 0, monthly_fee_integral: '900' })).toEqual({ kind: 'integral_only', full: 900 });
  });
  it('os dois valores = both; nenhum, nulo, negativo ou turma ausente = none', () => {
    expect(resolveClassFee({ monthly_fee: 650, monthly_fee_integral: 900 })).toEqual({ kind: 'both', half: 650, full: 900 });
    for (const c of [{ monthly_fee: null, monthly_fee_integral: null }, { monthly_fee: 0, monthly_fee_integral: -1 }, undefined]) {
      expect(resolveClassFee(c as never)).toEqual({ kind: 'none' });
    }
  });
});

describe('validateContractsRows: bolsa 100% (bloco H)', () => {
  it('desconto 100% é aceito com valor de tabela > 0 (bolsa); o valor de tabela é preservado', () => {
    const r = validateContractsRows([row({ turma: '5º A', valor_mensalidade: '900,00', desconto_percentual: '100' })], ctx([turmaSo()]));
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].data.monthly_amount).toBe(900);
    expect(r.valid[0].data.discount).toBe(100);
  });

  it('desconto 100% sem valor informado usa o valor da turma como valor de tabela (turma só meio período)', () => {
    const r = validateContractsRows([row({ turma: '5º A', desconto_percentual: '100' })], ctx([turmaSo()]));
    expect(r.errors).toEqual([]);
    expect(r.valid[0].data.monthly_amount).toBe(650);
    expect(r.valid[0].data.discount).toBe(100);
  });

  it('desconto acima de 100% continua sendo erro de linha', () => {
    const r = validateContractsRows([row({ turma: '5º A', valor_mensalidade: '900,00', desconto_percentual: '101' })], ctx([turmaSo()]));
    expect(r.valid).toEqual([]);
    expect(r.errors[0]).toMatchObject({ field: 'desconto_percentual' });
  });
});

describe('validateContractsRows: sobreposição de contratos ativos (bloco C2)', () => {
  const ativo = (start: string, end: string, extra: Partial<Active> = {}): Active => ({ student_id: 's1', start_date: start, end_date: end, ...extra });

  it('contra existente: ativo que se sobrepõe vira erro de linha com o período do contrato atual', () => {
    const r = validateContractsRows([row({ turma: '5º A', valor_mensalidade: '700', data_inicio: '01/06/2031', data_fim: '31/05/2032' })], ctx([turmaSo()], undefined, [ativo('2031-01-01', '2031-12-31')]));
    expect(r.valid).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 2, field: 'aluno' });
    expect(r.errors[0].message).toMatch(/Ana Souza/);
    expect(r.errors[0].message).toMatch(/01\/01\/2031 a 31\/12\/2031/);
  });

  it('contra existente: período que começa no dia seguinte (renovação antecipada) entra', () => {
    const r = validateContractsRows([row({ valor_mensalidade: '700', data_inicio: '01/01/2032', data_fim: '31/12/2032' })], ctx([turmaSo()], undefined, [ativo('2031-01-01', '2031-12-31')]));
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(1);
  });

  it('existente suspenso ou cancelado não bloqueia', () => {
    const r = validateContractsRows([row({ valor_mensalidade: '700', data_inicio: '01/03/2031', data_fim: '28/02/2032' })],
      ctx([turmaSo()], undefined, [ativo('2031-01-01', '2031-12-31', { status: 'suspended' }), ativo('2031-01-01', '2031-12-31', { status: 'cancelled' })]));
    expect(r.errors).toEqual([]);
  });

  it('linha com status suspenso ou cancelado não é barrada (não cobra)', () => {
    const r = validateContractsRows([row({ valor_mensalidade: '700', data_inicio: '01/03/2031', data_fim: '28/02/2032', status: 'suspenso' })], ctx([turmaSo()], undefined, [ativo('2031-01-01', '2031-12-31')]));
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(1);
  });

  it('entre linhas do mesmo arquivo: a 2ª linha ativa que se sobrepõe à 1ª é erro; a 1ª segue', () => {
    const r = validateContractsRows(
      [row({ valor_mensalidade: '700', data_inicio: '01/01/2031', data_fim: '31/12/2031' }), row({ valor_mensalidade: '700', data_inicio: '01/06/2031', data_fim: '31/05/2032' })],
      ctx([turmaSo()]),
    );
    expect(r.valid).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 3, field: 'aluno' });
    expect(r.errors[0].message).toMatch(/linha 2/);
  });

  it('entre linhas do mesmo arquivo: períodos que não se sobrepõem (anos seguidos) entram os dois', () => {
    const r = validateContractsRows(
      [row({ valor_mensalidade: '700', data_inicio: '01/01/2031', data_fim: '31/12/2031' }), row({ valor_mensalidade: '700', data_inicio: '01/01/2032', data_fim: '31/12/2032' })],
      ctx([turmaSo()]),
    );
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(2);
  });

  it('linhas de outros alunos não interferem', () => {
    const students = [{ id: 's1', full_name: 'Ana Souza', email: null, birth_date: null }, { id: 's2', full_name: 'Bia Lima', email: null, birth_date: null }];
    const r = validateContractsRows(
      [row({ valor_mensalidade: '700', data_inicio: '01/01/2031', data_fim: '31/12/2031' }), row({ aluno: 'Bia Lima', valor_mensalidade: '700', data_inicio: '01/01/2031', data_fim: '31/12/2031' })],
      ctx([turmaSo()], students),
    );
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(2);
  });
});

describe('validateContractsRows: valor e datas (bloco C2)', () => {
  it('valor zero ou negativo é erro de linha (bolsa se faz por desconto de 100%)', () => {
    for (const v of ['0', '-50', '0,00']) {
      const r = validateContractsRows([row({ valor_mensalidade: v })], ctx([turmaSo()]));
      expect(r.valid).toEqual([]);
      expect(r.errors[0]).toMatchObject({ field: 'valor_mensalidade' });
      expect(r.errors[0].message).toMatch(/maior que zero/);
      expect(r.errors[0].message).toMatch(/desconto de 100%/);
    }
  });

  it('data de término antes da de início é erro de linha', () => {
    const r = validateContractsRows([row({ valor_mensalidade: '700', data_inicio: '01/06/2031', data_fim: '31/05/2031' })], ctx([turmaSo()]));
    expect(r.valid).toEqual([]);
    expect(r.errors[0]).toMatchObject({ field: 'data_fim' });
    expect(r.errors[0].message).toMatch(/anterior/);
  });

  it('vencimento fora de 1 a 28 continua sendo erro', () => {
    const r = validateContractsRows([row({ valor_mensalidade: '700', dia_vencimento: '31' })], ctx([turmaSo()]));
    expect(r.errors[0]).toMatchObject({ field: 'dia_vencimento' });
  });
});
