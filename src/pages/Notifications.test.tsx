// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { NotificationItem } from '@/lib/notificationText';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), mark: vi.fn(), navigate: vi.fn(),
  // Contexto do usuário: o padrão é um admin comum na própria escola; os testes do master sobrescrevem.
  auth: { profile: { school_id: 'casa' } as { school_id: string | null } | null },
  master: { isMasterAdmin: false, viewingSchoolId: null as string | null },
  role: { role: 'admin' as string | null },
}));

vi.mock('@/lib/notifications', async () => ({
  ...(await vi.importActual<typeof import('@/lib/notifications')>('@/lib/notifications')),
  listNotifications: mocks.list,
  markNotificationsRead: mocks.mark,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/contexts/MasterAdminContext', () => ({ useMasterAdmin: () => mocks.master }));
vi.mock('@/hooks/use-role', () => ({ useRole: () => mocks.role }));
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => mocks.navigate,
}));

import Notifications from './Notifications';

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const item = (id: string, o: Partial<NotificationItem> = {}): NotificationItem => ({
  id, event: 'tuition_overdue', reference_date: today(), offset_days: 5, item_count: 12,
  total_amount: 6840, details: { class_count: 3 }, read_at: null, created_at: new Date().toISOString(), ...o,
});
const resp = (items: NotificationItem[], o: Partial<{ filteredTotal: number; total: number; unread: number }> = {}) =>
  ({ items, filteredTotal: items.length, total: items.length, unread: items.length, ...o });

const renderPage = () => render(<MemoryRouter><Notifications /></MemoryRouter>);

