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

  it('prévia: totais no singular com 1 contrato', async () => {
    render(<BatchRenewalDialog {...props({ sources: [c('a', 'Ana')] })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver prévia' }));
    expect(await screen.findByText(/1 contrato · 12 mensalidades/)).toBeTruthy();
    expect(screen.queryByText(/1 contratos/)).toBeNull();
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
    expect(screen.getByText(/1 contrato renovado antes do erro \(1 de 2 processados\)/)).toBeTruthy();
    expect(screen.getByText('Renovação interrompida')).toBeTruthy();
    expect(screen.queryByText(/0 contratos renovados/)).toBeNull();
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

describe('BatchRenewalDialog - payload e robustez', () => {
  const ok = { renewed: 2, tuitions: 24, skipped: [], processed: 2, total: 2, error: null };
  const preview = async (p = props()) => {
    render(<BatchRenewalDialog {...p} />);
    return p;
  };
  const toPreview = async () => userEvent.click(await screen.findByRole('button', { name: 'Ver prévia' }));
  const confirmBtn = async () => userEvent.click(await screen.findByRole('button', { name: 'Renovar 2 contratos' }));

  it('mensalidade = mensal x (1 - desconto) em centavos', async () => {
    mocks.renew.mockResolvedValue(ok);
    await preview(); await toPreview(); await confirmBtn();
    await waitFor(() => expect(mocks.renew).toHaveBeenCalled());
    const [, items] = mocks.renew.mock.calls[0];
    expect(items[0].tuitions[0].amount).toBe(90);  // 100 com 10% de desconto
    expect(items[1].tuitions[0].amount).toBe(200); // sem desconto
  });

  it('o reajuste de 10% chega uma vez ao payload', async () => {
    mocks.renew.mockResolvedValue(ok);
    await preview();
    const pct = await screen.findByLabelText('Reajuste (%)');
    await userEvent.clear(pct); await userEvent.type(pct, '10');
    await toPreview(); await confirmBtn();
    await waitFor(() => expect(mocks.renew).toHaveBeenCalled());
    const [, items] = mocks.renew.mock.calls[0];
    expect(items[0].monthly_amount).toBe(110);
    expect(items[0].tuitions[0].amount).toBe(99);
  });

  it('valor editado na prévia chega ao payload sem novo reajuste', async () => {
    mocks.renew.mockResolvedValue(ok);
    await preview();
    const pct = await screen.findByLabelText('Reajuste (%)');
    await userEvent.clear(pct); await userEvent.type(pct, '10');
    await toPreview();
    const ana = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
    const input = within(ana).getByDisplayValue('110,00');
    await userEvent.clear(input); await userEvent.type(input, '15000');
    await confirmBtn();
    await waitFor(() => expect(mocks.renew).toHaveBeenCalled());
    const [, items] = mocks.renew.mock.calls[0];
    expect(items[0].monthly_amount).toBe(150);
    expect(items[0].tuitions[0].amount).toBe(135);
  });

  it('"Sem turma" no mapa envia class_id null', async () => {
    mocks.renew.mockResolvedValue(ok);
    await preview();
    await userEvent.click(await screen.findByRole('combobox', { name: /Vai para: 5º A/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Sem turma' }));
    await toPreview(); await confirmBtn();
    await waitFor(() => expect(mocks.renew).toHaveBeenCalled());
    const [, items] = mocks.renew.mock.calls[0];
    expect(items.map((i: { class_id: unknown }) => i.class_id)).toEqual([null, null]);
  });

  it('"Sem turma" numa linha da prévia envia class_id null só para ela', async () => {
    mocks.renew.mockResolvedValue(ok);
    await preview(); await toPreview();
    await userEvent.click(await screen.findByRole('combobox', { name: /Turma de destino de Ana/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Sem turma' }));
    await confirmBtn();
    await waitFor(() => expect(mocks.renew).toHaveBeenCalled());
    const [, items] = mocks.renew.mock.calls[0];
    expect(items[0].class_id).toBeNull();
    expect(items[1].class_id).toBe('c1');
  });

  it('a taxa escolhida envia o id do serviço', async () => {
    mocks.renew.mockResolvedValue(ok);
    await preview();
    await userEvent.click(await screen.findByRole('combobox', { name: 'Taxa de rematrícula' }));
    await userEvent.click(await screen.findByRole('option', { name: /Taxa de rematrícula/ }));
    await toPreview(); await confirmBtn();
    await waitFor(() => expect(mocks.renew).toHaveBeenCalled());
    expect(mocks.renew.mock.calls[0][0]).toBe('s1');
    expect(mocks.renew.mock.calls[0][2]).toBe('svc1');
  });

  it('Escape durante a execução é ignorado e renova uma única vez', async () => {
    let resolve!: (v: unknown) => void;
    mocks.renew.mockReturnValue(new Promise((r) => { resolve = r; }));
    const p = await preview(); await toPreview(); await confirmBtn();
    expect(await screen.findByRole('status')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(p.onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(mocks.renew).toHaveBeenCalledTimes(1);
    resolve(ok);
    expect(await screen.findByText(/2 contratos renovados/)).toBeTruthy();
  });

  it('RPC que rejeita leva ao estado final com erro amigável e onDone ao fechar', async () => {
    mocks.renew.mockRejectedValue(new Error('boom'));
    const p = await preview(); await toPreview(); await confirmBtn();
    expect(await screen.findByText('Renovação interrompida')).toBeTruthy();
    expect(screen.getByText(/0 contratos renovados antes do erro \(0 de 2 processados\)/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(p.onDone).toHaveBeenCalled();
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('pulados no plural', async () => {
    mocks.renew.mockResolvedValue({ renewed: 0, tuitions: 0, skipped: [{ source_contract_id: 'a', reason: 'ALREADY_RENEWED' }, { source_contract_id: 'b', reason: 'ALREADY_RENEWED' }], processed: 2, total: 2, error: null });
    await preview(); await toPreview(); await confirmBtn();
    expect(await screen.findByText('2 contratos já estavam renovados e foram pulados.')).toBeTruthy();
  });
});
