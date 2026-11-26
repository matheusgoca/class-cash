// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.fn();
const rpc = vi.fn();
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
  return { supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (t: string) => chain(t) } };
});
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 'escola-1' }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/generateTuitions', () => ({ generateTuitions: vi.fn().mockResolvedValue({ inserted: 0 }) }));

import { ContractForm } from './ContractForm';

const contract = {
  id: 'k1', student_id: 's1', class_id: null, period: 'meio_periodo', start_date: '2031-01-01', end_date: '2031-12-31',
  monthly_amount: 1000, discount: 0, due_day: 10, status: 'active',
};

beforeEach(() => { toast.mockReset(); rpc.mockReset(); calls.length = 0; overlapRows = []; });
afterEach(() => cleanup());

describe('ContractForm: sobreposição e validações (bloco C2)', () => {
  it('Renovar com outro contrato ativo do aluno no período do sucessor: barra, avisa o período e não cria nada', async () => {
    overlapRows = [{ id: 'k2', start_date: '2032-06-01', end_date: '2033-05-31' }];
    render(<ContractForm contract={contract} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Renovar' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'destructive', description: expect.stringContaining('01/06/2032 a 31/05/2033'),
    })));
    expect(calls).not.toContain('contracts.insert');
  });

  it('Renovar sem conflito segue (cria o sucessor)', async () => {
    overlapRows = [];
    render(<ContractForm contract={contract} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Renovar' }));
    await waitFor(() => expect(calls).toContain('contracts.insert'));
  });

  it('valor 0 é recusado com a mensagem da bolsa por desconto (e nada é gravado)', async () => {
    render(<ContractForm contract={contract} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(document.getElementById('monthly_amount') as HTMLInputElement, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Atualizar Contrato/ }));
    expect(await screen.findByText(/maior que zero \(para bolsa, use desconto de 100%\)/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    expect(calls).not.toContain('contracts.update');
  });

  it('vencimento fora de 1 a 28 é recusado', async () => {
    render(<ContractForm contract={contract} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(document.getElementById('due_day') as HTMLInputElement, { target: { value: '31' } });
    fireEvent.submit(document.querySelector('form') as HTMLFormElement); // o min/max do HTML barraria o clique; aqui vale o schema
    expect(await screen.findByText(/dia de vencimento deve ser de 1 a 28/)).toBeTruthy();
    expect(calls).not.toContain('contracts.update');
  });

  it('desconto acima de 100% é recusado', async () => {
    render(<ContractForm contract={contract} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(document.getElementById('discount') as HTMLInputElement, { target: { value: '120' } });
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    expect(await screen.findByText(/Desconto deve ser entre 0 e 100%/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
});
