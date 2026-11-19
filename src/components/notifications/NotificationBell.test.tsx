// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { NotificationItem } from '@/lib/notificationText';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  mark: vi.fn(),
  show: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@/lib/notifications', () => ({ listNotifications: mocks.list, markNotificationsRead: mocks.mark }));
vi.mock('@/hooks/use-show-notifications', () => ({ useShowNotifications: () => mocks.show() }));
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => mocks.navigate,
}));

import { NotificationBell } from './NotificationBell';

const item = (o: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1', event: 'tuition_overdue', reference_date: '2026-11-19', offset_days: 5, item_count: 12,
  total_amount: 6840, details: { class_count: 3 }, read_at: null, created_at: '2026-11-19T08:00:00Z', ...o,
});
const page = (items: NotificationItem[], unread = items.length) =>
  ({ items, filteredTotal: items.length, total: items.length, unread });

const renderBell = () => render(<MemoryRouter><NotificationBell /></MemoryRouter>);

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  mocks.show.mockReturnValue(true);
  mocks.mark.mockResolvedValue(1);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('NotificationBell', () => {
  it('não renderiza nada para quem não deve ver (ex.: professor) e nem consulta o servidor', () => {
    mocks.show.mockReturnValue(false);
    const { container } = renderBell();
    expect(container.innerHTML).toBe("");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('mostra o selo e o aria-label com o total de não lidas', async () => {
    mocks.list.mockResolvedValue(page([item()], 3));
    renderBell();
    expect(await screen.findByRole('button', { name: 'Notificações, 3 não lidas' })).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('mostra "9+" acima de 9 não lidas', async () => {
    mocks.list.mockResolvedValue(page([item()], 25));
    renderBell();
    expect(await screen.findByText('9+')).toBeTruthy();
  });

  it('sem não lidas: sem selo e "Tudo em dia." no popover', async () => {
    mocks.list.mockResolvedValue(page([], 0));
    renderBell();
    const btn = await screen.findByRole('button', { name: 'Notificações, 0 não lidas' });
    expect(btn.textContent).toBe('');
    await userEvent.click(btn);
    expect(await screen.findByText('Tudo em dia.')).toBeTruthy();
    expect(screen.queryByText('Marcar todas como lidas')).toBeNull();
  });

  it('pede só os 4 não lidos mais recentes', async () => {
    mocks.list.mockResolvedValue(page([item()]));
    renderBell();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({ offset: 0, limit: 4, unreadOnly: true }));
  });

  it('falha no servidor: só o ícone, sem selo e sem quebrar', async () => {
    mocks.list.mockRejectedValue(new Error('boom'));
    renderBell();
    const btn = await screen.findByRole('button', { name: 'Notificações, 0 não lidas' });
    expect(btn.textContent).toBe('');
  });

  it('clicar num aviso marca como lido e navega para a ação', async () => {
    mocks.list.mockResolvedValue(page([item()]));
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notificações, 1 não lidas/ }));
    await userEvent.click(await screen.findByText('12 mensalidades vencidas há mais de 5 dias'));
    expect(mocks.mark).toHaveBeenCalledWith(['n1']);
    expect(mocks.navigate).toHaveBeenCalledWith('/mensalidades?status=overdue');
  });

  it('"Marcar todas como lidas" chama o RPC com null e recarrega', async () => {
    mocks.list.mockResolvedValue(page([item()]));
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notificações, 1 não lidas/ }));
    mocks.list.mockResolvedValue(page([], 0));
    await userEvent.click(await screen.findByText('Marcar todas como lidas'));
    expect(mocks.mark).toHaveBeenCalledWith(null);
    expect(await screen.findByRole('button', { name: 'Notificações, 0 não lidas' })).toBeTruthy();
  });

  it('o popover tem o link para a central', async () => {
    mocks.list.mockResolvedValue(page([item()]));
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notificações, 1 não lidas/ }));
    const link = await screen.findByRole('link', { name: 'Ver todas as notificações' });
    expect(link.getAttribute('href')).toBe('/notificacoes');
  });
});
