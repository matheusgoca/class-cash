// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const auth = { user: null as unknown, loading: false };
const master = { isMasterAdmin: false };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/MasterAdminContext', () => ({ useMasterAdmin: () => master }));
vi.mock('@/pages/Landing', () => ({ default: () => <div>LANDING</div> }));

import { RootRoute } from './RootRoute';

beforeEach(() => { auth.user = null; auth.loading = false; master.isMasterAdmin = false; });
afterEach(() => cleanup());

const renderAt = (hostname: string) =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<RootRoute hostname={hostname} />} />
        <Route path="/auth" element={<div>TELA DE LOGIN</div>} />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
        <Route path="/master" element={<div>PAINEL MASTER</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('RootRoute por domínio', () => {
  it.each(['app.classcash.com.br', 'class-cash-tan.vercel.app', 'APP.CLASSCASH.COM.BR:443'])('visitante em %s vai para o login', (h) => {
    renderAt(h);
    expect(screen.getByText('TELA DE LOGIN')).toBeTruthy();
    expect(screen.queryByText('LANDING')).toBeNull();
  });

  it.each(['classcash.com.br', 'www.classcash.com.br', 'localhost', 'class-cash-git-x-matheusgocas-projects.vercel.app', 'app.classcash.com.br.evil.com'])('visitante em %s continua na LP', (h) => {
    renderAt(h);
    expect(screen.getByText('LANDING')).toBeTruthy();
    expect(screen.queryByText('TELA DE LOGIN')).toBeNull();
  });

  it('usuário logado: dashboard em qualquer host (como hoje)', () => {
    auth.user = { id: 'u1' };
    for (const h of ['app.classcash.com.br', 'classcash.com.br', 'localhost']) {
      cleanup();
      renderAt(h);
      expect(screen.getByText('DASHBOARD')).toBeTruthy();
    }
  });

  it('master logado vai para /master', () => {
    auth.user = { id: 'u1' };
    master.isMasterAdmin = true;
    renderAt('app.classcash.com.br');
    expect(screen.getByText('PAINEL MASTER')).toBeTruthy();
  });

  it('enquanto a sessão carrega, não mostra nada nem redireciona (não perde o token do link)', () => {
    auth.loading = true;
    const { container } = renderAt('app.classcash.com.br');
    expect(container.textContent).toBe('');
  });

  it('sem a prop hostname usa o host da janela (jsdom = localhost: LP)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<RootRoute />} />
          <Route path="/auth" element={<div>TELA DE LOGIN</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('LANDING')).toBeTruthy();
  });
});
