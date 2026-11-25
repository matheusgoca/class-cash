// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Dialog } from '@/components/ui/dialog';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) }) },
}));
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 'escola-1' }) }));
vi.mock('./StudentServicesSection', () => ({ StudentServicesSection: () => null }));

import { StudentForm } from './StudentForm';

const classes = [{ id: 'c1', name: '5º A', monthly_fee: 650 }];
const aluno = {
  id: 's1', full_name: 'Ana Souza', birth_date: '2015-03-10', enrollment_date: '2026-02-01', status: 'active',
  enrollment_class_id: 'c1',
  // valores legados do cadastro: não podem aparecer nem ser reenviados
  full_tuition_value: 777, discount: 5, final_tuition_value: 738.15,
};

const renderForm = (onSubmit = vi.fn(), student: unknown = undefined) =>
  render(
    <MemoryRouter>
      <Dialog open>
        <StudentForm student={student} onSubmit={onSubmit} onCancel={vi.fn()} classes={classes} />
      </Dialog>
    </MemoryRouter>,
  );

afterEach(() => cleanup());

describe('StudentForm (item I: o aluno não digita valor)', () => {
  it('não tem os campos "Mensalidade base (R$)" nem "Desconto (%)" nem o bloco "Valor final da mensalidade"', () => {
    renderForm();
    expect(screen.queryByText('Mensalidade base (R$)')).toBeNull();
    expect(screen.queryByText('Desconto (%)')).toBeNull();
    expect(screen.queryByText('Valor final da mensalidade')).toBeNull();
    expect(screen.queryByPlaceholderText('500.00')).toBeNull();
  });

  it('mostra o bloco somente leitura, com a referência da turma e o rótulo distinto', async () => {
    renderForm(vi.fn(), aluno);
    expect(await screen.findByText('Referência da turma (meio período)')).toBeTruthy();
    expect(screen.queryByText('Valor do contrato')).toBeNull();
    // o valor legado do cadastro (777) não é exibido em lugar nenhum
    expect(screen.queryByText(/777/)).toBeNull();
  });

  it('salvar não envia full_tuition_value, discount nem final_tuition_value (não apaga o legado)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(onSubmit, aluno);
    await userEvent.click(await screen.findByRole('button', { name: /Salvar|Atualizar/ }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect('full_tuition_value' in payload).toBe(false);
    expect('discount' in payload).toBe(false);
    expect('final_tuition_value' in payload).toBe(false);
    expect(payload.full_name).toBe('Ana Souza');
  });
});
