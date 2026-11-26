// supabase/functions/send-notification-emails/handler.test.ts
// Autenticação por segredo dedicado (x-job-secret), modo saúde e ordem das travas: tudo sem rede (dependências injetadas).
import { describe, it, expect, vi } from 'vitest';
import { handleRequest, type HandlerDeps } from './handler.ts';

const SECRET = 'a'.repeat(32) + 'b'.repeat(32); // 64 caracteres, como o hex gerado pelo PM

type Env = Record<string, string | undefined>;

function makeDeps(env: Env = {}, rpc: (name: string, args: unknown) => unknown = () => ({ data: [], error: null })) {
  const rpcSpy = vi.fn(async (name: string, args: unknown) => rpc(name, args) as { data: unknown; error: unknown });
  const createClient = vi.fn(() => ({ rpc: rpcSpy }));
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 're_1' }), { status: 200 }));
  const deps: HandlerDeps = {
    env: (n) => env[n],
    createClient,
    fetch: fetchSpy as unknown as typeof fetch,
    sleep: async () => {},
  };
  return { deps, rpcSpy, createClient, fetchSpy };
}

const req = (headers: Record<string, string> = {}, method = 'POST') =>
  new Request('https://exemplo.invalid/functions/v1/send-notification-emails', { method, headers, body: method === 'GET' ? undefined : '{}' });

const ENV_OK: Env = { EMAIL_JOB_SECRET: SECRET, SUPABASE_URL: 'https://x.invalid', SUPABASE_SERVICE_ROLE_KEY: 'chave-interna' };