beforeEach(() => {
  mocks.mark.mockResolvedValue(1);
  mocks.auth.profile = { school_id: 'casa' };
  mocks.master.isMasterAdmin = false;
  mocks.master.viewingSchoolId = null;
  mocks.role.role = 'admin';
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Central de notificações: master e escola visualizada (D4)', () => {
  it('master visualizando OUTRA escola: mostra o aviso e NÃO consulta nem lista nada (sem avisos da escola de casa)', async () => {
    mocks.master.isMasterAdmin = true;
    mocks.master.viewingSchoolId = 'outra';
    mocks.list.mockResolvedValue(resp([item('da-escola-de-casa')]));
    renderPage();
    expect(await screen.findByText(/visualizando outra escola/i)).toBeTruthy();
    expect(screen.queryByText(/mensalidades vencidas/)).toBeNull();
    expect(screen.queryByRole('tab', { name: /Todas/ })).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('master na PRÓPRIA escola: carrega normalmente', async () => {
    mocks.master.isMasterAdmin = true;
    mocks.master.viewingSchoolId = 'casa';
    mocks.list.mockResolvedValue(resp([item('a')]));
    renderPage();
    expect(await screen.findByText('12 mensalidades vencidas há mais de 5 dias')).toBeTruthy();
    expect(screen.queryByText(/visualizando outra escola/i)).toBeNull();
  });

  it('perfil ainda não carregou: não decide nada e não consulta (evita piscar a escola errada)', async () => {
    mocks.auth.profile = null;
    mocks.master.isMasterAdmin = true;
    mocks.master.viewingSchoolId = 'outra';
    mocks.list.mockResolvedValue(resp([item('a')]));
    renderPage();
    await waitFor(() => expect(screen.queryByText(/mensalidades vencidas/)).toBeNull());
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('usuário comum (não master) carrega mesmo com viewingSchoolId diferente', async () => {
    mocks.master.viewingSchoolId = 'outra';
    mocks.list.mockResolvedValue(resp([item('a')]));
    renderPage();
    expect(await screen.findByText('12 mensalidades vencidas há mais de 5 dias')).toBeTruthy();
  });
});

describe('Central de notificações', () => {
  it('carrega a lista, agrupa em "Hoje" e mostra as contagens nas abas', async () => {
    mocks.list.mockResolvedValue(resp([item('a'), item('b', { event: 'reenrollment', item_count: 4, offset_days: 45, total_amount: null, details: { renewed_count: 1 } })], { total: 7, unread: 2 }));
    renderPage();
    expect(await screen.findByText('12 mensalidades vencidas há mais de 5 dias')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Hoje' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Todas · 7' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Não lidas · 2' })).toBeTruthy();
    expect(screen.getByText('4 contratos terminam em 45 dias')).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledWith({ offset: 0, limit: 20, unreadOnly: false, category: null });
  });

  it('não lido tem marcação textual para leitor de tela; lido não tem', async () => {
    mocks.list.mockResolvedValue(resp([item('a'), item('b', { read_at: new Date().toISOString() })]));
    renderPage();
    await screen.findAllByText(/mensalidades vencidas/);
    expect(screen.getAllByText('Não lida:')).toHaveLength(1);
  });

  it('estado vazio geral', async () => {
    mocks.list.mockResolvedValue(resp([], { total: 0, unread: 0 }));
    renderPage();
    expect(await screen.findByText('Nenhuma notificação ainda.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Marcar todas como lidas/ })).toBeNull();
  });

  it('aba de categoria sem itens (mas com avisos em outras): "Nenhuma notificação nesta categoria."', async () => {
    mocks.list.mockResolvedValueOnce(resp([item('a')], { total: 1, unread: 1 }));
    renderPage();
    await screen.findByText(/mensalidades vencidas/);
    mocks.list.mockResolvedValueOnce(resp([], { total: 1, unread: 1, filteredTotal: 0 }));
    await userEvent.click(screen.getByRole('tab', { name: 'Despesas' }));
    expect(await screen.findByText('Nenhuma notificação nesta categoria.')).toBeTruthy();
    expect(mocks.list).toHaveBeenLastCalledWith({ offset: 0, limit: 20, unreadOnly: false, category: 'despesas' });
  });

  it('aba "Não lidas" pede só não lidas', async () => {
    mocks.list.mockResolvedValue(resp([item('a')]));
    renderPage();
    await screen.findByText(/mensalidades vencidas/);
    await userEvent.click(screen.getByRole('tab', { name: /Não lidas/ }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ offset: 0, limit: 20, unreadOnly: true, category: null }));
  });

  it('"Carregar mais" pede o próximo offset, não duplica ids e some quando acaba', async () => {
    mocks.list.mockResolvedValueOnce(resp([item('a'), item('b')], { filteredTotal: 3, total: 3, unread: 3 }));
    renderPage();
    expect(await screen.findByText('Mostrando 2 de 3 notificações')).toBeTruthy();
    // a página seguinte repete o 'b' (geração deslocou o offset) e traz o 'c'
    mocks.list.mockResolvedValueOnce(resp([item('b'), item('c')], { filteredTotal: 3, total: 3, unread: 3 }));
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Mostrando 3 de 3 notificações')).toBeTruthy();
    expect(mocks.list).toHaveBeenLastCalledWith({ offset: 2, limit: 20, unreadOnly: false, category: null });
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('botão de ação marca como lido e navega; aviso lido só navega', async () => {
    mocks.list.mockResolvedValue(resp([item('a'), item('b', { event: 'reenrollment', item_count: 2, offset_days: 45, total_amount: null, details: { renewed_count: 0 }, read_at: new Date().toISOString() })]));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Ver cobranças' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/mensalidades?status=overdue'));
    expect(mocks.mark).toHaveBeenCalledWith(['a']);
    mocks.mark.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir rematrícula' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/rematricula'));
    expect(mocks.mark).not.toHaveBeenCalled();
  });

  it('"Marcar todas como lidas" chama o RPC com null e recarrega', async () => {
    mocks.list.mockResolvedValueOnce(resp([item('a')]));
    renderPage();
    mocks.list.mockResolvedValueOnce(resp([item('a', { read_at: new Date().toISOString() })], { unread: 0 }));
    await userEvent.click(await screen.findByRole('button', { name: /Marcar todas como lidas/ }));
    expect(mocks.mark).toHaveBeenCalledWith(null);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Marcar todas como lidas/ })).toBeNull());
  });

  it('erro de carregamento: mensagem e "Tentar de novo" que recarrega', async () => {
    mocks.list.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Não foi possível carregar as notificações.')).toBeTruthy();
    mocks.list.mockResolvedValueOnce(resp([item('a')]));
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText(/mensalidades vencidas/)).toBeTruthy();
  });
});
