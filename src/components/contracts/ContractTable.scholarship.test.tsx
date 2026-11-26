// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 'escola-1' }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ContractTable } from './ContractTable';

const c = (id: string, name: string, discount: number) => ({
  id, student_id: 's' + id, class_id: null, start_date: '2026-01-01', end_date: '2026-12-31', monthly_amount: 1000, discount,
  status: 'active' as const, created_at: '', updated_at: '', students: { full_name: name }, classes: null,
});

afterEach(() => cleanup());

describe('ContractTable: bolsa 100% (bloco H)', () => {
  it('contrato com desconto 100% mostra o selo "Bolsa 100%" e o valor de tabela preservado; o comum não', () => {
    render(<ContractTable data={[c('1', 'Ana Bolsista', 100), c('2', 'Bia Comum', 15)] as never} loading={false} onEdit={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getAllByText('Bolsa 100%')).toHaveLength(1);
    expect(screen.getAllByText(/R\$\s*1\.000,00/).length).toBeGreaterThanOrEqual(1);
  });
});
