// src/pages/Renewal.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { RenewalData } from '@/lib/renewalData';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), setDecision: vi.fn() }));
vi.mock('@/lib/renewalData', () => ({ fetchRenewalData: mocks.fetch }));
vi.mock('@/lib/renewalApi', async () => ({
  ...(await vi.importActual<typeof import('@/lib/renewalApi')>('@/lib/renewalApi')),
  setRenewalDecision: mocks.setDecision,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 's1', school: { id: 's1' } }) }));

import Renewal from './Renewal';

const contract = (id: string, name: string, o: Record<string, unknown> = {}) => ({
  id, student_id: `st-${id}`, student_name: name, class_id: 'c1', class_name: '5º A', start_date: '2030-03-01', end_date: '2031-02-28',
  monthly_amount: 100, discount: 10, due_day: 5, period: 'integral', ...o,
});
const data = (o: Partial<RenewalData> = {}): RenewalData => ({
  contracts: [contract('a', 'Ana'), contract('b', 'Bruno'), contract('c', 'Carla'), contract('d', 'Davi')] as never,
  renewedIds: new Set(['d']),
  decisions: {
    b: { contract_id: 'b', status: 'will_renew', reason: null, note: null },
    c: { contract_id: 'c', status: 'will_not_renew', reason: 'price', note: null },
  },
  classes: [{ id: 'c1', name: '5º A', max_capacity: 30 }],
  activeByClass: { c1: 4 },
  services: [],
  ...o,
});

const renderPage = () => render(<MemoryRouter><Renewal /></MemoryRouter>);

beforeEach(() => {
  // Radix Select/Dialog em jsdom
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  mocks.fetch.mockResolvedValue(data());
  mocks.setDecision.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Página de rematrícula', () => {
  it('lista os contratos da janela e o resumo por estado', async () => {
    renderPage();
    expect(await screen.findByText('Ana')).toBeTruthy();
    expect(screen.getByText('Bruno')).toBeTruthy();
    expect(screen.getByText('Carla')).toBeTruthy();
    expect(screen.getByText('Davi')).toBeTruthy();
    expect(mocks.fetch).toHaveBeenCalledWith('s1', 90);
    // resumo: 1 sem resposta (Ana), 1 vai renovar, 1 não vai, 1 renovado
    expect(screen.getByTestId('summary-none').textContent).toContain('1');
    expect(screen.getByTestId('summary-will_renew').textContent).toContain('1');
    expect(screen.getByTestId('summary-will_not_renew').textContent).toContain('1');
    expect(screen.getByTestId('summary-renewed').textContent).toContain('1');
  });

  it('"Renovado" é um selo de texto e a linha não é selecionável; "não vai renovar" também não', async () => {
    renderPage();
    await screen.findByText('Ana');
    const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
    expect(within(rowOf('Davi')).getByText('Renovado')).toBeTruthy();
    expect((within(rowOf('Davi')).getByRole('checkbox') as HTMLInputElement).disabled || within(rowOf('Davi')).getByRole('checkbox').getAttribute('data-disabled') !== null).toBe(true);
    expect(within(rowOf('Carla')).getByRole('checkbox').getAttribute('data-disabled') !== null || (within(rowOf('Carla')).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  });

  it('quem "vai renovar" já vem selecionado e o botão mostra a contagem', async () => {
    renderPage();
    await screen.findByText('Ana');
    expect(screen.getByRole('button', { name: /Renovar selecionados \(1\)/ })).toBeTruthy();
  });

  it('marcar outro contrato atualiza a contagem; "Selecionar todos que vão renovar" seleciona só os que vão', async () => {
    renderPage();
    await screen.findByText('Ana');
    await userEvent.click(within(screen.getByText('Ana').closest('tr') as HTMLElement).getByRole('checkbox'));
    expect(screen.getByRole('button', { name: /Renovar selecionados \(2\)/ })).toBeTruthy();
  });

  it('filtra por estado e por busca', async () => {
    renderPage();
    await screen.findByText('Ana');
    await userEvent.type(screen.getByPlaceholderText('Buscar aluno...'), 'bru');
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.getByText('Bruno')).toBeTruthy();
  });

  it('estado vazio e erro com "Tentar de novo"', async () => {
    mocks.fetch.mockResolvedValueOnce(data({ contracts: [] }));
    renderPage();
    expect(await screen.findByText('Nenhum contrato termina nesta janela.')).toBeTruthy();
    cleanup();
    mocks.fetch.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Não foi possível carregar a rematrícula.')).toBeTruthy();
    mocks.fetch.mockResolvedValueOnce(data());
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Ana')).toBeTruthy();
  });

  it('mudar o estado de Ana para "Contatado" chama o RPC e recarrega', async () => {
    renderPage();
    await screen.findByText('Ana');
    const row = screen.getByText('Ana').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('combobox', { name: /Estado de Ana/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Contatado' }));
    await waitFor(() => expect(mocks.setDecision).toHaveBeenCalledWith('a', 'contacted'));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
  });

  it('"Não vai renovar" abre o diálogo e exige o motivo', async () => {
    renderPage();
    await screen.findByText('Ana');
    const row = screen.getByText('Ana').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('combobox', { name: /Estado de Ana/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Não vai renovar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Motivo' })).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.setDecision).not.toHaveBeenCalled();
  });
});
