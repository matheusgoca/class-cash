// src/components/renewal/BatchRenewalDialog.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ renew: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@/lib/renewalApi', async () => ({
  ...(await vi.importActual<typeof import('@/lib/renewalApi')>('@/lib/renewalApi')),
  renewContracts: mocks.renew,
}));

import { BatchRenewalDialog } from './BatchRenewalDialog';
import type { RenewalContract } from '@/lib/renewal';

const c = (id: string, name: string, o: Partial<RenewalContract> = {}): RenewalContract => ({
  id, student_id: `st-${id}`, student_name: name, class_id: 'c1', class_name: '5º A', start_date: '2030-03-01',
  end_date: '2031-02-28', monthly_amount: 100, discount: 10, due_day: 5, period: 'integral', ...o,
});
const props = (o: Record<string, unknown> = {}) => ({
  open: true, onOpenChange: vi.fn(), sources: [c('a', 'Ana'), c('b', 'Bruno', { monthly_amount: 200, discount: 0 })],
  classes: [{ id: 'c1', name: '5º A', max_capacity: 30 }, { id: 'c2', name: '6º A', max_capacity: 1 }],
  activeByClass: { c1: 2, c2: 1 }, services: [{ id: 'svc1', name: 'Taxa de rematrícula', price: 150 }],
  schoolId: 's1', onDone: vi.fn(), ...o,
});

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('BatchRenewalDialog', () => {
  it('configuração: reajuste, taxa e uma linha de mapa por turma de origem presente', async () => {
    render(<BatchRenewalDialog {...props()} />);
    expect(await screen.findByLabelText('Reajuste (%)')).toBeTruthy();
    expect(screen.getAllByText('5º A').length).toBeGreaterThan(0); // turma de origem da seleção (rótulo e valor do seletor)
    expect(screen.queryByText('6º A')).toBeNull();   // turma que não está na seleção não aparece no mapa
  });

  it('prévia: aplica o % (10%), mostra totais e o período novo', async () => {
    render(<BatchRenewalDialog {...props()} />);
    const pct = await screen.findByLabelText('Reajuste (%)');
    await userEvent.clear(pct);
    await userEvent.type(pct, '10');
    await userEvent.click(screen.getByRole('button', { name: 'Ver prévia' }));
    const ana = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
    const bruno = screen.getByText('Bruno').closest('tr') as HTMLElement;
    expect(within(ana).getByDisplayValue('110,00')).toBeTruthy();   // 100 + 10%
    expect(within(bruno).getByDisplayValue('220,00')).toBeTruthy(); // 200 + 10%
    expect(within(ana).getByText(/01\/03\/2031/)).toBeTruthy();
    expect(screen.getByText(/2 contratos · 24 mensalidades/)).toBeTruthy(); // linha de totais (única)
    expect(screen.getByRole('button', { name: 'Renovar 2 contratos' })).toBeTruthy();
  });

  it('valor editado na linha não é recalculado ao voltar e mudar o %', async () => {
    render(<BatchRenewalDialog {...props()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver prévia' }));
    const ana = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
    const input = within(ana).getByDisplayValue('100,00');
    await userEvent.clear(input);
    await userEvent.type(input, '15000'); // calculadora: 150,00
    expect(within(ana).getByDisplayValue('150,00')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    const pct = await screen.findByLabelText('Reajuste (%)');
    await userEvent.clear(pct);
    await userEvent.type(pct, '20');
    await userEvent.click(screen.getByRole('button', { name: 'Ver prévia' }));
    const ana2 = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
    expect(within(ana2).getByDisplayValue('150,00')).toBeTruthy();                                   // editada: mantém
    expect(within(screen.getByText('Bruno').closest('tr') as HTMLElement).getByDisplayValue('240,00')).toBeTruthy(); // não editada: recalcula
  });

  it('valor zero numa linha bloqueia a confirmação', async () => {
    render(<BatchRenewalDialog {...props()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver prévia' }));
    const ana = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
    await userEvent.clear(within(ana).getByDisplayValue('100,00'));
    expect((screen.getByRole('button', { name: /Renovar/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(ana).getByText(/valor inválido/i)).toBeTruthy();
  });

  it('confirmar envia os itens ao RPC com a taxa e mostra o resultado; fechar recarrega a lista', async () => {
    mocks.renew.mockResolvedValue({ renewed: 2, tuitions: 24, skipped: [], processed: 2, total: 2, error: null });
    const p = props();
    render(<BatchRenewalDialog {...p} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver prévia' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Renovar 2 contratos' }));
    await waitFor(() => expect(mocks.renew).toHaveBeenCalledTimes(1));
    const [schoolId, items, fee] = mocks.renew.mock.calls[0];
    expect(schoolId).toBe('s1');
    expect(fee).toBeNull();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ source_contract_id: 'a', class_id: 'c1', monthly_amount: 100, start_date: '2031-03-01', end_date: '2032-02-29' });
    expect(items[0].tuitions).toHaveLength(12);
    expect(await screen.findByText(/2 contratos renovados/)).toBeTruthy();
    expect(screen.getByText(/24 mensalidades criadas/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(p.onDone).toHaveBeenCalled();
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('resultado com pulados e com erro parcial', async () => {
    mocks.renew.mockResolvedValue({ renewed: 1, tuitions: 12, skipped: [{ source_contract_id: 'b', reason: 'ALREADY_RENEWED' }], processed: 1, total: 2, error: 'Um contrato do lote foi recusado pelo servidor: x' });
    render(<BatchRenewalDialog {...props()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver prévia' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Renovar 2 contratos' }));
    expect(await screen.findByText(/1 contrato já estava renovado/)).toBeTruthy();
    expect(screen.getByText(/Foram renovados 1 de 2 antes do erro/)).toBeTruthy();
    expect(screen.getByText(/recusado pelo servidor/)).toBeTruthy();
  });

  it('aviso de capacidade quando a turma de destino estoura (não bloqueia)', async () => {
    // c2 tem capacidade 1 e já 1 ativo: levar 2 alunos de c1 para c2 estoura
    render(<BatchRenewalDialog {...props()} />);
    const map = await screen.findByRole('combobox', { name: /Vai para: 5º A/ });
    await userEvent.click(map);
    await userEvent.click(await screen.findByRole('option', { name: '6º A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ver prévia' }));
    expect(await screen.findByText(/6º A/, { selector: '[role="alert"] *' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Renovar 2 contratos' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
