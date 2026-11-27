// @vitest-environment jsdom
// Login: só entrada (acesso por convite). Convite, recuperação e "Esqueci minha senha" não dependem da aba Cadastrar.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ signIn: vi.fn(), user: null }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }), setSession: vi.fn() }, functions: { invoke: vi.fn() } },
}));

import Auth from './Auth';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

const renderAuth = () => render(<MemoryRouter><Auth /></MemoryRouter>);

describe('Auth', () => {
  it('não oferece cadastro público e mostra o contato oficial', () => {
    renderAuth();
    expect(screen.queryByRole('tab', { name: /Cadastrar/ })).toBeNull();
    expect(screen.queryByText(/Cadastrar/)).toBeNull();
    expect(screen.queryByText(/crie uma nova/i)).toBeNull();
    expect(screen.getByText('Entre com sua conta')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'contato@classcash.com.br' });
    expect(link.getAttribute('href')).toBe('mailto:contato@classcash.com.br');
    expect(screen.getByText(/Acesso por convite/)).toBeTruthy();
  });

  it('?mode=signup não abre cadastro: continua só com o login', () => {
    window.history.replaceState(null, '', '/auth?mode=signup');
    renderAuth();
    expect(screen.queryByLabelText('Nome Completo')).toBeNull();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy();
  });

  it('"Esqueci minha senha" continua funcionando', () => {
    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }));
    expect(screen.queryByRole('button', { name: 'Esqueci minha senha' })).toBeNull();
    expect(document.querySelector('input[type="email"]')).toBeTruthy();
  });

  it('link de convite (hash type=invite) abre a tela de definir senha', () => {
    window.history.replaceState(null, '', '/auth#access_token=a&refresh_token=b&type=invite');
    renderAuth();
    expect(screen.getByText('Bem-vindo ao Class Cash!')).toBeTruthy();
  });
});
