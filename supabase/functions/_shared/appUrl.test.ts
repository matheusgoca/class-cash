// supabase/functions/_shared/appUrl.test.ts
// redirectTo dos convites derivado de APP_URL, com lista de origens permitidas (anti redirecionamento aberto), fallback na Vercel
// e SEMPRE terminando em /auth (o Auth.tsx lê type=invite/recovery do fragmento ali).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALLOWED_ORIGINS, FALLBACK_ORIGIN, authRedirectUrl } from './appUrl.ts';

const FALLBACK = `${FALLBACK_ORIGIN}/auth`;

describe('authRedirectUrl', () => {
  it('origem permitida: usa a do APP_URL + /auth', () => {
    expect(authRedirectUrl('https://app.classcash.com.br')).toBe('https://app.classcash.com.br/auth');
    expect(authRedirectUrl('https://class-cash-tan.vercel.app')).toBe('https://class-cash-tan.vercel.app/auth');
    expect(authRedirectUrl('http://localhost:8080')).toBe('http://localhost:8080/auth');
  });

  it('barra final, caminho, query e fragmento do APP_URL são ignorados: o resultado é sempre origem + /auth', () => {
    for (const v of ['https://app.classcash.com.br/', 'https://app.classcash.com.br/qualquer/coisa', 'https://app.classcash.com.br/?x=1#y', 'https://app.classcash.com.br//auth']) {
      expect(authRedirectUrl(v)).toBe('https://app.classcash.com.br/auth');
    }
  });

  it('ignora maiúsculas e espaços nas pontas', () => {
    expect(authRedirectUrl(' HTTPS://APP.ClassCash.com.BR ')).toBe('https://app.classcash.com.br/auth');
  });

  it('origem FORA da lista cai no fallback da Vercel (nunca redireciona para domínio estranho)', () => {
    for (const v of [
      'https://evil.com',
      'https://app.classcash.com.br.evil.com',
      'https://evil-app.classcash.com.br',
      'https://sub.app.classcash.com.br',
      'https://classcash.com.br',
      'https://www.classcash.com.br',
      'http://app.classcash.com.br',            // esquema diferente = origem diferente
      'https://app.classcash.com.br:8443',      // porta diferente = origem diferente
      'https://app.classcash.com.br@evil.com',  // truque de userinfo: o host real é evil.com
      'https://evil.com/https://app.classcash.com.br',
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://app.classcash.com.br',
    ]) {
      expect(authRedirectUrl(v)).toBe(FALLBACK);
    }
  });

  it('ausente, vazio ou lixo cai no fallback', () => {
    for (const v of [undefined, null, '', '   ', 'app.classcash.com.br', 'não é url', '//app.classcash.com.br']) {
      expect(authRedirectUrl(v as string | undefined | null)).toBe(FALLBACK);
    }
  });

  it('SEMPRE termina em /auth e nunca tem mais nada depois (propriedade sobre muitas entradas)', () => {
    const entradas = [...ALLOWED_ORIGINS, ...ALLOWED_ORIGINS.map((o) => `${o}/x?y#z`), 'https://evil.com', '', 'lixo', undefined, null];
    for (const e of entradas) {
      const r = authRedirectUrl(e as string | undefined | null);
      expect(r.endsWith('/auth')).toBe(true);
      expect(new URL(r).pathname).toBe('/auth');
      expect(new URL(r).search).toBe('');
      expect(new URL(r).hash).toBe('');
      expect(ALLOWED_ORIGINS).toContain(new URL(r).origin);
    }
  });

  it('o fallback é a origem da Vercel e está na lista', () => {
    expect(FALLBACK_ORIGIN).toBe('https://class-cash-tan.vercel.app');
    expect(ALLOWED_ORIGINS).toContain(FALLBACK_ORIGIN);
  });
});

describe('a lista é a MESMA do CORS das 5 funções', () => {
  const read = (fn: string) => readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');
  const corsList = (src: string) => {
    const m = src.match(/const ALLOWED_ORIGINS = \[([^\]]*)\]/);
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  };

  it.each(['invite-user', 'invite-school-owner', 'accept-invite', 'remove-user', 'reset-user-mfa'])('%s', (fn) => {
    expect(corsList(read(fn))).toEqual([...ALLOWED_ORIGINS]);
  });
});

describe('as funções de convite usam o auxiliar (sem link fixo)', () => {
  const read = (fn: string) => readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');

  it.each(['invite-user', 'invite-school-owner'])('%s deriva o redirectTo de APP_URL', (fn) => {
    const src = read(fn);
    expect(src).toContain('authRedirectUrl(Deno.env.get("APP_URL"))');
    expect(src).not.toMatch(/redirectTo:\s*"https?:\/\//);
  });
});

describe('send-notification-emails: padrão de APP_URL', () => {
  it('o padrão é o app novo, não a Vercel', () => {
    const src = readFileSync(new URL('../send-notification-emails/handler.ts', import.meta.url), 'utf8');
    expect(src).toContain('const DEFAULT_APP_URL = "https://app.classcash.com.br";');
  });
});
