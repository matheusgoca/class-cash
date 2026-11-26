// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ReversePaymentDialog } from './ReversePaymentDialog';

afterEach(() => cleanup());

const base = { studentName: 'Ana', description: 'Mensalidade novembro de 2026', paidDate: '2026-11-20', finalAmount: 985, amount: 1000 };

describe('ReversePaymentDialog', () => {
  it('avisa o impacto no Realizado do mês antes de confirmar', () => {
    render(<ReversePaymentDialog {...base} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /Estornar baixa/ })).toBeTruthy();
    expect(screen.getByText(/Realizado de novembro de 2026/)).toBeTruthy();
    expect(screen.getByText(/R\$\s*985,00/)).toBeTruthy();
    expect(screen.getByText(/Ana/)).toBeTruthy();
  });
  it('confirma e cancela', () => {
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<ReversePaymentDialog {...base} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Estornar baixa' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it('enquanto estorna, o botão fica desabilitado (sem clique duplo)', () => {
    const onConfirm = vi.fn();
    render(<ReversePaymentDialog {...base} loading onConfirm={onConfirm} onCancel={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /Estornando/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
