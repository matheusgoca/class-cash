import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));

import { parsePreferencesPayload } from './notificationPreferences';

const raw = {
  preferences: [
    { event: 'tuition_due', direction: 'before', in_app: true, email: false, offset_days: 3, allowed_offsets: [1, 3, 5, 7], email_recommended: false },
    { event: 'tuition_overdue', direction: 'after', in_app: true, email: true, offset_days: 10, allowed_offsets: [1, 3, 5, 10, 15], email_recommended: true },
  ],
  settings: { digest_enabled: true, digest_time: '08:00', timezone: 'America/Sao_Paulo', confirmed_at: '2026-11-18T10:00:00+00:00' },
};

describe('parsePreferencesPayload', () => {
  it('converte snake_case do RPC para o estado da tela', () => {
    const out = parsePreferencesPayload(raw);
    expect(out.confirmedAt).toBe('2026-11-18T10:00:00+00:00');
    expect(out.state.digest).toEqual({ enabled: true, time: '08:00' });
    expect(out.state.preferences[1]).toEqual({
      event: 'tuition_overdue', direction: 'after', inApp: true, email: true,
      offsetDays: 10, options: [1, 3, 5, 10, 15], emailRecommended: true,
    });
  });
  it('confirmed_at ausente vira null', () => {
    const out = parsePreferencesPayload({ ...raw, settings: { ...raw.settings, confirmed_at: null } });
    expect(out.confirmedAt).toBeNull();
  });
  it('payload sem preferences ou settings lança erro amigável', () => {
    expect(() => parsePreferencesPayload(null)).toThrow('Resposta inesperada do servidor.');
    expect(() => parsePreferencesPayload({ preferences: [] })).toThrow('Resposta inesperada do servidor.');
  });
});
