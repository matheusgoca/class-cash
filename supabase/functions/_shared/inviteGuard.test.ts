// supabase/functions/_shared/inviteGuard.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  emailDomain, logRequest, makeReply, logInviteStart, logInviteResult, timeoutFetch,
  INVITE_TIMEOUT_MS, INVITE_TIMEOUT_CODE, INVITE_TIMEOUT_MESSAGE,
} from './inviteGuard.ts';

const ORIGINS = ['https://class-cash-tan.vercel.app', 'https://app.classcash.com.br'];
const logs = () => { const l: string[] = []; return { l, log: (s: string) => l.push(s) }; };

describe('emailDomain', () => {
  it('devolve só o domínio, em minúsculas', () => {
    expect(emailDomain('Fulano.Silva@Gmail.COM')).toBe('gmail.com');
    expect(emailDomain('a@b@escola.com.br')).toBe('escola.com.br');
  });
  it('entrada ruim não quebra nem vaza', () => {
    expect(emailDomain('semarroba')).toBe('invalido');
    expect(emailDomain('termina@')).toBe('invalido');
    expect(emailDomain(undefined)).toBe('desconhecido');
    expect(emailDomain(42)).toBe('desconhecido');
  });
});

describe('logRequest (chegada do POST)', () => {
  it('registra método e origem; nunca o token, o corpo nem o e-mail', () => {
    const { l, log } = logs();
    const req = new Request('https://x.supabase.co/functions/v1/invite-user', {
      method: 'POST',
      headers: { origin: 'https://classcash.com.br', authorization: 'Bearer SEGREDO-JWT', apikey: 'CHAVE-PUBLICA' },
      body: JSON.stringify({ email: 'pessoa@gmail.com' }),
    });
    logRequest('invite-user', req, ORIGINS, log);
    expect(l).toHaveLength(1);
    expect(JSON.parse(l[0])).toEqual({ fn: 'invite-user', evento: 'requisicao', metodo: 'POST', origin: 'https://classcash.com.br', origin_permitida: false });
    for (const proibido of ['SEGREDO-JWT', 'CHAVE-PUBLICA', 'pessoa', 'gmail']) expect(l[0]).not.toContain(proibido);
  });
  it('origem permitida é marcada como permitida; sem origin não quebra', () => {
    const { l, log } = logs();
    logRequest('f', new Request('https://x/f', { method: 'POST', headers: { origin: 'https://app.classcash.com.br' } }), ORIGINS, log);
    logRequest('f', new Request('https://x/f', { method: 'POST' }), ORIGINS, log);
    expect(JSON.parse(l[0]).origin_permitida).toBe(true);
    expect(JSON.parse(l[1])).toMatchObject({ origin: null, origin_permitida: false });
  });
});

describe('makeReply (todo caminho registra o status e leva o CORS)', () => {
  it('devolve o corpo, o status e os cabeçalhos de CORS, e registra o status', async () => {
    const { l, log } = logs();
    const cors = { 'Access-Control-Allow-Origin': 'https://app.classcash.com.br', Vary: 'Origin' };
    const reply = makeReply('invite-user', cors, log);
    for (const status of [200, 400, 401, 403, 409, 500, 504]) {
      const res = reply({ error: 'x', email: 'não deve ir pro log' }, status);
      expect(res.status).toBe(status);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.classcash.com.br');
      expect(res.headers.get('Vary')).toBe('Origin');
      expect(await res.json()).toMatchObject({ error: 'x' });
    }
    expect(l.map((s) => JSON.parse(s).status)).toEqual([200, 400, 401, 403, 409, 500, 504]);
    expect(l.join('')).not.toContain('não deve ir pro log');
  });
  it('sem status informado é 200', () => {
    const { l, log } = logs();
    expect(makeReply('f', {}, log)({ success: true }).status).toBe(200);
    expect(JSON.parse(l[0]).status).toBe(200);
  });
});

describe('log do convite (só o domínio do e-mail)', () => {
  it('início e resultado trazem domínio, status e duração, e nunca a parte local', () => {
    const { l, log } = logs();
    logInviteStart('invite-user', 'Maria.Souza@Escola.com.br', log);
    logInviteResult('invite-user', { email: 'Maria.Souza@Escola.com.br', ok: false, status: 429, ms: 1234, codigo: 'over_email_send_rate_limit' }, log);
    logInviteResult('invite-user', { email: 'a@b.com', ok: false, status: 504, ms: 20001, timeout: true }, log);
    expect(JSON.parse(l[0])).toEqual({ fn: 'invite-user', evento: 'invite_inicio', dominio: 'escola.com.br' });
    expect(JSON.parse(l[1])).toEqual({ fn: 'invite-user', evento: 'invite_resultado', ok: false, status: 429, ms: 1234, codigo: 'over_email_send_rate_limit', timeout: false, dominio: 'escola.com.br' });
    expect(JSON.parse(l[2])).toMatchObject({ status: 504, timeout: true, ms: 20001 });
    expect(l.join('')).not.toMatch(/maria|souza/i);
  });
});

