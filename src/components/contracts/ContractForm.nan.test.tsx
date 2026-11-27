// @vitest-environment jsdom
// "Novo Contrato": com valor ou desconto vazio/inválido, o valor final nunca mostra "NaN".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/integrations/supabase/client', () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = { select: () => c, eq: () => c, order: () => c, single: () => c, then: (res: (v: unknown) => unknown) => res({ data: [], error: null }) };
    return c;
  };
  return { supabase: { rpc: vi.fn(), from: () => chain() } };
});
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 'escola-1' }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ContractForm } from './ContractForm';

afterEach(() => cleanup());

const set = (id: string, value: string) =>
  fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value } });

describe('ContractForm: valor final sem NaN', () => {
  it('campo de valor vazio: mostra R$ 0,00', () => {
    render(<ContractForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(document.body.textContent).not.toMatch(/NaN/);
    set('monthly_amount', '1000');
    expect(document.body.textContent).toMatch(/R\$\s1\.000,00/);
    set('monthly_amount', '');
    expect(document.body.textContent).not.toMatch(/NaN/);
    expect(screen.getByText('Valor final da mensalidade').parentElement?.parentElement?.textContent).toMatch(/R\$\s0,00/);
  });

  it('desconto vazio ou inválido: sem NaN', () => {
    render(<ContractForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    set('monthly_amount', '500');
    set('discount', '');
    expect(document.body.textContent).not.toMatch(/NaN/);
    set('discount', 'abc');
    expect(document.body.textContent).not.toMatch(/NaN/);
    set('discount', '10');
    expect(document.body.textContent).toMatch(/R\$\s450,00/);
  });
});
