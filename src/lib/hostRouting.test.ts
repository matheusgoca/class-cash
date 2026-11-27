import { describe, it, expect } from 'vitest';
import { APP_HOSTS, isAppHost } from './hostRouting';

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