describe('timeoutFetch (prazo de verdade: cancela a requisição)', () => {
  it('o prazo do convite é de 20 s e o 504 tem código estável', () => {
    expect(INVITE_TIMEOUT_MS).toBe(20_000);
    expect(INVITE_TIMEOUT_CODE).toBe('invite_timeout');
    expect(INVITE_TIMEOUT_MESSAGE).toMatch(/não respondeu a tempo/);
  });

  const hang = ((_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => init!.signal!.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))))) as typeof fetch;

  it('chamada que não responde: é abortada no prazo e timedOut() fica true', async () => {
    const g = timeoutFetch(30, hang);
    await expect(g.fetch('https://x/y')).rejects.toThrow();
    expect(g.timedOut()).toBe(true);
  });

  it('chamada rápida: resolve normalmente e timedOut() fica false (sem timer pendurado)', async () => {
    vi.useFakeTimers();
    const g = timeoutFetch(20_000, (async () => new Response('ok')) as typeof fetch);
    const res = await g.fetch('https://x/y');
    expect(await res.text()).toBe('ok');
    expect(g.timedOut()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('respeita um sinal de cancelamento que já vinha na chamada, sem marcar timeout', async () => {
    const outer = new AbortController();
    const g = timeoutFetch(5_000, hang);
    const p = g.fetch('https://x/y', { signal: outer.signal });
    outer.abort();
    await expect(p).rejects.toThrow();
    expect(g.timedOut()).toBe(false);
  });

  it('com o supabase-js de verdade: o Auth que não responde vira ERRO devolvido (não trava) e timedOut() é true', async () => {
    const g = timeoutFetch(40, hang);
    const client = createClient('https://proj.supabase.co', 'service-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: g.fetch },
    });
    const t0 = Date.now();
    const { error } = await client.auth.admin.inviteUserByEmail('alguem@exemplo.com');
    expect(error).toBeTruthy();
    expect(g.timedOut()).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('as duas funções de convite usam o guarda em todo caminho', () => {
  const src = (f: string) => readFileSync(resolve(__dirname, '..', f, 'index.ts'), 'utf-8').replace(/\r\n/g, '\n');
  for (const [fn, name] of [['invite-user', 'invite-user'], ['invite-school-owner', 'invite-school-owner']] as const) {
    it(`${fn}: loga a chegada antes de tudo, responde só por reply (CORS e status), prazo de 20 s e 504 estável`, () => {
      const s = src(fn);
      const body = s.slice(s.indexOf('serve(async (req) => {'));
      // 1ª instrução da função é o log da chegada, antes do CORS, do OPTIONS e do req.json()
      expect(body.indexOf(`logRequest("${name}", req, ALLOWED_ORIGINS)`)).toBeGreaterThan(0);
      expect(body.indexOf('logRequest(')).toBeLessThan(body.indexOf('buildCorsHeaders(req)'));
      expect(body.indexOf('logRequest(')).toBeLessThan(body.indexOf('req.json()'));
      // nenhuma resposta fora do reply (que carrega o CORS e registra o status)
      expect(s).not.toContain('Response.json(');
      expect((s.match(/return reply\(/g) ?? []).length).toBeGreaterThanOrEqual(8);
      // o convite roda num cliente com prazo e o 504 usa o código estável
      expect(s).toContain('timeoutFetch(INVITE_TIMEOUT_MS)');
      expect(s).toContain('global: { fetch: guard.fetch }');
      expect(s).toContain('inviteClient.auth.admin.inviteUserByEmail(');
      expect(s).toMatch(/if \(guard\.timedOut\(\)\) \{[\s\S]*reply\(\{ error: INVITE_TIMEOUT_CODE, message: INVITE_TIMEOUT_MESSAGE \}, 504\)/);
      // log do início e do resultado do convite
      expect(s).toContain(`logInviteStart("${name}", email)`);
      expect((s.match(new RegExp(`logInviteResult\\("${name}"`, 'g')) ?? []).length).toBe(3);
      // o convite leva só o nome da escola como user_metadata (template do Supabase)
      expect(s).toMatch(/data: \{[^}]*school_name/);
      // e-mail nunca é interpolado em log novo
      expect(s).not.toMatch(/console\.log\([^)]*email/);
    });
  }
});
