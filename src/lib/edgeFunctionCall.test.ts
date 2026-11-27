import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  callEdgeFunction, callInviteFunction, EDGE_TIMEOUT_MS,
  INVITE_NETWORK_MESSAGE, INVITE_TIMEOUT_MESSAGE, GENERIC_NETWORK_MESSAGE,
} from './edgeFunctionCall';

const base = { baseUrl: 'https://proj.supabase.co', apiKey: 'chave-publica' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('callEdgeFunction', () => {
  it('o prazo padrão é de 30 s', () => {
    expect(EDGE_TIMEOUT_MS).toBe(30_000);
  });

  it('POST na função certa, com Bearer, apikey, JSON e sinal de cancelamento', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ success: true }));
    const r = await callEdgeFunction('invite-user', { a: 1 }, 'tok', { ...base, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/invite-user');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', apikey: 'chave-publica', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ a: 1 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(r).toMatchObject({ ok: true, status: 200, code: null, data: { success: true } });
  });

  it('erro da função: usa o código estável e a mensagem do corpo (message antes de error)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ error: 'user_exists', message: 'Este usuário já possui conta.' }, 409))
      .mockResolvedValueOnce(json({ error: 'invite_timeout', message: 'O serviço de e-mail não respondeu a tempo.' }, 504))
      .mockResolvedValueOnce(json({ error: 'Role inválida' }, 400));
    expect(await callEdgeFunction('x', {}, 't', { ...base, fetchImpl })).toMatchObject({ ok: false, status: 409, code: 'user_exists', message: 'Este usuário já possui conta.' });
    expect(await callEdgeFunction('x', {}, 't', { ...base, fetchImpl })).toMatchObject({ ok: false, status: 504, code: 'invite_timeout', message: 'O serviço de e-mail não respondeu a tempo.' });
    expect(await callEdgeFunction('x', {}, 't', { ...base, fetchImpl })).toMatchObject({ ok: false, status: 400, code: 'Role inválida', message: 'Role inválida' });
  });

  it('corpo que não é JSON (ex.: 502 do gateway) não quebra: mensagem padrão com o status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    const r = await callEdgeFunction('x', {}, 't', { ...base, fetchImpl });
    expect(r).toMatchObject({ ok: false, status: 502, code: null });
    expect(r.message).toContain('502');
  });

  it('CORS bloqueado / sem rede (TypeError "Failed to fetch"): NÃO lança e devolve a mensagem de convite em português', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const r = await callInviteFunction('invite-user', {}, 't', { ...base, fetchImpl });
    expect(r).toEqual({ ok: false, status: 0, code: 'network', message: INVITE_NETWORK_MESSAGE, data: {} });
    expect(INVITE_NETWORK_MESSAGE).toBe('Não foi possível enviar o convite. Verifique se você está em app.classcash.com.br e tente novamente.');
  });

  it('função que nunca responde: aborta no prazo e devolve a mensagem de timeout (a tela não fica parada)', async () => {
    const hang = (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))));
    const t0 = Date.now();
    const r = await callInviteFunction('invite-school-owner', {}, 't', { ...base, fetchImpl: hang as never, timeoutMs: 30 });
    expect(r).toMatchObject({ ok: false, status: 0, code: 'timeout', message: INVITE_TIMEOUT_MESSAGE });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('chamadas que não são de convite usam a mensagem genérica', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await callEdgeFunction('remove-user', {}, 't', { ...base, fetchImpl })).message).toBe(GENERIC_NETWORK_MESSAGE);
  });
});

describe('quem chama as funções de convite usa o caminho com timeout', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf-8');

  it('Team.tsx e MasterAdmin.tsx: sem fetch cru nem functions.invoke para convite/remoção; usam o auxiliar', () => {
    const team = src('src/pages/Team.tsx');
    const master = src('src/pages/MasterAdmin.tsx');
    expect(team).not.toMatch(/\bfetch\(/);
    expect((team.match(/callInviteFunction\(\s*"invite-user"/g) ?? []).length).toBe(2); // convidar e reenviar
    expect(team).toMatch(/callEdgeFunction\(\s*"remove-user"/);
    expect(master).not.toContain("functions.invoke('invite-school-owner'");
    expect((master.match(/callInviteFunction\(\s*'invite-school-owner'/g) ?? []).length).toBe(2);
  });

  it('Team.tsx: setSubmitting(false) e setResending(null) ficam em finally (nunca presos em "Enviando")', () => {
    const team = src('src/pages/Team.tsx').replace(/\r\n/g, '\n');
    const invite = team.slice(team.indexOf('const handleInvite'), team.indexOf('// ── Reenviar convite'));
    expect(invite).toMatch(/finally \{\s*setSubmitting\(false\);\s*\}/);
    const resend = team.slice(team.indexOf('const handleResend'), team.indexOf('// ── Editar role'));
    expect(resend).toMatch(/finally \{[\s\S]*setResending\(null\);\s*\}/);
    const remove = team.slice(team.indexOf('const handleRemove'), team.indexOf('const fmt ='));
    expect(remove).toMatch(/finally \{\s*setSubmitting\(false\);\s*\}/);
  });
});
