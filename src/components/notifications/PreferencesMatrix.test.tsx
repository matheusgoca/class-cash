// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventPreference } from '@/lib/notificationEvents';
import { PreferencesMatrix } from './PreferencesMatrix';

const prefs = (): EventPreference[] => [
  { event: 'tuition_overdue', direction: 'after', inApp: true, email: true, offsetDays: 5, options: [1, 3, 5, 10, 15], emailRecommended: true },
  { event: 'expense_due', direction: 'before', inApp: false, email: false, offsetDays: 2, options: [0, 1, 2, 3, 5, 7], emailRecommended: false },
];

function Harness({ onChange }: { onChange?: (p: EventPreference[]) => void }) {
  const [value, setValue] = useState(prefs());
  return (
    <PreferencesMatrix
      preferences={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

afterEach(cleanup);

describe('PreferencesMatrix — o e-mail acompanha o aviso no sistema', () => {
  it('mostra o texto da regra', () => {
    render(<Harness />);
    expect(screen.getByText(/o e-mail acompanha o aviso no sistema/i)).toBeTruthy();
  });

  it('desabilita o e-mail quando "No sistema" está desligado', () => {
    render(<Harness />);
    const emailDespesa = screen.getByRole('switch', { name: 'Despesa a pagar por e-mail' });
    expect(emailDespesa.hasAttribute('disabled')).toBe(true);
    const emailAtraso = screen.getByRole('switch', { name: 'Mensalidade em atraso por e-mail' });
    expect(emailAtraso.hasAttribute('disabled')).toBe(false);
  });

  it('desligar "No sistema" desliga o e-mail e desabilita o switch', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Mensalidade em atraso no sistema' }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ event: 'tuition_overdue', inApp: false, email: false }),
      expect.objectContaining({ event: 'expense_due' }),
    ]);
    const emailAtraso = screen.getByRole('switch', { name: 'Mensalidade em atraso por e-mail' });
    expect(emailAtraso.getAttribute('aria-checked')).toBe('false');
    expect(emailAtraso.hasAttribute('disabled')).toBe(true);
  });
});
