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

import { AttentionCard } from './AttentionCard';

const pad = (n: number) => String(n).padStart(2, '0');
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const item = (o: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1', event: 'tuition_overdue', reference_date: localToday(), offset_days: 5, item_count: 12,
  total_amount: 6840, details: { class_count: 3 }, read_at: null, created_at: new Date().toISOString(), ...o,
});
const page = (items: NotificationItem[]) => ({ items, filteredTotal: items.length, total: items.length, unread: items.length });
const renderCard = () => render(<MemoryRouter><AttentionCard /></MemoryRouter>);

beforeEach(() => {
  mocks.show.mockReturnValue(true);
  mocks.mark.mockResolvedValue(1);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('AttentionCard', () => {
  it('não renderiza para quem não deve ver e não consulta o servidor', () => {
    mocks.show.mockReturnValue(false);
    const { container } = renderCard();
    expect(container.innerHTML).toBe("");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('mostra os avisos de hoje, a etiqueta "N itens" e o rodapé de geração', async () => {
    mocks.list.mockResolvedValue(page([
      item({ id: 'a' }),
      item({ id: 'b', event: 'expense_due', item_count: 1, offset_days: 2, total_amount: 4200, details: { description: 'Aluguel' } }),
    ]));
    renderCard();
    expect(await screen.findByText('Precisa da sua atenção hoje')).toBeTruthy();
    expect(screen.getByText('2 itens')).toBeTruthy();
    expect(screen.getByText('12 mensalidades vencidas há mais de 5 dias')).toBeTruthy();
    expect(screen.getByText('Despesa a pagar: Aluguel')).toBeTruthy();
    expect(screen.getByText(/^Gerado hoje às \d{2}:\d{2}$/)).toBeTruthy();
  });

  it('singular: "1 item"', async () => {
    mocks.list.mockResolvedValue(page([item()]));
    renderCard();
    expect(await screen.findByText('1 item')).toBeTruthy();
  });

  it('só mostra os avisos do reference_date mais recente (ignora dias anteriores)', async () => {
    mocks.list.mockResolvedValue(page([item({ id: 'a' }), item({ id: 'old', reference_date: '2020-01-01', event: 'reenrollment', item_count: 4, offset_days: 45, details: { renewed_count: 1 } })]));
    renderCard();
    await screen.findByText('1 item');
    expect(screen.queryByText(/contratos terminam/)).toBeNull();
  });

  it('se o aviso mais recente não é de hoje, mostra "Nada pendente para hoje."', async () => {
    mocks.list.mockResolvedValue(page([item({ reference_date: '2020-01-01' })]));
    renderCard();
    expect(await screen.findByText('Nada pendente para hoje.')).toBeTruthy();
    expect(screen.queryByText(/itens?$/)).toBeNull();
  });

  it('sem avisos: "Nada pendente para hoje."', async () => {
    mocks.list.mockResolvedValue(page([]));
    renderCard();
    expect(await screen.findByText('Nada pendente para hoje.')).toBeTruthy();
  });

  it('falha no servidor: cai em "Nada pendente" sem quebrar a tela', async () => {
    mocks.list.mockRejectedValue(new Error('boom'));
    renderCard();
    expect(await screen.findByText('Nada pendente para hoje.')).toBeTruthy();
  });

  it('botão de ação marca como lido e navega', async () => {
    mocks.list.mockResolvedValue(page([item()]));
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Ver cobranças' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/mensalidades?status=overdue'));
    expect(mocks.mark).toHaveBeenCalledWith(['n1']);
  });

  it('aviso já lido: navega sem chamar o RPC de marcar', async () => {
    mocks.list.mockResolvedValue(page([item({ read_at: new Date().toISOString() })]));
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Ver cobranças' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.mark).not.toHaveBeenCalled();
  });
});
