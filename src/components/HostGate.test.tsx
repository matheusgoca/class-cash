// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { HostGate } from './HostGate';

afterEach(() => cleanup());

const loc = (hostname: string, pathname: string, search = '', hash = '') => ({ hostname, pathname, search, hash });

describe('HostGate (domínio único do app)', () => {
  it('em classcash.com.br/equipe: redireciona (uma vez) para o app com caminho, query e hash, e não monta o app', () => {
    const replace = vi.fn();
    render(<HostGate location={loc('classcash.com.br', '/equipe', '?a=1', '#h')} replace={replace}><div>APP</div></HostGate>);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('https://app.classcash.com.br/equipe?a=1#h');
    expect(screen.queryByText('APP')).toBeNull();
  });

  it('em www.classcash.com.br/auth também redireciona', () => {
    const replace = vi.fn();
    render(<HostGate location={loc('www.classcash.com.br', '/auth')} replace={replace}><div>APP</div></HostGate>);
    expect(replace).toHaveBeenCalledWith('https://app.classcash.com.br/auth');
  });

  it.each(['/', '/privacidade', '/termos'])('páginas da LP em classcash.com.br%s: não redireciona e mostra o conteúdo', (p) => {
    const replace = vi.fn();
    render(<HostGate location={loc('classcash.com.br', p, '', '#faq')} replace={replace}><div>CONTEUDO</div></HostGate>);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText('CONTEUDO')).toBeTruthy();
  });

  it.each(['app.classcash.com.br', 'class-cash-tan.vercel.app', 'localhost', 'class-cash-git-x-matheusgocas-projects.vercel.app'])(
    '%s: nunca redireciona, mesmo em rota do app',
    (h) => {
      const replace = vi.fn();
      render(<HostGate location={loc(h, '/equipe')} replace={replace}><div>CONTEUDO</div></HostGate>);
      expect(replace).not.toHaveBeenCalled();
      expect(screen.getByText('CONTEUDO')).toBeTruthy();
    },
  );
});
