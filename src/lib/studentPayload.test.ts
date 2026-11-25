// src/lib/studentPayload.test.ts
import { describe, it, expect } from 'vitest';
import { buildStudentPayload } from './studentPayload';

const base = {
  full_name: 'Ana Souza', email: 'ana@x.com', phone: '', guardian_contact: 'Mãe',
  birth_date: new Date(2015, 2, 10), enrollment_date: new Date(2026, 1, 1),
  class_id: 'c1', status: 'active' as const,
};

describe('buildStudentPayload (item I)', () => {
  it('converte as datas, põe a escola e tira a turma (que vai para enrollments)', () => {
    const { payload, classId } = buildStudentPayload(base, 'escola-1');
    expect(payload).toMatchObject({ full_name: 'Ana Souza', birth_date: '2015-03-10', enrollment_date: '2026-02-01', school_id: 'escola-1', status: 'active' });
    expect('class_id' in payload).toBe(false);
    expect(classId).toBe('c1');
  });

  it('NUNCA envia full_tuition_value, discount nem final_tuition_value, mesmo se vierem no formulário', () => {
    const { payload } = buildStudentPayload(
      { ...base, full_tuition_value: 500, discount: 10, final_tuition_value: 450 } as never,
      'escola-1',
    );
    expect('full_tuition_value' in payload).toBe(false);
    expect('discount' in payload).toBe(false);
    expect('final_tuition_value' in payload).toBe(false);
  });

  it('sem valor no formulário não gera NaN em lugar nenhum', () => {
    const { payload } = buildStudentPayload(base, 'escola-1');
    expect(Object.values(payload).some((v) => typeof v === 'number' && Number.isNaN(v))).toBe(false);
  });

  it('turma vazia vira null', () => {
    expect(buildStudentPayload({ ...base, class_id: null }, 's').classId).toBeNull();
  });
});
