import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

import { friendlyRenewalError, renewContracts, setRenewalDecision } from './renewalApi';
import type { RpcItem } from './renewal';

const item = (i: number): RpcItem => ({
  source_contract_id: `k${i}`, class_id: null, monthly_amount: 100, start_date: '2031-03-01', end_date: '2032-02-29',
  tuitions: [{ due_date: '2031-03-05', amount: 90, status: 'pending', description: 'Mensalidade março de 2031' }],
});
const items = (n: number) => Array.from({ length: n }, (_, i) => item(i));

beforeEach(() => rpc.mockReset());

describe('friendlyRenewalError', () => {
  it('traduz os códigos dos RPCs', () => {
    expect(friendlyRenewalError({ message: 'REASON_REQUIRED' })).toMatch(/motivo/i);
    expect(friendlyRenewalError({ message: 'NOT_ALLOWED' })).toMatch(/perfil/i);
    expect(friendlyRenewalError({ message: 'INVALID_CONTRACT' })).toMatch(/renovado|inativo|encontrado/i);
    expect(friendlyRenewalError({ message: 'INVALID_SERVICE' })).toMatch(/taxa/i);
    expect(friendlyRenewalError({ message: 'MFA_REQUIRED' })).toMatch(/2FA|duas etapas/i);
  });
  it('INVALID_ITEM inclui o detalhe do servidor', () => {
    expect(friendlyRenewalError({ message: 'INVALID_ITEM', details: 'Contrato abc: valor mensal inválido.' })).toContain('Contrato abc: valor mensal inválido.');
  });
  it('erro desconhecido cai numa mensagem genérica', () => {
    expect(friendlyRenewalError({ message: 'algo estranho' })).toBeTruthy();
  });
});

describe('setRenewalDecision', () => {
  it('chama o RPC com os parâmetros certos (motivo/observação nulos viram undefined)', async () => {
    rpc.mockResolvedValue({ error: null });
    await setRenewalDecision('k1', 'will_renew');
    expect(rpc).toHaveBeenCalledWith('set_renewal_decision', { p_contract_id: 'k1', p_status: 'will_renew', p_reason: undefined, p_note: undefined });
    await setRenewalDecision('k2', 'will_not_renew', 'price', 'caro');
    expect(rpc).toHaveBeenLastCalledWith('set_renewal_decision', { p_contract_id: 'k2', p_status: 'will_not_renew', p_reason: 'price', p_note: 'caro' });
  });
  it('erro do servidor vira Error com mensagem amigável', async () => {
    rpc.mockResolvedValue({ error: { message: 'REASON_REQUIRED' } });
    await expect(setRenewalDecision('k1', 'will_not_renew')).rejects.toThrow(/motivo/i);
  });
});

describe('renewContracts', () => {
  it('divide em lotes de 100 e soma os resultados', async () => {
    rpc.mockResolvedValueOnce({ data: { renewed: 100, tuitions: 100, skipped: [] }, error: null })
       .mockResolvedValueOnce({ data: { renewed: 99, tuitions: 99, skipped: [{ source_contract_id: 'k150', reason: 'ALREADY_RENEWED' }] }, error: null })
       .mockResolvedValueOnce({ data: { renewed: 50, tuitions: 50, skipped: [] }, error: null });
    const r = await renewContracts('s1', items(250), 'svc1');
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls.map((c) => (c[1].p_items as unknown[]).length)).toEqual([100, 100, 50]);
    expect(rpc.mock.calls[0][0]).toBe('renew_contracts');
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_school_id: 's1', p_fee_service_id: 'svc1' });
    expect(r).toMatchObject({ renewed: 249, tuitions: 249, processed: 250, total: 250, error: null });
    expect(r.skipped).toEqual([{ source_contract_id: 'k150', reason: 'ALREADY_RENEWED' }]);
  });
  it('sem taxa envia p_fee_service_id undefined', async () => {
    rpc.mockResolvedValue({ data: { renewed: 1, tuitions: 1, skipped: [] }, error: null });
    await renewContracts('s1', items(1), null);
    expect(rpc.mock.calls[0][1].p_fee_service_id).toBeUndefined();
  });
  it('para no primeiro erro e devolve o que já foi renovado', async () => {
    rpc.mockResolvedValueOnce({ data: { renewed: 100, tuitions: 100, skipped: [] }, error: null })
       .mockResolvedValueOnce({ data: null, error: { message: 'INVALID_ITEM', details: 'Contrato k130: mensalidade fora do período do contrato.' } });
    const r = await renewContracts('s1', items(250), null);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ renewed: 100, tuitions: 100, processed: 100, total: 250 });
    expect(r.error).toContain('Contrato k130');
  });
});

describe('renewContracts - falha parcial inesperada', () => {
  it('2º lote com data nulo e sem erro devolve o parcial com erro', async () => {
    rpc.mockResolvedValueOnce({ data: { renewed: 100, tuitions: 100, skipped: [] }, error: null })
       .mockResolvedValueOnce({ data: null, error: null });
    const r = await renewContracts('s1', items(250), null);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ renewed: 100, tuitions: 100, processed: 100, total: 250 });
    expect(r.error).toBeTruthy();
  });
  it('2º lote que lança devolve o parcial com erro', async () => {
    rpc.mockResolvedValueOnce({ data: { renewed: 100, tuitions: 100, skipped: [] }, error: null })
       .mockRejectedValueOnce(new Error('network down'));
    const r = await renewContracts('s1', items(250), null);
    expect(r).toMatchObject({ renewed: 100, tuitions: 100, processed: 100, total: 250 });
    expect(r.error).toBeTruthy();
  });
});
