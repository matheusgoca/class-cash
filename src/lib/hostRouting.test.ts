import { describe, it, expect } from 'vitest';
import { APP_HOSTS, APP_ORIGIN, LANDING_HOSTS, LANDING_PATHS, appRedirectTarget, isAppHost, isLandingHost } from './hostRouting';

describe('hostRouting: domínios do app (S6, roteamento por host)', () => {
  it('a lista é exatamente os dois hosts do app', () => {
    expect([...APP_HOSTS].sort()).toEqual(['app.classcash.com.br', 'class-cash-tan.vercel.app']);
  });

  it.each(['app.classcash.com.br', 'class-cash-tan.vercel.app'])('%s é host de app', (h) => {
    expect(isAppHost(h)).toBe(true);
  });

  it('ignora maiúsculas e minúsculas', () => {
    expect(isAppHost('APP.ClassCash.com.BR')).toBe(true);
    expect(isAppHost('Class-Cash-Tan.Vercel.App')).toBe(true);
  });

  it('ignora a porta', () => {
    expect(isAppHost('app.classcash.com.br:443')).toBe(true);
    expect(isAppHost('class-cash-tan.vercel.app:3000')).toBe(true);
  });

  it('aceita o ponto final de FQDN (o navegador pode devolver "host.")', () => {
    expect(isAppHost('app.classcash.com.br.')).toBe(true);
  });

  it.each(['classcash.com.br', 'www.classcash.com.br'])('%s é a LP, não o app', (h) => {
    expect(isAppHost(h)).toBe(false);
  });

  it('previews da Vercel, localhost e vazio seguem na LP', () => {
    for (const h of ['class-cash-git-feature-x-matheusgocas-projects.vercel.app', 'class-cash-abc123.vercel.app', 'localhost', 'localhost:8080', '127.0.0.1', '', '   ']) {
      expect(isAppHost(h)).toBe(false);
    }
  });

  it('match EXATO, nunca por sufixo nem por prefixo', () => {
    for (const h of [
      'app.classcash.com.br.evil.com',
      'evil-app.classcash.com.br',
      'xapp.classcash.com.br',
      'app.classcash.com.br.br',
      'sub.app.classcash.com.br',
      'app.classcash.com',
      'class-cash-tan.vercel.app.evil.com',
      'evil.class-cash-tan.vercel.app',
      'app.classcash.com.br@evil.com',
      'evil.com/app.classcash.com.br',
    ]) {
      expect(isAppHost(h)).toBe(false);
    }
  });

  it('valores não texto nunca são host de app', () => {
    expect(isAppHost(undefined as unknown as string)).toBe(false);
    expect(isAppHost(null as unknown as string)).toBe(false);
  });
});

describe('domínio único do app (convite bloqueado por CORS em classcash.com.br/equipe)', () => {
  const to = (hostname: string, pathname: string, search = '', hash = '') => appRedirectTarget({ hostname, pathname, search, hash });

  it('as páginas da LP são exatamente "/", "/privacidade" e "/termos" (as rotas públicas do App.tsx)', () => {
    expect([...LANDING_PATHS].sort()).toEqual(['/', '/privacidade', '/termos']);
    expect([...LANDING_HOSTS].sort()).toEqual(['classcash.com.br', 'www.classcash.com.br']);
    expect(APP_ORIGIN).toBe('https://app.classcash.com.br');
  });

  it.each(['classcash.com.br', 'www.classcash.com.br'])('%s: rota do app vai para app.classcash.com.br com o mesmo caminho', (h) => {
    expect(to(h, '/equipe')).toBe('https://app.classcash.com.br/equipe');
    expect(to(h, '/dashboard')).toBe('https://app.classcash.com.br/dashboard');
    expect(to(h, '/auth')).toBe('https://app.classcash.com.br/auth');
    expect(to(h, '/master/historico')).toBe('https://app.classcash.com.br/master/historico');
    expect(to(h, '/rota-que-nao-existe')).toBe('https://app.classcash.com.br/rota-que-nao-existe');
  });

  it('preserva query e hash (ex.: filtros e tokens de confirmação)', () => {
    expect(to('classcash.com.br', '/mensalidades', '?status=overdue&page=2', '#topo')).toBe('https://app.classcash.com.br/mensalidades?status=overdue&page=2#topo');
    expect(to('www.classcash.com.br', '/auth', '', '#access_token=abc&type=invite')).toBe('https://app.classcash.com.br/auth#access_token=abc&type=invite');
    expect(to('classcash.com.br', '/notificacoes/preferencias', '?x=1')).toBe('https://app.classcash.com.br/notificacoes/preferencias?x=1');
  });

  it('NÃO redireciona as páginas da LP (nem com query, hash, barra final ou maiúsculas)', () => {
    for (const h of ['classcash.com.br', 'www.classcash.com.br']) {
      for (const p of ['/', '/privacidade', '/termos', '/privacidade/', '/Termos', '/PRIVACIDADE//']) expect(to(h, p)).toBeNull();
      expect(to(h, '/', '?utm_source=x', '#faq')).toBeNull();
    }
  });

  it('sem query e hash passados, não inventa "undefined"', () => {
    expect(appRedirectTarget({ hostname: 'classcash.com.br', pathname: '/equipe' })).toBe('https://app.classcash.com.br/equipe');
  });

  it('o app, a Vercel, previews e localhost NÃO mudam (nem em rotas do app)', () => {
    for (const h of ['app.classcash.com.br', 'class-cash-tan.vercel.app', 'class-cash-git-x-matheusgocas-projects.vercel.app', 'localhost', '127.0.0.1', '']) {
      expect(to(h, '/equipe', '?a=1', '#b')).toBeNull();
      expect(to(h, '/', '', '')).toBeNull();
    }
  });

  it('ignora maiúsculas, porta e ponto final no host; match EXATO (sem sufixo nem prefixo)', () => {
    expect(to('ClassCash.com.BR', '/equipe')).toBe('https://app.classcash.com.br/equipe');
    expect(to('classcash.com.br.', '/equipe')).toBe('https://app.classcash.com.br/equipe');
    for (const h of ['classcash.com.br.evil.com', 'evilclasscash.com.br', 'sub.classcash.com.br', 'app.classcash.com.br.evil.com', 'xwww.classcash.com.br']) {
      expect(isLandingHost(h)).toBe(false);
      expect(to(h, '/equipe')).toBeNull();
    }
  });

  it('o destino nunca é um host de LP (sem laço de redirecionamento) e é sempre https no app', () => {
    for (const h of ['classcash.com.br', 'www.classcash.com.br']) {
      for (const p of ['/equipe', '/auth', '//evil.com', '/\\evil.com', '/a/../b']) {
        const t = to(h, p)!;
        const u = new URL(t);
        expect(u.origin).toBe('https://app.classcash.com.br');
        expect(appRedirectTarget({ hostname: u.hostname, pathname: u.pathname })).toBeNull();
      }
    }
  });
});
