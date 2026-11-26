// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toast = vi.fn();
const calls: string[] = [];
let overlapRows: unknown[] = [];
vi.mock('@/integrations/supabase/client', () => {
  const chain = (table: string) => {
    const c: any = new Proxy({}, { get: (_t, prop: string) => {
      if (prop === 'then') return (res: (v: unknown) => unknown) => res({ data: table === 'contracts' ? overlapRows : [], error: null });
      return (..._a: unknown[]) => { calls.push(`${table}.${prop}`); return c; };
    } });
    return c;
  };
  return { supabase: { rpc: vi.fn(), from: (t: string) => chain(t) } };
});
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 'escola-1' }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

import { ContractTable } from './ContractTable';

const suspenso = {
  id: 'k1', student_id: 's1', class_id: null, start_date: '2031-01-01', end_date: '2031-12-31', monthly_amount: 1000, discount: 0,
  status: 'suspended' as const, created_at: '', updated_at: '', students: { full_name: 'Ana' }, classes: null,
};

beforeEach(() => { toast.mockReset(); calls.length = 0; overlapRows = []; });
afterEach(() => cleanup());

const reativar = async () => {
  const user = userEvent.setup();
  render(<ContractTable data={[suspenso] as never} loading={false} onEdit={vi.fn()} onRefresh={vi.fn()} />);
  const row = screen.getByText('Ana').closest('tr') as HTMLElement;
  const buttons = row.querySelectorAll('button');
  await user.click(buttons[buttons.length - 1] as HTMLElement);
  await user.click(await screen.findByText('Reativar'));
};

describe('ContractTable: reativar revalida a sobreposição (bloco C2)', () => {
  it('com outro contrato ativo do aluno no período: não reativa e avisa o período', async () => {
    overlapRows = [{ id: 'k2', start_date: '2031-06-01', end_date: '2032-05-31' }];
    await reativar();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Não foi possível reativar', variant: 'destructive', description: expect.stringContaining('01/06/2031 a 31/05/2032'),
    })));
    expect(calls).not.toContain('contracts.update');
  });

  it('sem conflito: reativa', async () => {
    overlapRows = [];
    await reativar();
    await waitFor(() => expect(calls).toContain('contracts.update'));
  });
});
