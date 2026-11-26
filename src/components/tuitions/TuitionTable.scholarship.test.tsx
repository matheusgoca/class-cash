// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 'escola-1' }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { TuitionTable } from './TuitionTable';

const base = { due_date: '2026-11-10', student_id: 's', contract_id: 'k', discount_applied: 0, penalty_amount: 0, renegotiation_id: null, contracts: null };
const rows = [
  { ...base, id: 'a', students: { full_name: 'Ana Paga' }, description: 'Mensalidade A', amount: 1000, final_amount: 1000, status: 'paid' as const, paid_date: '2026-11-08', payment_method: 'PIX' },
  { ...base, id: 'b', students: { full_name: 'Bia Bolsista' }, description: 'Mensalidade B', amount: 0, final_amount: 0, status: 'paid' as const, paid_date: '2026-11-10', payment_method: 'bolsa' },
];

afterEach(() => cleanup());

const renderTable = (initialStatus = 'all') =>
  render(<TuitionTable data={rows as never} loading={false} onEdit={vi.fn()} onRefresh={vi.fn()} initialStatus={initialStatus} />);

describe('TuitionTable: bolsa 100% (bloco H)', () => {
  it('a bolsa mostra o selo "Bolsa 100%" (status e forma) e a paga comum continua "Pago"', () => {
    renderTable();
    expect(screen.getAllByText('Bolsa 100%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Pago')).toBeTruthy();
  });

  it('o filtro "Pago" não inclui a bolsa', () => {
    renderTable('paid');
    expect(screen.getByText('Ana Paga')).toBeTruthy();
    expect(screen.queryByText('Bia Bolsista')).toBeNull();
  });

  it('o filtro "Bolsa 100%" mostra só a bolsa', () => {
    renderTable('scholarship');
    expect(screen.getByText('Bia Bolsista')).toBeTruthy();
    expect(screen.queryByText('Ana Paga')).toBeNull();
  });

  it('bolsa não tem ação de baixa nem de estorno', () => {
    renderTable('scholarship');
    expect(screen.queryByRole('button', { name: 'Estornar baixa' })).toBeNull();
  });
});
