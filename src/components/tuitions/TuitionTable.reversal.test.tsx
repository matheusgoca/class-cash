// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

const rpc = vi.fn();
const toast = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn() } }));
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 'escola-1' }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

import { TuitionTable } from './TuitionTable';

const base = {
  due_date: '2026-11-10', description: 'Mensalidade novembro de 2026', student_id: 's1', contract_id: 'k1',
  discount_applied: 0, penalty_amount: 0, renegotiation_id: null, students: { full_name: 'Ana' }, contracts: null,
};
const rows = [
  { ...base, id: 't-paga', amount: 1000, final_amount: 985, status: 'paid' as const, paid_date: '2026-11-08', payment_method: 'PIX' },
  { ...base, id: 't-bolsa', amount: 0, final_amount: 0, status: 'paid' as const, paid_date: '2026-11-10', payment_method: 'bolsa', description: 'Mensalidade bolsa' },
  { ...base, id: 't-pend', amount: 1000, final_amount: 0, status: 'pending' as const, paid_date: null, payment_method: null, due_date: '2099-01-10', description: 'Mensalidade pendente' },
  { ...base, id: 't-canc', amount: 1000, final_amount: 0, status: 'cancelled' as const, paid_date: null, payment_method: null, description: 'Mensalidade cancelada' },
];

beforeEach(() => { rpc.mockReset(); toast.mockReset(); });
afterEach(() => cleanup());

const renderTable = (onRefresh = vi.fn()) =>
  render(<TuitionTable data={rows as never} loading={false} onEdit={vi.fn()} onRefresh={onRefresh} />);

describe('TuitionTable: estorno de baixa (bloco D)', () => {
  it('o botão "Estornar baixa" só aparece na mensalidade paga que não é de bolsa', () => {
    renderTable();
    expect(screen.getAllByRole('button', { name: 'Estornar baixa' })).toHaveLength(1);
  });

  it('confirmar chama o RPC com a escola e a mensalidade e atualiza a lista', async () => {
    rpc.mockResolvedValue({ data: { id: 't-paga' }, error: null });
    const onRefresh = vi.fn();
    renderTable(onRefresh);
    fireEvent.click(screen.getByRole('button', { name: 'Estornar baixa' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Realizado de novembro de 2026/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Estornar baixa' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('reverse_tuition_payment', { p_school_id: 'escola-1', p_tuition_id: 't-paga' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('erro do servidor vira mensagem amigável e não atualiza', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'NOT_PAID', code: '22023' } });
    const onRefresh = vi.fn();
    renderTable(onRefresh);
    fireEvent.click(screen.getByRole('button', { name: 'Estornar baixa' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Estornar baixa' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: expect.stringMatching(/não está paga/i) })));
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