describe('autenticação por x-job-secret (falha fechada)', () => {
  it('sem EMAIL_JOB_SECRET configurado: 401, mesmo com cabeçalho', async () => {
    const { deps, createClient } = makeDeps({ SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    const res = await handleRequest(req({ 'x-job-secret': SECRET }), deps);
    expect(res.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('cabeçalho ausente: 401', async () => {
    const { deps, createClient, fetchSpy } = makeDeps(ENV_OK);
    const res = await handleRequest(req(), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Não autorizado' });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('segredo errado: 401 igual ao de ausente (sem pista)', async () => {
    const { deps } = makeDeps(ENV_OK);
    const res = await handleRequest(req({ 'x-job-secret': 'c'.repeat(64) }), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Não autorizado' });
  });

  it('segredo configurado curto (menos de 32 caracteres): 401 mesmo se o cabeçalho for idêntico', async () => {
    const curto = 'abc123';
    const { deps } = makeDeps({ ...ENV_OK, EMAIL_JOB_SECRET: curto });
    const res = await handleRequest(req({ 'x-job-secret': curto }), deps);
    expect(res.status).toBe(401);
  });

  it('o Authorization (inclusive a chave de serviço) deixa de ser aceito', async () => {
    const { deps } = makeDeps(ENV_OK);
    const res = await handleRequest(req({ Authorization: 'Bearer chave-interna' }), deps);
    expect(res.status).toBe(401);
    const res2 = await handleRequest(req({ Authorization: `Bearer ${SECRET}` }), deps);
    expect(res2.status).toBe(401);
  });

  it('método diferente de POST: 401', async () => {
    const { deps } = makeDeps(ENV_OK);
    const res = await handleRequest(req({ 'x-job-secret': SECRET }, 'GET'), deps);
    expect(res.status).toBe(401);
  });

  it('espaço ou quebra de linha nas pontas do cabeçalho não atrapalham (o valor é hex)', async () => {
    const { deps } = makeDeps(ENV_OK);
    const res = await handleRequest(req({ 'x-job-secret': ` ${SECRET}\n` }), deps);
    expect(res.status).toBe(200);
  });
});

describe('segredo certo, envio global desligado', () => {
  it.each([undefined, '', 'false', 'TRUE', '1'])('EMAIL_SENDING_ENABLED=%s: responde "desligado" sem criar cliente e sem enviar', async (v) => {
    const { deps, createClient, fetchSpy, rpcSpy } = makeDeps({ ...ENV_OK, EMAIL_SENDING_ENABLED: v });
    const res = await handleRequest(req({ 'x-job-secret': SECRET }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: 'disabled' });
    expect(createClient).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ligado mas sem RESEND_API_KEY/EMAIL_FROM: 500 e não reivindica nada', async () => {
    const { deps, rpcSpy } = makeDeps({ ...ENV_OK, EMAIL_SENDING_ENABLED: 'true' });
    const res = await handleRequest(req({ 'x-job-secret': SECRET }), deps);
    expect(res.status).toBe(500);
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe('modo saúde (x-job-mode: health)', () => {
  const health = { 'x-job-secret': SECRET, 'x-job-mode': 'health' };

  it('chama só email_may_send com um UUID aleatório e responde ok (cliente interno funcionando)', async () => {
    const { deps, rpcSpy, fetchSpy } = makeDeps(ENV_OK, () => ({ data: false, error: null }));
    const res = await handleRequest(req(health), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ health: 'ok' });
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [name, args] = rpcSpy.mock.calls[0] as [string, { p_outbox_id: string }];
    expect(name).toBe('email_may_send');
    expect(args.p_outbox_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('funciona com o envio global DESLIGADO (roda antes do portão)', async () => {
    const { deps } = makeDeps({ ...ENV_OK, EMAIL_SENDING_ENABLED: 'false' }, () => ({ data: false, error: null }));
    expect((await handleRequest(req(health), deps)).status).toBe(200);
  });

  it('erro do RPC (cliente interno com chave inválida): 500 "falha", sem vazar a mensagem', async () => {
    const { deps } = makeDeps(ENV_OK, () => ({ data: null, error: { code: 'PGRST301', message: 'Invalid API key segredo-aqui' } }));
    const res = await handleRequest(req(health), deps);
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('falha');
    expect(body).not.toContain('segredo-aqui');
  });

  it('resposta inesperada do RPC (true em vez de false) também é falha', async () => {
    const { deps } = makeDeps(ENV_OK, () => ({ data: true, error: null }));
    expect((await handleRequest(req(health), deps)).status).toBe(500);
  });

  it('sem variáveis do cliente interno: 500 "falha"', async () => {
    const { deps } = makeDeps({ EMAIL_JOB_SECRET: SECRET });
    expect((await handleRequest(req(health), deps)).status).toBe(500);
  });

  it('só com o segredo correto: modo saúde com segredo errado é 401 e não toca o banco', async () => {
    const { deps, createClient } = makeDeps(ENV_OK);
    const res = await handleRequest(req({ 'x-job-secret': 'd'.repeat(64), 'x-job-mode': 'health' }), deps);
    expect(res.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('fluxo de envio (travas preservadas)', () => {
  const ENV_ON: Env = { ...ENV_OK, EMAIL_SENDING_ENABLED: 'true', RESEND_API_KEY: 're_key', EMAIL_FROM: 'Class Cash <avisos@exemplo.invalid>', EMAIL_ALLOWLIST: 'pm@exemplo.invalid' };
  const item = (id: string) => ({ outbox_id: id, to_email: 'pm@exemplo.invalid', school_name: 'Escola', event: 'tuition_overdue', reference_date: '2031-03-10', offset_days: 5, item_count: 3, total_amount: 100, details: { class_count: 1 } });

  it('passa a allowlist ao claim, confere email_may_send por item e só envia e marca o que pode sair', async () => {
    const calls: string[] = [];
    const { deps, fetchSpy, rpcSpy } = makeDeps(ENV_ON, (name, args) => {
      calls.push(name);
      if (name === 'claim_notification_emails') return { data: [item('o1'), item('o2')], error: null };
      if (name === 'email_may_send') return { data: (args as { p_outbox_id: string }).p_outbox_id === 'o1', error: null };
      return { data: null, error: null };
    });
    const res = await handleRequest(req({ 'x-job-secret': SECRET }), deps);
    expect(await res.json()).toEqual({ claimed: 2, sent: 1, failed: 0, skipped: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const claim = rpcSpy.mock.calls.find((c) => c[0] === 'claim_notification_emails')![1] as { p_only_emails: string[] };
    expect(claim.p_only_emails).toEqual(['pm@exemplo.invalid']);
    const marks = rpcSpy.mock.calls.filter((c) => c[0] === 'mark_email_result').map((c) => (c[1] as { p_outbox_id: string; p_status: string }));
    expect(marks).toEqual([expect.objectContaining({ p_outbox_id: 'o1', p_status: 'sent' })]);
  });

  it('claim com erro: 500 e nada é enviado', async () => {
    const { deps, fetchSpy } = makeDeps(ENV_ON, (name) => (name === 'claim_notification_emails' ? { data: null, error: { message: 'x' } } : { data: null, error: null }));
    const res = await handleRequest(req({ 'x-job-secret': SECRET }), deps);
    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
