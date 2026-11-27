// @vitest-environment jsdom
// Equipe: a linha do próprio usuário aparece com o selo "Você" e sem ações; os demais mantêm as ações.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-eu' } }) }));
vi.mock('@/contexts/SchoolContext', () => ({
  useSchool: () => ({ schoolId: 's1', school: { name: 'Escola Teste', owner_user_id: 'u-owner' } }),
}));
vi.mock('@/components/settings/MfaRecoveryButton', () => ({
  MfaRecoveryButton: ({ fullName }: { fullName: string }) => <button>Redefinir 2FA de {fullName}</button>,
}));
vi.mock('@/integrations/supabase/client', () => {
  const data: Record<string, unknown[]> = {
    profiles: [
      { user_id: 'u-eu', full_name: 'Eu Admin', email: 'eu@x.com', created_at: '2026-06-01T00:00:00Z' },
      { user_id: 'u-owner', full_name: 'Dona Escola', email: 'dona@x.com', created_at: '2026-05-01T00:00:00Z' },
      { user_id: 'u-fin', full_name: 'Fin Colega', email: 'fin@x.com', created_at: '2026-07-01T00:00:00Z' },
    ],
    user_roles: [{ user_id: 'u-eu', role: 'admin' }, { user_id: 'u-fin', role: 'financial' }],
    invitations: [],
  };
  const from = (table: string) => {
    const c: Record<string, unknown> = { select: () => c, eq: () => c, in: () => c, order: () => c, then: (res: (v: unknown) => unknown) => res({ data: data[table] ?? [], error: null }) };
    return c;
  };
  return { supabase: { from, auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } };
});

import Team from './Team';

afterEach(() => cleanup());

describe('Team: linha do próprio usuário', () => {
  it('mostra "Você" e nenhuma ação na própria linha; os demais continuam com ações', async () => {
    render(<Team />);
    const eu = (await screen.findByText('Eu Admin')).closest('tr') as HTMLElement;
    expect(within(eu).getByText('Você')).toBeTruthy();
    expect(within(eu).queryByTitle('Editar função')).toBeNull();
    expect(within(eu).queryByTitle('Remover acesso')).toBeNull();
    expect(within(eu).queryByText(/Redefinir 2FA/)).toBeNull();

    const fin = screen.getByText('Fin Colega').closest('tr') as HTMLElement;
    expect(within(fin).queryByText('Você')).toBeNull();
    expect(within(fin).getByTitle('Editar função')).toBeTruthy();
    expect(within(fin).getByTitle('Remover acesso')).toBeTruthy();
    expect(within(fin).getByText(/Redefinir 2FA/)).toBeTruthy();

    // owner: sem editar/remover (como antes), mas com redefinir 2FA
    const dona = screen.getByText('Dona Escola').closest('tr') as HTMLElement;
    expect(within(dona).queryByTitle('Remover acesso')).toBeNull();
    expect(within(dona).getByText(/Redefinir 2FA/)).toBeTruthy();
  });
});
