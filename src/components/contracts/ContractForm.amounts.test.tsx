// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

const rpc = vi.fn();
const updates: Record<string, unknown>[] = [];
const toast = vi.fn();
vi.mock('@/integrations/supabase/client', () => {
  const chain = (result: unknown) => {
    const c: any = {
      select: () => c, eq: () => c, order: () => c,
      update: (p: Record<string, unknown>) => { updates.push(p); return c; },
      insert: () => c, single: () => c,
      then: (res: (v: unknown) => unknown) => res(result),
    };
    return c;
  };
  return { supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => chain({ data: [], error: null }) } };
});
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 'escola-1' }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/generateTuitions', () => ({ generateTuitions: vi.fn().mockResolvedValue({ inserted: 0 }) }));

import { ContractForm } from './ContractForm';

const contract = {
  id: 'k1', student_id: 's1', class_id: null, period: 'meio_periodo', start_date: '2031-01-01', end_date: '2031-12-31',
  monthly_amount: 1000, discount: 0, due_day: 10, status: 'cancelled',
};
const preview = {
  dry_run: true, old_final: 1000, new_final: 1100, changed: true, upcoming: 3, overdue: 2, to_scholarship: 0,
  reopened_upcoming: 0, reopened_overdue: 0, updated: 5, unchanged: { adjusted: 1, renegotiated: 0, paid: 2, cancelled: 0 },
};

beforeEach(() => { rpc.mockReset(); toast.mockReset(); updates.length = 0; });
afterEach(() => cleanup());

const setMonthly = (value: string) => {
  fireEvent.change(document.getElementById('monthly_amount') as HTMLInputElement, { target: { value } });
};

describe('ContractForm: editar valor propaga para as mensalidades (bloco B)', () => {
  it('mudar o valor mostra o aviso do dry-run e só grava depois de confirmar (RPC real + demais campos sem valor/desconto)', async () => {
    rpc.mockResolvedValueOnce({ data: preview, error: null }).mockResolvedValueOnce({ data: { ...preview, dry_run: false }, error: null });
    render(<ContractForm contract={contract} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    setMonthly('1100');
    fireEvent.click(screen.getByRole('button', { name: /Atualizar Contrato/ }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/3 a vencer e 2 vencidas serão atualizadas/)).toBeTruthy();
    expect(within(dialog).getByText(/1 ajustada manualmente, 2 pagas/)).toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith('update_contract_amounts', { p_school_id: 'escola-1', p_contract_id: 'k1', p_monthly_amount: 1100, p_discount: 0, p_dry_run: true });
    expect(updates).toHaveLength(0); // nada gravado antes da confirmação

    fireEvent.click(within(dialog).getByRole('button', { name: 'Atualizar contrato e mensalidades' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc).toHaveBeenLastCalledWith('update_contract_amounts', { p_school_id: 'escola-1', p_contract_id: 'k1', p_monthly_amount: 1100, p_discount: 0, p_dry_run: false });
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).not.toHaveProperty('monthly_amount');
    expect(updates[0]).not.toHaveProperty('discount');
  });

  it('cancelar o aviso não grava nada', async () => {
    rpc.mockResolvedValueOnce({ data: preview, error: null });
    render(<ContractForm contract={contract} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    setMonthly('1100');
    fireEvent.click(screen.getByRole('button', { name: /Atualizar Contrato/ }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(0);
  });

  it('sem mudar valor nem desconto não chama o RPC de valor (só o update dos outros campos)', async () => {
    render(<ContractForm contract={contract} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Atualizar Contrato/ }));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(rpc).not.toHaveBeenCalled();
  });
});
