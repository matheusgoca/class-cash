// @vitest-environment jsdom
// O convite nunca deixa a tela parada em "Enviando": mesmo com o POST bloqueado por CORS (TypeError "Failed to fetch").
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 's1', school: { name: 'Escola Teste' } }) }));
vi.mock('@/components/settings/MfaRecoveryButton', () => ({ MfaRecoveryButton: () => null }));
vi.mock('@/integrations/supabase/client', () => {
  // qualquer cadeia .from(...).select(...).eq(...)... resolve com listas vazias
  const chain = (): unknown =>
    new Proxy(function () {}, {
      get: (_t, p) => (p === 'then' ? (res: (v: unknown) => void) => res({ data: [], error: null }) : () => chain()),
    });
  return {
    supabase: {
      from: () => chain(),
      auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    },
  };
});

import Team from './Team';

beforeEach(() => toast.mockClear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openAndSend() {
  render(<Team />);
  fireEvent.click(await screen.findByRole('button', { name: /Convidar membro/ }));
  fireEvent.change(await screen.findByPlaceholderText('colaborador@email.com'), { target: { value: 'novo@exemplo.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }));
}

describe('Team: convite', () => {
  it('POST bloqueado por CORS (Failed to fetch): mostra a mensagem em português e libera o botão', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await openAndSend();
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({
      title: 'Erro',
      variant: 'destructive',
      description: 'Não foi possível enviar o convite. Verifique se você está em app.classcash.com.br e tente novamente.',
    });
    // a tela não ficou presa: o botão voltou a "Enviar convite" e está habilitado
    const btn = await screen.findByRole('button', { name: 'Enviar convite' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('Enviando...')).toBeNull();
  });

  it('504 da função (invite_timeout): mostra a mensagem do servidor e libera o botão', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invite_timeout', message: 'O serviço de e-mail não respondeu a tempo.' }), { status: 504 }),
    ));
    await openAndSend();
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0].description).toBe('O serviço de e-mail não respondeu a tempo.');
    expect(((await screen.findByRole('button', { name: 'Enviar convite' })) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sucesso: avisa "Convite enviado!" e fecha o modal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })));
    await openAndSend();
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0].title).toBe('Convite enviado!');
    await waitFor(() => expect(screen.queryByPlaceholderText('colaborador@email.com')).toBeNull());
  });
});
