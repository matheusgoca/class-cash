// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StudentTable } from './StudentTable';
import type { StudentTuitionView } from '@/lib/studentTuition';

const aluno = (id: string, name: string, tuition: StudentTuitionView | undefined, legado = {}) => ({
  id, full_name: name, birth_date: '2015-03-10', status: 'active' as const,
  enrollment_class_id: 'c1', enrollment_class_name: '5º A', tuition, ...legado,
});

const renderTable = (students: ReturnType<typeof aluno>[]) =>
  render(
    <StudentTable
      students={students as never}
      classes={[{ id: 'c1', name: '5º A' }]}
      onEdit={vi.fn()} onDelete={vi.fn()}
      searchTerm="" onSearchChange={vi.fn()} classFilter="all" onClassFilterChange={vi.fn()}
    />,
  );

afterEach(() => cleanup());

describe('StudentTable: coluna Mensalidade (item I)', () => {
  it('com contrato: o valor do contrato, sem sufixo de referência', () => {
    renderTable([aluno('1', 'Ana', { kind: 'contract', value: 540, discount: 10, start: '2026-03-01', end: '2027-02-28', contractId: 'k1' })]);
    expect(screen.getByText(/R\$\s*540,00/)).toBeTruthy();
    expect(screen.queryByText(/ref\. turma/)).toBeNull();
  });

  it('sem contrato: a referência da turma com o sufixo "(ref. turma, meio período)"', () => {
    renderTable([aluno('2', 'Bia', { kind: 'class_reference', value: 650 })]);
    expect(screen.getByText(/R\$\s*650,00/)).toBeTruthy();
    expect(screen.getByText('(ref. turma, meio período)')).toBeTruthy();
  });

  it('sem nada: "—"', () => {
    renderTable([aluno('3', 'Caio', { kind: 'none' })]);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('IGNORA os valores legados do cadastro do aluno (final_tuition_value e afins)', () => {
    renderTable([aluno('4', 'Duda', { kind: 'none' }, { final_tuition_value: 777, full_tuition_value: 800, active_contract_final_amount: 999 })]);
    expect(screen.queryByText(/777/)).toBeNull();
    expect(screen.queryByText(/800/)).toBeNull();
    expect(screen.queryByText(/999/)).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('aluno sem a vista calculada: "—" (nunca cai no valor legado)', () => {
    renderTable([aluno('5', 'Edu', undefined, { final_tuition_value: 777 })]);
    expect(screen.queryByText(/777/)).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });
});
