import { describe, it, expect } from 'vitest';
import {
  DIGEST_HOURS, EVENT_LABELS, applyRecommendedEmails, canSave, formatOffset, isDirty, updatePreference,
  type PreferencesState,
} from './notificationEvents';

const base = (): PreferencesState => ({
  preferences: [
    { event: 'tuition_due', direction: 'before', inApp: true, email: false, offsetDays: 3, options: [1, 3, 5, 7], emailRecommended: false },
    { event: 'tuition_overdue', direction: 'after', inApp: true, email: false, offsetDays: 5, options: [1, 3, 5, 10, 15], emailRecommended: true },
    { event: 'renegotiation_installment', direction: 'before', inApp: true, email: false, offsetDays: 1, options: [0, 1, 2, 3], emailRecommended: true },
  ],
  digest: { enabled: false, time: '07:00' },
});

describe('formatOffset', () => {
  it('antes: 0 é "No dia", 1 no singular, n no plural', () => {
    expect(formatOffset('before', 0)).toBe('No dia');
    expect(formatOffset('before', 1)).toBe('1 dia antes');
    expect(formatOffset('before', 45)).toBe('45 dias antes');
  });
  it('depois: "Após n dia(s)"', () => {
    expect(formatOffset('after', 1)).toBe('Após 1 dia');
    expect(formatOffset('after', 5)).toBe('Após 5 dias');
  });
});

describe('EVENT_LABELS e DIGEST_HOURS', () => {
  it('rótulos do mockup', () => {
    expect(EVENT_LABELS.tuition_due).toEqual({ label: 'Mensalidade a vencer', description: 'Lembrete antes do vencimento' });
    expect(EVENT_LABELS.reenrollment.label).toBe('Rematrícula');
  });
  it('horas cheias das 06:00 às 20:00', () => {
    expect(DIGEST_HOURS[0]).toBe('06:00');
    expect(DIGEST_HOURS[DIGEST_HOURS.length - 1]).toBe('20:00');
    expect(DIGEST_HOURS).toHaveLength(15);
  });
});

describe('isDirty', () => {
  it('igual → false; mudou canal, antecedência ou resumo → true', () => {
    expect(isDirty(base(), base())).toBe(false);
    const a = base(); a.preferences[0].email = true;
    expect(isDirty(base(), a)).toBe(true);
    const b = base(); b.preferences[1].offsetDays = 10;
    expect(isDirty(base(), b)).toBe(true);
    const c = base(); c.digest.time = '08:00';
    expect(isDirty(base(), c)).toBe(true);
  });
});

describe('applyRecommendedEmails', () => {
  it('liga e-mail só nos recomendados, sem mutar o original', () => {
    const draft = base();
    const out = applyRecommendedEmails(draft);
    expect(out.preferences.map((p) => p.email)).toEqual([false, true, true]);
    expect(draft.preferences.map((p) => p.email)).toEqual([false, false, false]);
    expect(out.digest).toEqual(draft.digest);
  });

  it('não liga e-mail em evento recomendado com "No sistema" desligado', () => {
    const draft = base();
    draft.preferences[1].inApp = false;
    const out = applyRecommendedEmails(draft);
    expect(out.preferences.map((p) => p.email)).toEqual([false, false, true]);
  });
});

describe('updatePreference (o e-mail acompanha o aviso no sistema)', () => {
  const pref = () => ({ ...base().preferences[1], inApp: true, email: true });

  it('desligar "No sistema" desliga o e-mail junto', () => {
    expect(updatePreference(pref(), { inApp: false })).toMatchObject({ inApp: false, email: false });
  });

  it('ligar e-mail com "No sistema" desligado não tem efeito', () => {
    const p = { ...pref(), inApp: false, email: false };
    expect(updatePreference(p, { email: true })).toMatchObject({ inApp: false, email: false });
  });

  it('religar "No sistema" não religa o e-mail sozinho', () => {
    const p = { ...pref(), inApp: false, email: false };
    expect(updatePreference(p, { inApp: true })).toMatchObject({ inApp: true, email: false });
  });

  it('com "No sistema" ligado, e-mail e antecedência mudam normalmente, sem mutar o original', () => {
    const p = pref();
    expect(updatePreference(p, { email: false })).toMatchObject({ inApp: true, email: false });
    expect(updatePreference(p, { offsetDays: 10 })).toMatchObject({ inApp: true, email: true, offsetDays: 10 });
    expect(p).toMatchObject({ inApp: true, email: true, offsetDays: 5 });
  });
});

describe('canSave', () => {
  it('primeiro acesso (confirmedAt nulo): sempre pode salvar', () => {
    expect(canSave(base(), base(), null)).toBe(true);
  });
  it('depois de confirmado: só com mudança', () => {
    expect(canSave(base(), base(), '2026-11-18T10:00:00Z')).toBe(false);
    const d = base(); d.digest.enabled = true;
    expect(canSave(base(), d, '2026-11-18T10:00:00Z')).toBe(true);
  });
});
