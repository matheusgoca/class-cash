// src/lib/studentTuition.test.ts
import { describe, it, expect } from 'vitest';
import {
  CLASS_REFERENCE_LABEL, CONTRACT_VALUE_LABEL, NO_CONTRACT_NOTE,
  pickCurrentContract, studentTuitionView, type StudentContract,
} from './studentTuition';

const k = (o: Partial<StudentContract> = {}): StudentContract => ({
  id: 'k1', student_id: 's1', status: 'active', start_date: '2026-03-01', end_date: '2027-02-28',
  final_amount: 540, discount: 10, ...o,
});
const today = '2026-11-25';

describe('rótulos', () => {
  it('"valor do contrato" e "referência da turma" são textos distintos (R5)', () => {
    expect(CONTRACT_VALUE_LABEL).toBe('Valor do contrato');
    expect(CLASS_REFERENCE_LABEL).toBe('Referência da turma (meio período)');
    expect(CONTRACT_VALUE_LABEL).not.toBe(CLASS_REFERENCE_LABEL);
    expect(NO_CONTRACT_NOTE).toMatch(/definido ao criar o contrato/);
  });
});

describe('pickCurrentContract (R4: contrato vigente)', () => {
  it('sem contratos → null', () => {
    expect(pickCurrentContract([], today)).toBeNull();
  });
  it('escolhe o ativo cujo período contém hoje', () => {
    const vigente = k({ id: 'vig' });
    const velho = k({ id: 'velho', start_date: '2025-03-01', end_date: '2026-02-28' });
    expect(pickCurrentContract([velho, vigente], today)?.id).toBe('vig');
  });
  it('vários ativos contendo hoje: vence o de start_date mais recente', () => {
    const a = k({ id: 'a', start_date: '2026-01-01', end_date: '2026-12-31' });
    const b = k({ id: 'b', start_date: '2026-06-01', end_date: '2027-05-31' });
    expect(pickCurrentContract([a, b], today)?.id).toBe('b');
  });
  it('só vencido (ativo): devolve o de start_date mais recente', () => {
    const a = k({ id: 'a', start_date: '2024-03-01', end_date: '2025-02-28' });
    const b = k({ id: 'b', start_date: '2025-03-01', end_date: '2026-02-28' });
    expect(pickCurrentContract([a, b], today)?.id).toBe('b');
  });
  it('só futuro (ativo): devolve o futuro', () => {
    expect(pickCurrentContract([k({ id: 'fut', start_date: '2027-03-01', end_date: '2028-02-29' })], today)?.id).toBe('fut');
  });
  it('ignora contrato cancelado, suspenso ou de outro aluno-status', () => {
    expect(pickCurrentContract([k({ status: 'cancelled' }), k({ status: 'suspended' })], today)).toBeNull();
  });
  it('a data de hoje conta nas duas pontas do período', () => {
    expect(pickCurrentContract([k({ id: 'ini', start_date: today, end_date: '2027-01-01' })], today)?.id).toBe('ini');
    expect(pickCurrentContract([k({ id: 'fim', start_date: '2025-01-01', end_date: today })], today)?.id).toBe('fim');
  });
  it('desempate estável: mesmo start_date vence o de id maior (determinístico)', () => {
    const a = k({ id: 'a' });
    const b = k({ id: 'b' });
    expect(pickCurrentContract([a, b], today)?.id).toBe(pickCurrentContract([b, a], today)?.id);
  });
});

describe('studentTuitionView', () => {
  it('com contrato: valor do contrato (já com desconto), desconto e período', () => {
    const v = studentTuitionView(k({ final_amount: '540.00', discount: 10 }), 650);
    expect(v).toEqual({ kind: 'contract', value: 540, discount: 10, start: '2026-03-01', end: '2027-02-28', contractId: 'k1' });
  });
  it('o contrato vence a turma: o preço da turma é ignorado quando há contrato', () => {
    expect(studentTuitionView(k({ final_amount: 300 }), 999).kind).toBe('contract');
  });
  it('sem contrato e turma com mensalidade: referência da turma', () => {
    expect(studentTuitionView(null, 650)).toEqual({ kind: 'class_reference', value: 650 });
    expect(studentTuitionView(null, '650.50')).toEqual({ kind: 'class_reference', value: 650.5 });
  });
  it('sem contrato e sem valor útil na turma: none', () => {
    for (const fee of [null, undefined, 0, '0', '', -5]) {
      expect(studentTuitionView(null, fee as never)).toEqual({ kind: 'none' });
    }
  });
  it('desconto ausente no contrato vira 0', () => {
    const v = studentTuitionView(k({ discount: null }), null);
    expect(v).toMatchObject({ kind: 'contract', discount: 0 });
  });
});
