import { describe, it, expect, vi } from 'vitest';
import { periodsOverlap, findOverlap, overlapMessage, needsOverlapCheck, fetchOverlappingContract } from './contractOverlap';

describe('periodsOverlap (limites inclusivos)', () => {
  it.each([
    ['parcial', '2031-01-01', '2031-12-31', '2031-06-01', '2032-05-31', true],
    ['contido', '2031-01-01', '2031-12-31', '2031-03-01', '2031-04-30', true],
    ['contém', '2031-03-01', '2031-04-30', '2031-01-01', '2031-12-31', true],
    ['mesmo dia (fim = início)', '2031-01-01', '2031-12-31', '2031-12-31', '2032-12-30', true],
    ['dia seguinte', '2031-01-01', '2031-12-31', '2032-01-01', '2032-12-31', false],
    ['dia anterior', '2031-01-01', '2031-12-31', '2030-01-01', '2030-12-31', false],
    ['idêntico', '2031-01-01', '2031-12-31', '2031-01-01', '2031-12-31', true],
  ])('%s', (_n, as, ae, bs, be, esperado) => {
    expect(periodsOverlap(as, ae, bs, be)).toBe(esperado);
  });
});

const ativo = (id: string, student: string, start: string, end: string, status = 'active') => ({ id, student_id: student, start_date: start, end_date: end, status });

describe('findOverlap (lista em memória: importação)', () => {
  const existing = [ativo('k1', 's1', '2031-01-01', '2031-12-31'), ativo('k2', 's1', '2033-01-01', '2033-12-31', 'suspended'), ativo('k3', 's2', '2031-01-01', '2031-12-31'), ativo('k4', 's1', '2029-01-01', '2029-12-31', 'cancelled')];
  it('acha só contrato ATIVO do mesmo aluno que se sobrepõe', () => {
    expect(findOverlap(existing, { student_id: 's1', start_date: '2031-06-01', end_date: '2032-05-31' })?.id).toBe('k1');
    expect(findOverlap(existing, { student_id: 's1', start_date: '2032-01-01', end_date: '2032-12-31' })).toBeUndefined();
  });
  it('suspenso e cancelado não contam; outro aluno não conta', () => {
    expect(findOverlap(existing, { student_id: 's1', start_date: '2033-03-01', end_date: '2033-06-30' })).toBeUndefined();
    expect(findOverlap(existing, { student_id: 's1', start_date: '2029-03-01', end_date: '2029-06-30' })).toBeUndefined();
    expect(findOverlap(existing, { student_id: 's3', start_date: '2031-03-01', end_date: '2031-06-30' })).toBeUndefined();
  });
  it('o próprio contrato (excludeId) fica de fora', () => {
    expect(findOverlap(existing, { student_id: 's1', start_date: '2031-03-01', end_date: '2031-06-30', excludeId: 'k1' })).toBeUndefined();
  });
});

describe('overlapMessage', () => {
  it('cita o período do contrato existente em português', () => {
    expect(overlapMessage({ start_date: '2031-01-01', end_date: '2031-12-31' })).toBe(
      'Este aluno já tem um contrato ativo de 01/01/2031 a 31/12/2031. Encerre ou ajuste esse contrato antes de criar outro que se sobreponha.',
    );
  });
});

describe('needsOverlapCheck (quando validar)', () => {
  const edit = { status: 'active', start_date: '2031-01-01', end_date: '2031-12-31' };
  it('criação ativa sempre valida; criação suspensa ou cancelada não', () => {
    expect(needsOverlapCheck(null, { status: 'active', start_date: '2031-01-01', end_date: '2031-12-31' })).toBe(true);
    expect(needsOverlapCheck(null, { status: 'suspended', start_date: '2031-01-01', end_date: '2031-12-31' })).toBe(false);
    expect(needsOverlapCheck(null, { status: 'cancelled', start_date: '2031-01-01', end_date: '2031-12-31' })).toBe(false);
  });
  it('edição: reativação (suspenso/cancelado para ativo) e mudança de datas validam; editar outro campo não', () => {
    expect(needsOverlapCheck({ ...edit, status: 'suspended' }, { ...edit, status: 'active' })).toBe(true);
    expect(needsOverlapCheck(edit, { ...edit, end_date: '2032-03-31' })).toBe(true);
    expect(needsOverlapCheck(edit, { ...edit })).toBe(false);
    expect(needsOverlapCheck({ ...edit, status: 'suspended' }, { ...edit, status: 'suspended', end_date: '2032-03-31' })).toBe(false);
  });
});

describe('fetchOverlappingContract (consulta ao banco com school_id explícito)', () => {
  const mk = (rows: unknown[]) => {
    const calls: [string, ...unknown[]][] = [];
    const c: any = new Proxy({}, { get: (_t, prop: string) => {
      if (prop === 'then') return (res: (v: unknown) => unknown) => res({ data: rows, error: null });
      return (...args: unknown[]) => { calls.push([prop, ...args]); return c; };
    } });
    return { client: { from: (t: string) => { calls.push(['from', t]); return c; } } as never, calls };
  };

  it('filtra por escola, aluno, status ativo e período; exclui o próprio contrato', async () => {
    const { client, calls } = mk([{ id: 'k9', start_date: '2031-01-01', end_date: '2031-12-31' }]);
    const r = await fetchOverlappingContract(client, 's-escola', { student_id: 'a1', start_date: '2031-06-01', end_date: '2032-05-31', excludeId: 'k0' });
    expect(r?.id).toBe('k9');
    expect(calls).toContainEqual(['eq', 'school_id', 's-escola']);
    expect(calls).toContainEqual(['eq', 'student_id', 'a1']);
    expect(calls).toContainEqual(['eq', 'status', 'active']);
    expect(calls).toContainEqual(['lte', 'start_date', '2032-05-31']);
    expect(calls).toContainEqual(['gte', 'end_date', '2031-06-01']);
    expect(calls).toContainEqual(['neq', 'id', 'k0']);
  });
  it('sem sobreposição devolve undefined e não filtra id quando não há excludeId', async () => {
    const { client, calls } = mk([]);
    expect(await fetchOverlappingContract(client, 's-escola', { student_id: 'a1', start_date: '2031-06-01', end_date: '2032-05-31' })).toBeUndefined();
    expect(calls.some((c) => c[0] === 'neq')).toBe(false);
  });
  it('propaga o erro do banco', async () => {
    const c: any = new Proxy({}, { get: (_t, prop: string) => prop === 'then' ? (res: (v: unknown) => unknown) => res({ data: null, error: { message: 'x' } }) : () => c });
    await expect(fetchOverlappingContract({ from: () => c } as never, 's', { student_id: 'a', start_date: '2031-01-01', end_date: '2031-12-31' })).rejects.toBeTruthy();
  });
});
