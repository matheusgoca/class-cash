// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

const rpc = vi.fn();
const toast = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

import { SchoolEmailSwitch } from './SchoolEmailSwitch';

beforeEach(() => { rpc.mockReset(); toast.mockReset(); });
afterEach(() => cleanup());

const setup = (enabled: boolean, onChanged = vi.fn()) => {
  render(<SchoolEmailSwitch schoolId="escola-1" schoolName="Colégio Exemplo" enabled={enabled} onChanged={onChanged} />);
  return onChanged;
};

describe('SchoolEmailSwitch (S6 bloco 1, painel master)', () => {
  it('mostra o estado atual e o interruptor acessível', () => {
    setup(false);
    expect(screen.getByText(/E-mail de avisos/)).toBeTruthy();
    expect(screen.getByText(/Desligado/)).toBeTruthy();
    expect(screen.getByRole('switch', { name: /E-mail de avisos de Colégio Exemplo/ })).toBeTruthy();
  });

  it('ligar pede confirmação, avisa que as outras travas continuam e só então chama o RPC', async () => {
    rpc.mockResolvedValue({ data: { email_enabled: true, skipped: 0 }, error: null });
    const onChanged = setup(false);
    fireEvent.click(screen.getByRole('switch'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Colégio Exemplo/)).toBeTruthy();
    expect(within(dialog).getByText(/preferências confirmadas/i)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ligar e-mail' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_school_email_enabled', { p_school_id: 'escola-1', p_enabled: true }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(true));
  });

  it('desligar avisa que o que está na fila será pulado (não apagado)', async () => {
    rpc.mockResolvedValue({ data: { email_enabled: false, skipped: 3 }, error: null });
    const onChanged = setup(true);
    fireEvent.click(screen.getByRole('switch'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/pulados, sem apagar/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Desligar e-mail' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_school_email_enabled', { p_school_id: 'escola-1', p_enabled: false }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(false));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringMatching(/3 itens pulados/) }));
  });

  it('cancelar não chama o RPC', async () => {
    setup(false);
    fireEvent.click(screen.getByRole('switch'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(rpc).not.toHaveBeenCalled();
  });

  it('erro do servidor vira mensagem amigável e não muda o estado', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'NOT_ALLOWED', code: '42501' } });
    const onChanged = setup(false);
    fireEvent.click(screen.getByRole('switch'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ligar e-mail' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: expect.stringMatching(/suporte Class Cash/i) })));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
